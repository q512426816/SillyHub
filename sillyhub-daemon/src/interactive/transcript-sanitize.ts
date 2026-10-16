/**
 * transcript-sanitize —— 切供应商前清洗历史里「不可跨供应商重放」的供应商私有块。
 *
 * 背景（2026-10-16-provider-switch-transcript-sanitize）：
 * Claude Code 的 transcript（`<configDir>/projects/<encoded-cwd>/<agentSessionId>.jsonl`）
 * 是**逐轮全量重放**的：换供应商后第一个请求就会把整段历史发给新供应商。而历史里可能含有
 * 上一家供应商私有的块形态——实证（SillyHub 会话 f231ca18，引擎 0f782746，GLM glm-5.3）：
 * GLM 侧服务端工具（`analyze_image`）在 transcript 里被记成 `server_tool_use` 块 + 同一条
 * assistant 消息内的同 id `tool_result`；宿主档位切到 MiniMax 后重放该历史，MiniMax 的
 * Anthropic 兼容端点只认 `tool_use` ↔ `tool_result` 配对，直接
 * `400 invalid params, tool result's tool id(call_...) not found (2013)` —— 且每轮重放，
 * 会话在该供应商下**永久失败、不自愈**。
 *
 * 清洗语义（design §做法概述）：
 *   - 脏块判据（两遍扫描，与块顺序无关）：
 *     ① 私有调用块：`type ∈ PROVIDER_PRIVATE_TOOL_BLOCK_TYPES`（`server_tool_use` /
 *        `mcp_tool_use`——Anthropic 服务端工具块，第三方兼容端点不认）；
 *     ② 私有结果块：任何带 `tool_use_id` 且该 id 属于①的块（`tool_result` 与
 *        `*_tool_result` 家族同口径）。
 *   - 改写动作 = **替换为等价 `text` 块**（前缀【历史清理】+ 原文内容），**不删除**：
 *     记录条数、`uuid`、`parentUuid` 链完全不变（CLI resume 定位与追加逻辑零影响），
 *     结果正文（如图片分析全文）作为文本保留在上下文里。
 *   - 写盘前备份 `<文件名>.bak-sillyhub-<时间戳>`；写盘走 `writeFileAtomic`（原子顶替）。
 *   - 幂等：干净文件 / 已清洗文件重跑 → `replacedBlocks=0`，零写盘零备份。
 *
 * 失败语义（R-01 同款降级）：IO / 解析 / 无效行为一律吞掉返回 `changed=false`，
 * **绝不抛**——调用方（reload 前置路径）只记 warn 后继续 resume；最坏情况是维持
 * 清洗前的行为（原报错），不会因清洗把会话弄坏。
 *
 * @module interactive/transcript-sanitize
 */

import { copyFile, readFile, unlink } from 'node:fs/promises';
import { writeFileAtomic } from '../atomic-write.js';

/**
 * 供应商私有工具调用块类型（跨供应商重放不可解析，必须清洗）。
 *
 * - `server_tool_use`：Anthropic 服务端工具（含第三方兼容端点在自家端点内提供的
 *   服务端工具，如 GLM 的 `analyze_image`）；
 * - `mcp_tool_use`：服务端 MCP 工具块（同属服务端私有，客户端 `tool_use` 之外的形态）。
 */
export const PROVIDER_PRIVATE_TOOL_BLOCK_TYPES: ReadonlySet<string> = new Set([
  'server_tool_use',
  'mcp_tool_use',
]);

/** 清洗标记前缀（替换后的 text 块首行，便于用户在历史里识别「这里被清过」）。 */
export const SANITIZE_TEXT_PREFIX = '【历史清理】';

/** 调用块 input 正文保留上限（字符）——超限截断，避免把超大入参灌进文本块。 */
const INPUT_TEXT_MAX_CHARS = 2000;

/** jsonl 记录与内容块的最小形状（只声明本模块读写的键，其余原样透传）。 */
interface TranscriptRecord {
  message?: { content?: unknown };
  [key: string]: unknown;
}

interface ContentBlock {
  type?: unknown;
  id?: unknown;
  name?: unknown;
  tool_use_id?: unknown;
  input?: unknown;
  text?: unknown;
  content?: unknown;
  [key: string]: unknown;
}

/** 私有块 id 合法性（tool_use id 形态宽松：非空字符串即收）。 */
function asId(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/**
 * 把内容块里的正文抽成纯文本（string / [{type:'text',text}] / 其它标量兜底）。
 *
 * 结果块的内容形态由上游供应商决定（本次实证为纯字符串），这里只做「尽量不丢字」
 * 的宽松提取：拿不到正文返回空串（文本块仍会写一行说明，不会产出空块）。
 */
function extractBlockText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts = content
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object') {
          const text = (item as ContentBlock).text;
          if (typeof text === 'string') return text;
        }
        return '';
      })
      .filter((s) => s.length > 0);
    return parts.join('\n');
  }
  return '';
}

/** input 摘要（空对象/非对象不产出文本）。 */
function summarizeInput(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const keys = Object.keys(input as Record<string, unknown>);
  if (keys.length === 0) return '';
  let json: string;
  try {
    json = JSON.stringify(input);
  } catch {
    return '';
  }
  return json.length > INPUT_TEXT_MAX_CHARS
    ? `${json.slice(0, INPUT_TEXT_MAX_CHARS)}…`
    : json;
}

/** 私有调用块 → 等价 text 块。 */
function privateCallToText(block: ContentBlock): ContentBlock {
  const type = String(block.type ?? '');
  const name = typeof block.name === 'string' && block.name.length > 0 ? block.name : '(未命名)';
  const input = summarizeInput(block.input);
  return {
    type: 'text',
    text:
      `${SANITIZE_TEXT_PREFIX}原为供应商私有工具块 ${type}（工具 ${name}）的调用，` +
      `当前供应商不支持该块类型，已转为文本保留。` +
      (input.length > 0 ? `\n调用入参：${input}` : ''),
  };
}

/**
 * 私有结果块 → 等价 text 块（文本正文全量保留；非文本部分无法文本化，如实计数标注）。
 *
 * 2026-10-16 评审 P3-2：结果内容可能是混合块（图片等非文本无法转成 text）——原先
 * 静默丢弃却仍写「已转为文本保留」，与事实不符。此处如实标注被丢弃的非文本块数量，
 * 文本为空时也明说「无文本内容」。
 */
function privateResultToText(block: ContentBlock): ContentBlock {
  const type = String(block.type ?? '');
  const text = extractBlockText(block.content);
  const droppedNonText = countNonTextParts(block.content);
  const body =
    text.length > 0
      ? `\n${text}`
      : '\n（该结果无文本内容，无法保留）';
  const dropped = droppedNonText > 0 ? `\n（另含 ${droppedNonText} 个非文本内容块，无法转为文本，未保留）` : '';
  return {
    type: 'text',
    text: `${SANITIZE_TEXT_PREFIX}原为供应商私有工具块 ${type} 的结果，已转为文本保留：${body}${dropped}`,
  };
}

/** 结果内容里的非文本块计数（数组形态才可能混合；字符串/其它视为全部文本）。 */
function countNonTextParts(content: unknown): number {
  if (!Array.isArray(content)) return 0;
  let n = 0;
  for (const item of content) {
    if (typeof item === 'string') continue;
    if (item && typeof item === 'object' && typeof (item as ContentBlock).text === 'string') continue;
    n += 1;
  }
  return n;
}

/**
 * 纯函数：jsonl 全文 → 清洗后全文 + 命中计数（不落盘，供单测与预览）。
 *
 * 逐行处理，非 JSON / 形状不符的行原样透传（best-effort：清洗永远不因脏行中断）；
 * 行尾换行风格保持原样（`split('\n')` 后 `join('\n')` 等价还原）。
 * `droppedRecords` 恒 0——本清洗只替换块、绝不删记录（自证用，供断言与审计对账）。
 */
export function planTranscriptSanitize(text: string): {
  text: string;
  replacedBlocks: number;
  droppedRecords: number;
} {
  const lines = text.split('\n');

  // 第一遍：收集私有调用块 id 全集（跨行，与块顺序无关）。
  const privateIds = new Set<string>();
  for (const line of lines) {
    if (line.length === 0) continue;
    let record: TranscriptRecord;
    try {
      record = JSON.parse(line) as TranscriptRecord;
    } catch {
      continue;
    }
    const content = record?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const raw of content) {
      if (!raw || typeof raw !== 'object') continue;
      const block = raw as ContentBlock;
      const type = typeof block.type === 'string' ? block.type : '';
      if (!PROVIDER_PRIVATE_TOOL_BLOCK_TYPES.has(type)) continue;
      const id = asId(block.id);
      if (id !== undefined) privateIds.add(id);
    }
  }

  if (privateIds.size === 0) {
    return { text, replacedBlocks: 0, droppedRecords: 0 };
  }

  // 第二遍：改写命中块（调用侧按类型，结果侧按 tool_use_id 归属）。
  let replacedBlocks = 0;
  const outLines = lines.map((line) => {
    if (line.length === 0) return line;
    let record: TranscriptRecord;
    try {
      record = JSON.parse(line) as TranscriptRecord;
    } catch {
      return line;
    }
    const content = record?.message?.content;
    if (!Array.isArray(content)) return line;

    let touched = false;
    const nextContent = content.map((raw) => {
      if (!raw || typeof raw !== 'object') return raw;
      const block = raw as ContentBlock;
      const type = typeof block.type === 'string' ? block.type : '';
      if (PROVIDER_PRIVATE_TOOL_BLOCK_TYPES.has(type)) {
        touched = true;
        replacedBlocks += 1;
        return privateCallToText(block);
      }
      const toolUseId = asId(block.tool_use_id);
      if (toolUseId !== undefined && privateIds.has(toolUseId)) {
        touched = true;
        replacedBlocks += 1;
        return privateResultToText(block);
      }
      return raw;
    });
    if (!touched) return line;
    // 只改 content 数组：记录其余字段（uuid/parentUuid/timestamp/…）原样保留。
    return JSON.stringify({ ...record, message: { ...record.message, content: nextContent } });
  });

  return { text: outLines.join('\n'), replacedBlocks, droppedRecords: 0 };
}

/** 备份文件名时间戳（Windows 文件名禁冒号，统一替换为 `-`）。 */
function backupStamp(now: Date): string {
  return now.toISOString().replace(/[:.]/g, '-');
}

/** 文件级清洗的可注入缝（仅测试用——生产调用不传）。 */
export interface SanitizeOptions {
  /**
   * 读盘与写盘之间的插入点（评审 P2-2 的并发写守护测试用）。
   * 生产路径不传：正常流程 toggle 为 no-op。
   */
  beforeWrite?: () => void | Promise<void>;
}

/**
 * 文件级清洗：备份 + 原子改写（幂等；IO/解析异常不抛，返回 `changed=false`）。
 *
 * 调用时机见 design §接口契约：reload 切供应商路径在 transcript 迁移之后、resume 之前。
 *
 * 并发写守护（2026-10-16 评审 P2-2）：本函数是「读全文 → 计划 → 整文件原子顶替」，
 * 若在读写之间另一执行体（如仍存活的旧 CLI 句柄在 close 前追加了一轮）写入了新内容，
 * 直接顶替会**吞掉那次追加**。故写盘前重读一次比对：与计划基线不一致（= 期间被改）
 * 则放弃本次清洗并返回 `changed=false`（降级语义同其它失败路径：最坏退回清洗前行为，
 * 绝不丢数据）。代价是一次 6MB 级重读，只在真正的供应商切换路径发生一次。
 */
export async function sanitizeClaudeTranscriptForReplay(
  filePath: string,
  opts: SanitizeOptions = {},
): Promise<{
  filePath: string;
  changed: boolean;
  replacedBlocks: number;
  backupPath: string | null;
}> {
  let original: string;
  try {
    original = await readFile(filePath, 'utf-8');
  } catch {
    // 文件不存在 / 读不了：无可清洗（resume 是否可行交 CLI 自行报错）。
    return { filePath, changed: false, replacedBlocks: 0, backupPath: null };
  }

  const planned = planTranscriptSanitize(original);
  if (planned.replacedBlocks === 0) {
    return { filePath, changed: false, replacedBlocks: 0, backupPath: null };
  }

  const backupPath = `${filePath}.bak-sillyhub-${backupStamp(new Date())}`;
  try {
    // 备份先行：备份失败则不改写（宁可不清洗，也不让原文件无备份可回退）。
    await opts.beforeWrite?.();
    await copyFile(filePath, backupPath);
    // 评审 P2-2 守护：写前重读比对——读盘基线之后的任何时候被并发追加/改写，本次清洗即放弃
    //（放弃 = 降级回清洗前行为，绝不吞并发写）。残余窗口（比对 → 原子顶替之间的毫秒级）
    // 如实记在 design §并发写：非零但已显著收窄，落在其中的追加可由备份回退（显式取舍）。
    const fresh = await readFile(filePath, 'utf-8');
    if (fresh !== original) {
      console.warn('[transcript-sanitize] skipped_concurrent_write', { filePath });
      // 放弃即无清洗产物：备份一并撤掉（避免留孤件误导「已清洗过」）。
      await unlink(backupPath).catch(() => {});
      return { filePath, changed: false, replacedBlocks: 0, backupPath: null };
    }
    await writeFileAtomic(filePath, planned.text);
  } catch {
    return { filePath, changed: false, replacedBlocks: 0, backupPath: null };
  }

  return {
    filePath,
    changed: true,
    replacedBlocks: planned.replacedBlocks,
    backupPath,
  };
}
