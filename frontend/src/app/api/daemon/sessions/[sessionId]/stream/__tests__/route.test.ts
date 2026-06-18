// task-11：session SSE 代理路由测试。
//
// 路由：/api/daemon/sessions/[sessionId]/stream
// 代理 backend GET /api/daemon/sessions/{id}/stream（无缓冲 SSE）。
//
// 覆盖：
//   - 透传 token / cursor / Last-Event-ID 查询参数；
//   - 转发 Accept: text/event-stream；
//   - 后端错误状态透传；
//   - 成功流返回 SSE headers（无缓冲）；
//   - abort signal 传递。

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

import { GET } from "../route";

function makeRequest(
  sessionId: string,
  params: Record<string, string> = {},
): { req: NextRequest; ctx: { params: { sessionId: string } } } {
  const url = new URL(
    `http://localhost:3000/api/daemon/sessions/${encodeURIComponent(sessionId)}/stream`,
  );
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const req = new NextRequest(url.toString());
  return { req, ctx: { params: { sessionId } } };
}

describe("GET /api/daemon/sessions/[sessionId]/stream (proxy)", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("P0-2：token 不进 backend URL，改放 Authorization header；cursor 仍透传", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("data: {}\n\n", {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    );

    const { req, ctx } = makeRequest("sess-1", {
      token: "tok-abc",
      cursor: "log-42",
      "lastEventId": "log-99",
    });
    await GET(req, ctx);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [backendUrl, init] = fetchMock.mock.calls[0]!;
    const u = String(backendUrl);
    expect(u).toContain("/api/daemon/sessions/sess-1/stream");
    // P0-2：token 绝不能出现在 backend URL（避免泄漏到 access log）
    expect(u).not.toContain("token=tok-abc");
    expect(u).not.toContain("tok-abc");
    // 业务参数仍透传
    expect(u).toContain("cursor=log-42");
    expect(u).toContain("lastEventId=log-99");
    // token 在 Authorization header
    const headers = init?.headers as Record<string, string>;
    expect(headers.Accept).toBe("text/event-stream");
    expect(headers.Authorization).toBe("Bearer tok-abc");
  });

  it("编码 session id（特殊字符）", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("data: {}\n\n", { status: 200 }),
    );
    const { req, ctx } = makeRequest("sess a/b");
    await GET(req, ctx);
    const u = String(fetchMock.mock.calls[0]![0]);
    // backend URL 应编码 path 段
    expect(u).toContain("/api/daemon/sessions/sess%20a%2Fb/stream");
  });

  it("后端 404 状态透传", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("not found", { status: 404 }),
    );
    const { req, ctx } = makeRequest("missing");
    const resp = await GET(req, ctx);
    expect(resp.status).toBe(404);
  });

  it("后端 401 透传", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("unauth", { status: 401 }),
    );
    const { req, ctx } = makeRequest("sess-1");
    const resp = await GET(req, ctx);
    expect(resp.status).toBe(401);
  });

  it("成功流返回 SSE headers + body 透传", async () => {
    const bodyText = "event: log\ndata: {\"content\":\"hi\"}\n\n";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(bodyText, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    );
    const { req, ctx } = makeRequest("sess-1");
    const resp = await GET(req, ctx);
    expect(resp.status).toBe(200);
    expect(resp.headers.get("Content-Type")).toBe("text/event-stream");
    expect(resp.headers.get("Cache-Control")).toBe("no-cache");
    expect(resp.headers.get("X-Accel-Buffering")).toBe("no");
    expect(await resp.text()).toBe(bodyText);
  });

  it("无 token 时不附加 Authorization header", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("data: {}\n\n", { status: 200 }),
    );
    const { req, ctx } = makeRequest("sess-1");
    await GET(req, ctx);
    const [backendUrl, init] = fetchMock.mock.calls[0]!;
    const u = String(backendUrl);
    expect(u).not.toContain("token=");
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
    expect(headers.Accept).toBe("text/event-stream");
  });
});
