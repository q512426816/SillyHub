/**
 * 2026-10-11-apikey-mcp-copy-delete：API key lib 新增面单测。
 *
 * 依据:
 *   - frontend/src/lib/api-keys.ts（resolveDaemonApiKey / deleteApiKey /
 *     fetchApiKeyPlaintext）
 *   - 变更 FR-01：复制命令时内嵌真实明文；无活跃 key 自动签发永不过期 key
 *
 * 覆盖:
 *   1. resolveDaemonApiKey：最新活跃 key 可恢复 → 取回明文，不新建
 *   2. resolveDaemonApiKey：无活跃 key → 自动创建 expires_at=null 的 key
 *   3. resolveDaemonApiKey：活跃 key 是存量 hash-only（不可恢复）→ 仍自动创建
 *   4. resolveDaemonApiKey：明文取回 404（并发吊销）→ 兜底自动创建
 *   5. resolveDaemonApiKey：list 403 → forbidden（页面回退 access_token）
 *   6. deleteApiKey：DELETE ?hard=true 物理删除
 *   7. fetchApiKeyPlaintext：GET plaintext 路径
 *
 * mock 方式与 lib/__tests__/mcp-tokens.test.ts 一致：vi.stubGlobal("fetch")。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  deleteApiKey,
  fetchApiKeyPlaintext,
  resolveDaemonApiKey,
} from "@/lib/api-keys";

type FetchMock = ReturnType<typeof vi.fn>;

interface RespLike {
  ok: boolean;
  status: number;
  body?: unknown;
}

function _resp(r: RespLike) {
  return {
    ok: r.ok,
    status: r.status,
    statusText: r.ok ? "" : "Error",
    headers: { get: () => null },
    text: () =>
      Promise.resolve(r.body === undefined ? "" : JSON.stringify(r.body)),
  };
}

/** 按调用顺序回放响应序列（超出序列的调用返回最后一个）。 */
function stubFetchSequence(responses: RespLike[]): FetchMock {
  const mock = vi.fn((_url: string, _init?: RequestInit) => {
    const idx = Math.min(mock.mock.calls.length - 1, responses.length - 1);
    return Promise.resolve(_resp(responses[idx] as RespLike));
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

const errBody = {
  code: "x",
  message: "失败",
  request_id: null,
  details: null,
};

function apiKeyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "key-1",
    name: "daemon",
    key_prefix: "shk_live_ab",
    last_used_at: null,
    expires_at: null,
    created_at: "2026-10-11T00:00:00Z",
    revoked_at: null,
    plaintext_recoverable: true,
    ...overrides,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("resolveDaemonApiKey", () => {
  it("最新活跃 key 可恢复 → 取回明文返回，不创建新 key", async () => {
    const mock = stubFetchSequence([
      { ok: true, status: 200, body: { items: [apiKeyRow()] } },
      { ok: true, status: 200, body: { plaintext: "shk_live_secret123" } },
    ]);

    const result = await resolveDaemonApiKey();

    expect(result).toEqual({
      status: "ok",
      plaintext: "shk_live_secret123",
      keyPrefix: "shk_live_ab",
    });
    expect(mock).toHaveBeenCalledTimes(2);
    const [url, init] = mock.mock.calls[1] as [string, RequestInit];
    expect(url).toContain("/api/auth/api-keys/key-1/plaintext");
    expect(init.method).toBeUndefined(); // GET
  });

  it("无活跃 key → 自动创建永不过期（expires_at=null）的 key 并回显名称", async () => {
    const mock = stubFetchSequence([
      { ok: true, status: 200, body: { items: [apiKeyRow({ revoked_at: "2026-10-01T00:00:00Z" })] } },
      {
        ok: true,
        status: 201,
        body: {
          ...apiKeyRow({ id: "key-new", key_prefix: "shk_live_new" }),
          plaintext: "shk_live_fresh_key",
        },
      },
    ]);

    const result = await resolveDaemonApiKey();

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.plaintext).toBe("shk_live_fresh_key");
      expect(result.createdName).toContain("守护进程启动命令自动签发");
    }
    const [url, init] = mock.mock.calls[1] as [string, RequestInit];
    expect(url).toContain("/api/auth/api-keys");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string).expires_at).toBeNull();
  });

  it("活跃 key 是存量 hash-only（不可恢复）→ 仍走自动创建", async () => {
    const mock = stubFetchSequence([
      {
        ok: true,
        status: 200,
        body: { items: [apiKeyRow({ plaintext_recoverable: false })] },
      },
      {
        ok: true,
        status: 201,
        body: {
          ...apiKeyRow({ id: "key-new2" }),
          plaintext: "shk_live_fresh2",
        },
      },
    ]);

    const result = await resolveDaemonApiKey();

    expect(result.status).toBe("ok");
    expect(mock).toHaveBeenCalledTimes(2); // 没有调 plaintext 端点，直接创建
    const [, init] = mock.mock.calls[1] as [string, RequestInit];
    expect(init.method).toBe("POST");
  });

  it("明文取回 404（并发吊销）→ 兜底自动创建", async () => {
    const mock = stubFetchSequence([
      { ok: true, status: 200, body: { items: [apiKeyRow()] } },
      { ok: false, status: 404, body: errBody },
      {
        ok: true,
        status: 201,
        body: { ...apiKeyRow({ id: "key-new3" }), plaintext: "shk_live_fresh3" },
      },
    ]);

    const result = await resolveDaemonApiKey();

    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.plaintext).toBe("shk_live_fresh3");
    expect(mock).toHaveBeenCalledTimes(3);
  });

  it("list 返回 403 → forbidden（调用方回退 access_token）", async () => {
    stubFetchSequence([{ ok: false, status: 403, body: errBody }]);

    const result = await resolveDaemonApiKey();

    expect(result).toEqual({ status: "forbidden" });
  });
});

describe("deleteApiKey", () => {
  it("DELETE /api/auth/api-keys/{id}?hard=true 物理删除", async () => {
    const mock = stubFetchSequence([{ ok: true, status: 204 }]);

    await expect(deleteApiKey("k 1/x")).resolves.toBeUndefined();

    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(
      `/api/auth/api-keys/${encodeURIComponent("k 1/x")}?hard=true`,
    );
    expect(init.method).toBe("DELETE");
  });
});

describe("fetchApiKeyPlaintext", () => {
  it("GET plaintext 端点并解包 plaintext 字段", async () => {
    const mock = stubFetchSequence([
      { ok: true, status: 200, body: { plaintext: "shk_live_copy_me" } },
    ]);

    await expect(fetchApiKeyPlaintext("key-9")).resolves.toBe("shk_live_copy_me");

    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/auth/api-keys/key-9/plaintext");
    expect(init.method).toBeUndefined();
  });
});
