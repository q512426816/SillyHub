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
  getAgentSession,
  getAgentSessionLogs,
  listAgentSessions,
  parseSessionPermissionEvent,
  reopenSession,
  respondSessionPermission,
  type AgentSessionStatus,
} from "@/lib/daemon";

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
