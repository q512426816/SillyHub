"use client";

/**
 * verify P1 返工（2026-08-24-platform-session-feedback-fix / FR-03 / D-002@v1）：
 * 后台 Agent 任务卡片。
 *
 * 接收 agent_task_status 事件（Task/Agent 工具派发的子代理任务）聚合后的状态
 * props，展示任务名、状态（running / completed / failed）与可选进度（0~100）。
 * FR-03 边界：仅展示任务级状态，不展示任务内部细节（日志走既有工具卡）。
 *
 * 组件纯展示，不发起 SSE / HTTP 请求。颜色走状态语义阶，适配 AI-Native 双主题。
 */

import { Bot, Check, Loader2, X } from "lucide-react";

import { cn } from "@/lib/utils";

export interface AgentTaskCardProps {
  taskId: string;
  taskName: string;
  status: "running" | "completed" | "failed";
  progress?: number | null;
  message?: string | null;
}

function statusIcon(status: AgentTaskCardProps["status"]) {
  switch (status) {
    case "running":
      return <Loader2 className="h-3.5 w-3.5 animate-spin" />;
    case "completed":
      return <Check className="h-3.5 w-3.5" />;
    case "failed":
      return <X className="h-3.5 w-3.5" />;
  }
}

function statusClasses(status: AgentTaskCardProps["status"]) {
  switch (status) {
    case "running":
      return "bg-brand-100 text-brand-700";
    case "completed":
      return "bg-success/15 text-success";
    case "failed":
      return "bg-error/15 text-error";
  }
}

function statusLabel(status: AgentTaskCardProps["status"]) {
  switch (status) {
    case "running":
      return "运行中";
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
  }
}

export function AgentTaskCard({
  taskId,
  taskName,
  status,
  progress,
  message,
}: AgentTaskCardProps) {
  // progress 归一到 0~100 的整数显示；null / 非法值不渲染进度条。
  const normalizedProgress =
    typeof progress === "number" && Number.isFinite(progress)
      ? Math.min(100, Math.max(0, Math.round(progress)))
      : null;

  return (
    <article
      className="overflow-hidden rounded-md border bg-card shadow-sm"
      data-testid="agent-task-card"
      data-status={status}
      data-task-id={taskId}
    >
      <div className="flex items-start justify-between gap-2 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              "flex h-7 w-7 shrink-0 items-center justify-center rounded",
              statusClasses(status),
            )}
          >
            {statusIcon(status)}
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <Bot className="h-3 w-3 shrink-0 text-muted-foreground" />
              <span
                className="truncate text-xs font-semibold text-foreground"
                title={taskName}
              >
                {taskName || "后台任务"}
              </span>
            </div>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              后台任务 · {statusLabel(status)}
            </p>
          </div>
        </div>
        {status === "running" && (
          <span className="shrink-0 rounded bg-brand-100 px-1.5 py-0 text-[10px] font-medium text-brand-700">
            后台任务进行中
          </span>
        )}
      </div>

      {normalizedProgress !== null && status === "running" && (
        <div className="px-3 pb-2">
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-brand-500 transition-all"
              style={{ width: `${normalizedProgress}%` }}
              role="progressbar"
              aria-valuenow={normalizedProgress}
              aria-valuemin={0}
              aria-valuemax={100}
            />
          </div>
          <p className="mt-1 text-right text-[10px] tabular-nums text-muted-foreground">
            {normalizedProgress}%
          </p>
        </div>
      )}

      {message && (
        <p className="border-t bg-muted/20 px-3 py-1.5 text-[11px] text-muted-foreground">
          {message}
        </p>
      )}
    </article>
  );
}
