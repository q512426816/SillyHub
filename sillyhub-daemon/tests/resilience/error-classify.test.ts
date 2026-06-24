/**
 * error-classify 单测（task-07 / FR-04）。
 *
 * 覆盖 isRetryable / toCauseInfo：
 *   - TypeError（fetch failed）→ 可重试
 *   - TimeoutError（AbortSignal.timeout）→ 可重试
 *   - HubHttpError 5xx/429 → 可重试；4xx → 不可重试
 *   - AbortError / 普通 Error / 非 Error → 不可重试
 *   - toCauseInfo 压平 cause 链
 *
 * @module resilience/error-classify.test
 */

import { describe, it, expect } from "vitest";
import { isRetryable, toCauseInfo } from "../../src/resilience/error-classify.js";
import { HubHttpError } from "../../src/hub-client.js";

describe("isRetryable (task-07 / FR-04)", () => {
  it("TypeError（fetch failed）可重试", () => {
    expect(isRetryable(new TypeError("fetch failed"))).toBe(true);
  });

  it("TimeoutError（AbortSignal.timeout）可重试", () => {
    const e = new Error("timeout");
    e.name = "TimeoutError";
    expect(isRetryable(e)).toBe(true);
  });

  it("HubHttpError 503 可重试", () => {
    expect(isRetryable(new HubHttpError(503, "x", "u", "POST"))).toBe(true);
  });

  it("HubHttpError 429 限流可重试", () => {
    expect(isRetryable(new HubHttpError(429, "x", "u", "POST"))).toBe(true);
  });

  it("HubHttpError 404 不可重试（业务错误 fail-fast）", () => {
    expect(isRetryable(new HubHttpError(404, "x", "u", "POST"))).toBe(false);
  });

  it("HubHttpError 422 不可重试", () => {
    expect(isRetryable(new HubHttpError(422, "x", "u", "POST"))).toBe(false);
  });

  it("HubHttpError 401 不可重试", () => {
    expect(isRetryable(new HubHttpError(401, "x", "u", "POST"))).toBe(false);
  });

  it("AbortError 不可重试（主动停止信号）", () => {
    const e = new Error("aborted");
    e.name = "AbortError";
    expect(isRetryable(e)).toBe(false);
  });

  it("普通 Error 不可重试（保守）", () => {
    expect(isRetryable(new Error("unknown"))).toBe(false);
  });

  it("非 Error 值不可重试", () => {
    expect(isRetryable("string err")).toBe(false);
    expect(isRetryable(null)).toBe(false);
    expect(isRetryable(undefined)).toBe(false);
    expect(isRetryable({ foo: 1 })).toBe(false);
  });
});

describe("toCauseInfo (task-07)", () => {
  it("HubHttpError → { message, status }", () => {
    const info = toCauseInfo(new HubHttpError(503, "busy", "u", "POST"));
    expect(info.status).toBe(503);
    expect(info.message).toContain("503");
  });

  it("TypeError 带 cause.code（undici）→ 提取 code", () => {
    const err = new TypeError("fetch failed");
    (err as Error & { cause?: unknown }).cause = {
      code: "ECONNREFUSED",
      message: "connect refused",
    };
    const info = toCauseInfo(err);
    expect(info.code).toBe("ECONNREFUSED");
    expect(info.message).toBe("connect refused");
  });

  it("普通 Error 无 cause → { message, code=name }", () => {
    const info = toCauseInfo(new Error("boom"));
    expect(info.message).toBe("boom");
    expect(info.code).toBe("Error");
  });

  it("非 Error → message=String(err)", () => {
    expect(toCauseInfo("oops").message).toBe("oops");
  });
});
