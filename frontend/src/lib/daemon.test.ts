/**
 * task-12: lib/daemon.ts 新增 listAgentSessions / getAgentSessionLogs 测试。
 *
 * permission 相关 (respondSessionPermission / parseSessionPermissionEvent) 由
 * task-08 覆盖，本文件只覆盖 task-12 新增的只读查询与 URL/query 构造。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api";
import { useSession } from "@/stores/session";
import {
  AgentSessionListResponseSchema,
  deleteAgentSession,
  deleteDaemonRuntime,
  getAgentSession,
  getAgentSessionLogs,
  listAgentSessions,
  parseSessionPermissionEvent,
  reopenSession,
  respondSessionPermission,
  subscribeAgentSessionsEvents,
  type AgentSessionStatus,
} from "@/lib/daemon";
import { fetchSse, type FetchSseConnection } from "@/lib/fetch-sse";

// 2026-08-24-sessions-live-updates task-05：subscribeAgentSessionsEvents 的传输层
// mock——捕获 fetchSse 返回的连接对象 handlers，由测试手动触发 onopen/onmessage/
// onerror 模拟连接建立 / 信号帧 / 断连。本文件其余用例走 apiFetch（global fetch），
// 不经 fetchSse，整文件级 mock 无影响。
vi.mock("@/lib/fetch-sse", () => ({
  fetchSse: vi.fn(),
}));

// ── fetch harness ────────────────────────────────────────────────────────────

function mockFetch(resp: { status: number; body: unknown }): {
  fetchMock: ReturnType<typeof vi.fn>;
  lastUrl: () => string;
  lastInit: () => RequestInit | undefined;
} {
  const fetchMock = vi.fn();
  let lastUrl = "";
  let lastInit: RequestInit | undefined;
  const bodyStr = JSON.stringify(resp.body);
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    lastUrl = url;
    lastInit = init;
    const headers = new Headers({ "content-type": "application/json" });
    return {
      ok: resp.status >= 200 && resp.status < 300,
      status: resp.status,
      statusText: resp.status === 200 ? "OK" : "Error",
      headers,
      text: async () => bodyStr,
      json: async () => resp.body,
    } as unknown as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return {
    fetchMock,
    lastUrl: () => lastUrl,
    lastInit: () => lastInit,
  };
}

beforeEach(() => {
  useSession.setState({ accessToken: "tok-123" });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("listAgentSessions", () => {
  it("builds GET /sessions with query params and returns typed response", async () => {
    const body = {
      items: [
        {
          id: "s1",
          runtime_id: "r1",
          lease_id: null,
          provider: "claude",
          status: "active",
          agent_session_id: null,
          config: { manual_approval: true },
          turn_count: 2,
          created_at: "2026-06-18T10:00:00Z",
          last_active_at: "2026-06-18T10:05:00Z",
          ended_at: null,
        },
      ],
      total: 1,
      limit: 20,
      offset: 0,
    };
    const h = mockFetch({ status: 200, body });

    const result = await listAgentSessions({
      limit: 20,
      offset: 0,
      status: "active" as AgentSessionStatus,
    });

    expect(result.total).toBe(1);
    expect(result.items[0]?.id).toBe("s1");
    const url = new URL(h.lastUrl());
    expect(url.pathname).toBe("/api/daemon/sessions");
    expect(url.searchParams.get("limit")).toBe("20");
    expect(url.searchParams.get("offset")).toBe("0");
    expect(url.searchParams.get("status")).toBe("active");
    // GET, no json body
    expect(h.lastInit()?.method ?? "GET").toBe("GET");
  });

  it("omits optional query params when not provided", async () => {
    const h = mockFetch({
      status: 200,
      body: { items: [], total: 0, limit: 20, offset: 0 },
    });
    await listAgentSessions();
    const url = new URL(h.lastUrl());
    // default limit/offset still sent by impl; status must be absent
    expect(url.searchParams.has("status")).toBe(false);
  });

  // 2026-08-14-sessions-portal task-16 / FR-02：列表过滤参数透传 query string。
  it("passes runtime_id/machine_id/provider/q filters into query (task-16)", async () => {
    const h = mockFetch({
      status: 200,
      body: { items: [], total: 0, limit: 20, offset: 0 },
    });
    await listAgentSessions({
      runtime_id: "rt-1",
      machine_id: "inst-1",
      provider: "claude",
      q: "重构",
    });
    const url = new URL(h.lastUrl());
    expect(url.pathname).toBe("/api/daemon/sessions");
    expect(url.searchParams.get("runtime_id")).toBe("rt-1");
    expect(url.searchParams.get("machine_id")).toBe("inst-1");
    expect(url.searchParams.get("provider")).toBe("claude");
    expect(url.searchParams.get("q")).toBe("重构");
  });

  it("throws ApiError on non-2xx", async () => {
    mockFetch({
      status: 422,
      body: {
        code: "HTTP_422",
        message: "bad",
        request_id: null,
        details: null,
      },
    });
    await expect(listAgentSessions()).rejects.toBeInstanceOf(ApiError);
  });
});

describe("getAgentSessionLogs", () => {
  it("GET /sessions/{id}/logs with encoded id and returns AgentRunLogEntry[]", async () => {
    const body = [
      {
        id: "l1",
        run_id: "run-a",
        timestamp: "2026-06-18T10:00:01Z",
        channel: "stdout",
        content_redacted: "hello",
      },
      {
        id: "l2",
        run_id: "run-b",
        timestamp: "2026-06-18T10:01:00Z",
        channel: "tool_call",
        content_redacted: null,
      },
    ];
    const h = mockFetch({ status: 200, body });

    const result = await getAgentSessionLogs("00000000-0000-0000-0000-000000000001");
    expect(result).toHaveLength(2);
    expect(result[0]?.run_id).toBe("run-a");
    const url = new URL(h.lastUrl());
    expect(url.pathname).toBe(
      "/api/daemon/sessions/00000000-0000-0000-0000-000000000001/logs",
    );
  });

  it("404 maps to ApiError (resource hidden)", async () => {
    mockFetch({
      status: 404,
      body: {
        code: "HTTP_404_DAEMON_SESSION_NOT_FOUND",
        message: "not found",
        request_id: null,
        details: null,
      },
    });
    await expect(getAgentSessionLogs("any")).rejects.toBeInstanceOf(ApiError);
  });
});

describe("deleteAgentSession", () => {
  it("DELETE /sessions/{id} with encoded id", async () => {
    const h = mockFetch({ status: 204, body: null });

    await deleteAgentSession("sess a/b");

    const url = new URL(h.lastUrl());
    expect(url.pathname).toBe("/api/daemon/sessions/sess%20a%2Fb");
    expect(h.lastInit()?.method).toBe("DELETE");
  });

  it("maps delete conflicts to ApiError", async () => {
    mockFetch({
      status: 409,
      body: {
        code: "HTTP_409_DAEMON_SESSION_DELETE_CONFLICT",
        message: "end the active session first",
        request_id: null,
        details: null,
      },
    });

    await expect(deleteAgentSession("active-session")).rejects.toBeInstanceOf(ApiError);
  });
});

// ── ql-012: deleteDaemonRuntime ─────────────────────────────────────────────

describe("deleteDaemonRuntime", () => {
  it("DELETE /runtimes/{id} with encoded id", async () => {
    const h = mockFetch({ status: 204, body: null });

    await deleteDaemonRuntime("rt a/b");

    const url = new URL(h.lastUrl());
    expect(url.pathname).toBe("/api/daemon/runtimes/rt%20a%2Fb");
    expect(h.lastInit()?.method).toBe("DELETE");
  });

  it("maps non-2xx to ApiError", async () => {
    mockFetch({
      status: 404,
      body: {
        code: "HTTP_404_DAEMON_RUNTIME_NOT_FOUND",
        message: "not found",
        request_id: null,
        details: null,
      },
    });

    await expect(deleteDaemonRuntime("missing")).rejects.toBeInstanceOf(ApiError);
  });
});

// ── task-09: reopenSession + getAgentSession ─────────────────────────────────

describe("reopenSession", () => {
  it("POST /sessions/{id}/reopen with encoded id and returns {session_id, status}", async () => {
    const h = mockFetch({
      status: 200,
      body: { session_id: "s-reopen", status: "active" },
    });

    const result = await reopenSession("sess a/b");

    expect(result).toEqual({ session_id: "s-reopen", status: "active" });
    const url = new URL(h.lastUrl());
    expect(url.pathname).toBe("/api/daemon/sessions/sess%20a%2Fb/reopen");
    expect(h.lastInit()?.method).toBe("POST");
  });

  it("maps 409 reopen conflicts to ApiError carrying business code", async () => {
    mockFetch({
      status: 409,
      body: {
        code: "DAEMON_SESSION_RESUME_UNSUPPORTED",
        message: "provider does not support resume",
        request_id: null,
        details: null,
      },
    });

    await expect(reopenSession("any")).rejects.toMatchObject({
      name: "ApiError",
      code: "DAEMON_SESSION_RESUME_UNSUPPORTED",
      status: 409,
    });
    await expect(reopenSession("any")).rejects.toBeInstanceOf(ApiError);
  });
});

describe("getAgentSession", () => {
  it("GET /sessions/{id} with encoded id and returns AgentSessionRead", async () => {
    const body = {
      id: "s1",
      runtime_id: "r1",
      lease_id: null,
      provider: "claude",
      status: "active",
      agent_session_id: null,
      config: { manual_approval: true },
      turn_count: 2,
      created_at: "2026-06-18T10:00:00Z",
      last_active_at: "2026-06-18T10:05:00Z",
      ended_at: null,
    };
    const h = mockFetch({ status: 200, body });

    const result = await getAgentSession("sess a/b");

    expect(result.id).toBe("s1");
    expect(result.status).toBe("active");
    const url = new URL(h.lastUrl());
    expect(url.pathname).toBe("/api/daemon/sessions/sess%20a%2Fb");
    expect(h.lastInit()?.method ?? "GET").toBe("GET");
  });

  it("maps 404 to ApiError", async () => {
    mockFetch({
      status: 404,
      body: {
        code: "HTTP_404_DAEMON_SESSION_NOT_FOUND",
        message: "not found",
        request_id: null,
        details: null,
      },
    });
    await expect(getAgentSession("any")).rejects.toBeInstanceOf(ApiError);
  });
});

// ── task-08 permission helpers are reused unchanged — sanity import ─────────

describe("task-08 permission helpers re-exported (reused, not duplicated)", () => {
  it("respondSessionPermission + parseSessionPermissionEvent are importable", () => {
    expect(typeof respondSessionPermission).toBe("function");
    expect(typeof parseSessionPermissionEvent).toBe("function");
  });
});

// Schema export is only an internal dev-time guard; keep a trivial assertion.
describe("AgentSessionListResponseSchema guard", () => {
  it("parses a well-formed payload", () => {
    const parsed = AgentSessionListResponseSchema.parse({
      items: [],
      total: 0,
      limit: 20,
      offset: 0,
    });
    expect(parsed.total).toBe(0);
  });
});

// ── 2026-08-24-sessions-live-updates task-05: subscribeAgentSessionsEvents ────

/** 捕获型 fetchSse 连接桩：handlers 由被测代码赋值，测试手动触发。 */
interface CapturedSseConnection {
  onmessage: ((_e: { data: string; lastEventId: string }) => void) | null;
  onopen: (() => void) | null;
  onerror: ((_ev: { status?: number }) => void) | null;
  close: ReturnType<typeof vi.fn>;
}

const sseConns: CapturedSseConnection[] = [];
const sseCalls: Array<{ url: string; token?: string }> = [];

/** 每用例重装 fetchSse mock：新连接入 sseConns，调用参数入 sseCalls。 */
function installFetchSseMock(): void {
  sseConns.length = 0;
  sseCalls.length = 0;
  vi.mocked(fetchSse).mockImplementation((url, options = {}) => {
    sseCalls.push({ url, token: options.token });
    const conn: CapturedSseConnection = {
      onmessage: null,
      onopen: null,
      onerror: null,
      close: vi.fn(),
    };
    sseConns.push(conn);
    return conn as unknown as FetchSseConnection;
  });
}

describe("subscribeAgentSessionsEvents (task-05)", () => {
  beforeEach(() => {
    installFetchSseMock();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("订阅 /api/daemon/sessions/events：data 帧触发 onEvent，token 走 Authorization 不进 URL；未断开不触发 onReconnected", () => {
    const onEvent = vi.fn();
    const onReconnected = vi.fn();
    const sub = subscribeAgentSessionsEvents({ onEvent, onReconnected });

    // 首次连接立即建立；URL + token 契约（token 绝不进 URL，访问日志明文泄漏）
    expect(sseCalls).toHaveLength(1);
    const url = new URL(sseCalls[0]!.url);
    expect(url.pathname).toBe("/api/daemon/sessions/events");
    expect(sseCalls[0]!.url).not.toContain("tok-123");
    expect(sseCalls[0]!.token).toBe("tok-123");

    // 收到任一 data 帧（JSON 信号，payload 不消费）→ 每帧一次 onEvent
    const conn = sseConns[0]!;
    conn.onmessage?.({
      data: JSON.stringify({ event: "status_changed" }),
      lastEventId: "",
    });
    conn.onmessage?.({
      data: JSON.stringify({ event: "created" }),
      lastEventId: "",
    });
    expect(onEvent).toHaveBeenCalledTimes(2);
    // 从未断开 → onReconnected 不触发
    expect(onReconnected).not.toHaveBeenCalled();
    sub.close();
  });

  it("onerror → 退避重连（首档 1000ms，共享 RECONNECT_BACKOFF_MS），重连成功恰触发一次 onReconnected", async () => {
    vi.useFakeTimers();
    const onEvent = vi.fn();
    const onReconnected = vi.fn();
    const sub = subscribeAgentSessionsEvents({ onEvent, onReconnected });
    expect(sseConns).toHaveLength(1);

    // 断连 → 退避排程；未到首档 1000ms 不重连
    sseConns[0]!.onerror?.({});
    await vi.advanceTimersByTimeAsync(999);
    expect(sseConns).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sseConns).toHaveLength(2);

    // 重连成功（连接建立）→ onReconnected 恰一次
    sseConns[1]!.onopen?.();
    expect(onReconnected).toHaveBeenCalledTimes(1);
    // 重连后信号帧 → onEvent；onReconnected 同一恢复周期不重复触发
    sseConns[1]!.onmessage?.({ data: "{}", lastEventId: "" });
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onReconnected).toHaveBeenCalledTimes(1);
    sub.close();
  });

  it("重连时 token 每次现取（跨 token 刷新不带旧值）", async () => {
    vi.useFakeTimers();
    const sub = subscribeAgentSessionsEvents({ onEvent: vi.fn() });
    useSession.setState({ accessToken: "tok-456" });
    sseConns[0]!.onerror?.({});
    await vi.advanceTimersByTimeAsync(1000);
    expect(sseConns).toHaveLength(2);
    expect(sseCalls[1]!.token).toBe("tok-456");
    sub.close();
  });

  it("F7（B6 盲窗）：onConnected 每个连接周期恰一次——首次订阅建立即触发（补快照→订阅盲窗），重连后再触发", async () => {
    vi.useFakeTimers();
    const onConnected = vi.fn();
    const onEvent = vi.fn();
    const sub = subscribeAgentSessionsEvents({ onEvent, onConnected });
    expect(sseConns).toHaveLength(1);

    // 首次订阅建立（连接 onopen）→ 恰一次 onConnected（调用方据此补拉列表）
    sseConns[0]!.onopen?.();
    expect(onConnected).toHaveBeenCalledTimes(1);
    // 同周期后续信号帧不重复触发（与 onEvent 独立）
    sseConns[0]!.onmessage?.({ data: "{}", lastEventId: "" });
    expect(onConnected).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledTimes(1);

    // 断连重连后：新连接周期再触发一次 onConnected
    sseConns[0]!.onerror?.({});
    await vi.advanceTimersByTimeAsync(1000);
    expect(sseConns).toHaveLength(2);
    sseConns[1]!.onopen?.();
    expect(onConnected).toHaveBeenCalledTimes(2);
    sub.close();
  });

  it("F7（B6 盲窗）：onopen 未到时首条消息先到者也触发 onConnected（先到者语义）", () => {
    const onConnected = vi.fn();
    const sub = subscribeAgentSessionsEvents({ onEvent: vi.fn(), onConnected });
    sseConns[0]!.onmessage?.({ data: "{}", lastEventId: "" });
    expect(onConnected).toHaveBeenCalledTimes(1);
    // 随后 onopen 到达不重复
    sseConns[0]!.onopen?.();
    expect(onConnected).toHaveBeenCalledTimes(1);
    sub.close();
  });

  it("close() 幂等：关连接清定时器，之后 onerror 不再重连", async () => {
    vi.useFakeTimers();
    const sub = subscribeAgentSessionsEvents({ onEvent: vi.fn() });
    const conn = sseConns[0]!;
    sub.close();
    expect(conn.close).toHaveBeenCalledTimes(1);

    // close 后的断连不再排程重连（推进全部退避档位仍无新连接）
    conn.onerror?.({});
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sseConns).toHaveLength(1);

    // 二次 close 幂等：不抛错、不重复关连接
    sub.close();
    expect(conn.close).toHaveBeenCalledTimes(1);
  });
});
