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
