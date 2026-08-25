/**
 * useMessageQueue —— 会话消息排队 Hook（ql-20260825-011 后端真实排队重写）。
 *
 * 演进：2026-08-21 版是纯前端内存队列（useState，刷新即丢、投递靠本地
 * processQueue 轮询 sessionActive/hasCurrentRun）。现改为**服务端排队**：
 *   - 入队 = 直接 POST inject（后端忙轮自动落 agent_session_queued_messages，
 *     响应 queued=true）；run 终态后后台自动派发下一条；
 *   - 队列展示 = GET /sessions/{id}/queue（刷新/重开页面不丢）；
 *   - 删除/重试 = DELETE / POST retry 端点；
 *   - 前端不再持有投递状态机（processQueue/sendingRef 删除）——串行不变式
 *     由后端「单会话至多一个活跃 run + 行锁」保证。
 *
 * 刷新时机：sessionActive 期间 5s 轮询兜底 + 调用方在 SSE turn_started /
 * turn_completed 事件后调 refresh()。
 *
 * 实现约束：**不用 react-query**——dialog 模式弹窗测试无 QueryClientProvider
 * （lib/query-keys.ts 头注释的不变式：dialog 适配层零 react-query），本 hook 为
 * 两模式共享，故纯 useState + fetch 轮询（lib/query-keys.ts:12-14 先例）。
 */

import { useCallback, useEffect, useRef, useState } from "react";

import {
  deleteSessionQueueEntry,
  fetchSessionQueue,
  retrySessionQueueEntry,
} from "@/lib/daemon";

/** 排队条目（展示形态；与 MessageQueueBar 契约保持兼容）。 */
export interface QueueEntry {
  /** 服务端条目 id（uuid）。 */
  id: string;
  /** 消息文本（派发给 inject 的原文）。 */
  prompt: string;
  /** 附件 ids（仅引用已落库附件 id）。 */
  attachmentIds: string[];
  /** 展示文本（服务端队列不含附件标记行，直接用 prompt）。 */
  displayPrompt: string;
  /** 状态：pending 等待派发 / failed 派发失败留队（sending 由后端派发吸收，不再出现）。 */
  status: "pending" | "sending" | "failed";
  /** 失败原因（status === "failed" 时有值）。 */
  errorMsg?: string;
  /** 入队时间戳（Date.now()）。 */
  createdAt: number;
}

export interface UseMessageQueueOptions {
  /** 会话 id（空串 = 预会话态，不发队列查询）。 */
  sessionId: string;
  /** status === "active"（active 才轮询队列；终态会话队列冻结不刷）。 */
  sessionActive: boolean;
}

export interface UseMessageQueueReturn {
  /** 当前队列（驱动 MessageQueueBar 渲染）。 */
  queue: QueueEntry[];
  /** 按 id 移除条目（DELETE 端点 + 失效刷新）。 */
  removeEntry: (id: string) => void;
  /** 重试失败条目（POST retry 端点：failed→pending 并立即尝试派发）。 */
  retryEntry: (id: string) => void;
  /** 队列是否已满（与后端 SESSION_QUEUE_MAX_PENDING 同值）。 */
  isQueueFull: boolean;
  /** 队列长度。 */
  queueCount: number;
  /** 主动刷新（SSE turn_started/turn_completed 后调用）。 */
  refresh: () => void;
}

/** 队列上限（D-002 沿用；与后端 SESSION_QUEUE_MAX_PENDING 同值，满员由后端 409 守卫）。 */
const DEFAULT_MAX_QUEUE = 5;

/** 轮询间隔（ms）：active 会话低频兜底（主要靠 SSE 事件触发的 refresh）。 */
const POLL_INTERVAL_MS = 5000;

export function useMessageQueue({
  sessionId,
  sessionActive,
}: UseMessageQueueOptions): UseMessageQueueReturn {
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  /** 卸载/换会话后迟到的响应丢弃（epoch 单调递增，响应携带发起时的 epoch）。 */
  const epochRef = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(
    async (targetSessionId: string): Promise<void> => {
      if (targetSessionId === "") {
        setQueue([]);
        return;
      }
      const epoch = ++epochRef.current;
      try {
        const items = await fetchSessionQueue(targetSessionId);
        if (!mountedRef.current || epoch !== epochRef.current) return;
        setQueue(
          items.map((e) => ({
            id: e.id,
            prompt: e.prompt,
            attachmentIds: e.attachment_ids ?? [],
            displayPrompt: e.prompt,
            status: e.status === "failed" ? ("failed" as const) : ("pending" as const),
            errorMsg: e.error_msg ?? undefined,
            createdAt: Date.parse(e.created_at) || 0,
          })),
        );
      } catch {
        /* 队列拉取失败静默（下轮轮询/refresh 重试），不打断聊天主流程 */
      }
    },
    [],
  );

  // 会话切换 / 挂载：清旧队列 + 立即拉新。
  useEffect(() => {
    void load(sessionId);
  }, [sessionId, load]);

  // active 期间低频轮询兜底（派发/失败主要靠 SSE 事件触发的 refresh）。
  useEffect(() => {
    if (sessionId === "" || !sessionActive) return;
    const timer = setInterval(() => {
      void load(sessionId);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [sessionId, sessionActive, load]);

  const refresh = useCallback(() => {
    void load(sessionId);
  }, [load, sessionId]);

  const removeEntry = useCallback(
    (id: string) => {
      if (sessionId === "") return;
      void deleteSessionQueueEntry(sessionId, id)
        .catch(() => {
          /* 删除失败仍刷新（以服务端为准） */
        })
        .then(() => load(sessionId));
    },
    [sessionId, load],
  );

  const retryEntry = useCallback(
    (id: string) => {
      if (sessionId === "") return;
      void retrySessionQueueEntry(sessionId, id)
        .catch(() => {
          /* 重试失败仍刷新（以服务端为准） */
        })
        .then(() => load(sessionId));
    },
    [sessionId, load],
  );

  return {
    queue,
    removeEntry,
    retryEntry,
    isQueueFull: queue.length >= DEFAULT_MAX_QUEUE,
    queueCount: queue.length,
    refresh,
  };
}
