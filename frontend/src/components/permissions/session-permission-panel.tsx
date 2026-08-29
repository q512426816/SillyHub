"use client";

/**
 * SessionPermissionPanel（2026-07-09-ask-user-question-approval task-07/08 改造）。
 *
 * scan 真阻塞（generic-wibbling-whisper.md 改造点 F）会话级实时审批聚合面板，本次改造：
 *   1. 渲染按 dialog_kind 分流（design §4.2）：有 → AskUserDialogCard（结构化问答）；
 *      无 → PermissionApprovalCard（allow/deny）。
 *   2. SSE 实时推入与查询兜底（pendingFallback prop，task-06 listWorkspaceDialogs）
 *      按 request_id 合并——查询回填的来源字段（workspace_name/session_type/
 *      run_summary/created_at）覆盖 SSE 占位（design §4.4 C4：查询覆盖 SSE，不反向）。
 *   3. 每张卡用 DialogContextBar（task-08）作兄弟包裹层渲染来源上下文条 + 跳转入口，
 *      不侵入卡组件内部（design §4.4 / C5）。
 *   4. task-08（2026-08-24-platform-session-feedback-fix FR-04 / D-003@v1）：卡片可
 *      最小化为右下角浮动胶囊（未决角标 + 最近一条标题），wrapper hidden 切显隐、
 *      卡组件不卸载 → 已填内容保留；permission_resolved 经 removeCard 同步清胶囊计数。
 *   5. task-09（2026-08-29-daemon-platform-resilience / design A6）：SSE 断线无限
 *      退避自动重连（共享 RECONNECT_BACKOFF_MS 档位，subscribeAgentSessionsEvents
 *      先例）+ 重连成功补拉该会话 pending dialogs（既有 REST，幂等合并）——替换
 *      onerror 空处理仅靠 refetchInterval 兜底的现状（refetchInterval 保留双保险）。
 *
 * 仍接收 sessionIds 列表为每个 session 开 SSE 订阅 permission_request /
 * permission_resolved，聚合到统一的待决策卡片列表。permission_resolved（decision 字段）
 * 按 request_id 移除卡片（既有逻辑保留）。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ShieldAlert } from "lucide-react";

import { AskUserDialogCard } from "@/components/ask-user-dialog-card";
import { PermissionApprovalCard } from "@/components/permission-approval-card";
import { DialogContextBar } from "@/components/permissions/dialog-context-bar";
// ql-20260825-006：右下角胶囊 + 标题推导抽为共享组件（TurnTimeline 复用），
// resolvePendingTitle 原地 re-export 保持本模块既有导出面不变。
import {
  MinimizedDialogCapsule,
  resolvePendingTitle,
} from "@/components/permissions/minimized-dialog-capsule";
export { resolvePendingTitle };
import { Badge } from "@/components/ui/badge";
import { getApiBaseUrl } from "@/lib/api";
import {
  fetchPendingDialogs,
  parseSessionPermissionEvent,
  RECONNECT_BACKOFF_MS,
  type SessionPermissionRequest,
} from "@/lib/daemon";
import { fetchSse, type FetchSseConnection, type FetchSseEvent } from "@/lib/fetch-sse";
import { useSession } from "@/stores/session";

export interface SessionPermissionPanelProps {
  /** 订阅 SSE 的 session id 列表（task-06: scan + chat 活跃会话）。 */
  sessionIds: string[];
  /**
   * 数据库兜底（task-06 listWorkspaceDialogs 结果）：workspace 维度 pending
   * AskUserQuestion 对话查询。与 SSE 实时增量按 request_id 合并，刷新不丢（FR-5）。
   * 来源字段齐全，覆盖 SSE 占位（design §4.4 C4）。
   */
  pendingFallback?: SessionPermissionRequest[];
  /** workspace 名（task-06 page 本地补全 SSE 路缺省的 workspace_name，design §4.4）。 */
  workspaceName?: string;
}

/**
 * NFR-1 / R-1 / C10（task-10 性能上限）：SSE 连接数硬上限。
 *
 * workspace 下 active session 超过此上限时，仅对前 N 个开 EventSource，其余不订阅
 * （对齐后端 ``list_workspace_active_sessions`` 的 limit=50）。超出部分靠
 * ``GET /workspaces/{id}/dialogs`` refetchInterval 兜底（task-06 已实现），避免浏览器
 * 同时维护上百条长连接导致资源耗尽。
 */
const MAX_SESSION_SSE = 50;

/**
 * 合并 SSE 实时增量与查询兜底（design §4.4 C4）——纯函数，便于测试。
 *
 * 规则：按 request_id 幂等合并。
 *   - 新数据（fromQuery=true，来源字段齐全）覆盖同 id 旧数据（SSE 占位）的来源字段；
 *   - 旧数据已有真实来源字段时不被 SSE 占位（undefined）反向覆盖（C4：查询覆盖 SSE，
 *     不反向）；
 *   - 同 id 均缺来源字段：保留旧数据，仅补齐 fromQuery 带来的真实值。
 */
export function mergeDialogRequests(
  prev: SessionPermissionRequest[],
  incoming: SessionPermissionRequest,
  fromQuery = false,
): SessionPermissionRequest[] {
  const idx = prev.findIndex((c) => c.request_id === incoming.request_id);
  if (idx === -1) {
    return [...prev, incoming];
  }
  const oldCard = prev[idx]!;
  // 查询覆盖 SSE 占位：来源字段仅当新值有值且旧值无值时回填（不反向覆盖）。
  const merged: SessionPermissionRequest = {
    ...oldCard,
    ...(incoming.workspace_name
      ? { workspace_name: incoming.workspace_name }
      : {}),
    ...(incoming.session_type ? { session_type: incoming.session_type } : {}),
    ...(incoming.run_summary !== undefined &&
    incoming.run_summary !== null
      ? { run_summary: incoming.run_summary }
      : {}),
    ...(incoming.created_at ? { created_at: incoming.created_at } : {}),
    // dialog 字段：SSE 与查询都应携带；以查询为准（齐全），否则保留旧值。
    ...(fromQuery && incoming.dialog_kind
      ? { dialog_kind: incoming.dialog_kind }
      : {}),
    ...(fromQuery && incoming.dialog_payload
      ? { dialog_payload: incoming.dialog_payload }
      : {}),
  };
  const next = prev.slice();
  next[idx] = merged;
  return next;
}

/**
 * task-08（FR-04 / D-003@v1）：最小化胶囊标题——dialog 卡取第一个非空问题文本，
 * 普通审批卡取 tool_name。纯函数便于测试。ql-20260825-006 迁至共享组件文件，
 * 此处 re-export（上方 import 行）保持既有导出面。
 */

export function SessionPermissionPanel({
  sessionIds,
  pendingFallback,
  workspaceName,
}: SessionPermissionPanelProps) {
  const [cards, setCards] = useState<SessionPermissionRequest[]>([]);
  const accessToken = useSession((s) => s.accessToken);
  // task-08（FR-04 / D-003@v1）：最小化卡片集合（会话内存态，不持久化）。
  // 最小化只切 wrapper 的 hidden，不卸载卡组件子树 → AskUserDialogCard /
  // PermissionApprovalCard 已填 state 保留（design D-003）。胶囊展开态已随
  // ql-20260825-006 迁入共享 MinimizedDialogCapsule 组件内部自持。
  const [minimizedIds, setMinimizedIds] = useState<Set<string>>(new Set());

  /** 从卡片列表移除（permission_resolved SSE / 卡片自提交成功），并同步清最小化集合（胶囊计数不残留）。 */
  const removeCard = useCallback((requestId: string) => {
    setCards((prev) => prev.filter((c) => c.request_id !== requestId));
    setMinimizedIds((prev) => {
      if (!prev.has(requestId)) return prev;
      const next = new Set(prev);
      next.delete(requestId);
      return next;
    });
  }, []);

  /** 卡头最小化按钮 → 加入最小化集合（收缩为右下角胶囊）。 */
  const handleMinimize = useCallback((requestId: string) => {
    setMinimizedIds((prev) => {
      if (prev.has(requestId)) return prev;
      const next = new Set(prev);
      next.add(requestId);
      return next;
    });
  }, []);

  /** 胶囊还原 → 从最小化集合移除（卡片回列表原位置）。 */
  const handleRestore = useCallback((requestId: string) => {
    setMinimizedIds((prev) => {
      if (!prev.has(requestId)) return prev;
      const next = new Set(prev);
      next.delete(requestId);
      return next;
    });
  }, []);
  // task-12：EventSource → fetch-sse 连接句柄（close() 语义不变）。
  const sourcesRef = useRef<Map<string, FetchSseConnection>>(new Map());

  // 查询兜底（pendingFallback）变化时合并进 cards（C4：查询覆盖 SSE 占位）。
  useEffect(() => {
    if (!pendingFallback || pendingFallback.length === 0) return;
    setCards((prev) => {
      let acc = prev;
      for (const req of pendingFallback) {
        // 补全 workspace_name（page 侧本地补全 SSE 缺省字段）。
        const enriched: SessionPermissionRequest = workspaceName && !req.workspace_name
          ? { ...req, workspace_name: workspaceName }
          : req;
        acc = mergeDialogRequests(acc, enriched, true);
      }
      return acc;
    });
  }, [pendingFallback, workspaceName]);

  // sessionIds 变化时重建所有 SSE 订阅。
  useEffect(() => {
    sourcesRef.current.forEach((es) => es.close());
    sourcesRef.current.clear();
    setCards([]);
    // task-08：会话集合重建时同步清最小化态（胶囊不残留旧会话的卡片）。
    setMinimizedIds(new Set());

    const base = getApiBaseUrl();

    /**
     * 单会话订阅（task-09 / design A6：SSE 断线无限退避自动重连）。
     *
     * 模式抄 subscribeAgentSessionsEvents（lib/daemon.ts，共享
     * RECONNECT_BACKOFF_MS 档位表）：fetch-sse 无自动重连（task-12 取舍），
     * 断连期间 Redis Pub/Sub 广播的 permission_* 事件对本连接永久丢失——
     * onerror → 档位退避重建连接（30s 封顶、收到事件归零、永不停表）；
     * 断开过（hadDisconnection）后的下一次「连接成功」（onopen 或首条消息，
     * 先到者）补拉一次该会话 pending dialogs（既有 REST GET /sessions/{id}/
     * dialogs，经 mergeDialogRequests 幂等合并）兜断线窗口丢的请求。替换原
     * onerror 空处理仅靠 refetchInterval 兜底的现状（refetchInterval 仍保留，
     * 双保险）。
     */
    const subscribeSession = (sid: string): (() => void) => {
      let closed = false; // 订阅终止（effect cleanup / sessionIds 重建）后不再重连
      let retryCount = 0; // 退避档位（收到事件归零，对齐 streamSession）
      let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
      let hadDisconnection = false; // 断开过 → 下一次连接成功补拉一次 dialogs
      let connectedFired = false; // 本连接周期「连接成功」已触发（onopen / 首条消息先到者）

      /** 本连接周期恰一次：断开过则补拉 pending dialogs（按 request_id 幂等合并）。 */
      const fireConnectedOnce = () => {
        if (connectedFired) return;
        connectedFired = true;
        if (!hadDisconnection) return;
        hadDisconnection = false;
        void fetchPendingDialogs(sid)
          .then((dialogs) => {
            for (const req of dialogs) {
              // SSE 路来源字段缺省；page 已知 workspaceName 本地补全（同 onmessage）。
              const enriched: SessionPermissionRequest = workspaceName
                ? { ...req, workspace_name: workspaceName }
                : req;
              setCards((prev) => mergeDialogRequests(prev, enriched, false));
            }
          })
          .catch(() => {
            /* 补拉失败静默：refetchInterval / 下一次断连恢复再兜 */
          });
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
          if (!closed) wire();
        }, delay);
      };

      /** data 帧解析（task-09 抽出：首连与每次重连的 onmessage 共用）。 */
      const handleFrame = (e: FetchSseEvent) => {
        try {
          const data = JSON.parse(e.data) as unknown;
          const parsed = parseSessionPermissionEvent(data);
          if (parsed && (parsed as SessionPermissionRequest).tool_name) {
            const req = parsed as SessionPermissionRequest;
            // SSE 路来源字段缺省；page 已知 workspaceName 本地补全 workspace_name。
            const enriched: SessionPermissionRequest = workspaceName
              ? { ...req, workspace_name: workspaceName }
              : req;
            setCards((prev) => mergeDialogRequests(prev, enriched, false));
            return;
          }
          if (parsed && (parsed as { decision?: string }).decision) {
            const resolved = parsed as { request_id: string };
            // task-08：最小化中的卡片同样经 removeCard 移除并清胶囊计数。
            removeCard(resolved.request_id);
          }
        } catch {
          // 非 JSON / 非 permission 事件：忽略（其它 SSE 事件类型由订阅方自行处理）
        }
      };

      const wire = () => {
        const url = new URL(`${base}/api/daemon/sessions/${sid}/stream`);
        // task-12：token 不再拼 URL query（访问日志明文泄漏），fetch-sse 放
        // Authorization Bearer header。task-09：重连用 effect 闭包的 accessToken
        // ——token 刷新会经 effect deps 重建订阅，重连不带旧值。
        const es = fetchSse(url.toString(), accessToken ? { token: accessToken } : {});
        sourcesRef.current.set(sid, es);
        connectedFired = false; // 新连接周期重置（onopen / 首条消息先到者触发）
        es.onopen = () => {
          fireConnectedOnce();
        };
        es.onmessage = (e) => {
          retryCount = 0; // 收到事件 = 连接健康，退避档位归零
          fireConnectedOnce();
          handleFrame(e);
        };
        es.onerror = () => {
          // 404/401/网络中断：fetch-sse 不自动重连（task-12 取舍）——task-09 起
          // 按退避自动重建（上方 scheduleReconnect），refetchInterval 兜底保留。
          es.close();
          hadDisconnection = true;
          scheduleReconnect();
        };
      };

      wire();
      return () => {
        closed = true;
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
      };
    };

    // task-10 / NFR-1：SSE 连接数硬上限——超出 MAX_SESSION_SSE 的 session 不订阅，
    // 靠 GET /workspaces/{id}/dialogs refetchInterval 兜底（task-06）。
    const unsubscribes = sessionIds
      .slice(0, MAX_SESSION_SSE)
      .map((sid) => subscribeSession(sid));

    return () => {
      for (const unsub of unsubscribes) unsub();
      sourcesRef.current.forEach((es) => es.close());
      sourcesRef.current.clear();
    };
  }, [sessionIds, accessToken, workspaceName, removeCard]);

  // task-08（FR-04 / D-003@v1）：右下角浮动胶囊数据源——最小化中的卡集合
  // （MinimizedDialogCapsule 内取末位为最近一条）。须在 early-return 之前计算。
  const minimizedCards = cards.filter((c) => minimizedIds.has(c.request_id));

  if (sessionIds.length === 0 && (!pendingFallback || pendingFallback.length === 0)) {
    return null; // 无活跃会话且无兜底数据时不渲染（保持 approvals 页整洁）
  }

  return (
    <>
    <section className="rounded-md border bg-card">
      <header className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-amber-600" />
          <div>
            <h2 className="text-sm font-semibold">
              智能体实时询问与审批
            </h2>
            <p className="text-[11px] text-muted-foreground">
              订阅 {sessionIds.length} 个会话 · AskUserQuestion 决策与工具审批实时聚合
            </p>
          </div>
        </div>
        <Badge variant="outline">{cards.length} 待决策</Badge>
      </header>
      <div className="space-y-2 p-3">
        {cards.length === 0 ? (
          <p className="py-6 text-center text-[11px] text-muted-foreground">
            暂无待决策的询问（agent 遇歧义或需授权时会在此弹出）
          </p>
        ) : (
          cards.map((req) => {
            const isMinimized = minimizedIds.has(req.request_id);
            return (
              // task-08：key 在 wrapper、hidden 切 display、子树结构不变 →
              // 最小化/还原只是隐藏与显隐，卡片不重挂载，已填 state 保留。
              <div
                key={req.request_id}
                hidden={isMinimized}
                data-panel-card={req.request_id}
                data-minimized={isMinimized ? "true" : "false"}
              >
                <DialogContextBar request={req}>
                  {req.dialog_kind ? (
                    <AskUserDialogCard
                      request={req}
                      minimized={isMinimized}
                      onMinimize={handleMinimize}
                      onResolved={removeCard}
                    />
                  ) : (
                    <PermissionApprovalCard
                      request={req}
                      minimized={isMinimized}
                      onMinimize={handleMinimize}
                      onResolved={removeCard}
                    />
                  )}
                </DialogContextBar>
              </div>
            );
          })
        )}
      </div>
    </section>

    {/* task-08（FR-04 / D-003@v1）：右下角浮动胶囊——仅当存在最小化卡片时渲染
        （组件内空 items 兜底 null）。ql-20260825-006 换用共享 MinimizedDialogCapsule，
        DOM 与原内联实现逐节点等价（session-permission-minimize 测试口径不变）。 */}
    <MinimizedDialogCapsule
      items={minimizedCards.map((req) => ({
        requestId: req.request_id,
        title: resolvePendingTitle(req),
        isDialog: Boolean(req.dialog_kind),
      }))}
      onRestore={handleRestore}
    />
    </>
  );
}
