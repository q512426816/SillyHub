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
 * 2026-08-31-session-queue-ux：补排队三操作——reorderEntry（FR-04 拖拽
 *   重排，D-003 全量有序 ids）/ dispatchNowEntry（FR-05 立即发送，D-001 打断
 *   当前轮语义）/ editEntry（FR-06 重新编辑）。三者逐字对齐 removeEntry 的
 *   「调 API → 无论成败一律 load 以服务端为准」模式：失败静默、不弹错、
 *   不回滚本地（R-02 拖拽 vs 派发竞态：落手瞬间条目恰被派发删除 → 后端
 *   422 QUEUE_ORDER_MISMATCH → catch 静默 + load 后条目已消失自然收敛）；
 *   dispatchNowEntry 不消费响应 interrupted 字段（R-04：UI 收敛统一依赖
 *   SSE queue_changed + 随后 load）。
 *
 * ql-20260903-014：五操作失败不再一律静默——404/409/422 属已知竞态（条目
 *   恰被派发删除 / 会话非 active / 参数过期），随后的 load 以服务端为准收敛，
 *   保持静默；网络 / 5xx / 权限等真实失败改为 toast 提示（旧版全静默导致
 *   「编辑保存后文字弹回原样、删除后条目复活」无任何解释，用户以为功能坏了）。
 *   无论成败仍一律 load 的模式不变。
 *
 * 实现约束：**不用 react-query**——dialog 模式弹窗测试无 QueryClientProvider
 *   （lib/query-keys.ts 头注释的不变式：dialog 适配层零 react-query），本 hook 为
 *   两模式共享，故纯 useState + fetch 轮询（lib/query-keys.ts:12-14 先例）。
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError } from "@/lib/api";
import { useNotify } from "@/lib/errors";
import {
  deleteSessionQueueEntry,
  dispatchNowSessionQueueEntry,
  fetchSessionQueue,
  reorderSessionQueue,
  retrySessionQueueEntry,
  updateSessionQueueEntry,
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
  /**
   * 队列序键（2026-08-31-session-queue-ux FR-04/D-002：与派发序同源，
   * task-04 起后端必回填；仅透传给调用方，渲染序仍以服务端 load 返回序为准，
   * 前端不据此本地重排）。
   */
  position?: number;
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
  /**
   * 拖拽重排（FR-04/D-003）：ids 为松手后的**全量有序** id 列表——永远整表
   * 上传不传部分序（后端按上传序重写 position 0..n-1）。落手瞬间条目恰被
   * 派发删除时后端 422，静默 + load 自然收敛（R-02）。
   */
  reorderEntry: (ids: string[]) => void;
  /**
   * 重新编辑（FR-06）：✎ 保存的新 prompt 文本（1..8000 字）。空/超长 422、
   * TASK_WAKEUP 系统通知条目 409（bar 已隐藏其 ✎，属双保险）均静默 + load。
   */
  editEntry: (id: string, prompt: string) => void;
  /**
   * 立即发送（FR-05/D-001）：条目跳过队列直接起轮，忙时打断当前轮接力派发
   * （pending 与 failed 条目均可用）；会话非 active 409 静默。**不消费**响应
   * interrupted 字段（R-04：空闲分支当场派发成功即删行，忙时打断接力是既有
   * 终态钩子链路）——UI 收敛统一依赖 SSE queue_changed + 本方法随后的 load。
   */
  dispatchNowEntry: (id: string) => void;
  /** 队列是否已满（与后端 SESSION_QUEUE_MAX_PENDING 同值）。 */
  isQueueFull: boolean;
  /** 队列长度。 */
  queueCount: number;
  /** 主动刷新（SSE turn_started/turn_completed 后调用）。 */
  refresh: () => void;
}

/** 队列上限（D-002 沿用；与后端 SESSION_QUEUE_MAX_PENDING 同值，满员由后端 409 守卫）。
 *  导出供面板「队列已满」toast 文案取值，避免魔数漂移。 */
export const QUEUE_MAX_PENDING = 5;

/** 已知竞态状态码：catch 后静默（随后 load 以服务端为准收敛），其余真实失败 toast（ql-20260903-014）。 */
const RECONCILE_SILENT_STATUSES = new Set([404, 409, 422]);

/** 轮询间隔（ms）：active 会话低频兜底（主要靠 SSE 事件触发的 refresh）。 */
const POLL_INTERVAL_MS = 5000;

export function useMessageQueue({
  sessionId,
  sessionActive,
}: UseMessageQueueOptions): UseMessageQueueReturn {
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const notify = useNotify();
  /** 竞态静默 / 真实失败 toast 的统一出口（ql-20260903-014）。 */
  const notifyUnlessReconcile = useCallback(
    (err: unknown, fallback: string) => {
      if (err instanceof ApiError && RECONCILE_SILENT_STATUSES.has(err.status)) return;
      notify.error(err, fallback);
    },
    [notify],
  );
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
            position: e.position ?? undefined,
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
      // ql-20260904-009：后台标签页跳过 tick（SSE 断连时后台也不必 5s 空转
      // 拉队列；回前台下一拍恢复，SSE 重连 resync 自带对账）。
      if (typeof document !== "undefined" && document.hidden) return;
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
        .catch((err) => {
          /* 删除失败仍刷新（以服务端为准）；404=条目恰被派发删除属竞态静默，其余 toast */
          notifyUnlessReconcile(err, "删除排队消息失败");
        })
        .then(() => load(sessionId));
    },
    [sessionId, load, notifyUnlessReconcile],
  );

  const retryEntry = useCallback(
    (id: string) => {
      if (sessionId === "") return;
      void retrySessionQueueEntry(sessionId, id)
        .catch((err) => {
          /* 重试失败仍刷新（以服务端为准）；竞态（条目已删/会话非 active）静默 */
          notifyUnlessReconcile(err, "重试排队消息失败");
        })
        .then(() => load(sessionId));
    },
    [sessionId, load, notifyUnlessReconcile],
  );

  // 2026-08-31-session-queue-ux：以下三方法逐字对齐 removeEntry/retryEntry 模式
  // （预会话守卫 → 调 API → catch（竞态静默/真实失败 toast，ql-20260903-014）→
  //  then load；UI 状态只由服务端 load 结果驱动）。

  const reorderEntry = useCallback(
    (ids: string[]) => {
      if (sessionId === "") return;
      void reorderSessionQueue(sessionId, ids)
        .catch((err) => {
          /* 重排失败仍刷新：R-02 拖拽落手瞬间条目恰被派发删除 → 后端 422
             QUEUE_ORDER_MISMATCH 静默 + load 后条目已消失自然收敛（不弹错不回滚本地） */
          notifyUnlessReconcile(err, "调整排队顺序失败");
        })
        .then(() => load(sessionId));
    },
    [sessionId, load, notifyUnlessReconcile],
  );

  const editEntry = useCallback(
    (id: string, prompt: string) => {
      if (sessionId === "") return;
      void updateSessionQueueEntry(sessionId, id, prompt)
        .catch((err) => {
          /* 编辑失败仍刷新：422（空/超 8000 字）、409（TASK_WAKEUP 系统通知
             条目——bar 已隐藏其 ✎，此处属双保险）静默，以服务端 load 结果为准 */
          notifyUnlessReconcile(err, "保存修改失败");
        })
        .then(() => load(sessionId));
    },
    [sessionId, load, notifyUnlessReconcile],
  );

  const dispatchNowEntry = useCallback(
    (id: string) => {
      if (sessionId === "") return;
      void dispatchNowSessionQueueEntry(sessionId, id)
        .catch((err) => {
          /* 立即派发失败仍刷新（409 会话非 active 等竞态静默；不消费响应
             interrupted——R-04：UI 收敛统一依赖 SSE queue_changed + 本处 load） */
          notifyUnlessReconcile(err, "立即发送失败");
        })
        .then(() => load(sessionId));
    },
    [sessionId, load, notifyUnlessReconcile],
  );

  return {
    queue,
    removeEntry,
    retryEntry,
    reorderEntry,
    editEntry,
    dispatchNowEntry,
    isQueueFull: queue.length >= QUEUE_MAX_PENDING,
    queueCount: queue.length,
    refresh,
  };
}
