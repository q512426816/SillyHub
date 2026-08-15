"use client";

import { useState } from "react";

import { AgentRunPanel } from "@/components/agent-run-panel";
import { TeamProgress } from "@/components/team-progress";
import { Badge } from "@/components/ui/badge";
import type { GateStatusEvent } from "@/lib/agent-stream";
import type { DispatchResponse } from "@/lib/changes";

interface AgentStepProgressProps {
  hasActiveRun: boolean;
  configEnabled: boolean;
  lastDispatchStatus?: "running" | "completed" | "failed" | null;
  lastDispatchFinishedAt?: string | null;
  onRefresh?: () => void;
  refreshing?: boolean;
}

/**
 * 子步骤进度区（原 SillySpecStepProgress 在本组合的实际用样子集，task-05 内联；
 * ql-20260816-001：steps 链路已退役（step 明细统一走 ChangeStepTimeline），
 * 步骤条渲染分支与 steps prop 删除，仅保留智能体运行状态简化视图。
 */
function AgentStepProgress({
  hasActiveRun,
  configEnabled,
  lastDispatchStatus,
  lastDispatchFinishedAt,
  onRefresh,
  refreshing,
}: AgentStepProgressProps) {
  const refreshButton = onRefresh && (
    <button
      onClick={onRefresh}
      disabled={refreshing}
      className="text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
    >
      {refreshing ? "刷新中…" : "↻ 刷新"}
    </button>
  );

  // Boundary: no config → 简化状态行（原 steps 联动分支已随链路退役）
  if (!configEnabled) {
    return (
      <section className="rounded-md border bg-card">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <h2 className="text-xs font-medium">🤖 智能体运行状态</h2>
          {refreshButton}
        </div>
        <div className="px-3 py-2.5">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-block h-2 w-2 rounded-full bg-gray-300" />
            <span>当前阶段未配置智能体</span>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-md border bg-card">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <h2 className="text-xs font-medium">🤖 智能体运行状态</h2>
        {refreshButton}
      </div>
      <div className="px-3 py-2.5 space-y-2">
        {hasActiveRun ? (
          <div className="flex items-center gap-2 text-xs text-emerald-600">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
            </span>
            <span className="font-medium">智能体运行中…</span>
          </div>
        ) : lastDispatchStatus === "completed" ? (
          <div className="flex items-center gap-2 text-xs text-emerald-600">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
            <span className="font-medium">上次执行成功</span>
            {lastDispatchFinishedAt && (
              <span className="text-[11px] text-muted-foreground">
                · {new Date(lastDispatchFinishedAt).toLocaleString("zh-CN")}
              </span>
            )}
          </div>
        ) : lastDispatchStatus === "failed" ? (
          <div className="flex items-center gap-2 text-xs text-destructive">
            <span className="inline-block h-2 w-2 rounded-full bg-red-500" />
            <span className="font-medium">上次执行失败</span>
            {lastDispatchFinishedAt && (
              <span className="text-[11px] text-muted-foreground">
                · {new Date(lastDispatchFinishedAt).toLocaleString("zh-CN")}
              </span>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-xs text-blue-600">
            <span className="inline-block h-2 w-2 rounded-full bg-blue-500" />
            <span>等待步骤数据同步</span>
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * 智能体执行日志区（主线，2026-08-11-change-detail-layout-rework / FR-02 / FR-05b）。
 *
 * 把原 page.tsx 散落的四处收口为单一「机器在干活」窗口：
 *   - 子步骤进度（AgentStepProgress，task-05 起内联——原 SillySpecStepProgress
 *     已删，D-005@v1 数据源统一；本组合不传 onDispatch=不渲染操作按钮，
 *     操作入口统一归 ChangeStageActions，FR-05b 消除双入口）
 *   - gate 徽标（核验中/已通过/核验失败）
 *   - AgentRunPanel（执行日志 SSE）
 *   - TeamProgress（团队模式按需展开）
 *
 * 黑盒复用 AgentRunPanel/TeamProgress，不改其内部（design §6）。
 */
export interface ChangeAgentRunLogProps {
  workspaceId: string;
  /** agent run ID；null 时不连 SSE、不渲染日志面板 */
  panelRunId: string | null;
  /** run 是否活跃（pending/running → true） */
  panelIsActive: boolean;
  agentStatus: DispatchResponse | null;
  gateStatus: GateStatusEvent | null;
  teamMode: boolean;
  stageTeamMissionId: string | null;
  onDone: () => void;
  onGateStatusChanged: (_g: GateStatusEvent | null) => void;
  onRefresh: () => void;
  refreshing: boolean;
  /** 保留为契约字段；操作入口归 ChangeStageActions，本组件不渲染任何触发按钮 */
  onDispatch: () => void;
  dispatching: boolean;
}

export function ChangeAgentRunLog({
  workspaceId,
  panelRunId,
  panelIsActive,
  agentStatus,
  gateStatus,
  teamMode,
  stageTeamMissionId,
  onDone,
  onGateStatusChanged,
  onRefresh,
  refreshing,
}: ChangeAgentRunLogProps) {
  const [logsExpanded, setLogsExpanded] = useState(false);

  const lastDispatch = agentStatus?.last_dispatch;

  // gate 徽标数据源合并：SSE 实时（gateStatus）回退 last_dispatch.gate_status
  const gs =
    gateStatus?.gate_status ?? lastDispatch?.gate_status ?? null;
  const errs =
    gateStatus?.errors_summary ??
    (lastDispatch?.gate_result?.errors?.length
      ? String(lastDispatch.gate_result.errors).slice(0, 500)
      : null);
  const isRunning = gs === "pending" || gs === "running";
  const isPassed = gs === "decided" && !errs;
  const isFailed = gs === "failed" || (gs === "decided" && !!errs);

  return (
    <div className="space-y-3">
      {/* 团队进度（按需展开） */}
      {teamMode && stageTeamMissionId ? (
        <TeamProgress missionId={stageTeamMissionId} workspaceId={workspaceId} />
      ) : null}

      {/* 子步骤进度（无操作按钮，FR-05b 消除双入口） */}
      <AgentStepProgress
        hasActiveRun={agentStatus?.has_active_run ?? false}
        configEnabled={agentStatus?.config_enabled ?? false}
        lastDispatchStatus={
          lastDispatch?.status as "running" | "completed" | "failed" | null
        }
        lastDispatchFinishedAt={lastDispatch?.finished_at}
        onRefresh={onRefresh}
        refreshing={refreshing}
      />

      {/* 执行日志面板（panelRunId 非空时） */}
      {panelRunId ? (
        <div className="rounded-md border bg-card">
          <button
            type="button"
            className="flex w-full items-center justify-between border-b px-3 py-2 text-left"
            onClick={() => setLogsExpanded((v) => !v)}
          >
            <div className="flex items-center gap-2">
              <h2 className="text-xs font-medium">智能体执行日志</h2>
              {gs ? (
                <Badge
                  variant={
                    isPassed ? "success" : isFailed ? "destructive" : "outline"
                  }
                  className={isRunning ? "animate-pulse" : ""}
                >
                  {isPassed
                    ? "✓ 已通过"
                    : isFailed
                      ? "✗ 核验失败"
                      : "客观核验中…"}
                </Badge>
              ) : null}
              <span className="text-[11px] text-muted-foreground">
                {lastDispatch?.status ? ` · ${lastDispatch.status}` : ""}
              </span>
            </div>
            <span className="text-[11px] text-muted-foreground">
              {logsExpanded ? "▾ 收起" : "▸ 展开"}
            </span>
          </button>
          {logsExpanded ? (
            <div className="p-2">
              <AgentRunPanel
                workspaceId={workspaceId}
                runId={panelRunId}
                isActive={panelIsActive}
                title="智能体执行日志"
                isLive={panelIsActive}
                summary={
                  <span className="text-[11px] text-muted-foreground">
                    {lastDispatch?.status ? ` · ${lastDispatch.status}` : ""}
                  </span>
                }
                onDone={onDone}
                onGateStatusChanged={onGateStatusChanged}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
