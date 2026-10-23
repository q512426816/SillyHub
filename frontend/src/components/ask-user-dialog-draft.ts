/**
 * AskUser 作答草稿持久化（2026-10-23-askuser-dialog-draft / FR-03 / FR-04）。
 *
 * 用户诉求：AskUser 弹窗里已勾选的选项与已输入的自定义文本，未提交时刷新页面或
 * 切换会话不能丢——参照会话输入框草稿方案（localStorage）。
 *
 * 键：`sillyhub.askuser.draft.<requestId>`。以 request_id 为唯一维度（一次提问
 * 一个 id，全局唯一）而非 sessionId：
 *   - 切会话再切回 request_id 不变 → 能读回（sessionId 维度也能读回，但多一层
 *     无收益的耦合）；
 *   - 新提问必是新 id → 旧草稿天然不会串到新提问（FR-04 场景 4）；
 *   - 多选/单选、page / dialog / 群聊三宿主共用同一份（卡片是三宿主共用组件）。
 *
 * 值：`{ v: 1, at: <epoch ms>, states: { "<问题下标>": { selected, customText } } }`
 * `states` 键为问题下标字符串（与组件 `Record<number, QuestionState>` 同构，
 * 序列化后自然转字符串）。
 *
 * 清理三条路径（FR-04）：
 *   1. 提交成功 → clearAskUserDraft；
 *   2. 撞「已被他人回答」409 → clearAskUserDraft；
 *   3. 孤儿（提问已被答/会话结束，卡片不再挂载）→ 写入时按 TTL prune 兜底。
 *
 * 容错：localStorage 不可用（SSR / 隐私模式）、JSON 损坏、结构不符 → 一律降级
 * 空作答并把坏条目清掉，绝不因草稿读失败而让提问卡崩（卡是阻塞式交互）。
 */

/** 草稿键前缀（prune 的扫描面，也是测试断言锚点）。 */
export const ASKUSER_DRAFT_PREFIX = "sillyhub.askuser.draft.";

/** 草稿存活期上限：孤儿条目的兜底回收窗口（7 天）。 */
export const ASKUSER_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** 单问题的作答态（与组件内 QuestionState 同构）。 */
export interface AskUserDraftState {
  selected: string[];
  customText: string;
}

interface AskUserDraftEnvelope {
  v: 1;
  at: number;
  states: Record<string, AskUserDraftState>;
}

function draftKey(requestId: string): string {
  return `${ASKUSER_DRAFT_PREFIX}${requestId}`;
}

/** 安全访问 localStorage（SSR / 隐私模式返回 null，不抛）。 */
function safeStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** 逐条校验 states：结构不符的条目丢弃（部分可用仍返回，不整份作废）。 */
function sanitizeStates(raw: unknown): Record<string, AskUserDraftState> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Record<string, AskUserDraftState> = {};
  for (const [idx, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const v = value as { selected?: unknown; customText?: unknown };
    if (!Array.isArray(v.selected)) continue;
    const selected = v.selected.filter(
      (s): s is string => typeof s === "string",
    );
    const customText = typeof v.customText === "string" ? v.customText : "";
    out[idx] = { selected, customText };
  }
  return out;
}

/**
 * 读回某次提问的作答草稿。未写过 / 已过期 / 数据损坏 / 结构不符 → null
 * （调用方降级为空作答）。过期与损坏条目顺手清除，避免反复解析坏数据。
 */
export function readAskUserDraft(
  requestId: string,
): Record<string, AskUserDraftState> | null {
  const storage = safeStorage();
  if (!storage) return null;
  const key = draftKey(requestId);
  let raw: string | null = null;
  try {
    raw = storage.getItem(key);
  } catch {
    return null;
  }
  if (raw === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    removeKey(storage, key);
    return null;
  }
  if (!parsed || typeof parsed !== "object") {
    removeKey(storage, key);
    return null;
  }
  const envelope = parsed as Partial<AskUserDraftEnvelope>;
  const at = typeof envelope.at === "number" ? envelope.at : 0;
  const states = sanitizeStates(envelope.states);
  if (!states || at <= 0) {
    removeKey(storage, key);
    return null;
  }
  if (Date.now() - at > ASKUSER_DRAFT_TTL_MS) {
    removeKey(storage, key);
    return null;
  }
  return states;
}

/**
 * 写入某次提问的作答草稿（整份覆盖写，无字段级合并——同标签页事件串行，
 * 跨标签页 last-write-wins）。写入时顺带 prune 过期孤儿条目。
 */
export function writeAskUserDraft(
  requestId: string,
  states: Record<string, AskUserDraftState>,
): void {
  const storage = safeStorage();
  if (!storage) return;
  const envelope: AskUserDraftEnvelope = { v: 1, at: Date.now(), states };
  try {
    storage.setItem(draftKey(requestId), JSON.stringify(envelope));
  } catch {
    /* 写满 / 隐私模式：静默容错（作答仍可在内存态完成本次提交） */
  }
  pruneExpiredDrafts(storage);
}

/** 清除某次提问的草稿（提交成功 / 已被他人回答后调用）。 */
export function clearAskUserDraft(requestId: string): void {
  const storage = safeStorage();
  if (!storage) return;
  removeKey(storage, draftKey(requestId));
}

function removeKey(storage: Storage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    /* 静默容错 */
  }
}

/**
 * 回收超过 TTL 的孤儿草稿（提问已被答 / 会话结束 → 卡片不再挂载，无人再读）。
 * 只扫本前缀，不碰其它键（会话输入草稿 `sillyhub.sessions.draft.*` 等）。
 */
function pruneExpiredDrafts(storage: Storage): void {
  let keys: string[] = [];
  try {
    for (let i = 0; i < storage.length; i += 1) {
      const k = storage.key(i);
      if (k && k.startsWith(ASKUSER_DRAFT_PREFIX)) keys.push(k);
    }
  } catch {
    return;
  }
  const now = Date.now();
  for (const key of keys) {
    let at = 0;
    try {
      const raw = storage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as { at?: unknown };
      at = typeof parsed.at === "number" ? parsed.at : 0;
    } catch {
      at = 0;
    }
    if (at <= 0 || now - at > ASKUSER_DRAFT_TTL_MS) removeKey(storage, key);
  }
}
