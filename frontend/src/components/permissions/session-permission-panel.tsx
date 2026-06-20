"use client";

/**
 * scan 真阻塞（generic-wibbling-whisper.md 改造点 F）：会话级实时审批聚合面板。
 *
 * 接收 sessionIds 列表（workspace 维度 active scan sessions），为每个 session 开 SSE
 * 订阅 permission_request / permission_resolved，聚合到统一的待决策卡片列表。单卡
 * 交互复用 PermissionApprovalCard（自调 respondSessionPermission + onResolved 回调）。
 *
 * 供 approvals 审批中心页嵌入——让 scan 歧义 AskUserQuestion 决策在统一审核页可见 +
 * 可反馈，无需用户粘 sessionId 跳 runtimes 页。
 */

import { useEffect, useRef, useState } from "react";
import { ShieldAlert } from "lucide-react";

import { PermissionApprovalCard } from "@/components/permission-approval-card";
import { Badge } from "@/components/ui/badge";
import { getApiBaseUrl } from "@/lib/api";
import {
  parseSessionPermissionEvent,
  type SessionPermissionRequest,
} from "@/lib/daemon";
import { useSession } from "@/stores/session";

export interface SessionPermissionPanelProps {
  sessionIds: string[];
}

export function SessionPermissionPanel({
  sessionIds,
}: SessionPermissionPanelProps) {
  const [cards, setCards] = useState<SessionPermissionRequest[]>([]);
  const accessToken = useSession((s) => s.accessToken);
  const sourcesRef = useRef<Map<string, EventSource>>(new Map());

  // sessionIds 变化时重建所有 SSE 订阅。
  useEffect(() => {
    sourcesRef.current.forEach((es) => es.close());
    sourcesRef.current.clear();
    setCards([]);

    const base = getApiBaseUrl();
    for (const sid of sessionIds) {
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
            setCards((prev) =>
              prev.some((c) => c.request_id === req.request_id)
                ? prev
                : [...prev, req],
            );
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
  }, [sessionIds, accessToken]);

  if (sessionIds.length === 0) {
    return null; // 无活跃 scan session 时不渲染（保持 approvals 页整洁）
  }

  return (
    <section className="rounded-md border bg-card">
      <header className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-amber-600" />
          <div>
            <h2 className="text-sm font-semibold">
              会话级实时审批（scan 歧义询问）
            </h2>
            <p className="text-[11px] text-muted-foreground">
              订阅 {sessionIds.length} 个 scan 会话 · AskUserQuestion 决策实时聚合
            </p>
          </div>
        </div>
        <Badge variant="outline">{cards.length} 待决策</Badge>
      </header>
      <div className="space-y-2 p-3">
        {cards.length === 0 ? (
          <p className="py-6 text-center text-[11px] text-muted-foreground">
            暂无待决策的 scan 询问（agent 遇歧义时会在此弹出）
          </p>
        ) : (
          cards.map((req) => (
            <PermissionApprovalCard
              key={req.request_id}
              request={req}
              onResolved={(requestId) =>
                setCards((prev) =>
                  prev.filter((c) => c.request_id !== requestId),
                )
              }
            />
          ))
        )}
      </div>
    </section>
  );
}
