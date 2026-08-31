import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, apiFetch } from "@/lib/api";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

afterEach(() => {
  fetchMock.mockReset();
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

  it("不传 timeoutMs 时无超时行为（读操作零回归：挂起即挂起，不 abort）", async () => {
    fetchMock.mockImplementationOnce(hangUntilAborted);
    const pending = apiFetch("/api/example");
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
