// 2026-08-25 P1 修复：debounceLeadingTrailing（lib/utils.ts）单测——SSE 变更
// 信号 → invalidate 风暴抑制用的 leading+trailing 去抖。
//
// 覆盖：
//   1. 单次调用 → leading 立即执行一次，无 trailing；
//   2. 窗口期内密集调用 → leading 一次 + 窗口尾 trailing 一次（最后一次参数）；
//   3. 窗口过后再调用 → 重新 leading；
//   4. cancel() → 丢弃挂起的 trailing（卸载清理防幽灵执行）。

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { debounceLeadingTrailing } from "@/lib/utils";

describe("debounceLeadingTrailing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("单次调用 → leading 立即执行一次，窗口关闭后无 trailing", () => {
    const fn = vi.fn();
    const debounced = debounceLeadingTrailing(fn, 400);

    debounced();
    expect(fn).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(500);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("窗口期内密集调用 → leading 一次 + 窗口尾 trailing 一次（用最后一次参数）", () => {
    const fn = vi.fn();
    const debounced = debounceLeadingTrailing(fn, 400);

    debounced(1); // leading 立即
    debounced(2); // 窗口期内：合并
    debounced(3); // 窗口期内：合并（记最后一次）
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenLastCalledWith(1);

    vi.advanceTimersByTime(400); // 窗口关闭 → trailing
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith(3);
  });

  it("窗口过后再调用 → 重新 leading（持续信号至多每窗口 2 次执行）", () => {
    const fn = vi.fn();
    const debounced = debounceLeadingTrailing(fn, 400);

    debounced();
    debounced();
    vi.advanceTimersByTime(400); // leading + trailing = 2 次
    expect(fn).toHaveBeenCalledTimes(2);

    debounced(); // 新窗口 leading
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("cancel() → 丢弃挂起的 trailing；不影响已执行的 leading", () => {
    const fn = vi.fn();
    const debounced = debounceLeadingTrailing(fn, 400);

    debounced();
    debounced(); // 挂起 trailing
    expect(fn).toHaveBeenCalledTimes(1);

    debounced.cancel();
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(1);

    // cancel 后可继续使用（重新 leading）。
    debounced();
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
