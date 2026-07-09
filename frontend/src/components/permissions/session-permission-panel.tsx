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
 *
 * 仍接收 sessionIds 列表为每个 session 开 SSE 订阅 permission_request /
 * permission_resolved，聚合到统一的待决策卡片列表。permission_resolved（decision 字段）
 * 按 request_id 移除卡片（既有逻辑保留）。
 */

import { useEffect, useRef, useState } from "react";
import { ShieldAlert } from "lucide-react";

import { AskUserDialogCard } from "@/components/ask-user-dialog-card";
import { PermissionApprovalCard } from "@/components/permission-approval-card";
import { DialogContextBar } from "@/components/permissions/dialog-context-bar";
import { Badge } from "@/components/ui/badge";
import { getApiBaseUrl } from "@/lib/api";
import {
  parseSessionPermissionEvent,
  type SessionPermissionRequest,
} from "@/lib/daemon";
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

export function SessionPermissionPanel({
  sessionIds,
  pendingFallback,
  workspaceName,
}: SessionPermissionPanelProps) {
  const [cards, setCards] = useState<SessionPermissionRequest[]>([]);
  const accessToken = useSession((s) => s.accessToken);
  const sourcesRef = useRef<Map<string, EventSource>>(new Map());

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

    const base = getApiBaseUrl();
    // task-10 / NFR-1：SSE 连接数硬上限——超出 MAX_SESSION_SSE 的 session 不订阅，
    // 靠 GET /workspaces/{id}/dialogs refetchInterval 兜底（task-06）。
    for (const [i, sid] of sessionIds.entries()) {
      if (i >= MAX_SESSION_SSE) break;
      const url = new URL(`${base}/api/daemon/sessions/${sid}/stream`);
      if (accessToken) url.searchParams.set("token", accessToken);
      const es = new EventSource(url.toString());
      sourcesRef.current.set(sid, es);

      es.onmessage = (e: MessageEvent<string>) => {
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
            setCards((prev) =>
              prev.filter((c) => c.request_id !== resolved.request_id),
            );
          }
        } catch {
          // 非 JSON / 非 permission 事件：忽略（其它 SSE 事件类型由订阅方自行处理）
        }
      };
      es.onerror = () => {
        // 404/401/网络中断：浏览器 EventSource 自动重连，不主动 close。
      };
    }

    return () => {
      sourcesRef.current.forEach((es) => es.close());
      sourcesRef.current.clear();
    };
  }, [sessionIds, accessToken, workspaceName]);

  if (sessionIds.length === 0 && (!pendingFallback || pendingFallback.length === 0)) {
    return null; // 无活跃会话且无兜底数据时不渲染（保持 approvals 页整洁）
  }

  return (
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
          cards.map((req) => (
            <DialogContextBar key={req.request_id} request={req}>
              {req.dialog_kind ? (
                <AskUserDialogCard
                  request={req}
                  onResolved={(requestId) =>
                    setCards((prev) =>
                      prev.filter((c) => c.request_id !== requestId),
                    )
                  }
                />
              ) : (
                <PermissionApprovalCard
                  request={req}
                  onResolved={(requestId) =>
                    setCards((prev) =>
                      prev.filter((c) => c.request_id !== requestId),
                    )
                  }
                />
              )}
            </DialogContextBar>
          ))
        )}
      </div>
    </section>
  );
}
