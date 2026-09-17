import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, apiFetch } from "@/lib/api";
// ql-20260917-011：apiFetch 已接熔断上报——既有 5xx/网络错用例会喂计数，
// 用例间重置防串扰（否则计数跨用例累计会触发 circuit_open 短路炸后续用例）
import { __resetCircuitForTest } from "@/lib/api-circuit";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

afterEach(() => {
  fetchMock.mockReset();
  __resetCircuitForTest();
});

describe("apiFetch", () => {
  it("returns parsed JSON on 2xx", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, n: 42 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const result = await apiFetch<{ ok: boolean; n: number }>("/api/example");
    expect(result).toEqual({ ok: true, n: 42 });
  });

  it("throws ApiError with structured payload on 4xx", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: "validation_error",
          message: "bad input",
          request_id: "rid-1",
          details: { field: "x" },
        }),
        { status: 422, headers: { "content-type": "application/json" } },
      ),
    );

    await expect(apiFetch("/api/example")).rejects.toMatchObject({
      name: "ApiError",
      status: 422,
      code: "validation_error",
      message: "bad input",
      requestId: "rid-1",
    });
  });

  it("wraps network failures in ApiError(status=0, code='network_error')", async () => {
    fetchMock.mockRejectedValueOnce(new Error("connect ECONNREFUSED"));

    try {
      await apiFetch("/api/example");
      throw new Error("should not reach here");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(0);
      expect((err as ApiError).code).toBe("network_error");
    }
  });

  it("attaches an x-request-id header to every call", async () => {
    fetchMock.mockResolvedValueOnce(new Response("null", { status: 200 }));
    await apiFetch("/api/example");
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["x-request-id"]).toBeTypeOf("string");
    expect(headers["x-request-id"]?.length).toBeGreaterThan(8);
  });
});

describe("apiFetch timeout（ql-20260831-006-6d67）", () => {
  /** 挂起态 fetch：永不 resolve，仅在 signal abort 时 reject（模拟后端劣化请求挂起）。 */
  const hangUntilAborted = vi.fn(
    (_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        );
      }),
  );

  it("timeoutMs 到时 abort 并抛 code='timeout'（自定义文案透传）", async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockImplementationOnce(hangUntilAborted);
      const pending = apiFetch("/api/example", {
        timeoutMs: 30_000,
        timeoutMessage: "发送超时：草稿已保留",
      });
      // 先挂 catch 再推进时钟——reject 发生在 advanceTimersByTimeAsync 内，
      // 晚挂会出现 unhandled rejection。
      const caught = pending.catch((e: unknown) => e as ApiError);
      await vi.advanceTimersByTimeAsync(30_000);
      const err = await caught;
      expect(err).toMatchObject({
        name: "ApiError",
        status: 0,
        code: "timeout",
        message: "发送超时：草稿已保留",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("未传 timeoutMessage 时使用通用超时文案", async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockImplementationOnce(hangUntilAborted);
      const pending = apiFetch("/api/example", { timeoutMs: 1_000 });
      const caught = pending.catch((e: unknown) => e as ApiError);
      await vi.advanceTimersByTimeAsync(1_000);
      const err = await caught;
      expect(err).toMatchObject({
        code: "timeout",
        message: "请求超时，请重试",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("调用方 signal 的外部 abort 仍映射 network_error（streamSession resync 语义不回归）", async () => {
    const controller = new AbortController();
    fetchMock.mockImplementationOnce(hangUntilAborted);
    const pending = apiFetch("/api/example", {
      timeoutMs: 60_000,
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({
      status: 0,
      code: "network_error",
    });
  });

  it("GET 缺省 30s 默认超时（quick 群聊卡加载：代理挂起不再永久 pending）", async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockImplementationOnce(hangUntilAborted);
      const pending = apiFetch("/api/example");
      const caught = pending.catch((e: unknown) => e as ApiError);
      await vi.advanceTimersByTimeAsync(29_999);
      // 默认超时未到：仍挂起
      const early = await Promise.race([
        caught.then(() => "settled"),
        Promise.resolve("pending"),
      ]);
      expect(early).toBe("pending");
      await vi.advanceTimersByTimeAsync(1);
      const err = await caught;
      expect(err).toMatchObject({ status: 0, code: "timeout" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("写请求（POST）不传 timeoutMs 时无默认超时（慢写不误杀；显式传值不受影响）", async () => {
    fetchMock.mockImplementationOnce(hangUntilAborted);
    const pending = apiFetch("/api/example", { method: "POST", json: { a: 1 } });
    // 等一小段真实时间确认请求仍 pending（未被动 abort 抛错）。
    const outcome = await Promise.race([
      pending.then(
        () => "settled",
        () => "settled",
      ),
      new Promise((resolve) => setTimeout(() => resolve("pending"), 20)),
    ]);
    expect(outcome).toBe("pending");
  });
});

describe("apiFetch 非 JSON 错误体中文兜底（ql-20260903-012）", () => {
  it("502 HTML（后端重启窗口网关页）→ 中文文案，不透传英文 statusText", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("<html>Bad Gateway</html>", {
        status: 502,
        statusText: "Bad Gateway",
        headers: { "content-type": "text/html" },
      }),
    );
    await expect(apiFetch("/api/example")).rejects.toMatchObject({
      name: "ApiError",
      status: 502,
      code: "http_502",
      message: "网关错误（服务可能正在重启），请稍后重试",
    });
  });

  it("未映射状态码（599）→ 「请求失败（HTTP 599）」而非英文 Request failed", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("", { status: 599, statusText: "" }),
    );
    await expect(apiFetch("/api/example")).rejects.toMatchObject({
      code: "http_599",
      message: "请求失败（HTTP 599）",
    });
  });

  it("JSON 结构化错误体仍透传后端 message（不落状态码兜底）", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: "session_not_found",
          message: "会话不存在或已被删除",
          request_id: null,
          details: null,
        }),
        { status: 404, headers: { "content-type": "application/json" } },
      ),
    );
    await expect(apiFetch("/api/example")).rejects.toMatchObject({
      code: "session_not_found",
      message: "会话不存在或已被删除",
    });
  });
});

/* ------------------------------------------------------------------ */
/*  全局熔断接线（ql-20260917-011）                                     */
/* ------------------------------------------------------------------ */

describe("apiFetch × api-circuit", () => {
  it("连续 5xx 喂满阈值后：非 auth 请求被短路（不发网络），auth 放行", async () => {
    // 喂 5 次 502 开闸
    for (let i = 0; i < 5; i++) {
      fetchMock.mockResolvedValueOnce(new Response("bad gateway", { status: 502 }));
      await expect(apiFetch("/api/example")).rejects.toMatchObject({ status: 502 });
    }
    fetchMock.mockClear();
    // 非 auth：短路 circuit_open，fetch 不被调
    await expect(apiFetch("/api/workspaces")).rejects.toMatchObject({
      code: "circuit_open",
      status: 0,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    // auth 端点放行（登录/刷新是熔断期自救通道）
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    const r = await apiFetch("/api/auth/me");
    expect(r).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("网络错误同样计入开闸（部署窗口连接拒绝场景）", async () => {
    for (let i = 0; i < 5; i++) {
      fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
      await expect(apiFetch("/api/example")).rejects.toMatchObject({ code: "network_error" });
    }
    fetchMock.mockClear();
    await expect(apiFetch("/api/example")).rejects.toMatchObject({ code: "circuit_open" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("4xx 不开闸（业务态链路健康）", async () => {
    for (let i = 0; i < 6; i++) {
      fetchMock.mockResolvedValueOnce(new Response("not found", { status: 404 }));
      await expect(apiFetch("/api/example")).rejects.toMatchObject({ status: 404 });
    }
    fetchMock.mockClear();
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    await expect(apiFetch("/api/example")).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
