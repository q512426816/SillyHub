// tests/turn-phase-report.test.ts
// 2026-10-26-session-stage-progress task-02（FR-02/FR-03 / D-009 / D-013④）：
// daemon 侧轮阶段信号源测试——
//   ① hub-client.notifyTurnPhase：URL/body 构造（detail 有无守卫）、非 2xx 透传
//      HubHttpError（吞噬职责在调用方，方法本身不吞——对齐 notifyBashStatus）；
//   ② daemon.onTurnMessage 拦截分支：{type:'turn_phase_report'} 控制标记转
//      notifyTurnPhase（不进 submitMessages 日志轨）、first_event 防重键
//      (session_id, run_id) 每 run 至多一次（D-013④）、notifyTurnPhase reject
//      不抛（D-009）、非控制标记消息照常走 submitMessages（零回归）；
//   ③ 发射点：turn-control inject push 成功后发 inject_received（push 抛错不发）、
//      events onMessage 撤防处发 first_event（currentRunId 空跳过）——
//      均经 deps.onTurnMessage 桥 fire-and-forget。
//
// mock 模式对齐 daemon-agent-event-report.test.ts（Daemon 构造 + createMockClient
// 扩展 notifyTurnPhase）与 hub-client.test.ts（vi.stubGlobal('fetch')）。

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { Daemon } from "../src/daemon.js";
import { HubClient, HubHttpError } from "../src/hub-client.js";
import { REST_PREFIX } from "../src/protocol.js";
import { onMessage } from "../src/interactive/session-manager/events.js";
import { inject as injectTurn } from "../src/interactive/session-manager/turn-control.js";
import type { SessionState } from "../src/interactive/types.js";
import {
  createMockClient,
  createMockSessionManager,
  mockConfig,
} from "./interactive-test-helpers.js";

// ── ① hub-client.notifyTurnPhase ─────────────────────────────────────────────

describe("① hub-client notifyTurnPhase", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
      ),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POST 到 turn-phase 端点，body 含 session_id/run_id/phase，detail 缺省不传", async () => {
    const fetchMock = vi.fn(
      async () => new Response('{"ok":true}', { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const c = new HubClient("http://x:8000", "tok");

    await c.notifyTurnPhase("sess-1", "run-1", "skills_sync");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`http://x:8000${REST_PREFIX}/sessions/sess-1/turn-phase`);
    const body = JSON.parse(String(init.body));
    expect(body).toEqual({
      session_id: "sess-1",
      run_id: "run-1",
      phase: "skills_sync",
    });
  });

  it("detail 提供时进 body；非 2xx 透传 HubHttpError（吞噬职责在调用方）", async () => {
    const c = new HubClient("http://x:8000", "tok");

    const fetchOk = vi.fn(
      async () => new Response('{"ok":true}', { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchOk);
    await c.notifyTurnPhase("s", "r", "inject_received", "mid-turn");
    const body = JSON.parse(
      String((fetchOk.mock.calls[0] as [string, RequestInit])[1].body),
    );
    expect(body.detail).toBe("mid-turn");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("boom", { status: 500 })),
    );
    await expect(c.notifyTurnPhase("s", "r", "ready")).rejects.toBeInstanceOf(
      HubHttpError,
    );
  });
});

// ── ② daemon.onTurnMessage 拦截分支 ──────────────────────────────────────────

function buildDaemon(stateMap: Map<string, Partial<SessionState>>) {
  const detector = {
    detectAgents: vi.fn(async () => [
      {
        provider: "claude",
        path: "/fake/claude",
        version: "1.0.0",
        protocol: "stream_json",
        status: "available",
        versionWarning: null,
      },
    ]),
  };
  const wsClientMock = {
    connect: vi.fn(),
    close: vi.fn(),
    send: vi.fn(() => true),
    registerRpcHandler: vi.fn(),
  };
  const daemon = new Daemon(
    mockConfig,
    createMockClient() as never,
    { runLease: vi.fn(async () => ({})) } as never,
    {
      detector,
      wsClientFactory: vi.fn(() => wsClientMock),
      sessionManager: createMockSessionManager(stateMap),
    } as never,
  );
  const client = createMockClient() as unknown as Record<
    string,
    ReturnType<typeof vi.fn>
  >;
  client.notifyTurnPhase = vi.fn(async () => ({}));
  (daemon as unknown as { _client: unknown })._client = client;
  return { daemon, client };
}

function defaultStateMap(): Map<string, Partial<SessionState>> {
  return new Map<string, Partial<SessionState>>([
    ["sess-1", { leaseId: "lease-1", claimToken: "tok-1", provider: "claude" }],
  ]);
}

describe("② daemon.onTurnMessage turn_phase_report 拦截", () => {
  it("控制标记转 notifyTurnPhase 且不进 submitMessages 日志轨", async () => {
    const { daemon, client } = buildDaemon(defaultStateMap());

    await daemon.onTurnMessage("sess-1", "run-1", {
      type: "turn_phase_report",
      phase: "inject_received",
      detail: "queued",
    });

    expect(client.notifyTurnPhase).toHaveBeenCalledWith(
      "sess-1",
      "run-1",
      "inject_received",
      "queued",
    );
    expect(client.submitMessages).not.toHaveBeenCalled();
  });

  it("first_event 同 (session_id, run_id) 至多一次；新 run 重新上报（D-013④）", async () => {
    const { daemon, client } = buildDaemon(defaultStateMap());
    const marker = { type: "turn_phase_report", phase: "first_event" };

    await daemon.onTurnMessage("sess-1", "run-1", marker);
    await daemon.onTurnMessage("sess-1", "run-1", marker);
    await daemon.onTurnMessage("sess-1", "run-1", marker);
    expect(client.notifyTurnPhase).toHaveBeenCalledTimes(1);

    await daemon.onTurnMessage("sess-1", "run-2", marker);
    expect(client.notifyTurnPhase).toHaveBeenCalledTimes(2);
    expect(client.notifyTurnPhase).toHaveBeenLastCalledWith(
      "sess-1",
      "run-2",
      "first_event",
      undefined,
    );
  });

  it("notifyTurnPhase reject 不抛出（D-009）", async () => {
    const { daemon, client } = buildDaemon(defaultStateMap());
    client.notifyTurnPhase = vi.fn(async () => {
      throw new Error("network down");
    });

    await expect(
      daemon.onTurnMessage("sess-1", "run-1", {
        type: "turn_phase_report",
        phase: "first_event",
      }),
    ).resolves.toBeUndefined();
  });

  it("非控制标记消息照常走 submitMessages（零回归）", async () => {
    const { daemon, client } = buildDaemon(defaultStateMap());

    await daemon.onTurnMessage("sess-1", "run-1", {
      event_type: "text",
      type: "text",
      seq: 1,
      content: "hello",
    });

    expect(client.submitMessages).toHaveBeenCalledTimes(1);
    expect(client.notifyTurnPhase).not.toHaveBeenCalled();
  });
});

// ── ③ 发射点：inject_received / first_event ─────────────────────────────────

/** 最小 duck-type mgr（仅覆盖 inject/onMessage 触达面；inject 经 _store 取 state）。 */
function makeLightMgr(deps: Record<string, unknown>, state?: SessionState) {
  return {
    deps: deps as never,
    _store: new Map<string, SessionState>(state ? [["sess-1", state]] : []),
    _overBudgetSessions: new Set<string>(),
    _pendingFirstPrompt: new Map<string, unknown>(),
    _drivers: {},
    _resolversBySession: new Map<string, unknown>(),
    _turnStartWatchdogs: new Map<string, unknown>(),
    _pendingInjectCount: new Map<string, number>(),
    _scheduleFlush: vi.fn(),
    _flushPendingSessionHeader: vi.fn(),
    _armTurnStartWatchdog: vi.fn(),
    _disarmTurnStartWatchdog: vi.fn(),
    _liftSessionUsage: vi.fn(),
  } as never;
}

describe("③ turn-control inject push 后发 inject_received", () => {
  function makeInjectState(): SessionState {
    return {
      sessionId: "sess-1",
      provider: "claude",
      cwd: "/tmp/ws",
      leaseId: "lease-1",
      status: "active",
      currentRunId: "",
      inputQueue: { push: vi.fn() },
      lastActiveAt: Date.now(),
    } as unknown as SessionState;
  }

  it("push 成功后经 onTurnMessage 桥发 inject_received", async () => {
    const onTurnMessage = vi.fn(async () => {});
    const state = makeInjectState();
    const mgr = makeLightMgr(
      {
        onTurnMessage,
        onTurnResult: vi.fn(),
        onSessionEnd: vi.fn(),
        driver: {},
      },
      state,
    );

    await injectTurn(mgr, "sess-1", "hello", "run-9");

    const tpCalls = onTurnMessage.mock.calls.filter(
      (c) => (c[2] as Record<string, unknown>)["type"] === "turn_phase_report",
    );
    expect(tpCalls).toHaveLength(1);
    expect((tpCalls[0][2] as Record<string, unknown>).phase).toBe(
      "inject_received",
    );
    expect(tpCalls[0][1]).toBe("run-9");
  });

  it("push 抛错（会话已收口）→ 上报不发生、异常照常透传", async () => {
    const onTurnMessage = vi.fn(async () => {});
    const state = makeInjectState();
    state.inputQueue = {
      push: vi.fn(() => {
        throw new Error("closed");
      }),
    } as never;
    const mgr = makeLightMgr(
      {
        onTurnMessage,
        onTurnResult: vi.fn(),
        onSessionEnd: vi.fn(),
        driver: {},
      },
      state,
    );

    await expect(injectTurn(mgr, "sess-1", "hello", "run-9")).rejects.toThrow(
      "closed",
    );
    expect(onTurnMessage).not.toHaveBeenCalled();
  });
});

describe("③ events onMessage 撤防处发 first_event", () => {
  function makeMsgState(): SessionState {
    return {
      sessionId: "sess-1",
      provider: "claude",
      cwd: "/tmp/ws",
      leaseId: "lease-1",
      status: "running",
      currentRunId: "run-3",
      lastActiveAt: Date.now(),
    } as unknown as SessionState;
  }

  it("事件到达即经桥发 first_event（runId 取 currentRunId）", async () => {
    const onTurnMessage = vi.fn(async () => {});
    const mgr = makeLightMgr({ onTurnMessage });
    const state = makeMsgState();

    await onMessage(mgr, state, { events: [] } as never);

    const tpCalls = onTurnMessage.mock.calls.filter(
      (c) => (c[2] as Record<string, unknown>)["type"] === "turn_phase_report",
    );
    expect(tpCalls).toHaveLength(1);
    expect((tpCalls[0][2] as Record<string, unknown>).phase).toBe(
      "first_event",
    );
    expect(tpCalls[0][1]).toBe("run-3");
  });

  it("currentRunId 空（收尾窗口）→ 跳过上报不抛", async () => {
    const onTurnMessage = vi.fn(async () => {});
    const mgr = makeLightMgr({ onTurnMessage });
    const state = makeMsgState();
    state.currentRunId = undefined;

    await expect(
      onMessage(mgr, state, { events: [] } as never),
    ).resolves.toBeUndefined();
    expect(onTurnMessage).not.toHaveBeenCalled();
  });
});
