/**
 * 2026-10-21-daemon-zombie-turn FR-04：useInterruptFeedbackTimeout 单测。
 *
 * 依据：session-panel/interrupt-timeout.ts（打断 15s 超时回退定时器簿记）。
 * 用例：到点触发回调 / fire 前清除不触发 / 重按换防旧 timer 作废 /
 * 卸载清理 / 回调身份变更后取最新 / arm-clear 身份稳定。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import * as React from "react";

import {
  INTERRUPT_FEEDBACK_TIMEOUT_MS,
  isTurnStillInterrupting,
  useInterruptFeedbackTimeout,
} from "@/components/daemon/session-panel/interrupt-timeout";

describe("2026-10-21-daemon-zombie-turn FR-04：useInterruptFeedbackTimeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("arm 后到点（15s）触发回调并携带 runId", async () => {
    const onTimeout = vi.fn();
    const { result } = renderHook(() => useInterruptFeedbackTimeout(onTimeout));

    act(() => {
      result.current.arm("run-zombie");
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERRUPT_FEEDBACK_TIMEOUT_MS - 1);
    });
    expect(onTimeout).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(onTimeout).toHaveBeenCalledWith("run-zombie");
  });

  it("fire 前 clear → 不触发", async () => {
    const onTimeout = vi.fn();
    const { result } = renderHook(() => useInterruptFeedbackTimeout(onTimeout));

    act(() => {
      result.current.arm("run-1");
      result.current.clear();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERRUPT_FEEDBACK_TIMEOUT_MS * 2);
    });
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("重按换防：旧 timer 作废，新 runId 到点触发", async () => {
    const onTimeout = vi.fn();
    const { result } = renderHook(() => useInterruptFeedbackTimeout(onTimeout));

    act(() => {
      result.current.arm("run-old");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    act(() => {
      result.current.arm("run-new");
    });
    // 旧 timer 的 15s 整点已过——换防后不触发
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(onTimeout).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(onTimeout).toHaveBeenCalledWith("run-new");
  });

  it("卸载清理：unmount 后到点不触发", async () => {
    const onTimeout = vi.fn();
    const { result, unmount } = renderHook(() => useInterruptFeedbackTimeout(onTimeout));

    act(() => {
      result.current.arm("run-1");
    });
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERRUPT_FEEDBACK_TIMEOUT_MS * 2);
    });
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("回调身份变更后取最新（rerender 换回调）", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const { result, rerender } = renderHook(
      ({ cb }: { cb: (_runId: string) => void }) => useInterruptFeedbackTimeout(cb),
      { initialProps: { cb: first } },
    );

    act(() => {
      result.current.arm("run-1");
    });
    rerender({ cb: second });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERRUPT_FEEDBACK_TIMEOUT_MS);
    });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith("run-1");
  });

  it("arm/clear 身份跨渲染稳定（依赖面不膨胀）", () => {
    const onTimeout = vi.fn();
    const { result, rerender } = renderHook(() => useInterruptFeedbackTimeout(onTimeout));

    const armBefore = result.current.arm;
    const clearBefore = result.current.clear;
    rerender();
    expect(result.current.arm).toBe(armBefore);
    expect(result.current.clear).toBe(clearBefore);
  });

  it("React import 被消费（jsPragma 防 lint 误报的显式引用）", () => {
    expect(React.version).toBeTruthy();
  });
});

describe("2026-10-21-daemon-zombie-turn FR-04：到点裁决 isTurnStillInterrupting（P1 修复）", () => {
  it("仍处 interrupting → true（回退+提示）", () => {
    expect(
      isTurnStillInterrupting(
        [
          { runId: "run-1", status: "interrupting" },
          { runId: "run-2", status: "completed" },
        ],
        "run-1",
      ),
    ).toBe(true);
  });

  it.each(["completed", "failed", "killed", "running"])(
    "终态已到（status=%s）→ false（静默，不误报「未生效」）",
    (status) => {
      expect(isTurnStillInterrupting([{ runId: "run-1", status }], "run-1")).toBe(false);
    },
  );

  it("runId 不匹配（新轮已切换）→ false", () => {
    expect(
      isTurnStillInterrupting([{ runId: "run-2", status: "interrupting" }], "run-1"),
    ).toBe(false);
  });
});
