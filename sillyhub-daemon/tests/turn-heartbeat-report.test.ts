// tests/turn-heartbeat-report.test.ts
// 2026-10-29-engine-live-perception（FR-02）：轮内心跳上报链两层——
//   ① hub-client notifyTurnHeartbeat：POST turn-heartbeat 端点，body 键名
//      snake_case 三端逐字对齐（D-backend-039），可选字段缺省不传；
//   ② daemon.onTurnMessage 拦截分支：{type:'turn_heartbeat_report'} 控制标记
//      转 notifyTurnHeartbeat（不进 submitMessages 日志轨——FR-04 心跳与事件流
//      分道）；载荷守卫（缺 kind/precision/source 不发）；reject 不抛（D-009）。
//
// 形态照抄 turn-phase-report.test.ts 先例（同通道同语义家族）。

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { Daemon } from "../src/daemon.js";
import { HubClient, HubHttpError } from "../src/hub-client.js";
import { REST_PREFIX } from "../src/protocol.js";
import type { SessionState } from "../src/interactive/types.js";
import {
  createMockClient,
  createMockSessionManager,
  mockConfig,
} from "./interactive-test-helpers.js";

// ── ① hub-client.notifyTurnHeartbeat ─────────────────────────────────────────

describe("① hub-client notifyTurnHeartbeat", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"ok":true}', { status: 200 })),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POST 到 turn-heartbeat 端点，body 含必需键，可选字段缺省不传", async () => {
    const fetchMock = vi.fn(
      async () => new Response('{"ok":true}', { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const c = new HubClient("http://x:8000", "tok");

    await c.notifyTurnHeartbeat("sess-1", "run-1", {
      kind: "awaiting_first_token",
      precision: "estimated",
      source: "claude_input_json_delta",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      `http://x:8000${REST_PREFIX}/sessions/sess-1/turn-heartbeat`,
    );
    const body = JSON.parse(String(init.body));
    expect(body).toEqual({
      session_id: "sess-1",
      run_id: "run-1",
      kind: "awaiting_first_token",
      precision: "estimated",
      source: "claude_input_json_delta",
    });
  });

  it("可选字段提供时进 body；非 2xx 透传 HubHttpError（吞噬职责在调用方）", async () => {
    const c = new HubClient("http://x:8000", "tok");

    const fetchOk = vi.fn(
      async () => new Response('{"ok":true}', { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchOk);
    await c.notifyTurnHeartbeat("s", "r", {
      kind: "generating",
      est_chars: 4200,
      est_tokens: 1200,
      precision: "estimated",
      source: "zcode_telemetry",
      parent_tool_use_id: "toolu_sub_1",
    });
    const body = JSON.parse(
      String((fetchOk.mock.calls[0] as [string, RequestInit])[1].body),
    );
    expect(body).toMatchObject({
      kind: "generating",
      est_chars: 4200,
      est_tokens: 1200,
      parent_tool_use_id: "toolu_sub_1",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("boom", { status: 500 })),
    );
    await expect(
      c.notifyTurnHeartbeat("s", "r", {
        kind: "generating",
        precision: "authoritative",
        source: "codex_token_usage",
      }),
    ).rejects.toBeInstanceOf(HubHttpError);
  });
});

// ── ② daemon.onTurnMessage turn_heartbeat_report 拦截 ───────────────────────

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
  client.notifyTurnHeartbeat = vi.fn(async () => ({}));
  (daemon as unknown as { _client: unknown })._client = client;
  return { daemon, client };
}

function defaultStateMap(): Map<string, Partial<SessionState>> {
  return new Map<string, Partial<SessionState>>([
    ["sess-1", { leaseId: "lease-1", claimToken: "tok-1", provider: "claude" }],
  ]);
}

describe("② daemon.onTurnMessage turn_heartbeat_report 拦截", () => {
  it("心跳标记转 notifyTurnHeartbeat 且不进 submitMessages 日志轨（FR-04 分道）", async () => {
    const { daemon, client } = buildDaemon(defaultStateMap());

    await daemon.onTurnMessage("sess-1", "run-1", {
      type: "turn_heartbeat_report",
      kind: "generating",
      est_chars: 4200,
      est_tokens: 1200,
      precision: "estimated",
      source: "claude_input_json_delta",
    });

    expect(client.notifyTurnHeartbeat).toHaveBeenCalledTimes(1);
    expect(client.notifyTurnHeartbeat).toHaveBeenCalledWith(
      "sess-1",
      "run-1",
      {
        kind: "generating",
        est_chars: 4200,
        est_tokens: 1200,
        precision: "estimated",
        source: "claude_input_json_delta",
        parent_tool_use_id: undefined,
      },
    );
    expect(client.submitMessages).not.toHaveBeenCalled();
  });

  it("载荷守卫：缺 kind/precision/source 任一不发（宽松容错不伪造）", async () => {
    const { daemon, client } = buildDaemon(defaultStateMap());

    await daemon.onTurnMessage("sess-1", "run-1", {
      type: "turn_heartbeat_report",
      kind: "unknown_kind",
      precision: "estimated",
      source: "claude_input_json_delta",
    });
    await daemon.onTurnMessage("sess-1", "run-1", {
      type: "turn_heartbeat_report",
      kind: "generating",
      source: "claude_input_json_delta",
    });
    await daemon.onTurnMessage("sess-1", "run-1", {
      type: "turn_heartbeat_report",
      kind: "generating",
      precision: "estimated",
    });

    expect(client.notifyTurnHeartbeat).not.toHaveBeenCalled();
    expect(client.submitMessages).not.toHaveBeenCalled();
  });

  it("notifyTurnHeartbeat reject 不抛出（D-009——瞬态信号丢一条无功能损失）", async () => {
    const { daemon, client } = buildDaemon(defaultStateMap());
    client.notifyTurnHeartbeat = vi.fn(async () => {
      throw new Error("network down");
    });

    await expect(
      daemon.onTurnMessage("sess-1", "run-1", {
        type: "turn_heartbeat_report",
        kind: "awaiting_first_token",
        precision: "estimated",
        source: "zcode_telemetry",
      }),
    ).resolves.toBeUndefined();
  });

  it("同步抛（client 缺方法 TypeError）不抛出（ci-red-to-green 同坑预防）", async () => {
    const { daemon, client } = buildDaemon(defaultStateMap());
    delete client.notifyTurnHeartbeat;

    await expect(
      daemon.onTurnMessage("sess-1", "run-1", {
        type: "turn_heartbeat_report",
        kind: "generating",
        precision: "authoritative",
        source: "codex_token_usage",
      }),
    ).resolves.toBeUndefined();
  });
});
