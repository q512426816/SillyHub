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
