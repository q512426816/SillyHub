"use client";

/**
 * task-08（FR-07 / D-007@v1）：canUseTool 远程人审审批卡组件。
 *
 * 借鉴 workspaces/[id]/approvals/page.tsx 的卡片风格（tool_name + 摘要 +
 * allow/deny 按钮），但 session permission 是会话内瞬态链路，不接 worktree
 * lease policy。组件职责单一：展示一条 permission_request，用户点击 allow/deny
 * 后调 respondSessionPermission；父组件负责 SSE 订阅 + permission_resolved 后
 * 移除本卡。
 *
 * 5min 倒计时：基于 createdAt 本地计时（仅 UI 提示），不替代 backend 超时
 * （backend 5min 自动 deny + publish permission_resolved{reason:timeout}）。
 */

import { useEffect, useMemo, useState } from "react";
import { Check, ShieldAlert, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import {
  respondSessionPermission,
  type SessionPermissionRequest,
} from "@/lib/daemon";
import { cn } from "@/lib/utils";

/** 5min 倒计时窗口（ms），与 backend PERMISSION_TIMEOUT_SEC 对齐（仅 UI 提示）。 */
const PERMISSION_WINDOW_MS = 5 * 60 * 1000;

export interface PermissionApprovalCardProps {
  request: SessionPermissionRequest;
  /** 卡片被移除时回调（permission_resolved SSE / 父组件清空时触发）。 */
  onResolved?: (requestId: string, decision: "allow" | "deny") => void;
}

/**
 * 把工具 input 摘要成单行字符串（前 N 字符）。隐私：仅展示结构化字段，
 * 不展开完整 prompt/token（与 daemon 日志只记 request_id/tool_name 一致）。
 */
function summarizeInput(input: Record<string, unknown>): string {
  const entries = Object.entries(input).slice(0, 4);
  const parts = entries.map(([k, v]) => {
    const val =
      typeof v === "string"
        ? v.length > 60
          ? v.slice(0, 60) + "…"
          : v
        : JSON.stringify(v);
    return `${k}=${val}`;
  });
  if (Object.keys(input).length > 4) parts.push(`+${Object.keys(input).length - 4}…`);
  return parts.join("  ");
}

function formatCountdown(remainingMs: number): string {
  if (remainingMs <= 0) return "已超时";
  const totalSec = Math.floor(remainingMs / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function PermissionApprovalCard({
  request,
  onResolved,
}: PermissionApprovalCardProps) {
  const [submitting, setSubmitting] = useState<"allow" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // 倒计时：每秒更新一次（仅 UI 提示，backend 5min 超时是真相源）。
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const createdAt = useMemo(() => Date.now(), []);
  const elapsed = now - createdAt;
  const remaining = PERMISSION_WINDOW_MS - elapsed;
  const expired = remaining <= 0;

  const summary = useMemo(
    () => summarizeInput(request.input ?? {}),
    [request.input],
  );

  const handleRespond = async (decision: "allow" | "deny") => {
    if (submitting || expired) return;
    setSubmitting(decision);
    setError(null);
    try {
      await respondSessionPermission(
        request.session_id,
        request.request_id,
        decision,
      );
      // 成功送达 backend；permission_resolved SSE 到达后父组件移除本卡。
      onResolved?.(request.request_id, decision);
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.message : "提交失败，请重试";
      setError(msg);
      setSubmitting(null);
    }
  };

  return (
    <article
      className={cn(
        "overflow-hidden rounded-md border bg-card shadow-sm",
        expired && "opacity-70",
      )}
      data-request-id={request.request_id}
    >
      <header className="flex items-start justify-between gap-2 border-b bg-amber-50/60 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-amber-100 text-amber-700">
            <ShieldAlert className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-foreground">
                工具调用审批
              </span>
              <Badge variant="warning" className="px-1.5 py-0 text-[10px]">
                {request.tool_name}
              </Badge>
            </div>
            <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
              {request.request_id.slice(0, 12)}…
            </p>
          </div>
        </div>
        <span
          className={cn(
            "shrink-0 font-mono text-[11px] tabular-nums",
            remaining < 60_000
              ? "text-destructive"
              : "text-muted-foreground",
          )}
          title="5 分钟未响应将自动拒绝"
        >
          {formatCountdown(remaining)}
        </span>
      </header>

      <div className="px-3 py-2">
        <p className="text-[11px] font-medium uppercase text-muted-foreground">
          工具参数
        </p>
        <pre className="mt-1 max-h-24 overflow-auto rounded bg-muted/40 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-foreground whitespace-pre-wrap break-words">
          {summary || "(无参数)"}
        </pre>
        {error && (
          <p className="mt-2 text-[11px] text-destructive" role="alert">
            {error}
          </p>
        )}
      </div>

      <footer className="flex items-center justify-end gap-2 border-t bg-muted/20 px-3 py-2">
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1 px-2.5 text-[11px]"
          disabled={submitting !== null || expired}
          onClick={() => void handleRespond("deny")}
          title="拒绝该工具调用"
        >
          <X className="h-3.5 w-3.5" />
          {submitting === "deny" ? "提交中" : "拒绝"}
        </Button>
        <Button
          size="sm"
          className="h-7 gap-1 px-2.5 text-[11px]"
          disabled={submitting !== null || expired}
          onClick={() => void handleRespond("allow")}
          title="允许该工具调用"
        >
          <Check className="h-3.5 w-3.5" />
          {submitting === "allow" ? "提交中" : "允许"}
        </Button>
      </footer>
    </article>
  );
}
