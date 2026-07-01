// lib/__tests__/query-client.test.ts
// task-04：makeQueryClient retry 策略 + freshness-first 默认值单测（D-002@v1）。
import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api";
import { makeQueryClient } from "../query-client";

function getRetryPredicate(): (count: number, err: unknown) => boolean {
  const retry = makeQueryClient().getDefaultOptions().queries?.retry;
  if (typeof retry !== "function") throw new Error("expected retry to be a function");
  return retry as (count: number, err: unknown) => boolean;
}
function apiError(status: number): ApiError {
  return new ApiError(status, { code: `HTTP_${status}`, message: `err ${status}`, request_id: null, details: null });
}

describe("makeQueryClient retry strategy (D-002@v1)", () => {
  const retry = getRetryPredicate();
  it("4xx (401/403/404) no retry", () => {
    for (const s of [401, 403, 404] as const) {
      expect(retry(0, apiError(s))).toBe(false);
      expect(retry(1, apiError(s))).toBe(false);
    }
  });
  it("5xx retry up to 3 (0/1/2 true, 3 false)", () => {
    expect(retry(0, apiError(500))).toBe(true);
    expect(retry(3, apiError(500))).toBe(false);
    expect(retry(0, apiError(503))).toBe(true);
  });
  it("non-ApiError no retry", () => {
    expect(retry(0, new Error("n"))).toBe(false);
    expect(retry(0, null)).toBe(false);
  });
});
describe("freshness-first defaults (D-002@v1)", () => {
  it("staleTime=0 refetchOnWindowFocus=true", () => {
    const q = makeQueryClient().getDefaultOptions().queries!;
    expect(q.staleTime).toBe(0);
    expect(q.refetchOnWindowFocus).toBe(true);
  });
  it("fresh instance each call (no module singleton, R-01)", () => {
    expect(makeQueryClient()).not.toBe(makeQueryClient());
  });
});
