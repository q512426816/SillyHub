/**
 * api-circuit 单测（ql-20260917-011）：阈值开闸 / 冷却半开 / 探测成败闭合重开 /
 * 订阅通知。fake timers 驱动 Date.now 与冷却窗口。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api";
import {
  __resetCircuitForTest,
  circuitSnapshot,
  isCircuitOpen,
  isSystemicApiFailure,
  reportApiFailure,
  reportApiSuccess,
  subscribeCircuit,
} from "@/lib/api-circuit";

const netErr = () => new ApiError(0, { code: "network_error", message: "x", request_id: null, details: null });
const serverErr = (status = 502) =>
  new ApiError(status, { code: `http_${status}`, message: "x", request_id: null, details: null });
const bizErr = (status = 404) =>
  new ApiError(status, { code: `http_${status}`, message: "x", request_id: null, details: null });

beforeEach(() => {
  vi.useFakeTimers();
  __resetCircuitForTest();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("isSystemicApiFailure", () => {
  it("网络错误（status=0）/超时与 5xx 算系统性失败", () => {
    expect(isSystemicApiFailure(netErr())).toBe(true);
    expect(isSystemicApiFailure(serverErr(500))).toBe(true);
    expect(isSystemicApiFailure(serverErr(503))).toBe(true);
  });

  it("4xx 业务态与普通 Error 不算（连接本身健康）", () => {
    expect(isSystemicApiFailure(bizErr(401))).toBe(false);
    expect(isSystemicApiFailure(bizErr(404))).toBe(false);
    expect(isSystemicApiFailure(bizErr(422))).toBe(false);
    expect(isSystemicApiFailure(new Error("plain"))).toBe(false);
  });
});

describe("熔断状态机", () => {
  it("连续 5 次系统性失败开闸；snapshot 带冷却终点", () => {
    for (let i = 0; i < 4; i++) reportApiFailure(netErr());
    expect(isCircuitOpen()).toBe(false);
    reportApiFailure(netErr()); // 第 5 次
    expect(isCircuitOpen()).toBe(true);
    const s = circuitSnapshot();
    expect(s.open).toBe(true);
    expect(s.retryAt).toBe(Date.now() + 15_000);
  });

  it("不足阈值时 success 清零计数", () => {
    for (let i = 0; i < 4; i++) reportApiFailure(netErr());
    reportApiSuccess();
    reportApiFailure(netErr());
    expect(isCircuitOpen()).toBe(false); // 清零后仅 1 次
  });

  it("4xx 失败不计入（不会误开闸）", () => {
    for (let i = 0; i < 20; i++) reportApiFailure(bizErr(401));
    expect(isCircuitOpen()).toBe(false);
  });

  it("冷却过后半开放行（isCircuitOpen=false）", () => {
    for (let i = 0; i < 5; i++) reportApiFailure(netErr());
    expect(isCircuitOpen()).toBe(true);
    vi.advanceTimersByTime(15_001);
    expect(isCircuitOpen()).toBe(false); // half-open 放行探测
  });

  it("半开探测成功 → 关闸清零（后续需重新累计）", () => {
    for (let i = 0; i < 5; i++) reportApiFailure(netErr());
    vi.advanceTimersByTime(15_001);
    reportApiSuccess();
    expect(circuitSnapshot().open).toBe(false);
    expect(circuitSnapshot().retryAt).toBeNull();
    for (let i = 0; i < 4; i++) reportApiFailure(netErr());
    expect(isCircuitOpen()).toBe(false); // 计数已清零，4 次不够
  });

  it("半开探测失败 → 立即重开（重新计冷却）", () => {
    for (let i = 0; i < 5; i++) reportApiFailure(netErr());
    vi.advanceTimersByTime(15_001);
    reportApiFailure(serverErr(502)); // 半开期一次失败即重开
    expect(isCircuitOpen()).toBe(true);
    expect(circuitSnapshot().retryAt).toBe(Date.now() + 15_000);
  });
});

describe("subscribeCircuit", () => {
  it("开闸与关闸各通知一次（重开不重复弹）", () => {
    const events: boolean[] = [];
    subscribeCircuit((s) => events.push(s.open));
    for (let i = 0; i < 5; i++) reportApiFailure(netErr());
    expect(events).toEqual([true]); // 开闸一次
    reportApiFailure(netErr()); // 已 open 的继续失败不再通知
    expect(events).toEqual([true]);
    vi.advanceTimersByTime(15_001);
    reportApiSuccess(); // 半开探测成功关闸
    expect(events).toEqual([true, false]);
  });
});
