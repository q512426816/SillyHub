/**
 * useMessageQueue —— 会话消息排队 Hook（2026-08-21-session-message-queue task-01）。
 *
 * 设计依据（changes/2026-08-21-session-message-queue/design.md §2 / §3.1）：
 *   - D-001 前端队列等 active：running / reconnecting / pending 期间消息入队，
 *     等 sessionActive && !hasCurrentRun 后自动投递队头（后端 inject 守卫不动）；
 *   - D-002 队列上限默认 5 条：enqueue 满员返回 false；是否禁用输入框由调用方
 *     判断（hook 不做门禁，enqueue 只管入队返回布尔）；
 *   - D-003 失败留队头：投递抛错时条目标记 failed(errorMsg) 停在队头，不自动
 *     重试、不自动跳过（队头 failed 会阻塞后续投递），重试仅由用户点 retryEntry 触发；
 *   - D-004 附件排队：attachmentIds 只引用已落库附件 id，投递时随 prompt 一次带出。
 *
 * 防重入：sendingRef 保证同一时刻至多一条在投递（effect 重复触发直接返回）。
 * 卸载安全：mountedRef 防御，unmount 后不再 setState。
 * 状态镜像：queueRef 与 state 同步更新，processQueue 异步续段一律读 queueRef
 * （state 闭包是旧值）。
 */

import { useCallback, useEffect, useRef, useState } from "react";

/** 排队条目（design §3.1 逐字定义）。 */
export interface QueueEntry {
  /** 唯一标识（入队时生成）。 */
  id: string;
  /** 消息文本（投递给 onSend 的原文）。 */
  prompt: string;
  /** 附件 ids（D-004：上传时已落库，排队仅引用 id）。 */
  attachmentIds: string[];
  /** 带附件标记行的展示文本（MessageQueueBar 展开查看用）。 */
  displayPrompt: string;
  /** 投递状态：pending 等待 / sending 投递中 / failed 失败留队（D-003）。 */
  status: "pending" | "sending" | "failed";
  /** 失败原因（status === "failed" 时有值）。 */
  errorMsg?: string;
  /** 入队时间戳（Date.now()）。 */
  createdAt: number;
}

export interface UseMessageQueueOptions {
  /** 会话 id（切换会话时清空队列——排队消息属于原会话，不携带到新会话）。 */
  sessionId: string;
  /** status === "active"（D-001：等 active 才投递）。 */
  sessionActive: boolean;
  /** currentRunId != null（本轮运行中，直接投递会破坏 turn 串行）。 */
  hasCurrentRun: boolean;
  /** 实际发送（inject）：成功 resolve / 失败 throw，由调用方实现。 */
  onSend: (prompt: string, attachmentIds: string[]) => Promise<void>;
  /** 队列上限，默认 5（D-002）。 */
  maxQueue?: number;
}

export interface UseMessageQueueReturn {
  /** 当前队列（驱动 MessageQueueBar 渲染）。 */
  queue: QueueEntry[];
  /** 入队：满员返回 false（D-002），其余情况一律入队返回 true。 */
  enqueue: (
    prompt: string,
    attachmentIds: string[],
    displayPrompt: string,
  ) => boolean;
  /** 按 id 移除条目。 */
  removeEntry: (id: string) => void;
  /** 重试失败条目：failed → pending 后立即尝试投递；条件不满足则等 effect 触发（D-003：仅用户触发）。 */
  retryEntry: (id: string) => Promise<void>;
  /** 队列是否已满（D-002）。 */
  isQueueFull: boolean;
  /** 队列长度。 */
  queueCount: number;
}

/** 队列上限默认值（D-002）。 */
const DEFAULT_MAX_QUEUE = 5;

/**
 * 生成条目 id：浏览器优先 crypto.randomUUID；非安全上下文退时间戳+随机数
 * （与 lib/use-agent-run-stream.ts _safeRuntimeId 同义的本地兜底）。
 */
function _entryId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `mq-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function useMessageQueue({
  sessionId,
  sessionActive,
  hasCurrentRun,
  onSend,
  maxQueue = DEFAULT_MAX_QUEUE,
}: UseMessageQueueOptions): UseMessageQueueReturn {
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  /** 队列镜像 ref：异步续段读最新队列，与 state 同步更新（见文件头注释）。 */
  const queueRef = useRef<QueueEntry[]>([]);
  /** 防重入：true = 有一条正在投递中。 */
  const sendingRef = useRef(false);
  /** 卸载安全：unmount 后不再 setState。 */
  const mountedRef = useRef(true);

  const updateQueue = useCallback(
    (updater: (prev: QueueEntry[]) => QueueEntry[]) => {
      queueRef.current = updater(queueRef.current);
      if (mountedRef.current) setQueue(queueRef.current);
    },
    [],
  );

  // 卸载标记（StrictMode 双挂载下重复置 true 亦无害）。
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // 会话切换：清空队列（排队消息属于原会话；投递到新会话等于串话）。
  const sessionIdRef = useRef(sessionId);
  useEffect(() => {
    if (sessionIdRef.current === sessionId) return;
    sessionIdRef.current = sessionId;
    updateQueue(() => []);
  }, [sessionId, updateQueue]);

  const enqueue = useCallback(
    (prompt: string, attachmentIds: string[], displayPrompt: string): boolean => {
      if (queueRef.current.length >= maxQueue) return false; // D-002 满员拒收
      const entry: QueueEntry = {
        id: _entryId(),
        prompt,
        attachmentIds,
        displayPrompt,
        status: "pending",
        createdAt: Date.now(),
      };
      updateQueue((prev) => [...prev, entry]);
      return true;
    },
    [maxQueue, updateQueue],
  );

  const removeEntry = useCallback(
    (id: string) => {
      updateQueue((prev) => prev.filter((e) => e.id !== id));
    },
    [updateQueue],
  );

  /**
   * 投递队头一条（design §3.1 processQueue）：
   * 条件 = active && 无 currentRun && 队列非空 && 队头 pending
   * （队头 failed 停队不跳过 D-003；sending 由防重入兜底）。
   * 成功 → 移除该条，下一条由 effect 依最新 sessionActive/hasCurrentRun 再触发
   * （不就地连发：避免用陈旧的 hasCurrentRun 连续投递破坏 turn 串行）；
   * 失败 → 标 failed(errorMsg) 留在队头（D-003），停住不自动跳过。
   */
  const processQueue = useCallback(async (): Promise<void> => {
    if (sendingRef.current) return; // 防重入
    if (!sessionActive || hasCurrentRun) return;
    const head = queueRef.current[0];
    if (!head || head.status !== "pending") return;
    sendingRef.current = true;
    updateQueue((prev) =>
      prev.map((e) => (e.id === head.id ? { ...e, status: "sending" as const } : e)),
    );
    try {
      await onSend(head.prompt, head.attachmentIds);
      if (!mountedRef.current) return;
      updateQueue((prev) => prev.filter((e) => e.id !== head.id));
    } catch (err) {
      if (!mountedRef.current) return;
      const errorMsg = err instanceof Error ? err.message : "发送失败";
      updateQueue((prev) =>
        prev.map((e) =>
          e.id === head.id ? { ...e, status: "failed" as const, errorMsg } : e,
        ),
      );
    } finally {
      sendingRef.current = false;
    }
  }, [sessionActive, hasCurrentRun, onSend, updateQueue]);

  // 触发时机（design §3.1）：effect 监听 sessionActive / hasCurrentRun；
  // 队列自身变化（入队 / 移除 / 投递完成 / 重试重置）也重新评估——
  // active 且空闲时入队即自动投递，一条成功后接着评估下一条。
  useEffect(() => {
    void processQueue();
  }, [processQueue, queue]);

  const retryEntry = useCallback(
    async (id: string): Promise<void> => {
      // failed → pending（清错误信息），随后立即尝试投递；条件不满足则留队等 effect。
      updateQueue((prev) =>
        prev.map((e) =>
          e.id === id
            ? { ...e, status: "pending" as const, errorMsg: undefined }
            : e,
        ),
      );
      await processQueue();
    },
    [processQueue, updateQueue],
  );

  return {
    queue,
    enqueue,
    removeEntry,
    retryEntry,
    isQueueFull: queue.length >= maxQueue,
    queueCount: queue.length,
  };
}
