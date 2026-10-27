/**
 * 2026-10-26-session-stage-progress task-03（FR-04/FR-06 / D-010/D-012/D-013）：
 * turn_phase 事件前端全链路单测。
 *
 * stream 层（vi.mock fetch-sse，手动派发 onmessage）：
 *   ① turn_phase 事件 → onTurnPhase envelope（phase 透传，词表外值不丢弃）；
 *   ② 缺失 run_id → 白名单拦截 onError，onTurnPhase 不触发（D-013②）；
 *   ③ keepalive（无 event 载荷）→ onHeartbeat 路径，不触发 onTurnPhase。
 * turn-state 层（纯函数）：
 *   ④ applyTurnPhase 写入 currentPhase（at=本地时刻）+ 乱序 last-write-wins；
 *   ⑤ 跨 run 不污染（run_id / realRunId 归属路由）；未知 run 不建轮；
 *   ⑥ clearTurnPhase 终态清理（有值清 null / 无值幂等）。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  applyTurnPhase,
  clearTurnPhase,
  replacePlaceholderTurn,
  retireDeliveryPhase,
  upsertTurn,
} from "@/components/daemon/session-panel/turn-state";
import type { SessionTurnView } from "@/components/daemon/turn-timeline";
import type { FetchSseConnection } from "@/lib/fetch-sse";
import { streamSession } from "../session-stream";
import type { SessionStreamEnvelope } from "../session-sse";

// ── mock 依赖（streamSession 触达面）────────────────────────────────────────

const connections: FetchSseConnection[] = [];

vi.mock("@/lib/fetch-sse", () => ({
  fetchSse: vi.fn(() => {
    const conn = {
      onmessage: null,
      onopen: null,
      onerror: null,
      onHeartbeat: null,
      readyState: 1,
      addEventListener: vi.fn(() => vi.fn()),
      close: vi.fn(),
    };
    connections.push(conn as unknown as FetchSseConnection);
    return conn as unknown as FetchSseConnection;
  }),
}));

vi.mock("@/stores/session", () => ({
  useSession: { getState: () => ({ accessToken: "tok" }) },
}));

vi.mock("@/lib/api", () => ({
  getApiBaseUrl: () => "http://test.local",
}));

vi.mock("../sessions", () => ({
  listSessionRuns: vi.fn(async () => []),
  getAgentSessionLogs: vi.fn(async () => ({ logs: [], hasMore: false })),
}));

function requiredHandlers() {
  return {
    onTurnStarted: vi.fn(),
    onLog: vi.fn(),
    onTurnCompleted: vi.fn(),
    onSessionEnded: vi.fn(),
    onError: vi.fn(),
  };
}

function send(conn: FetchSseConnection, payload: unknown): void {
  actHandlers(conn);
  conn.onmessage?.({ data: JSON.stringify(payload), lastEventId: "" });
}

function actHandlers(conn: FetchSseConnection): void {
  if (!conn.onmessage) {
    throw new Error("wireConnection 未建立（fetchSse mock 未被消费）");
  }
}

// ── stream 层 ────────────────────────────────────────────────────────────────

describe("stream 层：turn_phase 分发（D-012/D-013②）", () => {
  beforeEach(() => {
    connections.length = 0;
  });

  it("① turn_phase 事件透传 onTurnPhase（词表外值不丢弃）", () => {
    const handlers = {
      ...requiredHandlers(),
      onTurnPhase: vi.fn(),
    };
    streamSession("sess-1", handlers);
    send(connections[0]!, {
      event: "turn_phase",
      session_id: "sess-1",
      run_id: "run-1",
      phase: "future_phase_x",
      detail: null,
      timestamp: "2026-10-26T01:00:00Z",
    });
    expect(handlers.onTurnPhase).toHaveBeenCalledTimes(1);
    const env = handlers.onTurnPhase.mock.calls[0]![0] as SessionStreamEnvelope;
    expect(env.phase).toBe("future_phase_x");
    expect(env.run_id).toBe("run-1");
  });

  it("② 缺失 run_id 的 turn_phase → onError 拦截，onTurnPhase 不触发（D-013②）", () => {
    const handlers = {
      ...requiredHandlers(),
      onTurnPhase: vi.fn(),
    };
    streamSession("sess-1", handlers);
    send(connections[0]!, {
      event: "turn_phase",
      session_id: "sess-1",
      phase: "ready",
    });
    expect(handlers.onTurnPhase).not.toHaveBeenCalled();
    expect(handlers.onError).toHaveBeenCalledTimes(1);
    expect(String(handlers.onError.mock.calls[0]![0])).toContain(
      "Missing run_id on turn_phase",
    );
  });

  it("③ keepalive 无 event 载荷 → onHeartbeat，不触发 onTurnPhase", () => {
    const handlers = {
      ...requiredHandlers(),
      onHeartbeat: vi.fn(),
      onTurnPhase: vi.fn(),
    };
    streamSession("sess-1", handlers);
    send(connections[0]!, { ts: "2026-10-26T01:00:00Z" });
    expect(handlers.onHeartbeat).toHaveBeenCalledTimes(1);
    expect(handlers.onTurnPhase).not.toHaveBeenCalled();
  });
});

// ── turn-state 层（纯函数）───────────────────────────────────────────────────

function makeTurn(
  runId: string,
  overrides: Partial<SessionTurnView> = {},
): SessionTurnView {
  return {
    runId,
    turn: 1,
    prompt: "",
    output: "",
    status: "running",
    seenLogIds: new Set<string>(),
    inputTokens: null,
    outputTokens: null,
    ...overrides,
  };
}

describe("applyTurnPhase（FR-04 / D-013①②）", () => {
  it("按 runId 写入 currentPhase，at 为本地到达时刻", () => {
    const before = Date.now();
    const turns = [makeTurn("run-1")];
    const next = applyTurnPhase(turns, "run-1", "spec_sync");
    const phase = next[0]!.currentPhase;
    expect(phase?.phase).toBe("spec_sync");
    expect(phase!.at).toBeGreaterThanOrEqual(before);
    expect(next[0]).not.toBe(turns[0]);
  });

  it("乱序到达 last-write-wins（同轮覆盖式刷新）", () => {
    let turns = [makeTurn("run-1")];
    turns = applyTurnPhase(turns, "run-1", "spawning");
    turns = applyTurnPhase(turns, "run-1", "ready");
    expect(turns[0]!.currentPhase?.phase).toBe("ready");
  });

  it("跨 run 不污染：run-1 事件不动 run-2 轮", () => {
    const turns = [makeTurn("run-1"), makeTurn("run-2")];
    const next = applyTurnPhase(turns, "run-1", "skills_sync");
    expect(next[0]!.currentPhase?.phase).toBe("skills_sync");
    expect(next[1]!.currentPhase).toBeUndefined();
  });

  it("realRunId 匹配同款路由（attach 历史轮）", () => {
    const turns = [makeTurn("ph-1", { realRunId: "real-1" })];
    const next = applyTurnPhase(turns, "real-1", "ready");
    expect(next[0]!.currentPhase?.phase).toBe("ready");
  });

  it("未知 run 不建轮（phase 非轮存在性信号）", () => {
    const turns = [makeTurn("run-1")];
    const next = applyTurnPhase(turns, "run-404", "ready");
    expect(next).toBe(turns);
    expect(next).toHaveLength(1);
  });

  it("runId 缺失原样返回（防御）", () => {
    const turns = [makeTurn("run-1")];
    expect(applyTurnPhase(turns, null, "ready")).toBe(turns);
    expect(applyTurnPhase(turns, undefined, "ready")).toBe(turns);
  });
});

// ── orphan-fallback（2026-10-26-turn-phase-orphan-fallback FR-01/02/04）──────

describe("applyTurnPhase 竞态回退（事件跑赢占位轮替换）", () => {
  it("FR-01 未命中 run_id 时回退写入 currentRunId 指向的活跃轮", () => {
    // 生产实证形态：占位轮 ph-1（currentRunId 指向）尚未换真实 run_id，
    // daemon 事件（run-real）先到——原设计丢弃 = 卡「执行器已接收」根因。
    const turns = [makeTurn("ph-1", { status: "pending" }), makeTurn("run-old")];
    const next = applyTurnPhase(turns, "run-real", "first_event", "ph-1");
    expect(next[0]!.currentPhase?.phase).toBe("first_event");
    expect(next[1]!.currentPhase).toBeUndefined(); // 只写活跃轮，不波及他轮
  });

  it("FR-01 精确命中优先——回退仅未命中时生效", () => {
    const turns = [makeTurn("run-active"), makeTurn("ph-1")];
    const next = applyTurnPhase(turns, "ph-1", "ready", "run-active");
    expect(next[1]!.currentPhase?.phase).toBe("ready"); // ph-1 精确命中
    expect(next[0]!.currentPhase).toBeUndefined(); // 回退未触发
  });

  it("FR-02 无活跃轮（currentRunId 空）维持丢弃不建幽灵轮", () => {
    const turns = [makeTurn("run-done", { status: "completed" })];
    const next = applyTurnPhase(turns, "run-late", "ready", null);
    expect(next).toBe(turns);
  });

  it("FR-02 currentRunId 指向轮已不在列表（终态清理后）维持丢弃", () => {
    const turns = [makeTurn("run-1")];
    const next = applyTurnPhase(turns, "run-late", "ready", "run-gone");
    expect(next).toBe(turns);
  });

  it("FR-04 排队轮不接回退——事件只写活跃轮，不建排队轮", () => {
    // 排队消息（未来 run-q）派发前不是轮：回退只落 currentRunId（run-active）。
    const turns = [makeTurn("run-active")];
    const next = applyTurnPhase(turns, "run-q", "inject_received", "run-active");
    expect(next).toHaveLength(1);
    expect(next[0]!.currentPhase?.phase).toBe("inject_received");
  });

  it("FR-03 竞态全链：回退写占位轮 → replacePlaceholderTurn 换真实 id 后 phase 保留", () => {
    let turns = [makeTurn("ph-1", { status: "pending", prompt: "你好" })];
    turns = applyTurnPhase(turns, "run-real", "first_event", "ph-1");
    turns = replacePlaceholderTurn(turns, "ph-1", "run-real", "running");
    expect(turns[0]!.runId).toBe("run-real");
    expect(turns[0]!.currentPhase?.phase).toBe("first_event"); // spread 保留
    // 后续事件按真实 id 精确命中，last-write-wins 继续生效。
    turns = applyTurnPhase(turns, "run-real", "first_event", "run-real");
    expect(turns[0]!.currentPhase?.phase).toBe("first_event");
  });
});

describe("clearTurnPhase（D-013③ 终态清理）", () => {
  it("有值清 null；null/undefined 幂等原样返回", () => {
    const withPhase = makeTurn("run-1", {
      currentPhase: { phase: "spawning", at: Date.now() },
    });
    const cleared = clearTurnPhase(withPhase);
    expect(cleared.currentPhase).toBeNull();

    const withoutPhase = makeTurn("run-1");
    expect(clearTurnPhase(withoutPhase)).toBe(withoutPhase);

    const nullPhase = makeTurn("run-1", { currentPhase: null });
    expect(clearTurnPhase(nullPhase)).toBe(nullPhase);
  });
});

// ── 2026-10-27-turn-phase-stall-honest-ui：log 到达退位投递阶段 ────────────────

function makeEnv(overrides: Partial<SessionStreamEnvelope>): SessionStreamEnvelope {
  return {
    event: "log",
    session_id: "sess-1",
    run_id: null,
    turn: null,
    log_id: null,
    timestamp: "2026-10-27T02:00:00Z",
    channel: null,
    content: null,
    status: null,
    exit_code: null,
    reason: null,
    ...overrides,
  } as SessionStreamEnvelope;
}

describe("retireDeliveryPhase（log 兜底退位）", () => {
  it("delivered / dispatched 清 null；非投递阶段与无值原样返回（引用不变）", () => {
    const delivered = makeTurn("run-1", {
      currentPhase: { phase: "delivered", at: Date.now() },
    });
    expect(retireDeliveryPhase(delivered).currentPhase).toBeNull();

    const dispatched = makeTurn("run-1", {
      currentPhase: { phase: "dispatched", at: Date.now() },
    });
    expect(retireDeliveryPhase(dispatched).currentPhase).toBeNull();

    // 非投递阶段：轮已在执行期（如 spawning），log 到达不代表该信号过期。
    const spawning = makeTurn("run-1", {
      currentPhase: { phase: "spawning", at: Date.now() },
    });
    expect(retireDeliveryPhase(spawning)).toBe(spawning);

    const withoutPhase = makeTurn("run-1");
    expect(retireDeliveryPhase(withoutPhase)).toBe(withoutPhase);
  });
});

describe("upsertTurn log 事件投递阶段退位（page/dialog 共用单点）", () => {
  it("log 到达时轮仍挂 delivered → currentPhase 被清除", () => {
    const prev = {
      turns: [makeTurn("run-1", { currentPhase: { phase: "delivered", at: Date.now() } })],
      currentRunId: "run-1",
    };
    const env = makeEnv({ run_id: "run-1", log_id: "l1", channel: "text", content: "x" });
    const next = upsertTurn(prev, env, (t) => t, {});
    expect(next.turns[0]!.currentPhase).toBeNull();
  });

  it("log 到达时轮挂非投递阶段（spawning）→ 保留", () => {
    const prev = {
      turns: [makeTurn("run-1", { currentPhase: { phase: "spawning", at: Date.now() } })],
      currentRunId: "run-1",
    };
    const env = makeEnv({ run_id: "run-1", log_id: "l1", channel: "text", content: "x" });
    const next = upsertTurn(prev, env, (t) => t, {});
    expect(next.turns[0]!.currentPhase?.phase).toBe("spawning");
  });

  it("非 log 事件（turn_completed）不触发退位——delivered 清除只认 log", () => {
    const prev = {
      turns: [makeTurn("run-1", { currentPhase: { phase: "delivered", at: Date.now() } })],
      currentRunId: "run-1",
    };
    const env = makeEnv({ event: "turn_completed", run_id: "run-1", status: "completed" });
    const next = upsertTurn(prev, env, (t) => t, {});
    // 终态清理由消费方 clearTurnPhase 负责（D-013③），upsertTurn 不越权。
    expect(next.turns[0]!.currentPhase?.phase).toBe("delivered");
  });
});
