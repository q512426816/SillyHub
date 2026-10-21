/**
 * buildTrajectory 纯函数单测 —— 2026-10-20-session-page-dsh-alignment 档 1。
 *
 * 覆盖配对/时长、状态映射、嵌套、零日志轮、时序、截断、窗口等装配契约，
 * 以及同属档 1 的泳道（lanes）推导契约（D-024）。纯 node 逻辑（无 DOM），夹具最小化、
 * 不依赖真实导出文件。
 */
import type { AgentRunLogEntry } from "@/lib/agent";

import { buildTrajectory, type TrajectoryRunInput, type TurnTimingSnapshot } from "../build-trajectory";

const T0 = "2026-01-01T00:00:00.000Z";
const T0_MS = Date.parse(T0);

function at(offsetMs: number): string {
  return new Date(T0_MS + offsetMs).toISOString();
}

interface EventFixture {
  event_type?: string;
  type?: string;
  content?: string;
  seq?: number;
  call_id?: string;
  tool_name?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
  tool_kind?: string;
}

interface LogFixture {
  id?: string;
  runId?: string;
  offsetMs?: number;
  channel?: AgentRunLogEntry["channel"];
  content?: string | null;
  event?: EventFixture | null;
  parentToolUseId?: string | null;
  depth?: number | null;
  toolKind?: string | null;
  subagentType?: string | null;
}

let logSeq = 0;

function makeLog(fixture: LogFixture = {}): AgentRunLogEntry {
  logSeq += 1;
  const event = fixture.event;
  return {
    id: fixture.id ?? `log-${logSeq}`,
    run_id: fixture.runId ?? "run-1",
    timestamp: at(fixture.offsetMs ?? 0),
    channel: fixture.channel ?? "stdout",
    content_redacted: fixture.content ?? null,
    parent_tool_use_id: fixture.parentToolUseId ?? null,
    subagent_type: fixture.subagentType ?? null,
    depth: fixture.depth ?? null,
    tool_kind: fixture.toolKind ?? null,
    metadata: event
      ? {
          agent_event: {
            event_type: event.event_type ?? event.type,
            content: event.content,
            seq: event.seq,
            call_id: event.call_id,
            tool_name: event.tool_name,
            usage: event.usage,
            metadata: event.tool_kind ? { tool_kind: event.tool_kind } : undefined,
          },
        }
      : null,
  } satisfies AgentRunLogEntry;
}

function makeRun(overrides: Partial<TrajectoryRunInput> = {}): TrajectoryRunInput {
  return {
    id: "run-1",
    status: "completed",
    started_at: T0,
    finished_at: at(60_000),
    input_tokens: 100,
    output_tokens: 20,
    ...overrides,
  };
}

/** `TurnTimingSnapshot.attempts[]` 的一条（后端原样透传的 dict 形状）。 */
function timingAttempt(
  startOffsetMs: number,
  endOffsetMs: number,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    index: 0,
    startedAt: at(startOffsetMs),
    firstTokenAt: at(startOffsetMs + 1_000),
    endedAt: at(endOffsetMs),
    model: "claude-sonnet-4",
    inputTokens: 100,
    outputTokens: 20,
    ...overrides,
  };
}

function makeTiming(
  attempts: Array<Record<string, unknown>>,
  overrides: Partial<TurnTimingSnapshot> = {},
): TurnTimingSnapshot {
  return {
    runId: "run-1",
    basis: "observed",
    ttftMs: null,
    totalMs: 60_000,
    attempts,
    ...overrides,
  };
}

function toolUse(offsetMs: number, callId: string, toolName: string, args: unknown, extra: Partial<LogFixture> = {}) {
  return makeLog({
    offsetMs,
    channel: "tool_call",
    content: JSON.stringify({ tool: toolName, args }),
    toolKind: toolName.toLowerCase(),
    ...extra,
    event: {
      event_type: "tool_use",
      content: JSON.stringify(args),
      seq: 10 + offsetMs,
      call_id: callId,
      tool_name: toolName,
      tool_kind: toolName.toLowerCase(),
      ...extra.event,
    },
  });
}

describe("buildTrajectory", () => {
  it("配对 tool_use / tool_result：一行 tool + 真实时长 + ok", () => {
    const logs = [
      toolUse(1_000, "call-1", "Bash", { command: "ls" }),
      makeLog({
        offsetMs: 3_500,
        content: "[TOOL_RESULT] Exit code 0\nfile-a\nfile-b",
        event: { event_type: "tool_result", content: "Exit code 0\nfile-a\nfile-b", seq: 20, call_id: "call-1" },
      }),
    ];
    const { rows } = buildTrajectory(logs, [makeRun()]);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.kind).toBe("tool");
    expect(row.toolName).toBe("Bash");
    expect(row.callId).toBe("call-1");
    expect(row.status).toBe("ok");
    expect(row.startedAt).toBe(T0_MS + 1_000);
    expect(row.endedAt).toBe(T0_MS + 3_500);
    expect(row.durationMs).toBe(2_500);
    expect(row.inputText).toBe('{"command":"ls"}');
    expect(row.outputText).toBe("Exit code 0\nfile-a\nfile-b");
    expect(row.stepIndex).toBe(1);
  });

  it("Exit code 非 0 → error", () => {
    const logs = [
      toolUse(0, "call-1", "Bash", { command: "false" }),
      makeLog({
        offsetMs: 500,
        event: { event_type: "tool_result", content: "Exit code 2\nboom", call_id: "call-1" },
      }),
    ];
    const { rows } = buildTrajectory(logs, [makeRun()]);
    expect(rows[0]!.status).toBe("error");
  });

  it("Exit code 0 即使正文含 error 字样也是 ok", () => {
    const logs = [
      toolUse(0, "call-1", "Bash", { command: "grep error log" }),
      makeLog({
        offsetMs: 500,
        event: {
          event_type: "tool_result",
          content: "Exit code 0\nerror.log:1: error: harmless",
          call_id: "call-1",
        },
      }),
    ];
    expect(buildTrajectory(logs, [makeRun()]).rows[0]!.status).toBe("ok");
  });

  it("无结果的 tool_use 在 completed run → running，时长 0", () => {
    const logs = [toolUse(1_000, "call-1", "Bash", { command: "sleep 30" })];
    const { rows } = buildTrajectory(logs, [makeRun()]);
    expect(rows[0]!.status).toBe("running");
    expect(rows[0]!.durationMs).toBe(0);
  });

  it("无结果的 tool_use 在 killed run → interrupted", () => {
    const logs = [toolUse(1_000, "call-1", "Bash", { command: "sleep 30" })];
    const { rows } = buildTrajectory(logs, [makeRun({ status: "killed" })]);
    expect(rows[0]!.status).toBe("interrupted");
  });

  it("嵌套子工具：depth / parentCallId 从日志透传", () => {
    const logs = [
      toolUse(0, "call-child", "Read", { file_path: "/tmp/a.ts" }, {
        depth: 1,
        parentToolUseId: "call-parent",
        subagentType: "researcher",
      }),
      makeLog({
        offsetMs: 800,
        parentToolUseId: "call-parent",
        depth: 1,
        event: { event_type: "tool_result", content: "file body", call_id: "call-child" },
      }),
    ];
    const { rows } = buildTrajectory(logs, [makeRun()]);
    expect(rows[0]!.kind).toBe("tool");
    expect(rows[0]!.depth).toBe(1);
    expect(rows[0]!.parentCallId).toBe("call-parent");
    expect(rows[0]!.meta?.subagentType).toBe("researcher");
    expect(rows[0]!.status).toBe("ok");
  });

  it("thinking → 独立行，剥 [THINKING] 前缀并带上 inlineTokens", () => {
    const logs = [
      makeLog({
        offsetMs: 200,
        content: "[THINKING] 先看结构",
        event: {
          event_type: "thinking",
          content: "先看结构",
          seq: 1,
          usage: { input_tokens: 12, output_tokens: 7 },
        },
      }),
    ];
    const { rows } = buildTrajectory(logs, [makeRun()]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe("thinking");
    expect(rows[0]!.outputText).toBe("先看结构");
    expect(rows[0]!.inlineTokens).toEqual({ in: 12, out: 7 });
    expect(rows[0]!.status).toBe("ok");
  });

  it("text 事件 → assistant 行，剥文本协议前缀", () => {
    const logs = [
      makeLog({
        offsetMs: 900,
        content: "[ASSISTANT] 答复正文",
        event: { event_type: "text", content: "答复正文", seq: 3 },
      }),
    ];
    const { rows } = buildTrajectory(logs, [makeRun()]);
    expect(rows[0]!.kind).toBe("assistant");
    expect(rows[0]!.outputText).toBe("答复正文");
  });

  it("user_input → user 行（prompt 进 inputText）", () => {
    const logs = [
      makeLog({
        offsetMs: -5_000,
        channel: "user_input",
        content: "帮我看下这个页面",
      }),
    ];
    const { rows } = buildTrajectory(logs, [makeRun()]);
    expect(rows[0]!.kind).toBe("user");
    expect(rows[0]!.inputText).toBe("帮我看下这个页面");
    expect(rows[0]!.turnIndex).toBe(1);
  });

  it("TASK_STARTED → system 行，保留 parentCallId", () => {
    const logs = [
      makeLog({
        offsetMs: 400,
        content: '[TASK_STARTED] {"task_id":"t1","tool_use_id":"call-parent"}',
        parentToolUseId: "call-parent",
      }),
    ];
    const { rows } = buildTrajectory(logs, [makeRun()]);
    expect(rows[0]!.kind).toBe("system");
    expect(rows[0]!.outputText).toBe('{"task_id":"t1","tool_use_id":"call-parent"}');
    expect(rows[0]!.parentCallId).toBe("call-parent");
  });

  it("零日志 run 不产轮：轮号只数有日志的 run（1 起）", () => {
    const logs = [
      makeLog({ runId: "run-2", content: "hello", event: { event_type: "text", content: "hello" } }),
    ];
    const runs = [
      makeRun({ id: "run-empty", started_at: null, finished_at: null }),
      makeRun({ id: "run-2" }),
      makeRun({ id: "run-empty-2" }),
    ];
    const { turns, rows } = buildTrajectory(logs, runs);
    expect(turns).toHaveLength(1);
    expect(turns[0]!.index).toBe(1);
    expect(turns[0]!.runId).toBe("run-2");
    expect(rows.every((row) => row.turnIndex === 1)).toBe(true);
  });

  it("乱序输入 → 行按 startedAt 升序，stepIndex 同步重排", () => {
    const logs = [
      makeLog({ offsetMs: 5_000, event: { event_type: "text", content: "后" } }),
      makeLog({ offsetMs: 1_000, event: { event_type: "text", content: "先" } }),
      makeLog({ offsetMs: 3_000, channel: "user_input", content: "中间" }),
    ];
    const { rows } = buildTrajectory(logs, [makeRun()]);
    expect(rows.map((row) => row.outputText ?? row.inputText)).toEqual(["先", "中间", "后"]);
    expect(rows.map((row) => row.stepIndex)).toEqual([1, 2, 3]);
  });

  it("同一 timestamp 的行按 agent_event.seq 稳定排序", () => {
    const logs = [
      makeLog({ offsetMs: 1_000, event: { event_type: "text", content: "seq-20", seq: 20 } }),
      makeLog({ offsetMs: 1_000, event: { event_type: "text", content: "seq-10", seq: 10 } }),
    ];
    const { rows } = buildTrajectory(logs, [makeRun()]);
    expect(rows.map((row) => row.outputText)).toEqual(["seq-10", "seq-20"]);
  });

  it("截断：maxTextLen 生效，带 … 后缀和 truncated 标记", () => {
    const logs = [
      makeLog({ offsetMs: 0, event: { event_type: "text", content: "0123456789abcdef" } }),
    ];
    const { rows } = buildTrajectory(logs, [makeRun()], { maxTextLen: 10 });
    expect(rows[0]!.outputText).toBe("0123456789…");
    expect(rows[0]!.truncated).toBe(true);
  });

  it("默认截断 800：超长正文只留 800 + …", () => {
    const logs = [makeLog({ offsetMs: 0, event: { event_type: "text", content: "x".repeat(900) } })];
    const { rows } = buildTrajectory(logs, [makeRun()]);
    expect(rows[0]!.outputText).toHaveLength(801);
    expect(rows[0]!.outputText?.endsWith("…")).toBe(true);
    expect(rows[0]!.truncated).toBe(true);
  });

  it("轮时长优先取 run.started_at / finished_at", () => {
    const logs = [makeLog({ offsetMs: 1_000, event: { event_type: "text", content: "x" } })];
    const { turns } = buildTrajectory(
      logs,
      [makeRun({ started_at: at(500), finished_at: at(60_500) })],
    );
    expect(turns[0]!.durationMs).toBe(60_000);
    expect(turns[0]!.inputTokens).toBe(100);
    expect(turns[0]!.outputTokens).toBe(20);
  });

  it("run 时间缺失 → 回退首/末日志时间戳", () => {
    const logs = [
      makeLog({ offsetMs: 1_000, event: { event_type: "text", content: "x" } }),
      makeLog({ offsetMs: 21_000, event: { event_type: "text", content: "y" } }),
    ];
    const { turns } = buildTrajectory(
      logs,
      [makeRun({ started_at: null, finished_at: null })],
    );
    expect(turns[0]!.startedAt).toBe(T0_MS + 1_000);
    expect(turns[0]!.endedAt).toBe(T0_MS + 21_000);
    expect(turns[0]!.durationMs).toBe(20_000);
  });

  it("窗口覆盖早于 run.started_at 的 user_input 与末行", () => {
    const logs = [
      makeLog({ offsetMs: -4_000, channel: "user_input", content: "早到的提问" }),
      makeLog({ offsetMs: 70_000, event: { event_type: "text", content: "晚到的答复" } }),
    ];
    const { windowStart, windowEnd } = buildTrajectory(logs, [makeRun()]);
    expect(windowStart).toBe(T0_MS - 4_000);
    expect(windowEnd).toBe(T0_MS + 70_000);
  });

  it("孤儿 tool_result（无 tool_use）→ 独立 tool_result 行", () => {
    const logs = [
      makeLog({
        offsetMs: 2_000,
        content: "[TOOL_RESULT] Exit code 1\nno such file",
        event: { event_type: "tool_result", content: "Exit code 1\nno such file", call_id: "call-orphan" },
      }),
    ];
    const { rows } = buildTrajectory(logs, [makeRun()]);
    expect(rows[0]!.kind).toBe("tool_result");
    expect(rows[0]!.status).toBe("error");
    expect(rows[0]!.callId).toBe("call-orphan");
  });

  it("旧轨 tool_call envelope：toolName / callId 从 JSON 解析，inputText 只留 args", () => {
    const logs = [
      makeLog({
        offsetMs: 100,
        channel: "tool_call",
        content: JSON.stringify({ tool: "Grep", args: { pattern: "trajectory" }, tool_use_id: "call_grep" }),
      }),
    ];
    const { rows } = buildTrajectory(logs, [makeRun()]);
    expect(rows[0]!.kind).toBe("tool");
    expect(rows[0]!.toolName).toBe("Grep");
    expect(rows[0]!.callId).toBe("call_grep");
    expect(rows[0]!.inputText).toBe('{"pattern":"trajectory"}');
    expect(rows[0]!.status).toBe("running");
  });
});

/**
 * 泳道推导（`lanes` / `coverage`）—— 三条泳道共用同一绝对时间轴：
 * input = user tick、tool = tool 真实跨度、
 * model = 「非工具时段（gap）里出现过思考/答复」的**近似**整段跨度。
 *
 * 2026-10-21 规则变更：model 条从「第一条思考/答复行 → 下一个工具起点」改成
 * 「整个 gap」——条首因此落在轮首 / 工具终点上，覆盖率从 1.3% 升到数十个百分点。
 * 下面三条旧用例的期望值随之调整（1s→0s、10s→9s、6s→4s），断言意图不变。
 */
describe("buildTrajectory lanes", () => {
  function lanesOf(logs: AgentRunLogEntry[], runs: TrajectoryRunInput[] = [makeRun()]) {
    return buildTrajectory(logs, runs).lanes;
  }

  it("input 泳道：每个 user 行一根零宽 tick，lane/rowId 指回 rows", () => {
    const logs = [
      makeLog({ offsetMs: 0, channel: "user_input", content: "第一问" }),
      makeLog({ offsetMs: 5_000, channel: "user_input", content: "第二问" }),
      makeLog({ offsetMs: 6_000, event: { event_type: "text", content: "答复" } }),
    ];
    const { lanes, rows } = buildTrajectory(logs, [makeRun()]);
    expect(lanes.input).toHaveLength(2);
    for (const span of lanes.input) {
      expect(span.lane).toBe("input");
      expect(span.start).toBe(span.end); // tick：零宽
      expect(rows.some((row) => row.id === span.rowId)).toBe(true);
    }
    expect(lanes.input.map((span) => span.start)).toEqual([T0_MS, T0_MS + 5_000]);
    expect(lanes.input[0]!.label).toBe("第一问");
  });

  it("tool 泳道：每行一根条，跨度取 tool_use→tool_result，嵌套保留 depth 与状态", () => {
    const logs = [
      toolUse(1_000, "call-parent", "Task", { prompt: "sub" }),
      toolUse(2_000, "call-child", "Read", { file_path: "/tmp/a.ts" }, {
        depth: 1,
        parentToolUseId: "call-parent",
      }),
      makeLog({
        offsetMs: 3_000,
        event: { event_type: "tool_result", content: "file body", call_id: "call-child" },
      }),
      makeLog({
        offsetMs: 9_000,
        event: { event_type: "tool_result", content: "Exit code 1\nboom", call_id: "call-parent" },
      }),
    ];
    const lanes = lanesOf(logs);
    expect(lanes.tool).toHaveLength(2);
    expect(lanes.tool.every((span) => span.lane === "tool")).toBe(true);
    expect(lanes.tool.map((span) => [span.start, span.end, span.depth, span.status])).toEqual([
      [T0_MS + 1_000, T0_MS + 9_000, 0, "error"],
      [T0_MS + 2_000, T0_MS + 3_000, 1, "ok"],
    ]);
    expect(lanes.tool[1]!.toolName).toBe("Read");
  });

  it("model 泳道：工具间隙（gap）整段成条，遇 tool 断开", () => {
    const logs = [
      makeLog({ offsetMs: 0, channel: "user_input", content: "提问" }),
      makeLog({ offsetMs: 1_000, event: { event_type: "thinking", content: "想一下" } }),
      makeLog({ offsetMs: 6_000, event: { event_type: "text", content: "先说一句" } }),
      toolUse(10_000, "call-1", "Bash", { command: "ls" }),
      makeLog({
        offsetMs: 12_000,
        event: { event_type: "tool_result", content: "Exit code 0\nok", call_id: "call-1" },
      }),
      makeLog({ offsetMs: 20_000, event: { event_type: "thinking", content: "再看" } }),
      makeLog({ offsetMs: 25_000, event: { event_type: "text", content: "收尾" } }),
    ];
    const lanes = lanesOf(logs);
    // 新规则（2026-10-21）：条覆盖**整段非工具时段**——
    // gap 1 = [轮首 0s, 工具起点 10s)，gap 2 = [工具终点 12s, 轮尾 60s)。
    // 旧规则把条首钉在第一条思考行（1s / 20s）上，覆盖因此只有几个百分点。
    expect(lanes.model.map((span) => [span.start, span.end])).toEqual([
      [T0_MS + 0, T0_MS + 10_000],
      [T0_MS + 12_000, T0_MS + 60_000],
    ]);
    expect(lanes.model.every((span) => span.lane === "model")).toBe(true);
    expect(lanes.model[0]!.label.startsWith("思考 · ")).toBe(true);
    expect(lanes.model[1]!.label.startsWith("思考 · ")).toBe(true);
  });

  it("model 条与同轮 tool 条零重叠（含嵌套子工具包住的区间）", () => {
    const logs = [
      toolUse(1_000, "call-parent", "Task", { prompt: "sub" }),
      toolUse(2_000, "call-child", "Read", { file_path: "/tmp/a.ts" }, {
        depth: 1,
        parentToolUseId: "call-parent",
      }),
      makeLog({
        offsetMs: 3_000,
        event: { event_type: "tool_result", content: "body", call_id: "call-child" },
      }),
      // 落在父工具区间内部的思考：不得作为 model 条的起点
      makeLog({ offsetMs: 5_000, event: { event_type: "thinking", content: "父工具里" } }),
      makeLog({
        offsetMs: 9_000,
        event: { event_type: "tool_result", content: "Exit code 0", call_id: "call-parent" },
      }),
      // 父工具结束后：可以画
      makeLog({ offsetMs: 10_000, event: { event_type: "thinking", content: "工具后" } }),
    ];
    const { lanes, turns } = buildTrajectory(logs, [makeRun()]);
    expect(lanes.model).toHaveLength(1);
    // 工具区间结束后整段就是模型时段（端点 = 父工具终点 9s，不是思考行 10s）。
    expect(lanes.model[0]!.start).toBe(T0_MS + 9_000);
    expect(lanes.model[0]!.end).toBe(turns[0]!.endedAt);
    expect(lanes.model[0]!.label).toContain("工具后");

    for (const model of lanes.model) {
      for (const tool of lanes.tool) {
        const overlap = Math.min(model.end, tool.end) - Math.max(model.start, tool.start);
        expect(overlap).toBeLessThanOrEqual(0);
      }
    }
  });

  it("model 条被工具切断后逐块产出：工具前 / 工具后各一根，互不跨越工具", () => {
    const logs = [
      makeLog({ offsetMs: 0, event: { event_type: "thinking", content: "前" } }),
      toolUse(2_000, "call-1", "Bash", { command: "ls" }),
      makeLog({
        offsetMs: 4_000,
        event: { event_type: "tool_result", content: "Exit code 0", call_id: "call-1" },
      }),
      makeLog({ offsetMs: 6_000, event: { event_type: "thinking", content: "后" } }),
    ];
    const lanes = lanesOf(logs);
    // gap 边界就是工具端点：工具前 [0, 2s)、工具后 [4s, 轮尾 60s)。
    expect(lanes.model.map((span) => [span.start - T0_MS, span.end - T0_MS])).toEqual([
      [0, 2_000],
      [4_000, 60_000],
    ]);
  });

  it("gap 内只要有一条 thinking，就把**整段 gap** 画成一根 model 条（不再从思考行起算）", () => {
    const logs = [
      // 轮首 0s ── 工具 20s→30s ── 轮尾 60s
      makeLog({ offsetMs: 10_000, event: { event_type: "thinking", content: "先想" } }),
      toolUse(20_000, "call-1", "Bash", { command: "ls" }),
      makeLog({
        offsetMs: 30_000,
        event: { event_type: "tool_result", content: "Exit code 0", call_id: "call-1" },
      }),
      makeLog({ offsetMs: 40_000, event: { event_type: "text", content: "再答" } }),
    ];
    const lanes = lanesOf(logs);
    // 两个 gap 都被「思考/答复」点亮 → 各出一根**覆盖整段**的条。
    expect(lanes.model.map((span) => [span.start - T0_MS, span.end - T0_MS])).toEqual([
      [0, 20_000],
      [30_000, 60_000],
    ]);
    // 条首落在 gap 起点（轮首 / 工具终点），不是第一条思考行。
    expect(lanes.model[0]!.start).toBe(T0_MS);
    expect(lanes.model[1]!.start).toBe(T0_MS + 30_000);
  });

  it("gap 内只有 system / user 行 → 不产 model 条（既无思考也无答复）", () => {
    const logs = [
      makeLog({ offsetMs: 0, channel: "user_input", content: "提问" }),
      makeLog({ offsetMs: 5_000, content: "[SYSTEM] boot" }),
      toolUse(10_000, "call-1", "Bash", { command: "ls" }),
      makeLog({
        offsetMs: 20_000,
        event: { event_type: "tool_result", content: "Exit code 0", call_id: "call-1" },
      }),
    ];
    const { lanes } = buildTrajectory(logs, [makeRun()]);
    expect(lanes.model).toEqual([]);
    expect(lanes.tool).toHaveLength(1);
    expect(lanes.input).toHaveLength(1);
  });

  it("coverage：模型 20s + 工具 10s + 空档 30s = 整窗 60s（并集口径）", () => {
    const logs = [
      // 只有工具**前**的 gap 里有思考；工具后的 gap 空着 → 计入空档
      makeLog({ offsetMs: 10_000, event: { event_type: "thinking", content: "先想" } }),
      toolUse(20_000, "call-1", "Bash", { command: "ls" }),
      makeLog({
        offsetMs: 30_000,
        event: { event_type: "tool_result", content: "Exit code 0", call_id: "call-1" },
      }),
    ];
    const { coverage, windowStart, windowEnd } = buildTrajectory(logs, [makeRun()]);
    expect(coverage.windowMs).toBe(windowEnd - windowStart);
    expect(coverage.windowMs).toBe(60_000);
    expect(coverage.modelMs).toBe(20_000); // [0,20s)：工具前的整段 gap
    expect(coverage.toolMs).toBe(10_000); // [20s,30s)
    // 三者铺满整窗，且并集口径保证不会超过 100%。
    expect(coverage.modelMs + coverage.toolMs).toBeLessThanOrEqual(coverage.windowMs);
    expect(coverage.windowMs - coverage.modelMs - coverage.toolMs).toBe(30_000); // [30s,60s) 无思考/答复
  });

  it("coverage 的 toolMs 用并集：嵌套子工具不重复计入", () => {
    const logs = [
      toolUse(0, "call-parent", "Task", { prompt: "sub" }),
      toolUse(2_000, "call-child", "Read", { file_path: "/tmp/a.ts" }, {
        depth: 1,
        parentToolUseId: "call-parent",
      }),
      makeLog({
        offsetMs: 4_000,
        event: { event_type: "tool_result", content: "body", call_id: "call-child" },
      }),
      makeLog({
        offsetMs: 10_000,
        event: { event_type: "tool_result", content: "Exit code 0", call_id: "call-parent" },
      }),
    ];
    const { coverage, lanes } = buildTrajectory(logs, [makeRun()]);
    expect(lanes.tool).toHaveLength(2); // 两条都还在（泳道要展示嵌套）
    expect(coverage.toolMs).toBe(10_000); // 并集只算父区间一次
  });

  it("同一轮内 model × tool 逐对零重叠（多工具 + 嵌套 + 多轮）", () => {
    const logs = [
      makeLog({ offsetMs: 1_000, event: { event_type: "thinking", content: "t1" } }),
      toolUse(2_000, "p1", "Task", { prompt: "sub" }),
      toolUse(3_000, "c1", "Read", { file_path: "/a" }, {
        depth: 1,
        parentToolUseId: "p1",
      }),
      makeLog({
        offsetMs: 4_000,
        event: { event_type: "tool_result", content: "body", call_id: "c1" },
      }),
      makeLog({ offsetMs: 5_000, event: { event_type: "thinking", content: "父工具里" } }),
      makeLog({
        offsetMs: 6_000,
        event: { event_type: "tool_result", content: "Exit code 0", call_id: "p1" },
      }),
      makeLog({ offsetMs: 7_000, event: { event_type: "text", content: "答复" } }),
      toolUse(8_000, "p2", "Bash", { command: "ls" }),
      makeLog({ offsetMs: 9_000, event: { event_type: "tool_result", content: "Exit code 0", call_id: "p2" } }),
      // 第二轮：打点/窗口都另起一段
      makeLog({ runId: "run-2", offsetMs: 70_000, event: { event_type: "thinking", content: "第二轮" } }),
      toolUse(80_000, "p3", "Bash", { command: "pwd" }, { runId: "run-2" }),
      makeLog({
        runId: "run-2",
        offsetMs: 90_000,
        event: { event_type: "tool_result", content: "Exit code 0", call_id: "p3" },
      }),
    ];
    const runs = [
      makeRun(),
      makeRun({ id: "run-2", started_at: at(65_000), finished_at: at(120_000) }),
    ];
    const { lanes, coverage } = buildTrajectory(logs, runs);

    const turnIndexes = new Set(lanes.model.map((span) => span.turnIndex));
    expect(turnIndexes.size).toBe(2); // 两轮都有 model 条，断言不是空转
    expect(lanes.tool).toHaveLength(4);
    for (const turnIndex of turnIndexes) {
      const models = lanes.model.filter((span) => span.turnIndex === turnIndex);
      const tools = lanes.tool.filter((span) => span.turnIndex === turnIndex);
      for (const model of models) {
        for (const tool of tools) {
          const overlap = Math.min(model.end, tool.end) - Math.max(model.start, tool.start);
          expect(overlap).toBeLessThanOrEqual(0);
        }
      }
    }
    expect(coverage.modelMs + coverage.toolMs).toBeLessThanOrEqual(coverage.windowMs);
  });

  it("无 user / tool 行 → 对应泳道为空数组（不产幽灵条）", () => {
    const logs = [makeLog({ offsetMs: 500, event: { event_type: "text", content: "" } })];
    const { lanes } = buildTrajectory(logs, [makeRun()]);
    expect(lanes.input).toEqual([]);
    expect(lanes.tool).toEqual([]);
  });
});

/**
 * 模型泳道真实区间（task-12 / D-026 退役判据）：
 * `run.timing`（`TurnTimingSnapshot`）存在且 attempts 非空 → 每个 attempt 一根
 * **真实占用**条；缺失 / attempts 为空 → 旧「整段非工具空档」近似口径完全不变。
 */
describe("buildTrajectory model timing", () => {
  it("timing 存在且 attempts 非空 → 每个 attempt 一根 model 条，start/end 精确、label 带 model 与 TTFT", () => {
    const logs = [
      makeLog({ offsetMs: 2_500, event: { event_type: "thinking", content: "第一次请求" } }),
      makeLog({ offsetMs: 16_000, event: { event_type: "text", content: "第二次请求" } }),
    ];
    const attempts = [
      timingAttempt(2_000, 8_000, { index: 0, firstTokenAt: at(3_000), model: "claude-a" }),
      timingAttempt(15_000, 22_000, { index: 1, firstTokenAt: at(15_500), model: "claude-b" }),
    ];
    const { lanes, rows, modelBasis, coverage } = buildTrajectory(logs, [
      makeRun({ timing: makeTiming(attempts) }),
    ]);

    expect(modelBasis).toBe("observed");
    expect(lanes.model).toHaveLength(attempts.length);
    expect(lanes.model.map((span) => [span.start - T0_MS, span.end - T0_MS])).toEqual([
      [2_000, 8_000],
      [15_000, 22_000],
    ]);
    // label 必须带 model 与 TTFT 毫秒（attempt 起点 → 首 token）。
    expect(lanes.model[0]!.label).toContain("claude-a");
    expect(lanes.model[0]!.label).toContain("TTFT 1000ms");
    expect(lanes.model[1]!.label).toContain("claude-b");
    expect(lanes.model[1]!.label).toContain("TTFT 500ms");
    // inspector 锚点仍指向真实行。
    for (const span of lanes.model) {
      expect(rows.some((row) => row.id === span.rowId)).toBe(true);
    }
    expect(coverage.modelMs).toBe(13_000); // 6s + 7s

    // 单 attempt 且 attempt 无 firstTokenAt 时，回填轮级 ttftMs（不填 0 冒充）。
    const single = buildTrajectory(logs, [
      makeRun({
        timing: makeTiming(
          [timingAttempt(2_000, 8_000, { firstTokenAt: null })],
          { ttftMs: 850 },
        ),
      }),
    ]);
    expect(single.lanes.model).toHaveLength(1);
    expect(single.lanes.model[0]!.label).toContain("TTFT 850ms");
  });

  it("timing 缺失（undefined / null / attempts 为空）→ modelBasis=approx，条数与旧空档口径完全一致", () => {
    const logs = [
      makeLog({ offsetMs: 10_000, event: { event_type: "thinking", content: "先想" } }),
      toolUse(20_000, "call-1", "Bash", { command: "ls" }),
      makeLog({
        offsetMs: 30_000,
        event: { event_type: "tool_result", content: "Exit code 0", call_id: "call-1" },
      }),
    ];
    const legacy = buildTrajectory(logs, [makeRun()]);
    expect(legacy.modelBasis).toBe("approx");
    // 旧口径：只有工具前那段 gap 里有思考行 → 只有一根条；工具后无思考/答复 → 无条。
    expect(legacy.lanes.model.map((span) => [span.start - T0_MS, span.end - T0_MS])).toEqual([
      [0, 20_000],
    ]);

    const withoutTiming = buildTrajectory(logs, [makeRun({ timing: null })]);
    expect(withoutTiming.modelBasis).toBe("approx");
    expect(withoutTiming.lanes.model).toEqual(legacy.lanes.model);

    // timing 存在但 attempts 为空 → 视为 approx（不伪造 observed）。
    const emptyAttempts = buildTrajectory(logs, [makeRun({ timing: makeTiming([]) })]);
    expect(emptyAttempts.modelBasis).toBe("approx");
    expect(emptyAttempts.lanes.model).toEqual(legacy.lanes.model);
  });

  it("timing 与工具区间重叠 → 与工具差集裁掉重叠段，model × tool 零重叠", () => {
    const logs = [
      toolUse(2_000, "call-1", "Bash", { command: "ls" }),
      makeLog({
        offsetMs: 3_000,
        event: { event_type: "tool_result", content: "Exit code 0", call_id: "call-1" },
      }),
      makeLog({ offsetMs: 4_000, event: { event_type: "thinking", content: "工具后继续" } }),
    ];
    const attempts = [timingAttempt(1_000, 5_000, { index: 0, firstTokenAt: at(1_200) })];
    const { lanes, coverage } = buildTrajectory(logs, [makeRun({ timing: makeTiming(attempts) })]);

    // [1s,5s) − [2s,3s) = [1s,2s) + [3s,5s)
    expect(lanes.model.map((span) => [span.start - T0_MS, span.end - T0_MS])).toEqual([
      [1_000, 2_000],
      [3_000, 5_000],
    ]);
    expect(coverage.modelMs).toBe(3_000);
    expect(coverage.toolMs).toBe(1_000);
    for (const model of lanes.model) {
      for (const tool of lanes.tool) {
        const overlap = Math.min(model.end, tool.end) - Math.max(model.start, tool.start);
        expect(overlap).toBeLessThanOrEqual(0);
      }
    }
  });

  it("coverage 并集不超窗：越过 run.finished_at 的 attempt 也计入窗口，model+tool ≤ window", () => {
    const logs = [
      makeLog({ offsetMs: 6_000, event: { event_type: "thinking", content: "想" } }),
      toolUse(10_000, "call-1", "Bash", { command: "ls" }),
      makeLog({
        offsetMs: 20_000,
        event: { event_type: "tool_result", content: "Exit code 0", call_id: "call-1" },
      }),
    ];
    const attempts = [
      timingAttempt(5_000, 15_000, { index: 0 }), // 与工具 [10s,20s) 重叠 → 裁到 [5s,10s)
      timingAttempt(58_000, 75_000, { index: 1 }), // 越过 run.finished_at（60s）
    ];
    const { coverage, lanes, windowStart, windowEnd } = buildTrajectory(logs, [
      makeRun({ timing: makeTiming(attempts) }),
    ]);

    expect(windowStart).toBe(T0_MS);
    expect(windowEnd).toBe(T0_MS + 75_000); // 窗口扩到真实占用终点
    expect(coverage.windowMs).toBe(75_000);
    expect(coverage.modelMs).toBe(5_000 + 17_000); // [5s,10s) + [58s,75s)
    expect(coverage.toolMs).toBe(10_000);
    expect(coverage.modelMs + coverage.toolMs).toBeLessThanOrEqual(coverage.windowMs);
    for (const span of [...lanes.model, ...lanes.tool]) {
      expect(span.start).toBeGreaterThanOrEqual(windowStart);
      expect(span.end).toBeLessThanOrEqual(windowEnd);
    }
  });
});
