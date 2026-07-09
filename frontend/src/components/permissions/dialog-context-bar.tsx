"use client";

/**
 * DialogContextBar（2026-07-09-ask-user-question-approval task-08 / design §4.4 / D-002）。
 *
 * 作为 AskUserDialogCard / PermissionApprovalCard 的**兄弟包裹层**：在卡片上方渲染
 * 来源上下文条（工作区名 · 场景 badge · 会话链接 · 运行链接 · 时间 · run_summary
 * 一句话）+ 卡头「查看会话 →」跳转入口。父组件 SessionPermissionPanel 负责 map 时
 * 用本组件包裹实际审批卡，**不侵入**卡组件内部（design §4.4 / C5），保持
 * AskUserDialogCard / PermissionApprovalCard 的 props 契约零改动。
 *
 * 跳转目标（design §4.4 C8 + R-2）：会话链接 → /runtimes?session=<session_id>
 * （runtime 页是全局 /runtimes，用 ?session= query 定位 session 弹窗，
 * runtimes/page.tsx:812 searchParams.get("session") 已解析）。运行链接同指
 * 会话详情（会话视图含跨 run 日志，run_id 在其中可见；当前无独立 runs 路由）。
 *
 * 来源字段（workspace_name / session_type / run_summary）由 task-05 的
 * SessionPermissionRequest 扩展提供，查询路（listWorkspaceDialogs）齐全，
 * SSE 路缺省→本组件渲染占位（design §4.4 C4）：
 *   - workspace_name 缺省 → 「工作区」
 *   - session_type 缺省 → badge「加载中」
 *   - run_summary 缺省/null/空串 → 「会话进行中」
 */

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight, Clock } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { SessionPermissionRequest } from "@/lib/daemon";

/** session_type 三态映射为中文 badge 文案 + 配色（design D-003）。 */
const SESSION_TYPE_META: Record<
  NonNullable<SessionPermissionRequest["session_type"]>,
  { label: string; variant: "info" | "default" | "success" }
> = {
  scan: { label: "扫描", variant: "info" },
  chat: { label: "对话", variant: "default" },
  stage: { label: "阶段", variant: "success" },
};

/** session_type 推导为纯函数（便于测试 + 缺省占位「加载中」）。 */
export function resolveSessionTypeBadge(
  sessionType: SessionPermissionRequest["session_type"],
): { label: string; variant: "info" | "default" | "success" } {
  if (sessionType && SESSION_TYPE_META[sessionType]) {
    return SESSION_TYPE_META[sessionType];
  }
  // SSE 路来源缺省：占位「加载中」（design §4.4 C4 / AC-5）。
  return { label: "加载中", variant: "default" };
}

/** 截断 session_id 用于展示（技术标识不翻译，CLAUDE.md §11）。 */
function truncateId(id: string, len = 8): string {
  if (!id) return "";
  return id.length <= len ? id : `${id.slice(0, len)}…`;
}

/** created_at 本地化显示；缺省回退为「刚刚」。 */
function formatTime(createdAt?: string): string {
  if (!createdAt) return "刚刚";
  const ts = Date.parse(createdAt);
  if (Number.isNaN(ts)) return "刚刚";
  const diffMs = Date.now() - ts;
  if (diffMs < 60_000) return "刚刚";
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)} 分钟前`;
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)} 小时前`;
  return new Date(ts).toLocaleString();
}

export interface DialogContextBarProps {
  request: SessionPermissionRequest;
  /** 被包裹的实际审批卡（AskUserDialogCard / PermissionApprovalCard）。 */
  children: ReactNode;
}

export function DialogContextBar({
  request,
  children,
}: DialogContextBarProps) {
  const sessionType = resolveSessionTypeBadge(request.session_type);
  const workspaceName = request.workspace_name?.trim() || "工作区";
  const summary =
    request.run_summary && request.run_summary.trim()
      ? request.run_summary.trim()
      : "会话进行中";
  const sessionHref = `/runtimes?session=${encodeURIComponent(request.session_id)}`;
  // 运行链接：同指会话详情页（会话视图含跨 run 日志；当前无独立 runs 路由）。
  // 带 run_id 作 hash 标识，便于会话视图未来按 run 定位（不影响当前跳转）。
  const runHref = `/runtimes?session=${encodeURIComponent(request.session_id)}#run-${encodeURIComponent(request.run_id)}`;

  return (
    <article
      className="overflow-hidden rounded-md border bg-card shadow-sm"
      data-context-request-id={request.request_id}
    >
      <header className="flex items-center justify-between gap-2 border-b bg-slate-50 px-3 py-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="font-semibold text-foreground">{workspaceName}</span>
          <span className="text-slate-300">·</span>
          <Badge variant={sessionType.variant} className="px-1.5 py-0 text-[10px]">
            {sessionType.label}
          </Badge>
          <span className="text-slate-300">·</span>
          <span>
            会话{" "}
            <Link
              href={sessionHref}
              className="font-mono text-[11px] text-blue-700 hover:underline"
              title={`跳转到会话 ${request.session_id}`}
              data-context-link="session"
            >
              {truncateId(request.session_id)}
            </Link>
          </span>
          <span className="text-slate-300">·</span>
          <span>
            运行{" "}
            <Link
              href={runHref}
              className="font-mono text-[11px] text-blue-700 hover:underline"
              title={`跳转到运行 ${request.run_id}`}
              data-context-link="run"
            >
              {truncateId(request.run_id)}
            </Link>
          </span>
          <span className="text-slate-300">·</span>
          <span className="inline-flex items-center gap-0.5">
            <Clock className="h-3 w-3" />
            {formatTime(request.created_at)}
          </span>
        </div>
        <Link
          href={sessionHref}
          className="inline-flex shrink-0 items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-medium text-blue-700 hover:bg-blue-50"
          title="跳转到会话详情"
          data-context-link="view-session"
        >
          查看会话
          <ArrowUpRight className="h-3 w-3" />
        </Link>
      </header>

      <div className="flex items-start gap-1.5 border-b bg-slate-50/60 px-3 py-1.5 text-[11px] text-muted-foreground">
        <span className="shrink-0 font-semibold text-foreground">上下文：</span>
        <span className="min-w-0 break-words" data-context-summary>
          {summary}
        </span>
      </div>

      {/* 被包裹的实际审批卡（不侵入卡组件内部，design §4.4 / C5） */}
      <div className="p-2">{children}</div>
    </article>
  );
}
