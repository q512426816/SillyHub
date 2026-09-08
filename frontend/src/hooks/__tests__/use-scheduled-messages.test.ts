/**
 * useScheduledMessages 单测（2026-09-07-session-pin-rename-scheduled-send
 * task-09 / FR-04 / FR-05 / D-001@v1 / Grill B-05）。
 *
 * 依据：
 *   - hooks/use-scheduled-messages.ts（task-08 实现：react-query useQuery 封装）；
 *   - tasks/task-09.md acceptance：queryKey 含 sessionId 按会话隔离 / 轮询拉取
 *     与会话切换重拉 / 30s refetchInterval 配置；
 *   - use-message-queue.test.ts 既有 hook 测试模式（vi.mock @/lib/daemon +
 *     renderHook + fake timers 轮询断言）。
 *
 * 与 use-message-queue 不同点：本 hook 走 react-query，renderHook 需包
 * QueryClientProvider wrapper（retry 关闭；refetchInterval 由 hook 每查询
 * 显式 30s，客户端缺省不覆盖）——bar 生产挂载走局部 client（R4 定案），
 * 测试用独立 client 同语义。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";

import {
  scheduledMessagesQueryKey,
  useScheduledMessages,
} from "@/hooks/use-scheduled-messages";
import type { ScheduledMessageRead } from "@/lib/daemon";

const mocks = vi.hoisted(() => ({
  listScheduledMessages: vi.fn(),
}));

vi.mock("@/lib/daemon", () => ({
  listScheduledMessages: (...args: unknown[]) =>
    mocks.listScheduledMessages(...args),
}));

// ── 固件 ─────────────────────────────────────────────────────────────────

function makeScheduled(
  overrides: Partial<ScheduledMessageRead> = {},
): ScheduledMessageRead {
  return {
    id: "sm-1",
    agent_session_id: "sess-1",
    prompt: "定时提醒",
    dispatch_at: "2026-09-08T14:30:00Z",
    status: "pending",
    attachment_ids: null,
    agent_profile_id: null,
    llm_provider_id: null,
    error_code: null,
    error_message: null,
    created_at: "2026-09-07T10:00:00Z",
    dispatched_at: null,
    cancelled_at: null,
    ...overrides,
  } as ScheduledMessageRead;
}

/** 独立 QueryClient wrapper（照组件测试 renderPanel 先例：retry/gcTime 关）。
 * 本文件为 .ts（任务卡 target_files 定名）：经 createElement 包 Provider，免 JSX。 */
function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
  return { wrapper, client };
}

beforeEach(() => {
  mocks.listScheduledMessages.mockReset().mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

// ── queryKey 隔离（Grill B-05：sessionId 进 key，切会话换键不串数据） ──────

describe("useScheduledMessages queryKey 隔离", () => {
  it("key 工厂：sessionId 为末位槽（不同会话不同 key）", () => {
    expect(scheduledMessagesQueryKey("sess-1")).toEqual([
      "agentSessions",
      "scheduled",
      "sess-1",
    ]);
    expect(scheduledMessagesQueryKey("sess-2")).not.toEqual(
      scheduledMessagesQueryKey("sess-1"),
    );
  });

  it("挂载按 sessionId 拉取，条目直透返回", async () => {
    mocks.listScheduledMessages.mockResolvedValue([
      makeScheduled(),
      makeScheduled({ id: "sm-2", status: "dispatched" }),
    ]);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useScheduledMessages("sess-1"), {
      wrapper,
    });

    await waitFor(() => expect(result.current.scheduled.length).toBe(2));
    expect(mocks.listScheduledMessages).toHaveBeenCalledWith("sess-1");
    expect(result.current.scheduled[0]).toMatchObject({
      id: "sm-1",
      status: "pending",
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
  });

  it("会话切换换键重拉，旧会话数据不残留（不串会话）", async () => {
    mocks.listScheduledMessages.mockResolvedValue([makeScheduled()]);
    const { wrapper } = makeWrapper();
    const { result, rerender } = renderHook(
      (props: { sessionId: string }) => useScheduledMessages(props.sessionId),
      { wrapper, initialProps: { sessionId: "sess-1" } },
    );
    await waitFor(() => expect(result.current.scheduled.length).toBe(1));

    mocks.listScheduledMessages.mockResolvedValue([
      makeScheduled({ id: "sm-2", agent_session_id: "sess-2" }),
    ]);
    rerender({ sessionId: "sess-2" });
    await waitFor(() =>
      expect(result.current.scheduled.map((m) => m.id)).toEqual(["sm-2"]),
    );
    expect(mocks.listScheduledMessages).toHaveBeenLastCalledWith("sess-2");
  });

  it("sessionId 空串（预会话 idle 态）→ enabled 守卫零请求", async () => {
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useScheduledMessages(""), { wrapper });
    // 等一个微任务屏障确认没有迟到请求。
    await act(async () => {});
    expect(mocks.listScheduledMessages).not.toHaveBeenCalled();
    expect(result.current.scheduled).toEqual([]);
  });
});

// ── 30s 轮询（D-001@v1：与后端 sweeper 同频兜底） ─────────────────────────

describe("useScheduledMessages 30s 轮询", () => {
  it("refetchInterval 30s：29s 内不重拉，累计 30s 第二拉（照 session-list-panel 轮询用例模式）", async () => {
    vi.useFakeTimers();
    const { wrapper } = makeWrapper();
    const { result, unmount } = renderHook(
      () => useScheduledMessages("sess-1"),
      { wrapper },
    );
    try {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(mocks.listScheduledMessages).toHaveBeenCalledTimes(1);
      expect(result.current.scheduled).toEqual([]);

      // 30s 间隔：29s 时仍只有首拉。
      await act(async () => {
        await vi.advanceTimersByTimeAsync(29_000);
      });
      expect(mocks.listScheduledMessages).toHaveBeenCalledTimes(1);

      // 累计 30s 到点 → 轮询重拉。
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });
      expect(mocks.listScheduledMessages).toHaveBeenCalledTimes(2);
      expect(mocks.listScheduledMessages).toHaveBeenNthCalledWith(2, "sess-1");
    } finally {
      unmount();
    }
  });

  it("refetchInterval 配置断言（任务卡「断言 options」口径）：查询挂载即带 30_000，与后端 sweeper 同频", async () => {
    const { wrapper, client } = makeWrapper();
    const { unmount } = renderHook(() => useScheduledMessages("sess-1"), {
      wrapper,
    });
    try {
      const query = client
        .getQueryCache()
        .find({ queryKey: scheduledMessagesQueryKey("sess-1") });
      expect(query).toBeTruthy();
      // cache.find 的 options 是基类 QueryOptions（refetchInterval 在
      // QueryObserverOptions 层）——按观察者选项窄化读取（纯断言口径）。
      const opts = query?.options as { refetchInterval?: number | false };
      expect(opts.refetchInterval).toBe(30_000);
    } finally {
      unmount();
    }
  });
});
