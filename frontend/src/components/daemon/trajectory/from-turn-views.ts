/**
 * 产品会话页的轨迹数据源（2026-10-22-session-trajectory-view / D-035）。
 *
 * 背景：轨迹档 1 原先只由 `buildTrajectory(logs, runs)` 驱动，唯一调用方是 dev 路由
 * `/proto/session-trajectory`（读盘的真实导出）。产品会话页拿不到原始 `AgentRunLogEntry[]`，
 * 但它手里已经有装配好的 `SessionTurnView[]`（含段级时间戳），足够派生三泳道所需的
 * 行/轮模型——因此这里做一层**纯函数适配器**：
 *
 *   SessionTurnView[] → TrajectoryRow[] / TrajectoryTurn[] → `assembleTrajectory`
 *
 * 关键约束（design 契约）：
 * - **零网络请求 / 零后端改动**：只吃页面已加载的数据（含 page-helpers 从 `/runs` 透传的
 *   `timing`——它是同一次会话加载的一部分，不是本面板新增的请求）；
 * - **不伪造时序**：段与轮都取真实锚点（`turnStartedAt` / 段 `startedAt|ts` / `replyAt`），
 *   整轮没有任何可用锚点 → **跳过该轮**（不塞 now()、不补 0），由调用方渲染空态；
 * - 口径沿用 `assembleTrajectory`：轮带 `timing` 且 attempts 非空 → 模型泳道真实占用
 *   （`observed`）；否则恒 `approx`（泳道头显示「近似（无 TTFT 采样）」）。
 */
import {
  assembleTrajectory,
  type Trajectory,
  type TrajectoryRow,
  type TrajectoryRowKind,
  type TrajectoryRowStatus,
  type TrajectoryTurn,
  type TurnTimingSnapshot,
} from "./build-trajectory";
import type { SessionTurnView } from "@/components/daemon/turn-timeline";
import type { TurnSegment } from "@/components/daemon/session-log-assembler";

/** 文本截断默认值与日志驱动路径一致（800 字）。 */
const DEFAULT_MAX_TEXT_LEN = 800;

export interface TurnViewTrajectoryOptions {
  /** 单行文本截断长度（默认 800；测试可传小值）。 */
  maxTextLen?: number;
}

function clip(
  text: string | null | undefined,
  max: number,
): { value?: string; truncated?: boolean } {
  if (!text) return {};
  if (text.length <= max) return { value: text };
  return { value: text.slice(0, max), truncated: true };
}

function parseIso(value: string | null | undefined): number | null {
  if (!value) return null;
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : null;
}

/** 轮 UI 态 → 轨迹行态（`interrupting`/`pending` 视为 running，不提前判死）。 */
function rowStatusOf(status: SessionTurnView["status"]): TrajectoryRowStatus {
  if (status === "failed") return "error";
  if (status === "killed") return "interrupted";
  if (status === "completed") return "ok";
  return "running";
}

/** 段类别 → 轨迹行类别（未识别段一律 system，不丢、不冒充正文）。 */
function rowKindOf(segment: TurnSegment): TrajectoryRowKind {
  switch (segment.kind) {
    case "text":
      return "assistant";
    case "thinking":
      return "thinking";
    case "tool":
      return "tool";
    case "compact":
    case "compact_status":
      return "compaction";
    case "user_msg":
    case "turn_trigger":
      return "user";
    case "file":
    case "stderr":
    case "preamble":
    case "subagent_stub":
      return "system";
    default:
      return "system";
  }
}

/** 段的起始锚点（text 用 startedAt，thinking 用 ts，tool 用 startedAt）。 */
function segmentStart(segment: TurnSegment): number | null {
  if (segment.kind === "thinking") return segment.ts ?? null;
  const start = (segment as { startedAt?: number | null }).startedAt;
  return typeof start === "number" ? start : null;
}

/** 段的结束锚点（仅工具段有真实 end；其余零宽）。 */
function segmentEnd(segment: TurnSegment, start: number): number {
  const end = (segment as { endedAt?: number | null }).endedAt;
  return typeof end === "number" && end >= start ? end : start;
}

/**
 * 轮视图 → 轨迹（三泳道 + 账本 + 检查器共用的 `Trajectory`）。
 *
 * @param turns 会话页已加载的轮（预览条目与无锚点轮会被跳过）
 * @returns 至少 `rows`/`turns` 为数组；两者皆空表示「无可绘制时序数据」
 */
export function trajectoryFromTurnViews(
  turns: readonly SessionTurnView[],
  options: TurnViewTrajectoryOptions = {},
): Trajectory {
  const maxTextLen = options.maxTextLen ?? DEFAULT_MAX_TEXT_LEN;
  const rows: TrajectoryRow[] = [];
  const outTurns: TrajectoryTurn[] = [];
  // 2026-10-22-session-trajectory-view（D-035②）：轮视图携带的 `/runs` timing
  // （daemon TTFT/attempt 采样）按 runId 收集——有 attempts 时模型泳道走真实占用
  // 区间（modelBasis="observed"），缺省/空 attempts 恒 approx，不伪造。
  const timingByRunId = new Map<string, TurnTimingSnapshot>();

  for (const turn of turns) {
    // 预览条目（未加载轮摘要）没有真实段时序——不参与轨迹。
    if (turn.preview) continue;

    const runId = turn.realRunId ?? turn.runId;
    const segs = turn.segments ?? [];
    const turnStartHint = typeof turn.turnStartedAt === "number" ? turn.turnStartedAt : null;
    const firstSegStart = segs.map(segmentStart).find((ts): ts is number => ts != null) ?? null;
    const replyAt = parseIso(turn.replyAt);

    const turnStart = turnStartHint ?? firstSegStart;
    // 整轮无任何时序锚点 → 跳过（不伪造 now()）。
    if (turnStart == null) continue;

    const turnIndex = outTurns.length + 1;
    const turnRows: TrajectoryRow[] = [];

    // 1) 用户输入行（零宽 tick；prompt 空也不丢——泳道需要知道「这轮由谁触发」）。
    turnRows.push({
      id: `${runId}:user`,
      kind: "user",
      turnIndex,
      stepIndex: 0,
      depth: 0,
      status: rowStatusOf(turn.status),
      startedAt: turnStart,
      endedAt: turnStart,
      durationMs: 0,
      inputText: clip(turn.prompt, maxTextLen).value,
    });

    // 2) 段行（思考 / 工具 / 正文 / 其它）。
    segs.forEach((segment, i) => {
      const start = segmentStart(segment);
      // 段缺锚点：用轮首兜底（真实轮首锚点，不是伪造值）。
      const startedAt = start ?? turnStart;
      const endedAt = segmentEnd(segment, startedAt);
      const kind = rowKindOf(segment);
      const clipped = clip(
        kind === "tool"
          ? (segment as { primary?: string | null }).primary ?? undefined
          : (segment as { text?: string }).text,
        maxTextLen,
      );
      const status: TrajectoryRowStatus =
        kind === "tool"
          ? (segment as { status?: "running" | "ok" | "deny" }).status === "deny"
            ? "error"
            : (segment as { status?: "running" | "ok" | "deny" }).status === "running"
              ? "running"
              : "ok"
          : rowStatusOf(turn.status);

      turnRows.push({
        id: `${runId}:${kind}:${segment.id || i}`,
        kind,
        turnIndex,
        stepIndex: 0,
        depth: 0,
        status,
        startedAt,
        endedAt,
        durationMs: Math.max(0, endedAt - startedAt),
        ...(kind === "tool"
          ? { toolName: (segment as { toolName?: string | null }).toolName ?? undefined }
          : {}),
        ...(clipped.truncated ? { truncated: true } : {}),
        ...(clipped.value
          ? kind === "user"
            ? { inputText: clipped.value }
            : { outputText: clipped.value }
          : {}),
        ...(kind === "assistant" || kind === "thinking"
          ? {}
          : { meta: { seq: i } as { seq?: number } }),
      });
    });

    // 3) 轮尾（replyAt 可能是唯一可靠的「这轮什么时候完」锚点）。
    let turnEnd = turnStart;
    for (const row of turnRows) turnEnd = Math.max(turnEnd, row.endedAt);
    if (replyAt != null) turnEnd = Math.max(turnEnd, replyAt);

    turnRows.sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id));
    turnRows.forEach((row, i) => {
      row.stepIndex = i + 1;
    });

    rows.push(...turnRows);
    if (turn.timing) timingByRunId.set(runId, turn.timing);
    outTurns.push({
      index: turnIndex,
      runId,
      startedAt: turnStart,
      endedAt: turnEnd,
      durationMs: Math.max(0, turnEnd - turnStart),
      status: turn.status,
      ...(typeof turn.inputTokens === "number" ? { inputTokens: turn.inputTokens } : {}),
      ...(typeof turn.outputTokens === "number" ? { outputTokens: turn.outputTokens } : {}),
    });
  }

  // 有 timing 的轮 → observed（真实占用区间）；全无 → approx（泳道头标「近似」）。
  return assembleTrajectory(rows, outTurns, timingByRunId);
}
