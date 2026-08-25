/**
 * useMessageQueue 单测（ql-20260825-011 后端真实排队重写版）。
 *
 * 覆盖：
 *   1. 挂载按 sessionId 拉取 GET /queue，条目字段映射（failed/errorMsg/附件）；
 *   2. 预会话态（sessionId=""）不发请求、队列为空；
 *   3. 会话切换重新拉取（排队消息属于原会话，不跨会话残留）；
 *   4. sessionActive 期间 5s 轮询兜底，非 active 不轮询；
 *   5. removeEntry → DELETE + 重新拉取；retryEntry → POST retry + 重新拉取；
 *   6. refresh() 主动刷新（SSE turn 事件后的调用契约）；
 *   7. isQueueFull：5 条 pending 满员（与后端 SESSION_QUEUE_MAX_PENDING 同值）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

import { useMessageQueue } from "@/hooks/use-message-queue";
import {
  deleteSessionQueueEntry,
  fetchSessionQueue,
  retrySessionQueueEntry,
  type SessionQueueEntry,
} from "@/lib/daemon";

vi.mock("@/lib/daemon", () => ({
  fetchSessionQueue: vi.fn(),
  deleteSessionQueueEntry: vi.fn(),
  retrySessionQueueEntry: vi.fn(),
}));

const mockedFetch = vi.mocked(fetchSessionQueue);
const mockedDelete = vi.mocked(deleteSessionQueueEntry);
const mockedRetry = vi.mocked(retrySessionQueueEntry);

function entry(overrides: Partial<SessionQueueEntry> = {}): SessionQueueEntry {
  return {
    id: "entry-1",
    prompt: "排队消息",
    attachment_ids: ["att-1"],
    agent_profile_id: null,
    llm_provider_id: null,
    status: "pending",
    error_msg: null,
    created_at: "2026-08-25T10:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useMessageQueue（ql-20260825-011 服务端排队）", () => {
  it("挂载即按 sessionId 拉取队列并映射条目字段", async () => {
    mockedFetch.mockResolvedValue([
      entry(),
      entry({ id: "entry-2", status: "failed", error_msg: "daemon 离线", prompt: "失败消息" }),
    ]);

    const { result } = renderHook(() =>
      useMessageQueue({ sessionId: "sess-1", sessionActive: false }),
    );

    await waitFor(() => expect(result.current.queue.length).toBe(2));
    expect(mockedFetch).toHaveBeenCalledWith("sess-1");
    expect(result.current.queue[0]!).toMatchObject({
      id: "entry-1",
      prompt: "排队消息",
      attachmentIds: ["att-1"],
      status: "pending",
    });
    expect(result.current.queue[1]!).toMatchObject({
      id: "entry-2",
      status: "failed",
      errorMsg: "daemon 离线",
    });
    expect(result.current.queueCount).toBe(2);
    expect(result.current.isQueueFull).toBe(false);
  });

  it("预会话态（sessionId 空串）不发请求且队列为空", async () => {
    const { result } = renderHook(() =>
      useMessageQueue({ sessionId: "", sessionActive: false }),
    );
    // 等一个微任务屏障确认没有迟到请求。
    await act(async () => {});
    expect(mockedFetch).not.toHaveBeenCalled();
    expect(result.current.queue).toEqual([]);
  });

  it("会话切换重新拉取，旧会话队列不残留", async () => {
    mockedFetch.mockResolvedValue([entry()]);
    const { result, rerender } = renderHook(
      (props: { sessionId: string }) =>
        useMessageQueue({ sessionId: props.sessionId, sessionActive: false }),
      { initialProps: { sessionId: "sess-1" } },
    );
    await waitFor(() => expect(result.current.queue.length).toBe(1));

    mockedFetch.mockResolvedValue([]);
    rerender({ sessionId: "sess-2" });
    await waitFor(() => expect(result.current.queue).toEqual([]));
    expect(mockedFetch).toHaveBeenLastCalledWith("sess-2");
  });

  it("sessionActive 期间 5s 轮询兜底，非 active 不轮询", async () => {
    vi.useFakeTimers();
    mockedFetch.mockResolvedValue([]);
    const { rerender } = renderHook(
      (props: { active: boolean }) =>
        useMessageQueue({ sessionId: "sess-1", sessionActive: props.active }),
      { initialProps: { active: false } },
    );
    // 初始挂载一次拉取后，非 active 不再轮询。
    await act(async () => vi.advanceTimersByTimeAsync(12000));
    expect(mockedFetch).toHaveBeenCalledTimes(1);

    rerender({ active: true });
    await act(async () => vi.advanceTimersByTimeAsync(5000));
    expect(mockedFetch.mock.calls.filter((c) => c[0] === "sess-1").length).toBeGreaterThanOrEqual(2);
  });

  it("removeEntry 走 DELETE 端点并刷新", async () => {
    mockedFetch.mockResolvedValue([entry()]);
    const { result } = renderHook(() =>
      useMessageQueue({ sessionId: "sess-1", sessionActive: false }),
    );
    await waitFor(() => expect(result.current.queue.length).toBe(1));

    mockedDelete.mockResolvedValue(undefined);
    mockedFetch.mockResolvedValue([]);
    await act(async () => {
      result.current.removeEntry("entry-1");
    });
    await waitFor(() => expect(result.current.queue).toEqual([]));
    expect(mockedDelete).toHaveBeenCalledWith("sess-1", "entry-1");
  });

  it("retryEntry 走 retry 端点并刷新", async () => {
    mockedFetch.mockResolvedValue([entry({ status: "failed" })]);
    const { result } = renderHook(() =>
      useMessageQueue({ sessionId: "sess-1", sessionActive: false }),
    );
    await waitFor(() => expect(result.current.queue[0]!.status).toBe("failed"));

    mockedRetry.mockResolvedValue(entry());
    mockedFetch.mockResolvedValue([entry()]);
    await act(async () => {
      result.current.retryEntry("entry-1");
    });
    await waitFor(() => expect(result.current.queue[0]!.status).toBe("pending"));
    expect(mockedRetry).toHaveBeenCalledWith("sess-1", "entry-1");
  });

  it("refresh() 主动重新拉取", async () => {
    mockedFetch.mockResolvedValue([]);
    const { result } = renderHook(() =>
      useMessageQueue({ sessionId: "sess-1", sessionActive: false }),
    );
    await waitFor(() => expect(mockedFetch).toHaveBeenCalledTimes(1));

    mockedFetch.mockResolvedValue([entry()]);
    await act(async () => {
      result.current.refresh();
    });
    await waitFor(() => expect(result.current.queue.length).toBe(1));
    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });

  it("5 条 pending 满员（与后端上限同值）", async () => {
    mockedFetch.mockResolvedValue(
      Array.from({ length: 5 }, (_, i) => entry({ id: `entry-${i}` })),
    );
    const { result } = renderHook(() =>
      useMessageQueue({ sessionId: "sess-1", sessionActive: false }),
    );
    await waitFor(() => expect(result.current.queueCount).toBe(5));
    expect(result.current.isQueueFull).toBe(true);
  });
});
