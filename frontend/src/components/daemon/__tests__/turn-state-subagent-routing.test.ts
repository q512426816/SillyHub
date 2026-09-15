/**
 * 2026-09-15-subagent-three-pane-display 用户验收返工：upsertTurn 父归属优先
 * 跨轮路由单测（实时 SSE 路径）。
 *
 * 背景（DB 实证）：后台子代理的 [TASK_NOTIFICATION]/内容行常经后续 run 上报
 * （daemon 任务注册表丢失时 writeTaskLine 回退 currentRunId）。按 run_id 分轮
 * 会让终态信号落到后续轮、找不到派发段 → 派发段永久「运行中」。本文件锁定：
 *   1. 带 parent_tool_use_id 的 log 先全轮 DFS 找父段，命中即路由到父段所在轮
 *      （终态信号更新段元数据），run_id 轮不动、不新建轮；
 *   2. 父段所在轮已完成（completed）时照样更新段元数据且**不**把轮翻回 running
 *      （后台通知到达时派发轮本就可能已完成）；
 *   3. 无 parent / 父段未找到 → 回退 run_id 分轮原路径（stub 兜底不变）。
 */
import { describe, it, expect } from "vitest";

import {
  applyEnvelopeToTurn,
  upsertTurn,
  type TurnState,
} from "../session-panel/turn-state";
import type { SessionTurnView } from "../turn-timeline";
import type { SessionStreamEnvelope } from "@/lib/daemon/session-sse";

function makeTurn(runId: string, overrides: Partial<SessionTurnView> = {}): SessionTurnView {
  return {
    runId,
    turn: null,
    prompt: "",
    output: "",
    status: "running",
    seenLogIds: new Set<string>(),
    inputTokens: null,
    outputTokens: null,
    processItems: [],
    segments: [],
    turnStartedAt: null,
    ...overrides,
  };
}

function makeEnv(overrides: Partial<SessionStreamEnvelope>): SessionStreamEnvelope {
  return {
    event: "log",
    session_id: "sess-1",
    run_id: null,
    turn: null,
    log_id: null,
    timestamp: "2026-09-15T12:00:00Z",
    channel: null,
    content: null,
    status: null,
    exit_code: null,
    reason: null,
    ...overrides,
  } as SessionStreamEnvelope;
}

const runA = "run-dispatch";
const runB = "run-later";

/** 派发轮：run A 内一条 Task tool_call（toolu_A1）已入段。 */
function makeDispatchState(dispatchStatus: SessionTurnView["status"] = "running"): TurnState {
  const dispatchEnv = makeEnv({
    run_id: runA,
    log_id: "s2",
    channel: "tool_call",
    content: JSON.stringify({
      tool: "Task",
      tool_use_id: "toolu_A1",
      args: { description: "后台调研", prompt: "请调研 X", subagent_type: "Explore" },
    }),
  });
  const turnA = applyEnvelopeToTurn(makeTurn(runA, { status: dispatchStatus }), dispatchEnv);
  return { turns: [turnA, makeTurn(runB)], currentRunId: runB };
}

/** DFS 找 tool_use_id 匹配的 tool 段（断言用）。 */
type Seg = NonNullable<SessionTurnView["segments"]>[number];

function findToolSeg(turns: SessionTurnView[], id: string): Seg | null {
  const walk = (list: SessionTurnView["segments"]): Seg | null => {
    for (const s of list ?? []) {
      if (s.kind === "tool" && s.id === id) return s;
      if (s.kind === "tool" || s.kind === "subagent_stub") {
        const inner = walk(s.children);
        if (inner) return inner;
      }
    }
    return null;
  };
  for (const t of turns) {
    const hit = walk(t.segments);
    if (hit) return hit;
  }
  return null;
}

describe("upsertTurn 父归属优先跨轮路由（2026-09-15 验收返工）", () => {
  it("后续 run 的 [TASK_NOTIFICATION] 路由到派发轮——taskStatus 收敛 completed，run_id 轮零污染", () => {
    const prev = makeDispatchState();
    const env = makeEnv({
      run_id: runB,
      log_id: "s9",
      channel: "stdout",
      parent_tool_use_id: "toolu_A1",
      content: '[TASK_NOTIFICATION] {"task_id":"t1","status":"completed","elapsed_ms":900}',
    });
    const next = upsertTurn(prev, env, (t) => applyEnvelopeToTurn(t, env), {});
    expect(next.turns).toHaveLength(2);
    const tool = findToolSeg(next.turns, "toolu_A1");
    expect(tool).toMatchObject({ kind: "tool", taskStatus: "completed", taskElapsedMs: 900 });
    // run B 轮未被写入（无新建、无 stub）。
    expect(next.turns[1]?.segments).toHaveLength(0);
    expect(next.currentRunId).toBe(runB);
  });

  it("派发轮已 completed 时照样更新段元数据，且不把轮翻回 running", () => {
    const prev = makeDispatchState("completed");
    const env = makeEnv({
      run_id: runB,
      log_id: "s9",
      channel: "stdout",
      parent_tool_use_id: "toolu_A1",
      content: '[TASK_NOTIFICATION] {"task_id":"t1","status":"completed","elapsed_ms":900}',
    });
    const next = upsertTurn(prev, env, (t) => applyEnvelopeToTurn(t, env), {});
    expect(next.turns[0]?.status).toBe("completed");
    expect(findToolSeg(next.turns, "toolu_A1")).toMatchObject({ taskStatus: "completed" });
  });

  it("无 parent 归属（前台普通行）回退 run_id 分轮——既有行为不变", () => {
    const prev = makeDispatchState();
    const env = makeEnv({
      run_id: runB,
      log_id: "s9",
      channel: "stdout",
      content: "[TOOL_RESULT] ok",
    });
    const next = upsertTurn(prev, env, (t) => applyEnvelopeToTurn(t, env), {});
    // 写入 run B 轮（孤儿 result 兜底段），派发轮不动。
    expect(next.turns[0]?.segments).toHaveLength(1);
    expect((next.turns[1]?.segments ?? []).length).toBeGreaterThan(0);
  });

  it("parent 指向不存在的段（孤儿/更早历史页未加载）→ 回退 run_id 分轮建 stub", () => {
    const prev = makeDispatchState();
    const env = makeEnv({
      run_id: runB,
      log_id: "s9",
      channel: "stdout",
      parent_tool_use_id: "toolu_UNKNOWN",
      subagent_type: "Explore",
      content: "[ASSISTANT] 孤儿子代理产出",
    });
    const next = upsertTurn(prev, env, (t) => applyEnvelopeToTurn(t, env), {});
    expect(next.turns[0]?.segments).toHaveLength(1);
    expect(
      (next.turns[1]?.segments ?? []).some((s) => s.kind === "subagent_stub"),
    ).toBe(true);
  });
});
