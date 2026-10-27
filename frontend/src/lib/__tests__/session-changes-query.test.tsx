/**
 * useSessionChanges 轮询策略单测
 * （2026-10-27-ghost-spec-binding-fix FR-08：弹窗实时性——用户实测反馈「真实
 * 变更创建/失效后入口徽标不更新、要刷新页面才回显」的根因是关闭态 0 轮询）。
 *
 * 覆盖：
 *   1. 关闭态（active 缺省）30s 慢档轮询——15s 不触发、30s 触发第二次拉取；
 *   2. 打开态（active: true）15s 快档轮询——15s 即触发第二次拉取。
 *
 * 打开沿「立即 refetch」（FR-09）是组件层接线（staleTime 缓存窗口内强制拉新），
 * 在 session-change-files-hover.test.tsx 以 refetch spy 断言，不在此重复。
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useSessionChanges } from "@/lib/changes";

const apiMock = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@/lib/api", () => ({
  ApiError: class extends Error {},
  apiFetch: (...args: unknown[]) => apiMock.fetch(...args),
}));

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { wrapper };
}

beforeEach(() => {
  vi.useFakeTimers();
  apiMock.fetch.mockReset();
  apiMock.fetch.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useSessionChanges 轮询双档（FR-08）", () => {
  it("关闭态 30s 慢档：15s 不触发，35s 内触发第二次拉取", async () => {
    const { wrapper } = setup();
    renderHook(() => useSessionChanges("ws-1", "s-1"), { wrapper });

    // advanceTimersByTimeAsync 自带微任务 flush（首拉 fetch resolve → state 更新）。
    // 不用 waitFor：其内部也依赖 timer，与 fake timers 互相等待会死锁。
    await vi.advanceTimersByTimeAsync(0);
    expect(apiMock.fetch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(15_000);
    expect(apiMock.fetch).toHaveBeenCalledTimes(1); // 15s 未到慢档

    await vi.advanceTimersByTimeAsync(20_000); // 累计 35s（interval 自 fetch 完成起算，留余量）
    expect(apiMock.fetch).toHaveBeenCalledTimes(2);
  });

  it("打开态 15s 快档：15s 即触发第二次拉取", async () => {
    const { wrapper } = setup();
    renderHook(() => useSessionChanges("ws-1", "s-1", { active: true }), { wrapper });

    await vi.advanceTimersByTimeAsync(0);
    expect(apiMock.fetch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(20_000); // > 快档 15s
    expect(apiMock.fetch).toHaveBeenCalledTimes(2);
  });
});
