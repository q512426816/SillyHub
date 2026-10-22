/**
 * 思考内容离线翻译 client（2026-10-19-thinking-zh-translate / FR-03 性能核心）。
 *
 * 职责（模块级单例，页面内共享）：
 * - ``needsTranslation`` 启发式：与后端 chunking.py 同规则（中文为主/过短/
 *   拉丁字母太少跳过）——不值得翻直接返回 null 零请求；
 * - ``splitIntoChunks``：长文按段界切 ≤1800 字符/块（后端单条上限 20000、
 *   每请求 16 条——块即请求 item，天然合规）；
 * - 合批队列：250ms 窗口聚合同屏多条为单请求（≤16 item），同文本跨组件
 *   共享单次在途 Promise（Map 去重）；
 * - 内存缓存（full text → 译文，FIFO 上限 500 条）；
 * - 引擎不可用退避：engine_ready=false 后 60s 内直接返回 null（防请求风暴，
 *   FR-01 场景「不可用降级」）。
 *
 * 端点契约：POST /api/translate/thinking（鉴权走 apiFetch 全局 JWT）。
 */
import { apiFetch } from "@/lib/api";

/** 后端限额同源常量（schema.py：ITEMS_MAX_COUNT=16）。 */
const BATCH_MAX_ITEMS = 16;
/** 合批窗口：同屏多条摘要聚成一个网络往返。 */
const BATCH_WINDOW_MS = 250;
/** 引擎不可用退避时长。 */
const UNAVAILABLE_BACKOFF_MS = 60_000;
/**
 * 单次请求超时（2026-10-22-fix-translate-pending 起 POST 必带超时防挂起；
 * 2026-10-23-translate-budget-align 改按批动态）：镜像后端等待预算公式
 * （engine.py `_timeout_for`：基准 20s + 每多一块 2.5s，改动须双侧同步），
 * 按本批**最坏后端块数**估算——前端块 ≤1800 字符，后端 CHUNK_MAX_CHARS=1000
 * 二次细切，每条前端块最多膨胀为 2 块。外加 5s HTTP/线程池余量；前端超时是
 * 兜底而非首道防线（后端预算先到期会 fail-soft 正常返回），满批 16×1800 最坏
 * 32 块 = 102.5s，仍有界防挂起。旧固定 20s 会被 e7ce2a101 实测 21.5s 的正常
 * 满批推理误杀并累计后端崩溃计数（3 次即 600s 退避）。
 */
const BACKEND_TIMEOUT_BASE_MS = 20_000;
const BACKEND_TIMEOUT_PER_CHUNK_MS = 2_500;
const BACKEND_CHUNK_MAX_CHARS = 1_000;
const REQUEST_TIMEOUT_MARGIN_MS = 5_000;

/** 按批动态请求超时：后端公式（最坏块数）+ 余量。 */
export function requestTimeoutMsFor(entries: ReadonlyArray<{ chunk: string }>): number {
  const backendChunks = entries.reduce(
    (sum, entry) => sum + Math.max(1, Math.ceil(entry.chunk.length / BACKEND_CHUNK_MAX_CHARS)),
    0,
  );
  return (
    BACKEND_TIMEOUT_BASE_MS +
    Math.max(0, backendChunks - 1) * BACKEND_TIMEOUT_PER_CHUNK_MS +
    REQUEST_TIMEOUT_MARGIN_MS
  );
}
/** 内存缓存条目上限（FIFO 淘汰——译文纯函数结果，先入者先淘汰足够）。 */
const CACHE_MAX_ENTRIES = 500;

// ── 启发式（与后端 chunking.py 常量同源，改动须双侧同步）────────────────────

const WORTHY_MIN_FLAT_CHARS = 30;
const WORTHY_MIN_LATIN_CHARS = 8;
const WORTHY_CJK_RATIO_MAX = 0.6;
const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff]/g;
const LATIN_RE = /[A-Za-z]/g;

/** 是否值得送翻：英文为主且够长才翻（后端同规则兜底双判定）。 */
export function needsTranslation(text: string): boolean {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length < WORTHY_MIN_FLAT_CHARS) return false;
  const cjk = (flat.match(CJK_RE) || []).length;
  const latin = (flat.match(LATIN_RE) || []).length;
  const denom = cjk + latin;
  if (denom === 0) return false;
  if (cjk / denom >= WORTHY_CJK_RATIO_MAX) return false;
  return latin >= WORTHY_MIN_LATIN_CHARS;
}

// ── 分块（段界优先保段落完整；拼接保真）──────────────────────────────────────

/** 长文按 \n\n+ 段界切为 ≤maxChars 的块（分隔符归上一块尾），拼接恒等于原文。 */
export function splitIntoChunks(text: string, maxChars = 1800): string[] {
  if (!text) return [];
  if (text.length <= maxChars) return [text];
  const parts = text.split(/(\n\n+)/);
  const paragraphs: string[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    paragraphs.push(parts[i] + (parts[i + 1] ?? ""));
  }
  const chunks: string[] = [];
  for (const para of paragraphs) {
    if (para.length > maxChars) {
      // 段内超限：按 maxChars 硬切（前端不做句界——后端送翻前还会二次细切）
      for (let j = 0; j < para.length; j += maxChars) {
        chunks.push(para.slice(j, j + maxChars));
      }
    } else {
      const last = chunks[chunks.length - 1];
      if (last !== undefined && last.length + para.length <= maxChars) {
        chunks[chunks.length - 1] = last + para;
      } else {
        chunks.push(para);
      }
    }
  }
  return chunks;
}

// ── 端点类型（手写，不进 api-types 自动生成面——daemon/sessions.ts 先例）────

interface TranslateApiItemOut {
  id: string;
  text: string;
  translated: boolean;
}
interface TranslateApiResponse {
  ok: boolean;
  engine_ready: boolean;
  reason: string | null;
  items: TranslateApiItemOut[];
}

// ── 模块级缓存 / 退避 / 合批队列 ─────────────────────────────────────────────

const translationCache = new Map<string, string>();
let unavailableUntil = 0;

/**
 * 块级队列（2026-10-19 评审 P2 修复）：队列条目=单块（1 请求 item），跨请求
 * 的多块文本经 Assembler 聚合——任一块所在批次完成即回填，收齐 resolve。
 * 旧「job 整体入队」形态在 >16 块（>28800 字符）时队头永远装不进单批，
 * flush 空批 return 后无人再排程 → 队列卡死（UI 恒「翻译中…」且阻塞后续）。
 */
interface Assembler {
  source: string;
  /** 块译文槽：undefined=未回填，null=该块失败，string=成功。 */
  parts: (string | null | undefined)[];
  received: number;
  resolve: (translated: string | null) => void;
}
interface QueueEntry {
  assembler: Assembler;
  chunkIndex: number;
  chunk: string;
}
let queue: QueueEntry[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
/** 同文本在途去重：text → 共享 Promise。 */
const inflight = new Map<string, Promise<string | null>>();

function cacheGet(text: string): string | null {
  return translationCache.get(text) ?? null;
}

function cachePut(text: string, translated: string): void {
  if (translationCache.size >= CACHE_MAX_ENTRIES) {
    const oldest = translationCache.keys().next().value;
    if (oldest !== undefined) translationCache.delete(oldest);
  }
  translationCache.set(text, translated);
}

/** 块译文回填：收齐全部块后拼装 resolve + 写缓存（部分失败整条回退 null）。 */
function fillEntry(entry: QueueEntry, translated: string | null): void {
  const asm = entry.assembler;
  if (asm.parts[entry.chunkIndex] !== undefined) return; // 防御：重复回填
  asm.parts[entry.chunkIndex] = translated;
  asm.received += 1;
  if (asm.received < asm.parts.length) return;
  if (asm.parts.every((p) => p !== null)) {
    const joined = asm.parts.join("");
    cachePut(asm.source, joined);
    asm.resolve(joined);
  } else {
    asm.resolve(null);
  }
}

function failEntries(entries: QueueEntry[]): void {
  for (const entry of entries) fillEntry(entry, null);
}

async function requestBatch(entries: QueueEntry[]): Promise<void> {
  const items = entries.map((entry, idx) => ({ id: `${idx}`, text: entry.chunk }));
  let resp: TranslateApiResponse;
  try {
    resp = await apiFetch<TranslateApiResponse>("/api/translate/thinking", {
      method: "POST",
      json: { items, target: "zh" },
      timeoutMs: requestTimeoutMsFor(entries),
      timeoutMessage: "翻译请求超时，已回退原文",
    });
  } catch {
    // 网络失败与引擎不可用同语义：本批回退原文 + 退避（防风暴）
    unavailableUntil = Date.now() + UNAVAILABLE_BACKOFF_MS;
    failEntries(entries);
    return;
  }
  if (!resp.engine_ready) {
    unavailableUntil = Date.now() + UNAVAILABLE_BACKOFF_MS;
    failEntries(entries);
    return;
  }
  const byId = new Map(resp.items.map((it) => [it.id, it]));
  entries.forEach((entry, idx) => {
    const it = byId.get(`${idx}`);
    fillEntry(entry, it && it.translated ? it.text : null);
  });
}

function flush(): void {
  flushTimer = null;
  if (Date.now() < unavailableUntil) {
    // 退避期：队列整体回退原文（清空防积压）
    const pending = queue;
    queue = [];
    failEntries(pending);
    return;
  }
  // 块级条目恒可装满（1 item/条）——不存在装不进单批的队头（P2 卡死根因已消除）
  const batch = queue.splice(0, BATCH_MAX_ITEMS);
  if (!batch.length) return;
  void requestBatch(batch).finally(() => {
    if (queue.length) scheduleFlush();
  });
}

function scheduleFlush(): void {
  if (flushTimer == null) {
    flushTimer = setTimeout(() => flush(), BATCH_WINDOW_MS);
  }
}

/**
 * 翻译一段思考文本；返回译文或 null（不值得翻/不可用/失败——null 即展示原文）。
 * 结果进内存缓存，同文本重复调用零请求。
 */
export function translateText(text: string): Promise<string | null> {
  if (!needsTranslation(text)) return Promise.resolve(null);
  const cached = cacheGet(text);
  if (cached !== null) return Promise.resolve(cached);
  // 引擎不可用退避期：入口快失败（不等合批窗口——该请求必然回退原文）
  if (Date.now() < unavailableUntil) return Promise.resolve(null);
  const existing = inflight.get(text);
  if (existing) return existing;
  const promise = new Promise<string | null>((resolve) => {
    const chunks = splitIntoChunks(text);
    const assembler: Assembler = {
      source: chunks.join(""),
      parts: new Array<string | null | undefined>(chunks.length),
      received: 0,
      resolve,
    };
    chunks.forEach((chunk, chunkIndex) => queue.push({ assembler, chunkIndex, chunk }));
    scheduleFlush();
  }).finally(() => {
    inflight.delete(text);
  });
  inflight.set(text, promise);
  return promise;
}

/** 引擎是否处于不可用退避期（组件据此展示一次性「未就绪」提示）。 */
export function isTranslationUnavailable(): boolean {
  return Date.now() < unavailableUntil;
}

/** 测试隔离：清空缓存/队列/退避/在途去重（生产勿用）。 */
export function resetThinkingTranslateForTests(): void {
  translationCache.clear();
  unavailableUntil = 0;
  if (flushTimer != null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  const pending = queue;
  queue = [];
  failEntries(pending);
  inflight.clear();
}
