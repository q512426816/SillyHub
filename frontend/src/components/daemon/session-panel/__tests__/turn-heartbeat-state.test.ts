/**
 * 2026-10-29-engine-live-perception（FR-03）：applyTurnHeartbeat 纯函数——
 * 轮内心跳写入轮状态的守卫面（main 选主 / 载荷守卫 / runId 路由与竞态回退 /
 * 终态清空）。applyTurnPhase 同款路由语义的对齐用例。
 */
import { describe, expect, it } from "vitest";

import {
  applyTurnHeartbeat,
  clearTurnPhase,
} from "@/components/daemon/session-panel/turn-state";
import type { SessionTurnView } from "@/components/daemon/turn-timeline";

function makeTurn(runId: string, over: Partial<SessionTurnView> = {}): SessionTurnView {
  return {
    runId,
    turn: 1,
    prompt: "继续",
    output: "",
    status: "running",
    seenLogIds: new Set<string>(),
    inputTokens: null,
    outputTokens: null,
    ctxTokens: null,
    apiDurationMs: null,
    errorDetail: null,
    ...over,
  };
}

const MAIN_HB = {
  kind: "generating",
  est_chars: 4200,
  est_tokens: 1200,
  precision: "estimated",
  source: "claude_input_json_delta",
} as const;

describe("applyTurnHeartbeat（2026-10-29-engine-live-perception FR-03）", () => {
  it("main 心跳按 runId 写入轮状态（at=本地到达时刻）", () => {
    const turns = [makeTurn("run-1")];
    const next = applyTurnHeartbeat(turns, "run-1", { ...MAIN_HB });
    expect(next[0]!.heartbeat).toMatchObject({
      kind: "generating",
      est_chars: 4200,
      est_tokens: 1200,
      precision: "estimated",
      source: "claude_input_json_delta",
    });
    expect(next[0]!.heartbeat!.at).toBeGreaterThan(0);
    // 原数组不可变（map 新对象）。
    expect(turns[0]!.heartbeat).toBeUndefined();
  });

  it("选主（Grill P1-b）：子代理心跳（parent_tool_use_id 非空）不入主轮状态", () => {
    const turns = [makeTurn("run-1")];
    const next = applyTurnHeartbeat(turns, "run-1", {
      ...MAIN_HB,
      parent_tool_use_id: "toolu_sub_1",
    });
    expect(next).toBe(turns); // 原样返回（未写入）
  });

  it("载荷守卫：kind/precision 非法值静默忽略（不伪造）", () => {
    const turns = [makeTurn("run-1")];
    expect(
      applyTurnHeartbeat(turns, "run-1", {
        ...MAIN_HB,
        kind: "generating_text",
      }),
    ).toBe(turns);
    expect(
      applyTurnHeartbeat(turns, "run-1", {
        ...MAIN_HB,
        precision: "maybe",
      }),
    ).toBe(turns);
    expect(
      applyTurnHeartbeat(turns, "run-1", {
        ...MAIN_HB,
        kind: null,
        precision: null,
      }),
    ).toBe(turns);
  });

  it("est_* 非数值归 null（不伪造 0）", () => {
    const turns = [makeTurn("run-1")];
    const next = applyTurnHeartbeat(turns, "run-1", {
      kind: "awaiting_first_token",
      precision: "estimated",
      source: "zcode_telemetry",
    });
    expect(next[0]!.heartbeat).toMatchObject({
      kind: "awaiting_first_token",
      est_chars: null,
      est_tokens: null,
    });
  });

  it("未命中 runId 时回退 currentRunId 活跃轮（竞态回退同 applyTurnPhase FR-01）", () => {
    const turns = [makeTurn("placeholder-1")];
    const next = applyTurnHeartbeat(
      turns,
      "real-run-9",
      { ...MAIN_HB },
      "placeholder-1",
    );
    expect(next[0]!.heartbeat).toBeDefined();
  });

  it("无 runId / 无回退命中：原样返回不建幽灵轮", () => {
    const turns = [makeTurn("run-1")];
    expect(applyTurnHeartbeat(turns, null, { ...MAIN_HB })).toBe(turns);
    expect(
      applyTurnHeartbeat(turns, "ghost-run", { ...MAIN_HB }, null),
    ).toBe(turns);
  });

  it("clearTurnPhase 终态一并清空 heartbeat（估算补显落定即隐兜底）", () => {
    const turn = makeTurn("run-1", {
      currentPhase: { phase: "first_event", at: 1 },
      heartbeat: { ...MAIN_HB, at: 1 },
    });
    const cleared = clearTurnPhase(turn);
    expect(cleared.currentPhase).toBeNull();
    expect(cleared.heartbeat).toBeNull();
  });
});
