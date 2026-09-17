/**
 * CircuitBreakerBanner 单测（ql-20260917-011）：开闸出现 / 关闸消失。
 */

import { render, screen, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetCircuitForTest, reportApiFailure, reportApiSuccess } from "@/lib/api-circuit";
import { ApiError } from "@/lib/api";
import { CircuitBreakerBanner } from "@/components/circuit-banner";

const netErr = () => new ApiError(0, { code: "network_error", message: "x", request_id: null, details: null });

beforeEach(() => {
  __resetCircuitForTest();
});

afterEach(() => {
  __resetCircuitForTest();
  vi.restoreAllMocks();
});

describe("CircuitBreakerBanner", () => {
  it("默认不渲染；开闸出现横幅；半开探测成功后消失", () => {
    const { container } = render(<CircuitBreakerBanner />);
    expect(screen.queryByTestId("circuit-banner")).toBeNull();

    for (let i = 0; i < 5; i++) {
      act(() => reportApiFailure(netErr()));
    }
    expect(screen.getByTestId("circuit-banner").textContent).toContain("与服务器的连接暂时中断");

    // 冷却过后半开探测成功 → 关闸 → 横幅消失
    vi.useFakeTimers();
    try {
      vi.advanceTimersByTime(15_001);
      act(() => reportApiSuccess());
      expect(screen.queryByTestId("circuit-banner")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
    expect(container).toBeInTheDocument;
  });
});
