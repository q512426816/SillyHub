/**
 * 会话轨迹（Trajectory）纯函数装配器 —— 2026-10-20-session-page-dsh-alignment 档 1。
 *
 * 输入是产品 DTO 的原始日志（`AgentRunLogEntry[]`）+ run 元数据，输出一份**纯数据**
 * 的行/轮模型，供 `trajectory-view.tsx` 这类纯展示组件消费。本文件不依赖 React、
 * DOM、store 或网络，因此可在 node 环境下单测（见 ./__tests__/build-trajectory.test.ts）。
 *
 * 语义要点（与交付规格逐条对应）：
 *   - 按 `runs` 顺序分组；**零日志的 run 不产出轮**，轮号只数有日志的 run（1 起）。
 *   - 轮内按事件时间排序（同一毫秒时用 `agent_event.seq` 稳定次序；user_input /
 *     TASK_* 等无 seq 的行仍以 timestamp 落位——seq 是事件流内序号，与 epoch ms
 *     不可比，混用会把无 seq 的行全部甩到队尾）。
 *   - `tool_use` 开一行、同 `call_id` 的 `tool_result` 闭合该行 —— 一次工具调用只
 *     产出一行 `tool`，`startedAt/endedAt/durationMs` 跨两条日志；无结果的 tool_use
 *     在其 run 正常结束时为 `running`，run 终态失败/被杀时为 `interrupted`。
 *   - `thinking` / `text` / `user_input` / `[TASK_*]` 各自成行；stdout 的
 *     `[THINKING] ` / `[TOOL_RESULT] ` / `[ASSISTANT] ` / `[REPLY] ` 等文本协议前缀
 *     统一剥掉，正文按原文保留（真实路径/命令不改写）。
 *   - `inputText` / `outputText` 默认截到 800 字（加 `…` 后缀并置 `truncated`）。
 *   - 模型泳道有两条口径：run 带 `timing`（后端 `/runs` 的 `TurnTimingSnapshot`）且
 *     attempts 非空 → 每个 attempt 一根**真实占用**条（label 带 model 与 TTFT 毫秒）；
 *     否则退回「整段非工具空档」近似。整条泳道的口径由 `Trajectory.modelBasis` 标注。
 *
 * 本文件不落 DB、不读取任何全局状态，同输入恒同输出。
 */
import type { AgentRunLogEntry } from "@/lib/agent";
import type { components } from "@/lib/api-types";

export type TrajectoryRowKind =
  | "user"
  | "assistant"
  | "thinking"
  | "tool"
  | "tool_result"
  | "system"
  | "compaction"
  | "error";

export type TrajectoryRowStatus = "ok" | "error" | "running" | "interrupted";

export interface TrajectoryRow {
  id: string;
  kind: TrajectoryRowKind;
  /** 1 起：只数「有日志的 run」的位置（零日志 run 不占号）。 */
  turnIndex: number;
  /** 1 起：轮内按开始时间排序后的位置。 */
  stepIndex: number;
  depth: number;
  parentCallId?: string;
  callId?: string;
  toolName?: string;
  status: TrajectoryRowStatus;
  /** epoch ms */
  startedAt: number;
  /** epoch ms */
  endedAt: number;
  durationMs: number;
  inputText?: string;
  outputText?: string;
  /** inputText / outputText 任一被 maxTextLen 截断。 */
  truncated?: boolean;
  inlineTokens?: { in?: number; out?: number };
  meta?: {
    toolKind?: string;
    subagentType?: string;
    seq?: number;
    /** 2026-10-22-trajectory-view-redesign：工具结果缺配对时退回 primary 摘要
     *  （详情「结果」页据此标注「未捕获结果」）。 */
    resultFromPrimary?: boolean;
  };
}

export interface TrajectoryTurn {
  index: number;
  runId: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  status: string;
  inputTokens?: number;
  outputTokens?: number;
  /** 2026-10-22-trajectory-view-redesign：该轮 `/runs` 的 attempt 采样（详情「计时」用）。
   *  缺省 = 无采样；推导逻辑不变，仅随轮透传给展示层。 */
  timing?: TurnTimingSnapshot;
}

export type TrajectoryLaneKind = "input" | "model" | "tool";

/**
 * 泳道条（Gantt bar）：`start/end` 是真实 epoch ms，渲染端只做
 * `left = (start - viewStart) / (viewEnd - viewStart)` 的线性换算；
 * **三条泳道共用同一个绝对时间轴**（不做逐轮缩放/分面）。
 */
export interface TrajectorySpan {
  id: string;
  /** 所属泳道（= `TrajectoryLanes` 的键，渲染端据此取色）。 */
  lane: TrajectoryLaneKind;
  /** epoch ms */
  start: number;
  /** epoch ms；等于 start 表示零宽事件（输入 tick 按下限 2px 渲染）。 */
  end: number;
  label: string;
  status: TrajectoryRowStatus;
  /** 指向 `rows[]` 的行 id（inspector 复用行详情）。 */
  rowId: string;
  turnIndex: number;
  /** 工具嵌套层级（`input` / `model` 取来源行 depth）。 */
  depth: number;
  /** `event` = 行级 usage 有效；`turn` = 回退到轮级 tokens（真实导出全是轮级）。 */
  tokensLevel: "turn" | "event";
  tokens?: { in?: number; out?: number };
  toolName?: string;
  /** 同轮同泳道重叠时的子行号（贪心排布，0 起）；渲染端可选用于 1px 抖动。 */
  subRow: number;
}

export interface TrajectoryLanes {
  input: TrajectorySpan[];
  model: TrajectorySpan[];
  tool: TrajectorySpan[];
}

/**
 * 泳道覆盖率（wall-clock 口径，供 hint 行显示「模型 62% · 工具 31% · 空档 7%」）。
 *
 *   - `modelMs` / `toolMs` = 该泳道全部条的**并集**时长：同轮内嵌套子工具、跨轮
 *     重叠的区间只算一次，因此 `modelMs + toolMs <= windowMs` 恒成立；
 *   - `windowMs` = `windowEnd - windowStart`，与渲染端同一根绝对轴；
 *   - 「空档」= `windowMs - modelMs - toolMs`（轮间空隙 + 无任何行的等待时间）。
 *
 * 注意：这是**展示口径**，不是引擎真实算力时间——无 `timing` 时 model 条本身是近似
 * （见 `deriveApproxModelSpans` 上方注释），覆盖率因此也是近似；有 `timing` 时
 * model 条按 attempt 区间绘制（`modelBasis="observed"`），覆盖率对应真实占用并集。
 */
export interface TrajectoryCoverage {
  modelMs: number;
  toolMs: number;
  windowMs: number;
}

/**
 * 模型泳道口径（整条泳道一个标注，供 UI 显示「真实占用」/「近似（无 TTFT 采样）」）：
 *   - `observed`：每一轮都有可用 attempt 采样（startedAt/endedAt 可解析），条按真实
 *     模型请求区间绘制；
 *   - `approx`：任一轮缺采样（含 `timing` 为 null / attempts 为空 / 时间戳不可解析）
 *     且该轮回退到近似后仍产出了 model 条——不把近似数据标成真实。
 */
export type TrajectoryModelBasis = "observed" | "approx";

export interface Trajectory {
  rows: TrajectoryRow[];
  turns: TrajectoryTurn[];
  lanes: TrajectoryLanes;
  /** 三条泳道的 wall-clock 覆盖率（并集口径，见 `TrajectoryCoverage`）。 */
  coverage: TrajectoryCoverage;
  /** 模型泳道口径：`observed` = 真实 attempt 区间；`approx` = 整段非工具空档近似。 */
  modelBasis: TrajectoryModelBasis;
  /** 全轨迹时间窗口（含 user_input 早于 run.started_at 的真实情形）。 */
  windowStart: number;
  windowEnd: number;
}

/**
 * 一轮模型调用时序（后端 `GET /sessions/{id}/runs` 的 `run.timing`，task-08 读模型）。
 * 形状由 design「1b 承载面与读模型字段」钉死；`attempts[]` 在生成类型里原样透传为
 * dict 列表，本文件按字段名防御式读取。proto 路由的 staged 导出没有该字段 → undefined。
 */
export type TurnTimingSnapshot = components["schemas"]["TurnTimingSnapshot"];

/** `runs[]` 消费端形状（StagedRun 结构兼容；只读本文件需要的字段）。 */
export interface TrajectoryRunInput {
  id: string;
  status?: string | null;
  model?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  duration_api_ms?: number | null;
  error_code?: string | null;
  /** 模型调用时序；缺省 / null ＝无采样（走近似口径）。 */
  timing?: TurnTimingSnapshot | null;
}

export interface BuildTrajectoryOptions {
  /** 正文字段截断长度，默认 800（含 `…` 后缀）。 */
  maxTextLen?: number;
}

const DEFAULT_MAX_TEXT_LEN = 800;

/** run 已终止且不可能是「仍在执行」→ 无结果的工具调用标 interrupted。 */
const INTERRUPTED_RUN_STATUSES = new Set([
  "failed",
  "killed",
  "interrupted",
  "cancelled",
  "canceled",
  "error",
]);

/** stdout 文本协议里可由前缀直接判类型的标记。 */
const KNOWN_PREFIX_RE =
  /^\s*\[(THINKING|TOOL_RESULT|TOOL_USE|REPLY|ASSISTANT|TASK_STARTED|TASK_NOTIFICATION|COMPACT|COMPACTION|SYSTEM|ERROR|FATAL)\]\s?/;

/** 工具结果里「失败」的保守判定：只看行首强信号 + Exit code，避免读取文件正文误判。 */
const TOOL_ERROR_PREFIX_RE =
  /^(?:<tool_use_error>|Error:|error:|FATAL:|Fatal:|Traceback \(most recent call last\)|Command failed|FAILED?\b)/;

interface AgentEventView {
  eventType: string | null;
  content: string | null;
  seq: number | null;
  callId: string | null;
  toolName: string | null;
  usageIn: number | null;
  usageOut: number | null;
  toolKind: string | null;
}

interface OrderedLog {
  log: AgentRunLogEntry;
  index: number;
  at: number | null;
}

interface RowInit {
  id: string;
  kind: TrajectoryRowKind;
  turnIndex: number;
  depth: number;
  status: TrajectoryRowStatus;
  startedAt: number;
  endedAt?: number;
  parentCallId?: string;
  callId?: string;
  toolName?: string;
  inputText?: string;
  outputText?: string;
  truncated?: boolean;
  inlineTokens?: { in?: number; out?: number };
  meta?: { toolKind?: string; subagentType?: string; seq?: number };
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function timeOf(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

function readAgentEvent(log: AgentRunLogEntry): AgentEventView | null {
  const metadata = log.metadata;
  if (!metadata || typeof metadata !== "object") return null;
  const raw = (metadata as Record<string, unknown>).agent_event;
  if (!raw || typeof raw !== "object") return null;
  const event = raw as Record<string, unknown>;
  const usage =
    event.usage && typeof event.usage === "object"
      ? (event.usage as Record<string, unknown>)
      : null;
  const nested =
    event.metadata && typeof event.metadata === "object"
      ? (event.metadata as Record<string, unknown>)
      : null;
  return {
    eventType: stringOrNull(event.event_type) ?? stringOrNull(event.type),
    content: typeof event.content === "string" ? event.content : null,
    seq: numberOrNull(event.seq),
    callId: stringOrNull(event.call_id),
    toolName: stringOrNull(event.tool_name),
    usageIn: usage ? numberOrNull(usage.input_tokens) : null,
    usageOut: usage ? numberOrNull(usage.output_tokens) : null,
    toolKind: nested ? stringOrNull(nested.tool_kind) : null,
  };
}

function splitPrefix(text: string): { body: string; prefix: string | null } {
  const match = KNOWN_PREFIX_RE.exec(text);
  if (!match) return { body: text, prefix: null };
  return { body: text.slice(match[0].length), prefix: match[1] ?? null };
}

function tryParseJson(text: string | null): Record<string, unknown> | null {
  if (!text) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // 非 JSON：走文本兜底
  }
  return null;
}

function clipText(
  text: string | null | undefined,
  maxTextLen: number,
): { value?: string; truncated: boolean } {
  if (text == null) return { truncated: false };
  if (text.length <= maxTextLen) return { value: text, truncated: false };
  let cut = Math.max(0, maxTextLen);
  // 不把 emoji 等代理对切成半个字符。
  if (cut > 0) {
    const code = text.charCodeAt(cut - 1);
    if (code >= 0xd800 && code <= 0xdbff) cut -= 1;
  }
  return { value: `${text.slice(0, cut)}…`, truncated: true };
}

function tokensOf(event: AgentEventView | null): { in?: number; out?: number } | undefined {
  if (!event) return undefined;
  const inTokens = event.usageIn ?? 0;
  const outTokens = event.usageOut ?? 0;
  // 真实导出里事件级 usage 大量为 0/0——不把 0 当有效值塞满 tokens 列。
  if (inTokens === 0 && outTokens === 0) return undefined;
  return { in: inTokens, out: outTokens };
}

function toolResultStatus(text: string): "ok" | "error" {
  const trimmed = text.trimStart();
  if (trimmed.startsWith("<tool_use_error>")) return "error";
  const exit = /Exit code\s+(-?\d+)/.exec(text);
  if (exit) {
    const code = Number(exit[1]);
    return Number.isFinite(code) && code !== 0 ? "error" : "ok";
  }
  if (TOOL_ERROR_PREFIX_RE.test(trimmed)) return "error";
  return "ok";
}

function makeRow(init: RowInit): TrajectoryRow {
  const endedAt = init.endedAt ?? init.startedAt;
  const row: TrajectoryRow = {
    id: init.id,
    kind: init.kind,
    turnIndex: init.turnIndex,
    stepIndex: 0,
    depth: init.depth,
    status: init.status,
    startedAt: init.startedAt,
    endedAt,
    durationMs: Math.max(0, endedAt - init.startedAt),
  };
  if (init.parentCallId) row.parentCallId = init.parentCallId;
  if (init.callId) row.callId = init.callId;
  if (init.toolName) row.toolName = init.toolName;
  if (init.inputText !== undefined) row.inputText = init.inputText;
  if (init.outputText !== undefined) row.outputText = init.outputText;
  if (init.truncated) row.truncated = true;
  if (init.inlineTokens) row.inlineTokens = init.inlineTokens;
  if (init.meta && (init.meta.toolKind || init.meta.subagentType || init.meta.seq !== undefined)) {
    row.meta = init.meta;
  }
  return row;
}

function orderLogs(logs: AgentRunLogEntry[]): OrderedLog[] {
  return logs
    .map((log, index) => ({ log, index, at: timeOf(log.timestamp) }))
    .sort((a, b) => {
      const at = a.at;
      const bt = b.at;
      if (at != null && bt != null && at !== bt) return at - bt;
      if (at == null && bt != null) return 1;
      if (at != null && bt == null) return -1;
      // 同一毫秒：事件流 seq 才是稳定次序（缺失则保持原始行序）。
      const as = readAgentEvent(a.log)?.seq;
      const bs = readAgentEvent(b.log)?.seq;
      if (as != null && bs != null && as !== bs) return as - bs;
      return a.index - b.index;
    });
}

/**
 * 原始日志 + run 元数据 → 轨迹行/轮模型。
 *
 * `maxTextLen` 只影响 `inputText/outputText` 的展示长度；时长、状态、配对均基于全量
 * 原文（工具结果状态判定用未截断文本，避免截断把 `Exit code 1` 切掉）。
 */
export function buildTrajectory(
  logs: AgentRunLogEntry[],
  runs: TrajectoryRunInput[],
  opts: BuildTrajectoryOptions = {},
): Trajectory {
  const maxTextLen = Math.max(0, Math.trunc(opts.maxTextLen ?? DEFAULT_MAX_TEXT_LEN));
  const logsByRun = new Map<string, AgentRunLogEntry[]>();
  for (const log of logs) {
    const list = logsByRun.get(log.run_id);
    if (list) list.push(log);
    else logsByRun.set(log.run_id, [log]);
  }

  // 只收「带 timing」的 run；缺字段 / null 的 run 不进 map → 该轮走近似口径。
  const timingByRunId = new Map<string, TurnTimingSnapshot>();
  for (const run of runs) {
    if (run.timing) timingByRunId.set(run.id, run.timing);
  }

  const rows: TrajectoryRow[] = [];
  const turns: TrajectoryTurn[] = [];
  let turnIndex = 0;

  for (const run of runs) {
    const runLogs = logsByRun.get(run.id);
    // 零日志 run：不产轮、不占轮号（真实导出里 21 runs 有 1 个空 run）。
    if (!runLogs || runLogs.length === 0) continue;
    turnIndex += 1;
    const currentTurn = turnIndex;
    const ordered = orderLogs(runLogs);

    let firstLogAt: number | null = null;
    let lastLogAt: number | null = null;
    for (const item of ordered) {
      if (item.at == null) continue;
      if (firstLogAt == null) firstLogAt = item.at;
      lastLogAt = item.at;
    }

    const runStartedAt = timeOf(run.started_at);
    const runFinishedAt = timeOf(run.finished_at);
    const startedAt = runStartedAt ?? firstLogAt ?? lastLogAt ?? 0;
    const endedAt = Math.max(startedAt, runFinishedAt ?? lastLogAt ?? startedAt);
    const inputTokens = numberOrNull(run.input_tokens);
    const outputTokens = numberOrNull(run.output_tokens);
    turns.push({
      index: currentTurn,
      runId: run.id,
      startedAt,
      endedAt,
      durationMs: endedAt - startedAt,
      status: run.status ?? "unknown",
      ...(inputTokens != null ? { inputTokens } : {}),
      ...(outputTokens != null ? { outputTokens } : {}),
    });

    const turnRows: TrajectoryRow[] = [];
    /** call_id → 尚未闭合的 tool 行（tool_result 到达时回填）。 */
    const openTools = new Map<string, TrajectoryRow>();

    for (const item of ordered) {
      const { log, at } = item;
      const ts = at ?? startedAt;
      const event = readAgentEvent(log);
      const raw = log.content_redacted ?? "";
      const { body: stripped, prefix } = splitPrefix(raw);
      const depth =
        typeof log.depth === "number" && Number.isFinite(log.depth)
          ? log.depth
          : log.parent_tool_use_id
            ? 1
            : 0;
      const parentCallId = log.parent_tool_use_id ?? undefined;
      const inlineTokens = tokensOf(event);
      const seq = event?.seq ?? undefined;
      const subagentType = log.subagent_type ?? undefined;
      const baseMeta = {
        ...(log.tool_kind ? { toolKind: log.tool_kind } : {}),
        ...(subagentType ? { subagentType } : {}),
        ...(seq !== undefined ? { seq } : {}),
      };
      const rowId = log.id || `${run.id}:${item.index}`;

      if (log.channel === "user_input") {
        const clipped = clipText(event?.content ?? stripped, maxTextLen);
        turnRows.push(
          makeRow({
            id: rowId,
            kind: "user",
            turnIndex: currentTurn,
            depth,
            status: "ok",
            startedAt: ts,
            inputText: clipped.value,
            truncated: clipped.truncated,
            parentCallId,
            callId: event?.callId ?? undefined,
            inlineTokens,
            meta: baseMeta,
          }),
        );
        continue;
      }

      const eventType = event?.eventType ?? null;

      if (eventType === "thinking" || (!eventType && prefix === "THINKING")) {
        const clipped = clipText(event?.content ?? stripped, maxTextLen);
        turnRows.push(
          makeRow({
            id: rowId,
            kind: "thinking",
            turnIndex: currentTurn,
            depth,
            status: "ok",
            startedAt: ts,
            outputText: clipped.value,
            truncated: clipped.truncated,
            parentCallId,
            callId: event?.callId ?? undefined,
            inlineTokens,
            meta: baseMeta,
          }),
        );
        continue;
      }

      // 旧轨 tool_call 行没有 agent_event（内容即 {tool,args,tool_use_id} envelope）。
      if (eventType === "tool_use" || (!eventType && (prefix === "TOOL_USE" || log.channel === "tool_call"))) {
        const inputSource = event?.content ?? stripped;
        const parsed = tryParseJson(inputSource) ?? tryParseJson(raw);
        let toolName = event?.toolName ?? undefined;
        if (!toolName && parsed && typeof parsed.tool === "string") toolName = parsed.tool;
        if (!toolName && log.tool_kind) toolName = log.tool_kind;
        if (!toolName) toolName = "tool";
        let callId = event?.callId ?? undefined;
        if (!callId && parsed && typeof parsed.tool_use_id === "string") {
          callId = parsed.tool_use_id;
        }
        if (!callId) callId = log.id || `${run.id}:tool:${item.index}`;
        // 旧轨 tool_call envelope 形如 {tool,args,tool_use_id}：inspector 只展示 args。
        let inputText = inputSource;
        if (parsed && parsed.args && typeof parsed.args === "object" && event?.content == null) {
          inputText = JSON.stringify(parsed.args);
        }
        const clipped = clipText(inputText, maxTextLen);
        const row = makeRow({
          id: rowId,
          kind: "tool",
          turnIndex: currentTurn,
          depth,
          status: "running",
          startedAt: ts,
          inputText: clipped.value,
          truncated: clipped.truncated,
          parentCallId,
          callId,
          toolName,
          inlineTokens,
          meta: baseMeta,
        });
        turnRows.push(row);
        openTools.set(callId, row);
        continue;
      }

      if (eventType === "tool_result" || (!eventType && prefix === "TOOL_RESULT")) {
        const resultBody = event?.content ?? stripped;
        const parsed = tryParseJson(raw);
        const callId =
          event?.callId ??
          (parsed && typeof parsed.tool_use_id === "string" ? parsed.tool_use_id : undefined);
        const status = toolResultStatus(resultBody);
        const opened = callId ? openTools.get(callId) : undefined;
        if (opened && callId) {
          const clipped = clipText(resultBody, maxTextLen);
          opened.outputText = clipped.value;
          opened.endedAt = Math.max(opened.startedAt, ts);
          opened.durationMs = opened.endedAt - opened.startedAt;
          opened.status = status;
          if (clipped.truncated) opened.truncated = true;
          openTools.delete(callId);
        } else {
          const clipped = clipText(resultBody, maxTextLen);
          turnRows.push(
            makeRow({
              id: rowId,
              kind: "tool_result",
              turnIndex: currentTurn,
              depth,
              status,
              startedAt: ts,
              outputText: clipped.value,
              truncated: clipped.truncated,
              parentCallId,
              callId,
              inlineTokens,
              meta: baseMeta,
            }),
          );
        }
        continue;
      }

      const assistantLike =
        eventType === "text" ||
        eventType === "reply" ||
        eventType === "assistant" ||
        prefix === "ASSISTANT" ||
        prefix === "REPLY";
      if (assistantLike) {
        const clipped = clipText(event?.content ?? stripped, maxTextLen);
        turnRows.push(
          makeRow({
            id: rowId,
            kind: "assistant",
            turnIndex: currentTurn,
            depth,
            status: "ok",
            startedAt: ts,
            outputText: clipped.value,
            truncated: clipped.truncated,
            parentCallId,
            callId: event?.callId ?? undefined,
            inlineTokens,
            meta: baseMeta,
          }),
        );
        continue;
      }

      // 前缀兜底：system（含 [TASK_STARTED]/[TASK_NOTIFICATION]）、compaction、error。
      const isSystem = prefix === "SYSTEM" || prefix === "TASK_STARTED" || prefix === "TASK_NOTIFICATION";
      const isCompaction = prefix === "COMPACT" || prefix === "COMPACTION";
      const isError = prefix === "ERROR" || prefix === "FATAL";
      const clipped = clipText(event?.content ?? stripped, maxTextLen);
      turnRows.push(
        makeRow({
          id: rowId,
          kind: isError ? "error" : isCompaction ? "compaction" : isSystem ? "system" : "assistant",
          turnIndex: currentTurn,
          depth,
          status: isError ? "error" : "ok",
          startedAt: ts,
          outputText: clipped.value,
          truncated: clipped.truncated,
          parentCallId,
          callId: event?.callId ?? undefined,
          inlineTokens,
          meta: baseMeta,
        }),
      );
    }

    // 未闭合的工具调用：run 已失败/被杀 → interrupted；否则仍在跑 → running。
    if (run.status && INTERRUPTED_RUN_STATUSES.has(run.status)) {
      for (const row of openTools.values()) row.status = "interrupted";
    }

    turnRows.sort((a, b) => {
      if (a.startedAt !== b.startedAt) return a.startedAt - b.startedAt;
      const as = a.meta?.seq ?? Number.MAX_SAFE_INTEGER;
      const bs = b.meta?.seq ?? Number.MAX_SAFE_INTEGER;
      if (as !== bs) return as - bs;
      return a.id.localeCompare(b.id);
    });
    turnRows.forEach((row, i) => {
      row.stepIndex = i + 1;
    });
    rows.push(...turnRows);
  }

  return assembleTrajectory(rows, turns, timingByRunId);
}

/**
 * 装配收口（2026-10-22-session-trajectory-view 抽出的公共尾段）：
 * 行/轮 + 可选 timing → 窗口、泳道、覆盖率、口径。
 *
 * 抽出的唯一目的：让「日志驱动」（`buildTrajectory`）与「轮视图驱动」
 * （`from-turn-views.ts` 的产品会话页路径）共用同一套窗口/覆盖率/口径数学，
 * 避免第二套实现漂移。行为与原内联尾段逐行等价。
 */
export function assembleTrajectory(
  rows: TrajectoryRow[],
  turns: TrajectoryTurn[],
  timingByRunId: Map<string, TurnTimingSnapshot> = new Map(),
): Trajectory {
  let windowStart = Number.POSITIVE_INFINITY;
  let windowEnd = Number.NEGATIVE_INFINITY;
  for (const turn of turns) {
    windowStart = Math.min(windowStart, turn.startedAt);
    windowEnd = Math.max(windowEnd, turn.endedAt);
  }
  for (const row of rows) {
    windowStart = Math.min(windowStart, row.startedAt);
    windowEnd = Math.max(windowEnd, row.endedAt);
  }
  // 真实占用区间可能越过 run.finished_at（上游补报 / 时钟误差）：窗口必须覆盖，
  // 否则 model 条会画到轴外、coverage 也可能突破 windowMs。
  for (const turn of turns) {
    for (const attempt of parseTimingAttempts(timingByRunId.get(turn.runId))) {
      windowStart = Math.min(windowStart, attempt.start);
      windowEnd = Math.max(windowEnd, attempt.end);
    }
  }
  if (!Number.isFinite(windowStart) || !Number.isFinite(windowEnd)) {
    windowStart = 0;
    windowEnd = 0;
  }
  if (windowEnd < windowStart) windowEnd = windowStart;

  const lanes = buildTrajectoryLanes(rows, turns, timingByRunId);
  // 2026-10-22-trajectory-view-redesign：轮级 timing 随轮透传给详情面板（只读附加）。
  const turnsWithTiming = turns.map((turn) => {
    const timing = timingByRunId.get(turn.runId);
    return timing ? { ...turn, timing } : turn;
  });
  return {
    rows,
    turns: turnsWithTiming,
    lanes,
    coverage: computeCoverage(lanes, windowStart, windowEnd),
    modelBasis: deriveModelBasis(turns, timingByRunId, lanes),
    windowStart,
    windowEnd,
  };
}

/* ───────────────────────── 泳道（Gantt）推导 ─────────────────────────
 *
 * 三条泳道消费同一份 `rows`，不改行模型：
 *   - input：每个 `user` 行一根 tick（零宽：`start === end`，渲染端按下限 2px）；
 *   - tool ：每个 `tool` 行一根条（`tool_use → tool_result` 的真实跨度），
 *     嵌套工具保留 `depth`；
 *   - model：两条口径（`deriveModelSpans` 分派）：
 *       ① `timing` 存在且 attempts 非空 → **真实占用**：每个 attempt 一根条，区间取
 *          `[startedAt, endedAt)`，label 带 model 与 TTFT 毫秒；仍与同轮工具 busy
 *          做差集（`subtractBusy`）兜底，保证零重叠。
 *       ② 缺 `timing` → **近似**：数据里没有 TTFT / attempt 边界，切不出真正的
 *          「prefill → decode」区间，因此用「本轮非工具时段（gap）」代替：
 *           1) 把本轮**所有** tool 行的占用区间合并（嵌套子工具并入父区间）
 *              得到 busy 集合，于是本轮被切成若干 gap：
 *              [轮首, 首个 busy.start)、[busy_i.end, busy_{i+1}.start)、
 *              [末 busy.end, 轮尾]；
 *           2) 只要该 gap 内**至少有一条** thinking / assistant 行（含起点/终点），
 *              就为**整个 gap** 画一根 model 条——不再从「第一条思考/答复」起算。
 *              一个 gap 最多一根条，条内不再按行切分。
 *           3) 出条前再与 busy 做一次差集（`subtractBusy`）兜底，保证 model 条
 *              在任何嵌套形态下都与同轮 tool 条**零重叠**。
 *
 *     等价说法：近似口径下 model 泳道 = 「本轮除工具占用外的全部时间，但只在本轮
 *     真的产生过思考/答复时才画」。真实数据显示这会把 model 覆盖从 1.3% 提到数十
 *     个百分点（旧规则每轮只画几十秒，因为条的起点被钉在第一条思考行上）。
 *
 *     近似口径**仍然不是模型算力时间**：轮首等待、上下文拼装、工具结果回填后的
 *     空闲都会被算进 gap。UI 按 `Trajectory.modelBasis` 明示当前口径。
 */

/** 泳道条 label 的最大展示长度（超出加 `…`）。 */
const SPAN_LABEL_MAX = 64;

/** model 条按来源行打前缀，便于 tooltip / 搜索区分。 */
const MODEL_ROW_LABEL: Partial<Record<TrajectoryRowKind, string>> = {
  thinking: "思考",
  assistant: "答复",
};

function spanLabel(text: string | undefined, fallback: string): string {
  const flat = (text ?? "").replace(/\s+/g, " ").trim();
  if (!flat) return fallback;
  return clipText(flat, SPAN_LABEL_MAX).value ?? fallback;
}

/** 行级 tokens 优先；真实导出事件级 usage 全 0 → 回退轮级并标记 `turn`。 */
function spanTokens(
  row: TrajectoryRow,
  turn: TrajectoryTurn | undefined,
): { tokensLevel: "turn" | "event"; tokens?: { in?: number; out?: number } } {
  if (row.inlineTokens) return { tokensLevel: "event", tokens: row.inlineTokens };
  if (turn && (turn.inputTokens != null || turn.outputTokens != null)) {
    return {
      tokensLevel: "turn",
      tokens: { in: turn.inputTokens, out: turn.outputTokens },
    };
  }
  return { tokensLevel: "turn" };
}

/** 同泳道重叠排布：按 start 已排序的 spans 贪心占子行（上限 maxRows）。 */
function assignSubRows(spans: TrajectorySpan[], maxRows = 3): void {
  const rowEnds: number[] = [];
  for (const span of spans) {
    // 零宽 tick 也要占位，否则同一毫秒的多个输入会全部叠在子行 0。
    const packEnd = Math.max(span.end, span.start + 1);
    let placed = -1;
    for (let i = 0; i < rowEnds.length; i += 1) {
      const last = rowEnds[i];
      if (last !== undefined && last <= span.start) {
        placed = i;
        break;
      }
    }
    if (placed < 0 && rowEnds.length < maxRows) {
      placed = rowEnds.length;
      rowEnds.push(packEnd);
    }
    if (placed < 0) {
      // 超出子行上限：并入最后一行（渲染只是 1–2px 抖动，不增高泳道）。
      placed = maxRows - 1;
      rowEnds[placed] = Math.max(rowEnds[placed] ?? 0, packEnd);
    } else {
      rowEnds[placed] = Math.max(rowEnds[placed] ?? 0, packEnd);
    }
    span.subRow = placed;
  }
}

interface SpanInterval {
  start: number;
  end: number;
}

/** 合并重叠/相接区间（升序）；零宽区间（running 工具 start===end）不占位。 */
function mergeIntervals(intervals: SpanInterval[]): SpanInterval[] {
  const sorted = intervals
    .filter((item) => item.end > item.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: SpanInterval[] = [];
  for (const current of sorted) {
    const last = merged[merged.length - 1];
    if (last && current.start <= last.end) {
      last.end = Math.max(last.end, current.end);
    } else {
      merged.push({ start: current.start, end: current.end });
    }
  }
  return merged;
}

/** 从 `[start, end)` 里挖掉 busy 区间（已合并升序），返回剩余片段。 */
function subtractBusy(start: number, end: number, busy: SpanInterval[]): SpanInterval[] {
  const pieces: SpanInterval[] = [];
  let cursor = start;
  for (const item of busy) {
    if (item.end <= cursor) continue;
    if (item.start >= end) break;
    if (item.start > cursor) pieces.push({ start: cursor, end: Math.min(item.start, end) });
    cursor = Math.max(cursor, item.end);
    if (cursor >= end) break;
  }
  if (cursor < end) pieces.push({ start: cursor, end });
  return pieces;
}

/** 该行能否把一段「非工具时段」认成模型活动（只有思考 / 答复算）。 */
const MODEL_ACTIVITY_KINDS = new Set<TrajectoryRowKind>(["thinking", "assistant"]);

/** `TurnTimingSnapshot.attempts[]` 的一条，已归一成 epoch ms。 */
interface ParsedAttempt {
  index: number;
  start: number;
  end: number;
  model: string | null;
  /** 首 token 相对 attempt 起点的毫秒数；无首 token → null（不填 0 冒充）。 */
  ttftMs: number | null;
  inputTokens?: number;
  outputTokens?: number;
}

/**
 * `timing.attempts[]` → 可绘制的 attempt 区间（纯函数，无时间源）。
 *
 * 只收 `startedAt` / `endedAt` 都能解析且 `end >= start` 的条目；字段缺失或时间戳
 * 不可解析时**跳过该条**（不伪造区间）。全部条目不可用 → 空数组，调用方据此回退
 * 近似口径（`basis="approx"`）。`ttftMs` 由 `firstTokenAt - startedAt` 现算；首 token
 * 缺失时仅当只有一轮 attempt 才回填轮级 `timing.ttftMs`，否则保持 null，绝不用 0
 * 冒充（design `TurnTimingSnapshot` 契约）。
 */
function parseTimingAttempts(
  timing: TurnTimingSnapshot | null | undefined,
): ParsedAttempt[] {
  if (!timing || !Array.isArray(timing.attempts)) return [];
  // 只有一轮 attempt 时，轮级 `ttftMs` 可以安全回填（同一测量）；多 attempt 不猜测归属。
  const snapshotTtft = timing.attempts.length === 1 ? numberOrNull(timing.ttftMs) : null;
  const attempts: ParsedAttempt[] = [];
  timing.attempts.forEach((raw, position) => {
    if (!raw || typeof raw !== "object") return;
    const record = raw as Record<string, unknown>;
    const start = timeOf(stringOrNull(record.startedAt));
    const end = timeOf(stringOrNull(record.endedAt));
    if (start == null || end == null || end < start) return;
    const firstTokenAt = timeOf(stringOrNull(record.firstTokenAt));
    const ttftMs =
      firstTokenAt != null && firstTokenAt >= start ? firstTokenAt - start : snapshotTtft;
    const inputTokens = numberOrNull(record.inputTokens);
    const outputTokens = numberOrNull(record.outputTokens);
    attempts.push({
      index: numberOrNull(record.index) ?? position,
      start,
      end,
      model: stringOrNull(record.model),
      ttftMs,
      ...(inputTokens != null ? { inputTokens } : {}),
      ...(outputTokens != null ? { outputTokens } : {}),
    });
  });
  return attempts.sort((a, b) => a.start - b.start || a.index - b.index);
}

/** observed 口径的条 label：`<model> · TTFT <n>ms`（未采样时明确写「未采样」）。 */
function attemptSpanLabel(attempt: ParsedAttempt): string {
  const model = attempt.model ?? "模型";
  const ttft = attempt.ttftMs != null ? `TTFT ${Math.round(attempt.ttftMs)}ms` : "TTFT 未采样";
  const full = `${model} · ${ttft}`;
  return clipText(full, SPAN_LABEL_MAX).value ?? model;
}

/**
 * 单轮 observed 口径（`timing` 存在且 attempts 非空）：每个 attempt 一根 model 条，
 * 区间 = `[startedAt, endedAt)`，label 带 model 与 TTFT 毫秒。
 *
 * 仍与同轮工具 busy 做差集（契约要求 attempt 与 tool 零重叠，这里是防御性兜底）：
 * 上游越界时一根 attempt 会被切成多段，**绝不**与 tool 条交叠。
 * 模型条保持单色——本函数不做 TTFT / decode 双色切分（D-024 / D-026 约束）。
 */
function deriveObservedModelSpans(
  turnRows: TrajectoryRow[],
  turn: TrajectoryTurn,
  attempts: readonly ParsedAttempt[],
): TrajectorySpan[] {
  const ordered = [...turnRows].sort(
    (a, b) => a.startedAt - b.startedAt || a.stepIndex - b.stepIndex,
  );
  const toolBusy = mergeIntervals(
    ordered
      .filter((row) => row.kind === "tool")
      .map((row) => ({ start: row.startedAt, end: row.endedAt })),
  );
  const activity = ordered.filter((row) => MODEL_ACTIVITY_KINDS.has(row.kind));
  /** inspector 锚点：attempt 区间内首条思考/答复 → 本轮首条思考/答复 → 本轮首行。 */
  const fallbackRow = activity[0] ?? ordered[0];

  const spans: TrajectorySpan[] = [];
  for (const attempt of attempts) {
    const anchor =
      activity.find(
        (row) => row.startedAt >= attempt.start && row.startedAt <= attempt.end,
      ) ?? fallbackRow;
    const label = attemptSpanLabel(attempt);
    for (const piece of subtractBusy(attempt.start, attempt.end, toolBusy)) {
      if (piece.end <= piece.start) continue;
      spans.push({
        id: `${turn.runId}:model:attempt:${attempt.index}:${piece.start}`,
        lane: "model",
        start: piece.start,
        end: piece.end,
        label,
        status: anchor?.status ?? "ok",
        rowId: anchor?.id ?? `${turn.runId}:model:attempt:${attempt.index}`,
        turnIndex: turn.index,
        depth: anchor?.depth ?? 0,
        subRow: 0,
        ...(attempt.inputTokens != null || attempt.outputTokens != null
          ? {
              tokensLevel: "event" as const,
              tokens: { in: attempt.inputTokens, out: attempt.outputTokens },
            }
          : anchor
            ? spanTokens(anchor, turn)
            : { tokensLevel: "turn" as const }),
      });
    }
  }

  return spans;
}

/**
 * 单轮 model 条推导（**近似**，无 `timing` / attempts 为空时）：
 *   1) 合并本轮全部 tool 占用区间（嵌套并入父区间）→ busy；
 *   2) 本轮被 busy 切成若干 gap：轮首→首个 busy、busy 之间、末 busy→轮尾；
 *   3) gap 内若存在 thinking / assistant 行，则**整段 gap** 就是一根 model 条；
 *   4) 出条前与 busy 再做一次差集（防御性兜底），确保与 tool 条零重叠。
 */
function deriveApproxModelSpans(
  turnRows: TrajectoryRow[],
  turn: TrajectoryTurn,
): TrajectorySpan[] {
  const ordered = [...turnRows].sort(
    (a, b) => a.startedAt - b.startedAt || a.stepIndex - b.stepIndex,
  );

  let turnEnd = Math.max(turn.endedAt, turn.startedAt);
  const busy: SpanInterval[] = [];
  for (const row of ordered) {
    turnEnd = Math.max(turnEnd, row.endedAt);
    if (row.kind === "tool") busy.push({ start: row.startedAt, end: row.endedAt });
  }
  const toolBusy = mergeIntervals(busy);

  // 轮首取「run 起点 / 首行」的较早者：真实导出里 user_input 可能早于 run 起点。
  const firstRowAt = ordered[0]?.startedAt;
  const turnStart = firstRowAt == null ? turn.startedAt : Math.min(turn.startedAt, firstRowAt);

  // 本轮的非工具时段（busy 的补集）。
  const gaps: SpanInterval[] = [];
  let cursor = turnStart;
  for (const item of toolBusy) {
    if (item.start > cursor) gaps.push({ start: cursor, end: item.start });
    cursor = Math.max(cursor, item.end);
  }
  if (turnEnd > cursor) gaps.push({ start: cursor, end: turnEnd });

  const spans: TrajectorySpan[] = [];
  for (const gap of gaps) {
    if (gap.end <= gap.start) continue;
    // gap 内第一条思考/答复行：决定 label / rowId / status / depth（整段只出一根条）。
    const first = ordered.find(
      (row) =>
        MODEL_ACTIVITY_KINDS.has(row.kind) &&
        row.startedAt >= gap.start &&
        row.startedAt <= gap.end,
    );
    if (!first) continue;

    const kindLabel = MODEL_ROW_LABEL[first.kind] ?? "模型";
    const label = `${kindLabel} · ${spanLabel(first.outputText, "无正文")}`;
    for (const piece of subtractBusy(gap.start, gap.end, toolBusy)) {
      if (piece.end <= piece.start) continue;
      spans.push({
        id: `${turn.runId}:model:${first.id}:${piece.start}`,
        lane: "model",
        start: piece.start,
        end: piece.end,
        label,
        status: first.status,
        rowId: first.id,
        turnIndex: turn.index,
        depth: first.depth,
        subRow: 0,
        ...spanTokens(first, turn),
      });
    }
  }

  return spans;
}

/**
 * 单轮 model 条分派：有可用 attempt → observed（真实占用）；否则 → approx（空档近似）。
 * `timing` 存在但 attempts 为空 / 时间戳不可解析时**不会**伪造 observed。
 */
function deriveModelSpans(
  turnRows: TrajectoryRow[],
  turn: TrajectoryTurn,
  attempts: readonly ParsedAttempt[],
): TrajectorySpan[] {
  if (attempts.length > 0) return deriveObservedModelSpans(turnRows, turn, attempts);
  return deriveApproxModelSpans(turnRows, turn);
}

/**
 * 轨迹级模型口径（见 `TrajectoryModelBasis`）：
 *   - 没有任何可用 attempt → `approx`；
 *   - 有可用 attempt，但任一轮**回退近似且真的产出了 model 条** → 仍标 `approx`
 *     （混合数据集不把近似条伪装成「真实占用」）；
 *   - 其余（全部有采样的轮都走 observed）→ `observed`。
 */
function deriveModelBasis(
  turns: TrajectoryTurn[],
  timingByRunId: ReadonlyMap<string, TurnTimingSnapshot>,
  lanes: TrajectoryLanes,
): TrajectoryModelBasis {
  if (turns.length === 0) return "approx";
  const approxTurnIndexes = new Set<number>();
  let observedTurns = 0;
  for (const turn of turns) {
    if (parseTimingAttempts(timingByRunId.get(turn.runId)).length > 0) {
      observedTurns += 1;
    } else {
      approxTurnIndexes.add(turn.index);
    }
  }
  if (observedTurns === 0) return "approx";
  const hasApproxSpan = lanes.model.some((span) => approxTurnIndexes.has(span.turnIndex));
  return hasApproxSpan ? "approx" : "observed";
}

/**
 * 行/轮模型 → 三条泳道的条。纯函数，同一输入恒同输出；
 * 排序规则 = start 升序（渲染端 `←/→` 切换也按这个次序）。
 *
 * `timings` 可选（runId → `turn.timing`）：带可用 attempts 的轮走 observed 口径，
 * 其余轮保持近似；不传＝全部近似（与升级前行为完全一致）。
 */
export function buildTrajectoryLanes(
  rows: TrajectoryRow[],
  turns: TrajectoryTurn[],
  timings?: ReadonlyMap<string, TurnTimingSnapshot | null | undefined>,
): TrajectoryLanes {
  const turnByIndex = new Map<number, TrajectoryTurn>();
  for (const turn of turns) turnByIndex.set(turn.index, turn);

  const rowsByTurn = new Map<number, TrajectoryRow[]>();
  for (const row of rows) {
    const list = rowsByTurn.get(row.turnIndex);
    if (list) list.push(row);
    else rowsByTurn.set(row.turnIndex, [row]);
  }

  const input: TrajectorySpan[] = [];
  const model: TrajectorySpan[] = [];
  const tool: TrajectorySpan[] = [];

  for (const [turnIndex, turnRows] of rowsByTurn) {
    const turn = turnByIndex.get(turnIndex);
    for (const row of turnRows) {
      if (row.kind === "user") {
        input.push({
          id: `${row.id}:input`,
          lane: "input",
          start: row.startedAt,
          end: row.endedAt,
          label: spanLabel(row.inputText, "用户输入"),
          status: row.status,
          rowId: row.id,
          turnIndex,
          depth: row.depth,
          subRow: 0,
          ...spanTokens(row, turn),
        });
      } else if (row.kind === "tool") {
        tool.push({
          id: `${row.id}:tool`,
          lane: "tool",
          start: row.startedAt,
          end: row.endedAt,
          label: row.toolName ?? "tool",
          ...(row.toolName ? { toolName: row.toolName } : {}),
          status: row.status,
          rowId: row.id,
          turnIndex,
          depth: row.depth,
          subRow: 0,
          ...spanTokens(row, turn),
        });
      }
    }
    if (turn) {
      model.push(
        ...deriveModelSpans(turnRows, turn, parseTimingAttempts(timings?.get(turn.runId))),
      );
    }
  }

  const byStart = (a: TrajectorySpan, b: TrajectorySpan): number =>
    a.start - b.start || a.end - b.end || a.id.localeCompare(b.id);

  const lanes: TrajectoryLanes = {
    input: input.sort(byStart),
    model: model.sort(byStart),
    tool: tool.sort(byStart),
  };
  assignSubRows(lanes.input);
  assignSubRows(lanes.model);
  assignSubRows(lanes.tool);
  return lanes;
}

/**
 * 泳道条的**并集**时长：区间按 start 升序（lanes 已排序）扫一遍，重叠/相接只算一
 * 次。用于覆盖率——嵌套子工具、跨轮重叠都不重复计入，因此
 * `modelMs + toolMs <= windowMs` 恒成立。
 */
function unionMs(spans: TrajectorySpan[]): number {
  let total = 0;
  let cursor = Number.NEGATIVE_INFINITY;
  for (const span of spans) {
    if (!(span.end > span.start)) continue;
    if (span.start >= cursor) {
      total += span.end - span.start;
      cursor = span.end;
    } else if (span.end > cursor) {
      total += span.end - cursor;
      cursor = span.end;
    }
  }
  return total;
}

/** 三条泳道的 wall-clock 覆盖率（并集口径，见 `TrajectoryCoverage`）。 */
function computeCoverage(
  lanes: TrajectoryLanes,
  windowStart: number,
  windowEnd: number,
): TrajectoryCoverage {
  return {
    modelMs: unionMs(lanes.model),
    toolMs: unionMs(lanes.tool),
    windowMs: Math.max(0, windowEnd - windowStart),
  };
}
