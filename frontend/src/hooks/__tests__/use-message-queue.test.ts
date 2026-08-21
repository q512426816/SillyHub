/**
 * useMessageQueue 单测（2026-08-21-session-message-queue task-08）。
 *
 * 依据：
 *   - changes/2026-08-21-session-message-queue/design.md §3.1（hook 契约）、
 *     D-001（active 且无 currentRun 才投递）/ D-002（上限默认 5，满员拒收）/
 *     D-003（失败标 failed 留队头，不自动跳过，重试仅用户触发）；
 *   - tasks/task-08.md acceptance：enqueue / processQueue / removeEntry /
 *     retryEntry / 队列上限边界。注：卡内「maxRetries 超限不再重试」为骨架
 *     残留字段，design 与源码均无 maxRetries（失败不自动重试），以源码实际
 *     行为为准，不测不存在的行为；
 *   - .sillyspec/docs/frontend/scan/CONVENTIONS.md 代码风格第 7 条
 *     （Vitest jsdom + @testing-library/react，测试标题中文）。
 *
 * 覆盖：
 *   1. enqueue 入队字段完整，queueCount / isQueueFull 正确；
 *   2. maxQueue 边界：默认 5 第 6 条拒收 / 自定义 maxQueue / 满员移除后回落；
 *   3. 投递成功：onSend 逐参收到 prompt + attachmentIds，条目经 sending 后移除；
 *   4. 投递失败（D-003）：标 failed + errorMsg 留队头，后续条目不被投递；
 *   5. 条件门控与翻转：hasCurrentRun / sessionActive 关闭不投递，翻转后自动投递；
 *   6. removeEntry 按 id 移除；
 *   7. retryEntry：failed → pending → 重新投递；条件不满足仅置 pending 留队；
 *   8. sessionId 变化清空队列（排队消息不携带到新会话）；
 *   9. 连发保护：第一条 sending 期间第二条不被投递，resolve 后由 effect 接力。
 */
import { describe, it, expect, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

import {
  useMessageQueue,
  type UseMessageQueueOptions,
} from "@/hooks/use-message-queue";

/** 受控 Promise：手动 resolve，用于冻结 sending 中间态验证连发保护。 */
function controlled<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** 默认双门关闭（sessionActive=false + hasCurrentRun=true）：入队不自动投递。 */
function renderQueue(overrides: Partial<UseMessageQueueOptions> = {}) {
  const initialProps: UseMessageQueueOptions = {
    sessionId: "sess-1",
    sessionActive: false,
    hasCurrentRun: true,
    onSend: vi.fn(),
    ...overrides,
  };
  const utils = renderHook((props: UseMessageQueueOptions) => useMessageQueue(props), {
    initialProps,
  });
  return { ...utils, initialProps };
}

describe("useMessageQueue（task-08 / D-001 D-002 D-003）", () => {
  it("enqueue：入队条目字段完整，queueCount / isQueueFull 正确", () => {
    const { result } = renderQueue();

    let ok = false;
    act(() => {
      ok = result.current.enqueue("第一条消息", ["att-1", "att-2"], "第一条消息\n📎 2");
    });

    expect(ok).toBe(true);
    const entry = result.current.queue[0];
    expect(entry?.prompt).toBe("第一条消息");
    expect(entry?.attachmentIds).toEqual(["att-1", "att-2"]);
    expect(entry?.displayPrompt).toBe("第一条消息\n📎 2");
    expect(entry?.status).toBe("pending");
    expect(entry?.errorMsg).toBeUndefined();
    expect(typeof entry?.createdAt).toBe("number");
    expect(result.current.queueCount).toBe(1);
    expect(result.current.isQueueFull).toBe(false);
  });

  it("maxQueue 默认 5（D-002）：第 6 条拒收；满员移除后回落可再入队", () => {
    const { result } = renderQueue();

    for (let i = 1; i <= 5; i += 1) {
      act(() => {
        expect(result.current.enqueue(`第${i}条`, [], `第${i}条`)).toBe(true);
      });
    }
    expect(result.current.queueCount).toBe(5);
    expect(result.current.isQueueFull).toBe(true);

    let sixth = true;
    act(() => {
      sixth = result.current.enqueue("第6条", [], "第6条");
    });
    expect(sixth).toBe(false);
    expect(result.current.queueCount).toBe(5);

    // 满员时移除一条 → isQueueFull 回落，可再次入队补位
    const removedId = result.current.queue[4]?.id ?? "";
    act(() => {
      result.current.removeEntry(removedId);
    });
    expect(result.current.isQueueFull).toBe(false);
    act(() => {
      expect(result.current.enqueue("替补条目", [], "替补条目")).toBe(true);
    });
    expect(result.current.queueCount).toBe(5);
  });

  it("自定义 maxQueue=2：第 3 条拒收", () => {
    const { result } = renderQueue({ maxQueue: 2 });

    act(() => {
      expect(result.current.enqueue("一", [], "一")).toBe(true);
    });
    act(() => {
      expect(result.current.enqueue("二", [], "二")).toBe(true);
    });
    expect(result.current.isQueueFull).toBe(true);
    act(() => {
      expect(result.current.enqueue("三", [], "三")).toBe(false);
    });
    expect(result.current.queueCount).toBe(2);
  });

  it("投递成功：onSend 逐参收到 prompt+attachmentIds，条目经 sending 后移除", async () => {
    const onSend = vi.fn();
    const first = controlled<void>();
    onSend.mockReturnValueOnce(first.promise);
    const { result } = renderQueue({ sessionActive: true, hasCurrentRun: false, onSend });

    act(() => {
      expect(result.current.enqueue("带附件消息", ["att-1", "att-2"], "带附件消息\n📎 2")).toBe(true);
    });

    // 条目进入 sending（投递中未移除）
    await waitFor(() => expect(result.current.queue[0]?.status).toBe("sending"));
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith("带附件消息", ["att-1", "att-2"]);
    expect(result.current.queueCount).toBe(1);

    // 手动 resolve → 条目移除
    await act(async () => {
      first.resolve();
    });
    await waitFor(() => expect(result.current.queueCount).toBe(0));
    expect(result.current.queue).toHaveLength(0);
  });

  it("投递失败（D-003）：标 failed+errorMsg 留队头，后续条目不被投递", async () => {
    const onSend = vi.fn().mockRejectedValue(new Error("inject 500"));
    const { result } = renderQueue({ sessionActive: true, hasCurrentRun: false, onSend });

    act(() => {
      expect(result.current.enqueue("会失败的消息", [], "会失败的消息")).toBe(true);
    });
    await waitFor(() => expect(result.current.queue[0]?.status).toBe("failed"));
    expect(result.current.queue[0]?.errorMsg).toBe("inject 500");
    expect(onSend).toHaveBeenCalledTimes(1);

    // D-003：failed 留队头，第二条入队后不被自动投递（不跳过）
    act(() => {
      expect(result.current.enqueue("第二条", [], "第二条")).toBe(true);
    });
    await act(async () => {}); // flush 微任务：若错误投递第二条，此处必然暴露
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(result.current.queueCount).toBe(2);
    expect(result.current.queue[0]?.status).toBe("failed");
    expect(result.current.queue[1]?.status).toBe("pending");
  });

  it("投递失败抛非 Error：errorMsg 兜底「发送失败」", async () => {
    const onSend = vi.fn().mockRejectedValue("网络中断");
    const { result } = renderQueue({ sessionActive: true, hasCurrentRun: false, onSend });

    act(() => {
      result.current.enqueue("m", [], "m");
    });
    await waitFor(() => expect(result.current.queue[0]?.status).toBe("failed"));
    expect(result.current.queue[0]?.errorMsg).toBe("发送失败");
  });

  it("条件门控：hasCurrentRun=true 时不投递", async () => {
    const onSend = vi.fn();
    const { result } = renderQueue({ sessionActive: true, hasCurrentRun: true, onSend });

    act(() => {
      result.current.enqueue("运行中入队", [], "运行中入队");
    });
    await act(async () => {});
    expect(onSend).not.toHaveBeenCalled();
    expect(result.current.queue[0]?.status).toBe("pending");
  });

  it("条件门控：sessionActive=false 时不投递", async () => {
    const onSend = vi.fn();
    const { result } = renderQueue({ sessionActive: false, hasCurrentRun: false, onSend });

    act(() => {
      result.current.enqueue("非 active 入队", [], "非 active 入队");
    });
    await act(async () => {});
    expect(onSend).not.toHaveBeenCalled();
    expect(result.current.queue[0]?.status).toBe("pending");
  });

  it("条件翻转：sessionActive false→true 后自动投递（reconnect→active 场景）", async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    const { result, rerender, initialProps } = renderQueue({
      sessionActive: false,
      hasCurrentRun: false,
      onSend,
    });

    act(() => {
      result.current.enqueue("断线时入队", [], "断线时入队");
    });
    await act(async () => {});
    expect(onSend).not.toHaveBeenCalled();

    rerender({ ...initialProps, sessionActive: true });
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(onSend).toHaveBeenCalledWith("断线时入队", []);
    await waitFor(() => expect(result.current.queueCount).toBe(0));
  });

  it("条件翻转：hasCurrentRun true→false 后自动投递", async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    const { result, rerender, initialProps } = renderQueue({
      sessionActive: true,
      hasCurrentRun: true,
      onSend,
    });

    act(() => {
      result.current.enqueue("上一轮运行中入队", [], "上一轮运行中入队");
    });
    await act(async () => {});
    expect(onSend).not.toHaveBeenCalled();

    rerender({ ...initialProps, hasCurrentRun: false });
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.queueCount).toBe(0));
  });

  it("removeEntry：按 id 移除指定条目，未知 id 无副作用", () => {
    const { result } = renderQueue();

    act(() => {
      result.current.enqueue("一号", [], "一号");
    });
    act(() => {
      result.current.enqueue("二号", [], "二号");
    });
    const ids = result.current.queue.map((e) => e.id);
    expect(ids[0]).not.toBe(ids[1]);

    act(() => {
      result.current.removeEntry(ids[0] ?? "");
    });
    expect(result.current.queueCount).toBe(1);
    expect(result.current.queue[0]?.prompt).toBe("二号");

    act(() => {
      result.current.removeEntry("no-such-id");
    });
    expect(result.current.queueCount).toBe(1);
  });

  it("retryEntry：failed → pending → 重新投递成功后移除（D-003 仅用户触发）", async () => {
    const onSend = vi.fn()
      .mockRejectedValueOnce(new Error("第一次失败"))
      .mockResolvedValueOnce(undefined);
    const { result } = renderQueue({ sessionActive: true, hasCurrentRun: false, onSend });

    act(() => {
      result.current.enqueue("重试我", ["att-9"], "重试我\n📎 1");
    });
    await waitFor(() => expect(result.current.queue[0]?.status).toBe("failed"));

    const id = result.current.queue[0]?.id ?? "";
    await act(async () => {
      await result.current.retryEntry(id);
    });

    expect(onSend).toHaveBeenCalledTimes(2);
    expect(onSend).toHaveBeenNthCalledWith(2, "重试我", ["att-9"]);
    await waitFor(() => expect(result.current.queueCount).toBe(0));
  });

  it("retryEntry：条件不满足时仅置 pending 留队，等 effect 再触发", async () => {
    const onSend = vi.fn().mockRejectedValue(new Error("失败"));
    const { result, rerender, initialProps } = renderQueue({
      sessionActive: true,
      hasCurrentRun: false,
      onSend,
    });

    act(() => {
      result.current.enqueue("等条件", [], "等条件");
    });
    await waitFor(() => expect(result.current.queue[0]?.status).toBe("failed"));
    expect(onSend).toHaveBeenCalledTimes(1);

    // 条件翻转为不可投递后重试：只应置 pending 清错误，不产生新投递
    rerender({ ...initialProps, sessionActive: false, hasCurrentRun: true });
    const id = result.current.queue[0]?.id ?? "";
    await act(async () => {
      await result.current.retryEntry(id);
    });

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(result.current.queueCount).toBe(1);
    expect(result.current.queue[0]?.status).toBe("pending");
    expect(result.current.queue[0]?.errorMsg).toBeUndefined();
  });

  it("sessionId 变化清空队列（排队消息不携带到新会话）", () => {
    const onSend = vi.fn();
    const { result, rerender, initialProps } = renderQueue({ sessionId: "sess-1", onSend });

    act(() => {
      result.current.enqueue("旧会话消息一", [], "旧会话消息一");
    });
    act(() => {
      result.current.enqueue("旧会话消息二", [], "旧会话消息二");
    });
    expect(result.current.queueCount).toBe(2);

    rerender({ ...initialProps, sessionId: "sess-2" });
    expect(result.current.queueCount).toBe(0);
    expect(result.current.queue).toHaveLength(0);
    expect(onSend).not.toHaveBeenCalled();
  });

  it("连发保护：第一条 sending 期间第二条不被投递，resolve 后接力投递", async () => {
    const onSend = vi.fn();
    const first = controlled<void>();
    const second = controlled<void>();
    onSend.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderQueue({ sessionActive: true, hasCurrentRun: false, onSend });

    act(() => {
      result.current.enqueue("一", [], "一");
    });
    act(() => {
      result.current.enqueue("二", [], "二");
    });

    // 第一条 sending 期间：一次只投一条，第二条保持 pending
    await waitFor(() => expect(result.current.queue[0]?.status).toBe("sending"));
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(result.current.queue[0]?.prompt).toBe("一");
    expect(result.current.queue[1]?.status).toBe("pending");

    // 第一条成功移除后，effect 依最新条件接力投递第二条
    await act(async () => {
      first.resolve();
    });
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(2));
    expect(result.current.queueCount).toBe(1);
    expect(result.current.queue[0]?.prompt).toBe("二");
    expect(result.current.queue[0]?.status).toBe("sending");

    await act(async () => {
      second.resolve();
    });
    await waitFor(() => expect(result.current.queueCount).toBe(0));
  });
});
