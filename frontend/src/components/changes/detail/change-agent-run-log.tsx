"use client";

import { useState } from "react";

import { AgentRunPanel } from "@/components/agent-run-panel";
import {
  SillySpecStepProgress,
  type StepInfo,
} from "@/components/sillyspec-step-progress";
import { TeamProgress } from "@/components/team-progress";
import { Badge } from "@/components/ui/badge";
import type { GateStatusEvent } from "@/lib/agent-stream";
import type { DispatchResponse } from "@/lib/changes";

/**
 * 智能体执行日志区（主线，2026-08-11-change-detail-layout-rework / FR-02 / FR-05b）。
 *
 * 把原 page.tsx 散落的四处收口为单一「机器在干活」窗口：
 *   - SillySpecStepProgress（子步骤进度）—— 组合时传 onDispatch=undefined 使其内嵌
 *     「触发智能体/执行下一步」按钮不渲染，操作入口统一归 ChangeStageActions（FR-05b，
 *     消除双入口；Design Grill 确认此为不改组件内部唯一可行接线）
 *   - gate 徽标（核验中/已通过/核验失败）
 *   - AgentRunPanel（执行日志 SSE）
 *   - TeamProgress（团队模式按需展开）
 *
 * 黑盒复用 AgentRunPanel/SillySpecStepProgress/TeamProgress，不改其内部（design §6）。
 */
export interface ChangeAgentRunLogProps {
  workspaceId: string;
  /** agent run ID；null 时不连 SSE、不渲染日志面板 */
  panelRunId: string | null;
  /** run 是否活跃（pending/running → true） */
  panelIsActive: boolean;
  agentStatus: DispatchResponse | null;
  gateStatus: GateStatusEvent | null;
  currentStage: string | null;
  /** 已派生的子步骤（page.tsx 从 change.stages 派生后传入） */
  steps: StepInfo[] | undefined;
  teamMode: boolean;
  stageTeamMissionId: string | null;
  onDone: () => void;
  onGateStatusChanged: (_g: GateStatusEvent | null) => void;
  onRefresh: () => void;
  refreshing: boolean;
  /** 保留为契约字段；操作入口归 ChangeStageActions，本组件不透传给 SillySpecStepProgress */
  onDispatch: () => void;
  dispatching: boolean;
}

export function ChangeAgentRunLog({
  workspaceId,
  panelRunId,
  panelIsActive,
  agentStatus,
  gateStatus,
  currentStage,
  steps,
  teamMode,
  stageTeamMissionId,
  onDone,
  onGateStatusChanged,
  onRefresh,
  refreshing,
}: ChangeAgentRunLogProps) {
  const [logsExpanded, setLogsExpanded] = useState(false);

  const hasActiveRun = agentStatus?.has_active_run ?? false;
  const configEnabled = agentStatus?.config_enabled ?? false;
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

      {/* 子步骤进度（不传 onDispatch/dispatching → 内嵌触发按钮不渲染，FR-05b） */}
      <SillySpecStepProgress
        currentStage={currentStage}
        steps={steps}
        hasActiveRun={hasActiveRun}
        configEnabled={configEnabled}
        lastDispatchStatus={
          lastDispatch?.status as "running" | "completed" | "failed" | null
        }
        lastDispatchFinishedAt={lastDispatch?.finished_at}
        lastDispatchSummary={lastDispatch?.output_summary}
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
