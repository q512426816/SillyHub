"use client";

/**
 * 后台 Agent 任务卡片（全生命周期）。
 *
 * verify P1 返工（2026-08-24-platform-session-feedback-fix / FR-03）：接收
 * agent_task_status 事件（Task/Agent 工具派发的子代理任务）聚合后的状态
 * props，展示任务名与状态。
 * 2026-08-27-background-subagent-progress / task-12（FR-06 / D-005@v1，视觉
 * 基准 prototype-background-subagent-progress.html 右列）：状态机扩到
 * running → completed / failed / stopped 全生命周期——
 *   - running：「正在做什么」行（last_tool_name + summary 摘要）、走秒
 *     （本地 1s tick + 服务端 elapsed_ms 到达时校准锚点）、tokens / 工具
 *     次数小字；>5 分钟无更新显示橙色「最后活跃 X 分钟前」警示；
 *   - 终态：定格（completed ✓ 绿 / failed ✕ 红 / stopped ■ 灰 + 服务端
 *     elapsed_ms 格式化 mm:ss + summary 首行），不再转圈；
 *   - 百分比进度条仅在存在可信基准（progress 数值）时显示——本变更后端无
 *     任务总量基准，progress 恒 null 不渲染，进度视觉走 tokens 累积文案。
 *
 * FR-03 边界：仅展示任务级状态，不展示任务内部细节（日志走既有工具卡）。
 * 组件纯展示，不发起 SSE / HTTP 请求；每秒 tick 是局部 state（FR-06 经济性，
 * 对齐 SubagentCatalog 先例）。颜色走状态语义阶（brand / success / error /
 * warning / muted），三主题可适配（D-005@v1）。
 */

import { useEffect, useState } from "react";
import { Bot, Check, Clock, FileText, Loader2, Square, X } from "lucide-react";

import { formatTokens } from "@/components/daemon/runtime-card-helpers";
import { formatElapsedMmss } from "@/components/daemon/turn-status-bar";
import { cn } from "@/lib/utils";

/** 「最后活跃」警示门槛：running 态超过该时长无 task_progress 更新，显示橙色提示。 */
export const AGENT_TASK_IDLE_WARN_MS = 5 * 60 * 1000;

export interface AgentTaskCardProps {
  taskId: string;
  taskName: string;
  /** FR-04（task-10）：增补 stopped 终态（用户 / 主代理停止）。 */
  status: "running" | "completed" | "failed" | "stopped";
  progress?: number | null;
  message?: string | null;
  /** ── FR-04 / task-12 生命周期扩展字段（全可选——旧事件缺失 → null 不渲染）── */
  /** 最近一次工具名（「正在做什么」行工具 chip）。 */
  lastToolName?: string | null;
  /** 最近一次 task_progress 摘要 / 终态 summary（展示首行，超长截断）。 */
  summary?: string | null;
  /** 服务端上报的运行时长（running 心跳为校准值，终态为最终用时）。 */
  elapsedMs?: number | null;
  /** 收到携带 elapsedMs 事件的本地时刻（Date.now()）——走秒校准锚点。 */
  elapsedSyncedAt?: number | null;
  /** 首次见到该任务（running 事件）的本地时刻——无 elapsedMs 时的走秒兜底锚点。 */
  startedAt?: number | null;
  /** 最近一次 running 心跳到达的本地时刻——「最后活跃」判定锚点。 */
  lastActivityAt?: number | null;
  /** 终态事件到达的本地时刻——无服务端时长时的终态用时兜底。 */
  terminalAt?: number | null;
  /** 累计 tokens（进度视觉文案）。 */
  totalTokens?: number | null;
  /** 累计工具调用次数。 */
  toolUses?: number | null;
}

function statusIcon(status: AgentTaskCardProps["status"]) {
  switch (status) {
    case "running":
      return <Loader2 className="h-3.5 w-3.5 animate-spin" />;
    case "completed":
      return <Check className="h-3.5 w-3.5" />;
    case "failed":
      return <X className="h-3.5 w-3.5" />;
    case "stopped":
      return <Square className="h-3 w-3" />;
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
    case "stopped":
      return "bg-muted text-muted-foreground";
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
    case "stopped":
      return "已停止";
  }
}

export function AgentTaskCard({
  taskId,
  taskName,
  status,
  progress,
  message,
  lastToolName,
  summary,
  elapsedMs,
  elapsedSyncedAt,
  startedAt,
  lastActivityAt,
  terminalAt,
  totalTokens,
  toolUses,
}: AgentTaskCardProps) {
  const isRunning = status === "running";

  // 每秒 tick（FR-06 局部 state，对齐 SubagentCatalog 先例）：仅 running 启动，
  // 转终态 / 卸载即清理——走秒与「最后活跃」共用同一 tick。
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!isRunning) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [isRunning]);

  // progress 归一到 0~100 的整数显示；null / 非法值不渲染进度条（无可信基准
  // 不伪造百分比，本变更 progress 恒 null——进度视觉走下方 tokens 累积文案）。
  const normalizedProgress =
    typeof progress === "number" && Number.isFinite(progress)
      ? Math.min(100, Math.max(0, Math.round(progress)))
      : null;

  // 走秒口径（原型右列「数据来源」）：elapsed = 服务端 elapsed_ms + 自校准
  // 锚点以来的本地增量（elapsed = elapsed_ms + (now - 收到事件时刻)）；无任何
  // 锚点（旧事件）→ 不显示计时，退化为现状显示。
  const runningAnchor = elapsedSyncedAt ?? startedAt ?? null;
  const runningElapsedMs =
    runningAnchor != null
      ? (elapsedMs ?? 0) + Math.max(0, now - runningAnchor)
      : null;
  // 终态真实用时：优先服务端 elapsed_ms（task_notification 权威值）；缺失时用
  // startedAt → terminalAt 本地区间兜底；再缺失不显示（不伪造时长）。
  const terminalElapsedMs = !isRunning
    ? elapsedMs != null
      ? elapsedMs
      : startedAt != null && terminalAt != null
        ? terminalAt - startedAt
        : null
    : null;
  const elapsedMsTotal = isRunning ? runningElapsedMs : terminalElapsedMs;
  const elapsedText =
    elapsedMsTotal != null ? formatElapsedMmss(elapsedMsTotal) : null;

  // 「最后活跃」警示：running 态距最近一次心跳超过门槛（默认 5 分钟）切换为
  // 橙色警示行（warning 语义阶，三主题适配）；终态不参与（已定格）。
  const idleMs =
    isRunning && lastActivityAt != null ? Math.max(0, now - lastActivityAt) : null;
  const showIdleWarn = idleMs != null && idleMs > AGENT_TASK_IDLE_WARN_MS;
  const idleMinutes = idleMs != null ? Math.floor(idleMs / 60_000) : 0;

  // 进度视觉文案（无任务总量基准时的进度代偿）：tokens 累积 + 工具次数。
  const usageParts: string[] = [];
  if (totalTokens != null) usageParts.push(`tokens ${formatTokens(totalTokens)}`);
  if (toolUses != null) usageParts.push(`工具 ${toolUses} 次`);

  // 终态 summary 首行（多行 summary 只取第一个非空行，超长截断）。
  const summaryFirstLine =
    summary
      ?.split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? null;

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
              {elapsedText && (
                <>
                  {" · "}
                  {!isRunning && "真实用时 "}
                  <span className="tabular-nums">{elapsedText}</span>
                </>
              )}
            </p>
          </div>
        </div>
        {isRunning && (
          <span className="shrink-0 rounded bg-brand-100 px-1.5 py-0 text-[10px] font-medium text-brand-700">
            后台任务进行中
          </span>
        )}
      </div>

      {isRunning && (
        <div className="px-3 pb-2">
          {showIdleWarn ? (
            // 沉默警示行（原型 card-idle）：橙色「最后活跃 X 分钟前」替代
            // 「正在做什么」行——可能是长命令 / 慢模型，也可能卡死。
            <p
              data-testid="agent-task-idle-warn"
              className="flex items-center gap-1.5 rounded bg-muted px-2 py-1.5 text-[11px] text-warning"
            >
              <Clock aria-hidden className="h-3 w-3 shrink-0" />
              <span className="min-w-0 truncate">
                最后活跃 {idleMinutes} 分钟前 —— 可能是长命令 / 慢模型，也可能卡死，可让主代理查一次状态
              </span>
            </p>
          ) : (
            // 「正在做什么」行（原型 .doing）：工具 chip（brand 阶）+ summary
            // 摘要；事件字段缺失（旧 daemon）退化为「后台任务运行中」。
            <div
              data-testid="agent-task-doing"
              className="flex min-w-0 items-baseline gap-1.5 rounded bg-muted px-2 py-1.5 text-[11px] text-muted-foreground"
            >
              {lastToolName && (
                <span className="shrink-0 font-mono text-[10.5px] font-semibold text-brand-600">
                  {lastToolName}
                </span>
              )}
              <span
                className="min-w-0 truncate"
                title={summary ?? undefined}
              >
                {summary ?? (lastToolName ? "" : "后台任务运行中")}
              </span>
            </div>
          )}

          {normalizedProgress !== null && (
            <div className="mt-1.5">
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

          {usageParts.length > 0 && (
            <p
              data-testid="agent-task-usage"
              className="mt-1 text-[10px] tabular-nums text-muted-foreground"
            >
              {usageParts.join(" · ")}
            </p>
          )}
        </div>
      )}

      {!isRunning && summaryFirstLine && (
        // 终态 summary 首行（原型 card-terminal）：定格后的任务产出摘要。
        <p
          data-testid="agent-task-summary"
          className="flex items-start gap-1.5 border-t bg-muted/20 px-3 py-1.5 text-[11px] text-muted-foreground"
        >
          <FileText aria-hidden className="mt-0.5 h-3 w-3 shrink-0" />
          <span className="min-w-0 truncate" title={summaryFirstLine}>
            {summaryFirstLine}
          </span>
        </p>
      )}

      {message && (
        <p className="border-t bg-muted/20 px-3 py-1.5 text-[11px] text-muted-foreground">
          {message}
        </p>
      )}
    </article>
  );
}
