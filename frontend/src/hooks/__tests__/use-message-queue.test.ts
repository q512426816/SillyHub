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
 *   7. isQueueFull：5 条 pending 满员（与后端 SESSION_QUEUE_MAX_PENDING 同值）；
 *   8. 2026-08-31-session-queue-ux task-10：reorderEntry / editEntry /
 *      dispatchNowEntry 三方法（「调对应端点 + load 重新拉取」双行为，对齐
 *      removeEntry 既有模式）+ API reject 静默仍 load（R-02）+ position 字段透传。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

import { useMessageQueue } from "@/hooks/use-message-queue";
import {
  deleteSessionQueueEntry,
  dispatchNowSessionQueueEntry,
  fetchSessionQueue,
  reorderSessionQueue,
  retrySessionQueueEntry,
  updateSessionQueueEntry,
  type SessionQueueEntry,
} from "@/lib/daemon";

vi.mock("@/lib/daemon", () => ({
  fetchSessionQueue: vi.fn(),
  deleteSessionQueueEntry: vi.fn(),
  retrySessionQueueEntry: vi.fn(),
  // 2026-08-31-session-queue-ux（FR-04/05/06）：队列三操作 client。
  reorderSessionQueue: vi.fn(),
  updateSessionQueueEntry: vi.fn(),
  dispatchNowSessionQueueEntry: vi.fn(),
}));

const mockedFetch = vi.mocked(fetchSessionQueue);
const mockedDelete = vi.mocked(deleteSessionQueueEntry);
const mockedRetry = vi.mocked(retrySessionQueueEntry);
const mockedReorder = vi.mocked(reorderSessionQueue);
const mockedUpdate = vi.mocked(updateSessionQueueEntry);
const mockedDispatchNow = vi.mocked(dispatchNowSessionQueueEntry);

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
      // 2026-08-31-session-queue-ux D-002：task-04 起后端必回填 position，映射层透传。
      entry({ position: 2 }),
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
      position: 2,
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

  // ── 2026-08-31-session-queue-ux task-10：三操作方法（对齐 removeEntry 既有
  //    「调端点 → load 重新拉取」双行为模式） ──────────────────────────────────

  it("reorderEntry 走 reorder 端点（全量有序 ids，D-003）并刷新", async () => {
    mockedFetch.mockResolvedValue([
      entry(),
      entry({ id: "entry-2", prompt: "第二条" }),
    ]);
    const { result } = renderHook(() =>
      useMessageQueue({ sessionId: "sess-1", sessionActive: false }),
    );
    await waitFor(() => expect(result.current.queue.length).toBe(2));

    // 松手后的全量有序 ids 原样上传（禁止部分序），随后 load 以服务端返回序收敛。
    mockedReorder.mockResolvedValue(undefined);
    mockedFetch.mockResolvedValue([
      entry({ id: "entry-2", prompt: "第二条" }),
      entry(),
    ]);
    await act(async () => {
      result.current.reorderEntry(["entry-2", "entry-1"]);
    });
    await waitFor(() =>
      expect(result.current.queue.map((q) => q.id)).toEqual(["entry-2", "entry-1"]),
    );
    expect(mockedReorder).toHaveBeenCalledTimes(1);
    expect(mockedReorder).toHaveBeenCalledWith("sess-1", ["entry-2", "entry-1"]);
  });

  it("editEntry 走 update 端点并刷新", async () => {
    mockedFetch.mockResolvedValue([entry()]);
    const { result } = renderHook(() =>
      useMessageQueue({ sessionId: "sess-1", sessionActive: false }),
    );
    await waitFor(() => expect(result.current.queue.length).toBe(1));

    mockedUpdate.mockResolvedValue(entry({ prompt: "改后消息" }));
    mockedFetch.mockResolvedValue([entry({ prompt: "改后消息" })]);
    await act(async () => {
      result.current.editEntry("entry-1", "改后消息");
    });
    await waitFor(() => expect(result.current.queue[0]!.prompt).toBe("改后消息"));
    expect(mockedUpdate).toHaveBeenCalledTimes(1);
    expect(mockedUpdate).toHaveBeenCalledWith("sess-1", "entry-1", "改后消息");
  });

  it("dispatchNowEntry 走 dispatch-now 端点并刷新（响应 interrupted 不本地消费，R-04）", async () => {
    mockedFetch.mockResolvedValue([entry()]);
    const { result } = renderHook(() =>
      useMessageQueue({ sessionId: "sess-1", sessionActive: false }),
    );
    await waitFor(() => expect(result.current.queue.length).toBe(1));

    // 响应带 interrupted=true（打断当前轮）：hook 不据此本地造状态，收敛统一 load。
    mockedDispatchNow.mockResolvedValue({ interrupted: true });
    mockedFetch.mockResolvedValue([]);
    await act(async () => {
      result.current.dispatchNowEntry("entry-1");
    });
    await waitFor(() => expect(result.current.queue).toEqual([]));
    expect(mockedDispatchNow).toHaveBeenCalledTimes(1);
    expect(mockedDispatchNow).toHaveBeenCalledWith("sess-1", "entry-1");
  });

  it("三方法 API reject 静默仍 load（R-02：以服务端为准，不弹错不回滚本地）", async () => {
    mockedFetch.mockResolvedValue([entry()]);
    const { result } = renderHook(() =>
      useMessageQueue({ sessionId: "sess-1", sessionActive: false }),
    );
    await waitFor(() => expect(mockedFetch).toHaveBeenCalledTimes(1));

    mockedReorder.mockRejectedValue(new Error("422 QUEUE_ORDER_MISMATCH"));
    mockedUpdate.mockRejectedValue(new Error("409 TASK_WAKEUP"));
    mockedDispatchNow.mockRejectedValue(new Error("409 session not active"));
    mockedFetch.mockResolvedValue([entry()]);
    await act(async () => {
      result.current.reorderEntry(["entry-1"]);
    });
    await act(async () => {
      result.current.editEntry("entry-1", "改后消息");
    });
    await act(async () => {
      result.current.dispatchNowEntry("entry-1");
    });
    // 每次失败后仍各触发一次 load：初始 1 + 三次 = 4，队列未被本地清空/回滚。
    await waitFor(() => expect(mockedFetch).toHaveBeenCalledTimes(4));
    expect(result.current.queue.length).toBe(1);
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
