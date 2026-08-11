/**
 * task-05 / 变更 2026-08-11-mcp-token-management-ui：McpToken lib 三函数单测。
 *
 * 依据:
 *   - frontend/src/lib/mcp-tokens.ts（listMcpTokens / createMcpToken / revokeMcpToken）
 *   - 变更 design：明文 token 仅 POST 201 一次返回（R-06），GET/列表永不含明文
 *
 * 覆盖:
 *   1. listMcpTokens：GET 路径 + 解包 items（与 listApiKeys 同形）
 *   2. listMcpTokens：workspaceId 经 encodeURIComponent 编码
 *   3. createMcpToken：POST + JSON 请求体 + 返回明文 token
 *   4. revokeMcpToken：DELETE 路径 + tokenId 编码 + 204 空体
 *   5. 403 响应抛 ApiError（page 403 空态依赖 err.status === 403 判定）
 *
 * mock 方式与 lib/__tests__/agent.test.ts 一致：vi.stubGlobal("fetch")，不走真实网络。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api";
import {
  createMcpToken,
  listMcpTokens,
  revokeMcpToken,
} from "@/lib/mcp-tokens";

type FetchMock = ReturnType<typeof vi.fn>;

function stubFetchOnce(resp: {
  ok: boolean;
  status: number;
  body?: unknown;
}): FetchMock {
  const mock = vi.fn().mockResolvedValue({
    ok: resp.ok,
    status: resp.status,
    statusText: resp.ok ? "" : "Error",
    headers: { get: () => null },
    text: () =>
      Promise.resolve(resp.body === undefined ? "" : JSON.stringify(resp.body)),
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

function lastCall(mock: FetchMock): [string, RequestInit] {
  return mock.mock.calls[mock.mock.calls.length - 1] as [string, RequestInit];
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("listMcpTokens", () => {
  it("GET /api/workspaces/{id}/mcp-tokens 并解包 items", async () => {
    const items = [
      {
        id: "t-1",
        name: "ci-runner",
        scope: ["read", "dispatch"],
        last_used_at: null,
        revoked_at: null,
        created_at: "2026-08-01T10:00:00Z",
      },
    ];
    const mock = stubFetchOnce({ ok: true, status: 200, body: { items } });

    const result = await listMcpTokens("ws-1");

    expect(mock).toHaveBeenCalledTimes(1);
    const [url, init] = lastCall(mock);
    expect(url).toContain("/api/workspaces/ws-1/mcp-tokens");
    // GET：不显式指定 method，也不带 body
    expect(init.method).toBeUndefined();
    expect(init.body).toBeUndefined();
    // 解包 items，直接返回数组
    expect(result).toEqual(items);
  });

  it("workspaceId 含特殊字符时路径经 encodeURIComponent 编码", async () => {
    const mock = stubFetchOnce({ ok: true, status: 200, body: { items: [] } });

    await listMcpTokens("ws 1/中文");

    const [url] = lastCall(mock);
    expect(url).toContain(
      `/api/workspaces/${encodeURIComponent("ws 1/中文")}/mcp-tokens`,
    );
    expect(url).not.toContain("ws 1/中文");
  });
});

describe("createMcpToken", () => {
  it("POST JSON 请求体并返回明文 token（仅此一次可见）", async () => {
    const created = {
      id: "t-9",
      token: "shk_live_plaintext_only_once",
      name: "ci-runner",
      scope: ["read", "dispatch"],
      created_at: "2026-08-11T08:00:00Z",
    };
    const mock = stubFetchOnce({ ok: true, status: 201, body: created });

    const result = await createMcpToken("ws-1", {
      name: "ci-runner",
      scope: ["read", "dispatch"],
    });

    const [url, init] = lastCall(mock);
    expect(url).toContain("/api/workspaces/ws-1/mcp-tokens");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["content-type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({
      name: "ci-runner",
      scope: ["read", "dispatch"],
    });
    expect(result.token).toBe("shk_live_plaintext_only_once");
    expect(result).toEqual(created);
  });
});

describe("revokeMcpToken", () => {
  it("DELETE /api/workspaces/{ws}/mcp-tokens/{tokenId}，tokenId 编码，204 空体 resolve", async () => {
    const mock = stubFetchOnce({ ok: true, status: 204 });

    await expect(
      revokeMcpToken("ws-1", "tok 1/x"),
    ).resolves.toBeUndefined();

    expect(mock).toHaveBeenCalledTimes(1);
    const [url, init] = lastCall(mock);
    expect(url).toContain(
      `/api/workspaces/ws-1/mcp-tokens/${encodeURIComponent("tok 1/x")}`,
    );
    expect(init.method).toBe("DELETE");
  });
});

describe("错误归一", () => {
  it("403 响应抛 ApiError 且 status === 403（page 无权限空态判定依据）", async () => {
    stubFetchOnce({
      ok: false,
      status: 403,
      body: {
        code: "forbidden",
        message: "需要 WORKSPACE_WRITE 权限",
        request_id: null,
        details: null,
      },
    });

    const err = await listMcpTokens("ws-1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(403);
    expect((err as ApiError).code).toBe("forbidden");
  });
});
