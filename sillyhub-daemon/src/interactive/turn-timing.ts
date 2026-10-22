/**
 * interactive/turn-timing.ts —— 每轮模型调用时序派生（TTFT / attempt）
 *（2026-10-20-session-page-dsh-alignment / 线 C 1b / D-025@v1 / D-026@v1 /
 *  FR-11, FR-15 / task-10）。
 *
 * 职责：把本轮**已到达事件**的时间戳序列（kind + atMs + model / tokens）派生成
 * `TurnTimingSnapshot`，供 backend `daemon_run_snapshots.timing` 落库、前端轨迹
 * 模型泳道从「整段空档近似」改成「按 attempt 切分的真实占用」。
 *
 * 纯函数契约（design「1b 承载面与读模型字段」/ TaskCard）：
 *   - 零 I/O、无全局态、无时钟读取：时间戳全部由调用方从既有事件对象取好后传入；
 *   - 同输入恒同输出（attempts 顺序、ISO 字符串、四舍五入规则确定）；
 *   - **零事件 / 轮首时间缺失 / 没有任何可用活动 → 返回 `null`**——不返回空壳
 *     对象、不填 `ttftMs: 0` 冒充（版本门控靠「整体省略字段」表达，不新增旁路键）。
 *
 * spike-02 判定（2026-10-21，逐 driver 核对事件时序，证据见下）→ `basis="approx"`：
 *   - claude（`claude-events.ts:980-1031`）：SDK 原始流里**有**每调用锚点
 *     `message_start`，但归一化器只用它记 `callStartMs` 算 `api_duration_ms`，
 *     **不产出 AgentEvent**；到 `_onMessage` 的事件只有 text / thinking /
 *     tool_use / tool_result（partial flush 走 500ms 节流）。
 *   - codex（`codex-app-server-driver.ts:1255-1298`）：`turn/started` 只标**轮**起点
 *     （收敛成 text + metadata.status='running' / source='turn_started'）；
 *     工具结果之后的下一次模型请求没有通知；driver 自己的生成窗口也是用「首个
 *     模型输出事件」锚定（`generatingSince`），不是请求起点。
 *   - pi（`pi-events.ts:36`、`pi-rpc-driver.ts:1491-1571`）：`message_start` 是纯
 *     生命周期帧（零 IR 产出被丢弃）；生成窗口同样用首个 `text_delta` 锚定。
 *   结论：三引擎在 daemon 事件边界上**都没有稳定的「模型请求起点」信号**，故按
 *   plan「Spike 前置验证」的降级口径采集：
 *     attempt 起点 = 轮首（首 attempt）或**最后一个工具结果**之后（模型必然在等
 *     工具结果返回后才可能发起下一次请求）；首 token = 首个 text/thinking delta；
 *     终点 = 下一个 tool_use（模型产出工具调用即本次生成结束）或轮终态。
 *   `TurnTimingSnapshot.basis` 因此恒为 `"approx"`；`"observed"` 留给未来驱动侧
 *   上报请求起点事件后的口径切换（契约值不删）。
 *
 * attempt 与工具区间**零重叠**的构造性保证：
 *   1. tool_use 一定先关掉当前 attempt（`endedAt = tool_use.atMs`），再起工具区间；
 *   2. 工具执行期间（有未配对 tool_use）到达的 text/thinking 一律不计入模型占用
 *      （子代理/回显噪声；主模型在等工具，不可能是主调用输出）；
 *   3. 下一 attempt 的起点取「本批工具**全部** result 返回」的时刻（并行工具取最后
 *      一条 result），因此 attempt 起点 ≥ 每条工具区间终点（半开区间相邻不算重叠）。
 *
 * 已知口径偏差（诚实披露，不修数据）：
 *   - claude 的 text 事件走 500ms partial 节流 flush，TTFT 观测值最多偏大一个
 *     节流窗口；
 *   - `attempts[].startedAt` 是上述**边界近似**（不是请求发送时刻），UI 必须按
 *     `basis="approx"` 标注（task-12 消费）；
 *   - tokens 取 attempt 内**最后一次** usage 观测（claude/pi 为单次调用值；codex
 *     `usage_update` 是增量帧，仅作量级参考）；
 *   - 无时间戳的工具事件不参与区间切分（切了就无法保证零重叠）。
 *
 * @module interactive/turn-timing
 */
import type { AgentEventType } from '../types.js';

/* ── DTO（design「1b 承载面与读模型字段」逐字字段）───────────────────────── */

/**
 * 时序口径：
 *   - `observed`：attempt 起点来自引擎侧显式上报的请求起点（**当前无 producer**，
 *     保留给后续驱动升级）；
 *   - `approx`：起点由「轮首 / 工具结果之后」近似（当前三引擎的实际口径）。
 */
export type TurnTimingBasis = 'observed' | 'approx';

/** 事件类型复用既有 `AgentEventType`（**不新增事件类型**，只是取其中 4 类参与派生）。 */
export type TurnTimingEventKind = AgentEventType;

/** 单事件携带的 token 用量（`AgentEvent.usage` 的两个短名字段）。 */
export type TurnTimingTokens = {
  input?: number;
  output?: number;
};

/**
 * 派生输入的一条事件（调用方在 `_onMessage` 收到既有 AgentEvent 的那一刻取
 * `Date.now()` 作 `atMs`——**不改事件协议**，时间戳只在内存里配对）。
 *
 * `atMs` 缺省 = 该事件没有可驱动时间戳：仍参与「本轮有模型输出」的存在性判定，
 * 但**不参与**区间切分与 firstToken 锚定（不猜时刻）。
 */
export type TurnTimingEvent = {
  kind: TurnTimingEventKind;
  /** 观察时刻（epoch ms）。缺省 / 非有限数 = 无时间戳。 */
  atMs?: number | null;
  /** 事件自带的模型名（`metadata.model`；缺省回退会话模型）。 */
  model?: string | null;
  tokens?: TurnTimingTokens;
};

/** 一次模型调用（一个 attempt）的区间与用量。 */
export type TurnTimingAttempt = {
  /** 轮内序号（0 起，按时间顺序）。 */
  index: number;
  /** ISO 时间戳。**approx 口径下是边界近似**（轮首 / 工具结果之后），非请求发送时刻。 */
  startedAt: string;
  /** 首个 text/thinking delta 的 ISO 时间戳；未取到 → null（不填 0 冒充）。 */
  firstTokenAt: string | null;
  /** 本次生成结束（下一个 tool_use / 轮终态）的 ISO 时间戳。 */
  endedAt: string;
  /** 本 attempt 观测到的模型名；未知 → null（不伪造）。 */
  model: string | null;
  inputTokens?: number;
  outputTokens?: number;
};

/**
 * 一轮的模型调用时序快照（design 契约逐字字段；backend `TurnTimingSnapshot`
 * 镜像同名 camelCase）。
 *
 * 版本门控：本对象**不存在**时上游整体省略 `timing` 字段（不是空对象、不是
 * `basis` 壳），backend 落 null，前端保持单色近似（D-025@v1 / E8）。
 */
export type TurnTimingSnapshot = {
  /** `AgentRun.id`（与 `file_changes.runId` 同一轮的键）。 */
  runId: string;
  basis: TurnTimingBasis;
  /** 本轮首个 attempt 的首 token 延迟 ms；未取到 → null（禁填 0 冒充）。 */
  ttftMs: number | null;
  /** 轮总时长 ms（轮首观察时刻 → 轮终态观察时刻）。 */
  totalMs: number;
  attempts: TurnTimingAttempt[];
};

/** `deriveTurnTiming` 入参（daemon 侧派生上下文，非跨跳 DTO）。 */
export type DeriveTurnTimingOptions = {
  /** 本轮 `AgentRun.id`；空串 → 无法作键，派生返回 null。 */
  runId: string;
  /** 轮首观察时刻（E1 `_armTurnFileChanges` 记的 `startedAtMs`）。缺失 → 返回 null。 */
  turnStartedAtMs?: number | null;
  /** 轮终态观察时刻（`_onResult` 里 `onResult` await 完后的墙钟）；缺失 → 取最后一条事件。 */
  turnEndedAtMs?: number | null;
  /** 会话模型（`SessionState.model`；attempt 未带 model 时回填）。 */
  model?: string | null;
};

/**
 * 当前口径恒为 `approx`（spike-02：三引擎无请求起点事件，见模块头）。
 *
 * 保留 `observed` 分支的**唯一**触发条件（未来）：驱动侧把引擎原生
 * `message_start` / `turn/started` 之类「请求起点」提升为一等事件后，本模块的
 * 起点锚点改由该事件给出——那时再把本常量换成分支判定。**现在不做**：没有
 * producer 的开关就是假开关。
 */
const TURN_TIMING_BASIS: TurnTimingBasis = 'approx';

/* ── 内部工具 ────────────────────────────────────────────────────────────── */

/** 有限数字 → 原值；其余（undefined / null / NaN / Infinity / 字符串）→ null。 */
function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** epoch ms → ISO 8601 字符串（前端 `Date.parse` 口径）。 */
function isoOf(ms: number): string {
  return new Date(ms).toISOString();
}

/** 非空模型名 → 原值；其余 → null（不伪造模型）。 */
function modelOf(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/** attempt 草稿（可变的内部结构，收尾后转成只读 DTO）。 */
type AttemptDraft = {
  startMs: number;
  firstTokenMs: number | null;
  /**
   * 见过「无时间戳的首 token 事件」：之后**禁止**再拿任何后到 delta 的时刻冒充
   * 首 token（否则会把「不知道」写成偏大的 TTFT）。
   */
  firstTokenUnknown: boolean;
  /** 收尾时回填（下一个 tool_use / 轮终态）。 */
  endMs: number | null;
  model: string | null;
  inputTokens: number | undefined;
  outputTokens: number | undefined;
};

/** 把事件自带的 model / tokens 合并进草稿（后到覆盖先到；缺省不动）。 */
function mergeEventMeta(draft: AttemptDraft, ev: TurnTimingEvent): void {
  const model = modelOf(ev.model);
  if (model !== null) draft.model = model;
  const input = finiteNumber(ev.tokens?.input);
  if (input !== null) draft.inputTokens = input;
  const output = finiteNumber(ev.tokens?.output);
  if (output !== null) draft.outputTokens = output;
}

/** 新开一个 attempt 草稿（起点锚点已定；首 token 待 delta）。 */
function beginDraft(startMs: number, ev: TurnTimingEvent): AttemptDraft {
  const draft: AttemptDraft = {
    startMs,
    firstTokenMs: null,
    firstTokenUnknown: false,
    endMs: null,
    model: null,
    inputTokens: undefined,
    outputTokens: undefined,
  };
  mergeEventMeta(draft, ev);
  return draft;
}

/* ── 派生主体 ────────────────────────────────────────────────────────────── */

/**
 * 本轮事件序列 → `TurnTimingSnapshot | null`（纯函数）。
 *
 * 返回 null 的三种情形（版本门控的 daemon 侧来源，上游据此**整体省略** timing）：
 *   1. `runId` 为空 / 轮首时间缺失（没有总时长与首 attempt 起点，派生即猜测）；
 *   2. 事件里没有任何模型输出（零事件 / 只有 status 等生命周期事件）；
 *   3. 派生出的 attempt 全部零宽（起点与终点同刻，画不出区间）或轮总时长 ≤ 0。
 *
 * 注意：**有输出但首 token 无时间戳**不是 null——attempt 照出、
 * `firstTokenAt`/`ttftMs` 为 null（不伪造 0），并保持 `basis="approx"`。
 */
export function deriveTurnTiming(
  events: readonly TurnTimingEvent[],
  opts: DeriveTurnTimingOptions,
): TurnTimingSnapshot | null {
  const runId = typeof opts?.runId === 'string' ? opts.runId : '';
  if (runId === '') return null;
  const turnStartedAtMs = finiteNumber(opts.turnStartedAtMs);
  // 轮首未知：totalMs 与首 attempt 起点都无从谈起（宁可省略字段，也不猜）。
  if (turnStartedAtMs === null) return null;
  const turnEndedAtMs = finiteNumber(opts.turnEndedAtMs);
  const fallbackModel = modelOf(opts.model);
  const list: readonly TurnTimingEvent[] = Array.isArray(events) ? events : [];

  /** 下一次模型请求的起点锚点：轮首，或「本批工具全部返回」的时刻。 */
  let anchorMs: number | null = turnStartedAtMs;
  /** 最后一条**带时间戳**事件的时刻（轮终态缺失时的终点兜底）。 */
  let lastTimedMs: number | null = turnStartedAtMs;
  /** 尚未配对的 tool_use 起点（按到达顺序 FIFO：先开先配）。 */
  const openTools: number[] = [];
  const drafts: AttemptDraft[] = [];
  let current: AttemptDraft | null = null;

  for (const ev of list) {
    if (!ev || typeof ev !== 'object') continue;
    const atMs = finiteNumber(ev.atMs);
    if (atMs !== null) lastTimedMs = atMs;

    switch (ev.kind) {
      // ── 模型输出（首 token 锚点）─────────────────────────────────────────
      case 'text':
      case 'thinking': {
        // 工具执行期不是主模型占用（子代理流 / 回显）：不计入 attempt。
        if (openTools.length > 0) break;
        if (current === null) {
          // 无起点锚 = 无法放置区间（不拿 delta 时刻冒充起点，否则 ttft 会假 0）。
          if (anchorMs === null) break;
          current = beginDraft(anchorMs, ev);
        } else {
          mergeEventMeta(current, ev);
        }
        // 首个 delta 定 firstToken；后续 delta 不覆盖（TTFT 只看第一条）。
        // 无时间戳的 delta 一旦出现，本 attempt 的首 token 时刻就**永久未知**——
        // 后续带时间戳的 delta 不得冒充（否则 TTFT 会被写大）。
        if (atMs !== null && current.firstTokenMs === null) {
          if (current.firstTokenUnknown) break;
          current.firstTokenMs = atMs;
        } else if (atMs === null) {
          current.firstTokenUnknown = true;
        }
        break;
      }
      // ── 模型产出工具调用 = 本次生成结束，同时开启工具区间 ──────────────────
      case 'tool_use': {
        // 无时间戳的工具事件不参与切分（否则无法保证与工具区间零重叠）。
        if (atMs === null) break;
        if (current !== null) {
          current.endMs = Math.max(atMs, current.startMs);
          drafts.push(current);
          current = null;
        } else if (openTools.length === 0 && anchorMs !== null) {
          // 模型未产文本、直接调工具：仍是一次模型调用（首 token 未知 → null）。
          const draft = beginDraft(anchorMs, ev);
          draft.endMs = Math.max(atMs, draft.startMs);
          drafts.push(draft);
        }
        openTools.push(atMs);
        break;
      }
      // ── 工具结束：本批全部返回后，下一次模型请求才可能开始 ─────────────────
      case 'tool_result': {
        if (atMs === null) break;
        if (openTools.length > 0) {
          openTools.shift();
          if (openTools.length === 0) anchorMs = atMs;
        }
        // 未配对 result（无对应 tool_use）：不知道工具区间，不拿它当锚点。
        break;
      }
      // status / error / turn_result / complete：生命周期信号，不切分区间。
      default:
        break;
    }
  }

  // 收尾：最后一个 attempt 结束于轮终态（缺失时退回最后一条带时间戳事件）。
  const endRef = turnEndedAtMs ?? lastTimedMs;
  if (current !== null) {
    const end = endRef !== null ? Math.max(endRef, current.startMs) : current.startMs;
    current.endMs = end;
    drafts.push(current);
    current = null;
  }

  if (endRef === null || endRef <= turnStartedAtMs) return null;

  // 草稿 → DTO（零宽 attempt 丢弃：起点终点同刻画不出区间，也算不上数据）。
  const attempts: TurnTimingAttempt[] = [];
  let firstDraft: AttemptDraft | null = null;
  for (const draft of drafts) {
    const rawEnd = draft.endMs ?? endRef;
    const end = turnEndedAtMs !== null ? Math.min(rawEnd, turnEndedAtMs) : rawEnd;
    if (end <= draft.startMs) continue;
    const attempt: TurnTimingAttempt = {
      index: attempts.length,
      startedAt: isoOf(draft.startMs),
      firstTokenAt: draft.firstTokenMs !== null ? isoOf(draft.firstTokenMs) : null,
      endedAt: isoOf(end),
      model: draft.model ?? fallbackModel,
      ...(draft.inputTokens !== undefined ? { inputTokens: draft.inputTokens } : {}),
      ...(draft.outputTokens !== undefined ? { outputTokens: draft.outputTokens } : {}),
    };
    attempts.push(attempt);
    if (firstDraft === null) firstDraft = draft;
  }
  // 没有任何模型输出 / 全部零宽 → null（不返回空壳对象）。
  if (attempts.length === 0 || firstDraft === null) return null;

  // 轮级 TTFT = 首个 attempt 的首 token 延迟（多 attempt 的 per-attempt 延迟可由
  // firstTokenAt - startedAt 现算）；首 token 未知或时刻不自洽 → null。
  const ttftMs =
    firstDraft.firstTokenMs !== null && firstDraft.firstTokenMs >= firstDraft.startMs
      ? Math.round(firstDraft.firstTokenMs - firstDraft.startMs)
      : null;

  return {
    runId,
    basis: TURN_TIMING_BASIS,
    ttftMs,
    totalMs: Math.round(endRef - turnStartedAtMs),
    attempts,
  };
}

/* ── 事件 → 派生输入的映射（`_onMessage` 旁路累加的唯一入口）──────────────── */

/**
 * 既有 `AgentEvent` → `TurnTimingEvent`（**只读既有字段**，不改协议）。
 *
 * 只收参与派生的 4 类（text / thinking / tool_use / tool_result）；status / error /
 * turn_result 等生命周期信号返回 null——轮终态时刻由 `turnEndedAtMs` 单独传入，
 * 无需再存一条事件（省内存）。
 *
 * `atMs` 由调用方在收到事件那一刻取墙钟（`Date.now()`）。非有限数（NaN /
 * Infinity）→ 记为 `atMs: null` 的「无时间戳活动」：参与「本轮是否有模型输出」的
 * 存在性判定，但**不参与**区间切分与首 token 锚定（不知道时刻就不猜）。
 */
export function timingEventFromAgentEvent(
  ev: {
    type?: string;
    usage?: { input_tokens?: unknown; output_tokens?: unknown };
    metadata?: Record<string, unknown>;
  },
  atMs: number,
): TurnTimingEvent | null {
  const kind = typeof ev?.type === 'string' ? ev.type : '';
  if (
    kind !== 'text' &&
    kind !== 'thinking' &&
    kind !== 'tool_use' &&
    kind !== 'tool_result'
  ) {
    return null;
  }
  const event: TurnTimingEvent = { kind, atMs: finiteNumber(atMs) };
  const model = modelOf(ev.metadata?.['model']);
  if (model !== null) event.model = model;
  const input = finiteNumber(ev.usage?.input_tokens);
  const output = finiteNumber(ev.usage?.output_tokens);
  if (input !== null || output !== null) {
    event.tokens = {
      ...(input !== null ? { input } : {}),
      ...(output !== null ? { output } : {}),
    };
  }
  return event;
}
