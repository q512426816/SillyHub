/**
 * notifications — 站内通知前端数据层（2026-08-29-approval-notify-push task-10）。
 *
 * 组成：
 *   - 四个 REST fetch 函数（列表 / 未读数 / 单条已读 / 全部已读），类型全部取
 *     api-types.ts 生成物（NotificationRead / NotificationListResponse /
 *     UnreadCountResponse / ReadAllResponse），禁止手写接口形状（R-08）。
 *   - useNotifications / useUnreadCount：useQuery 三件套惯例；**无
 *     refetchInterval**（D-005@v1 铁律）——实时性由 useNotificationsStream 的
 *     SSE 事件驱动 invalidate + refetchOnWindowFocus 兜底。
 *   - useNotificationsStream：订阅 GET /api/notifications/events（fetch-sse，
 *     token 走 Authorization header，先例 daemon.ts subscribeAgentSessionsEvents），
 *     notification 命名事件 → invalidate notifications 全部 key；连接建立
 *     （含重连成功）→ 再 invalidate 一次补拉断线期间漏发（无 Last-Event-ID
 *     回放，D-003@v2，对齐 session-permission-panel fireConnectedOnce 先例）。
 *
 * 退避重连与永久停连照 session-permission-panel.tsx 内联先例
 * （PERMANENT_SSE_ERROR_STATUSES={401,403,404} ql-20260829-005）：
 * 401/403/404 停连不重试；网络错误 / 流中断 / 5xx 指数退避（复用 daemon.ts
 * RECONNECT_BACKOFF_MS，上限 30s），收到事件即退避档位归零。
 */
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, apiFetch, getApiBaseUrl } from "@/lib/api";
import type { components } from "@/lib/api-types";
import { RECONNECT_BACKOFF_MS } from "@/lib/daemon";
import { fetchSse } from "@/lib/fetch-sse";
import { queryKeys } from "@/lib/query-keys";
import { useSession } from "@/stores/session";

/* ------------------------------------------------------------------ */
/*  Types（api-types 生成物单一来源）                                    */
/* ------------------------------------------------------------------ */

/** 单条通知视图（task-07 契约）。 */
export type NotificationRead = components["schemas"]["NotificationRead"];
/** 列表分页响应 {items, total}。 */
export type NotificationListResponse =
  components["schemas"]["NotificationListResponse"];
/** 未读数响应 {count}。 */
export type UnreadCountResponse = components["schemas"]["UnreadCountResponse"];
/** 全部已读响应 {updated}。 */
export type ReadAllResponse = components["schemas"]["ReadAllResponse"];

/** 列表查询参数（query-keys.ts list key 复用）。 */
export interface NotificationListParams {
  limit?: number;
  offset?: number;
  unread_only?: boolean;
}

/* ------------------------------------------------------------------ */
/*  API functions                                                      */
/* ------------------------------------------------------------------ */

/** 本人通知列表（created_at DESC）+ 总数。 */
export function listNotifications(params: NotificationListParams = {}) {
  return apiFetch<NotificationListResponse>("/api/notifications", {
    query: {
      limit: params.limit,
      offset: params.offset,
      unread_only: params.unread_only,
    },
  });
}

/** 本人未读数（徽标首载/兜底）。 */
export function getUnreadCount() {
  return apiFetch<UnreadCountResponse>("/api/notifications/unread-count");
}

/** 单条标记已读；非本人或不存在 → 404。 */
export function markNotificationRead(notificationId: string) {
  return apiFetch<NotificationRead>(
    `/api/notifications/${notificationId}/read`,
    { method: "POST" },
  );
}

/** 全部已读，返回更新行数。 */
export function markAllNotificationsRead() {
  return apiFetch<ReadAllResponse>("/api/notifications/read-all", {
    method: "POST",
  });
}

/* ------------------------------------------------------------------ */
/*  Hooks（无 refetchInterval 铁律，D-005@v1）                          */
/* ------------------------------------------------------------------ */

/** 默认首载 20 条（design §7.4）。 */
const DEFAULT_LIST_LIMIT = 20;

/**
 * 通知列表查询。params 进 key（过滤/分页变化即新查询）；refetchOnWindowFocus
 * true 聚焦兜底（Redis 降级链 §10）；**不设 refetchInterval**——实时刷新由
 * useNotificationsStream 的 SSE 事件 invalidate 驱动。
 */
export function useNotifications(params: NotificationListParams = {}) {
  const q = useQuery<NotificationListResponse, ApiError>({
    queryKey: queryKeys.notifications.list(params),
    queryFn: () => listNotifications(params),
    refetchOnWindowFocus: true,
  });
  return {
    items: q.data?.items ?? [],
    total: q.data?.total ?? 0,
    isLoading: q.isLoading,
    isFetching: q.isFetching,
    isError: q.isError,
    error: q.error,
    refetch: q.refetch,
  };
}

/** 未读数查询（徽标）。同 useNotifications：聚焦兜底、无轮询。 */
export function useUnreadCount() {
  const q = useQuery<UnreadCountResponse, ApiError>({
    queryKey: queryKeys.notifications.unreadCount,
    queryFn: () => getUnreadCount(),
    refetchOnWindowFocus: true,
  });
  return {
    count: q.data?.count ?? 0,
    isLoading: q.isLoading,
    isFetching: q.isFetching,
    isError: q.isError,
    error: q.error,
    refetch: q.refetch,
  };
}

/* ------------------------------------------------------------------ */
/*  SSE 订阅（事件驱动 invalidate）                                     */
/* ------------------------------------------------------------------ */

/**
 * 永久性 SSE HTTP 错误码（对齐 session-permission-panel.tsx:81 /
 * ql-20260829-005）：401 凭证失效 / 403 无权限 / 404 端点不存在。这些状态
 * 重试永远不会再成功，命中即停重连循环；网络错误 / 流中断 / 5xx 不在名单，
 * 照旧退避重连。
 */
const PERMANENT_SSE_ERROR_STATUSES = new Set([401, 403, 404]);

/**
 * 订阅通知 SSE 流（纯函数订阅器，hook 内 useEffect 消费；抽出便于单测）。
 *
 * - onEvent：收到 ``event: notification`` 帧（data=通知摘要 JSON）触发——本函数
 *   不解析载荷内容（前端只需失效重拉，data 仅做 JSON 可解析性检查防坏帧炸流，
 *   解析失败静默忽略）。
 * - onConnected：连接建立（onopen）触发，每个连接周期恰一次——调用方 invalidate
 *   一次补拉（首连兜「先快照后订阅」窗口；重连成功兜断线期间漏发，无
 *   Last-Event-ID 回放 D-003@v2）。
 * - close()：幂等终止（关连接 + 清退避定时器），之后不再重连。
 */
export function subscribeNotificationsEvents(opts: {
  onEvent: () => void;
  onConnected: () => void;
}): { close: () => void } {
  const url = `${getApiBaseUrl()}/api/notifications/events`;

  let es: ReturnType<typeof fetchSse> | null = null;
  let closed = false; // 调用方 close() 后不再重连
  let retryCount = 0; // 退避档位（收到事件归零）
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let connectedFired = false; // 本连接周期 onConnected 已发（onopen 触发）

  const fireConnectedOnce = () => {
    if (connectedFired) return;
    connectedFired = true;
    opts.onConnected();
  };

  const wireConnection = () => {
    connectedFired = false;
    // token 每次重连现取（对齐 daemon.ts streamSession：长连接跨 token 刷新后
    // 重连不带旧值）。EventSource 不支持自定义 header，故必须 fetch-sse。
    const { accessToken } = useSession.getState();
    es = fetchSse(url, accessToken ? { token: accessToken } : {});
    es.onopen = () => {
      fireConnectedOnce();
    };
    // backend 通知走命名事件 ``event: notification``（data=通知摘要 JSON）；
    // ``connected`` 初始帧与 25s keepalive 注释帧由 fetch-sse 忽略/不分发。
    es.addEventListener("notification", (e) => {
      retryCount = 0; // 收到事件 = 连接健康，退避档位归零
      // 坏帧静默忽略（防 JSON 解析异常炸流）；前端只做失效，不消费载荷。
      try {
        JSON.parse(e.data);
      } catch {
        return;
      }
      fireConnectedOnce();
      opts.onEvent();
    });
    es.onerror = (ev) => {
      // 401/403/404 永久失败：停连不重试（对齐 session-permission-panel
      // PERMANENT_SSE_ERROR_STATUSES）。token 刷新后组件重挂载自然重开。
      if (ev.status !== undefined && PERMANENT_SSE_ERROR_STATUSES.has(ev.status)) {
        return;
      }
      scheduleReconnect();
    };
  };

  const scheduleReconnect = () => {
    if (closed) return;
    const delay =
      RECONNECT_BACKOFF_MS[
        Math.min(retryCount, RECONNECT_BACKOFF_MS.length - 1)
      ]!;
    retryCount += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (!closed) wireConnection();
    }, delay);
  };

  wireConnection();

  return {
    close: () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      es?.close();
    },
  };
}

/**
 * 通知实时流 hook：挂载即订阅（hook 内部 useEffect 自管理生命周期），收到
 * notification 事件或（重）连接建立即 invalidate notifications 全部 key——列表
 * 与未读数共用前缀，一次失效双拉（D-005@v1 事件驱动，全链路无轮询）。
 *
 * 组件卸载时关闭连接并清退避定时器；多处挂载各自独立连接（铃铛唯一消费端，
 * task-11）。
 */
export function useNotificationsStream(): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    const sub = subscribeNotificationsEvents({
      onEvent: () => {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.notifications.all,
        });
      },
      onConnected: () => {
        // 连接建立（首连 + 每次重连成功）补拉一次：兜「先快照后订阅」窗口与
        // 断线期间漏发（无 Last-Event-ID 回放，D-003@v2 Non-Goal）。
        void queryClient.invalidateQueries({
          queryKey: queryKeys.notifications.all,
        });
      },
    });
    return () => {
      sub.close();
    };
  }, [queryClient]);
}
