"use client";

import { useState } from "react";

import { AgentRunPanel } from "@/components/agent-run-panel";
import { TeamProgress } from "@/components/team-progress";
import { Badge } from "@/components/ui/badge";
import type { GateStatusEvent } from "@/lib/agent-stream";
import type { DispatchResponse } from "@/lib/changes";

/**
 * 单个步骤信息（对应后端 sync_stage_status 写入的 stages.steps）。
 *
 * 2026-08-15-change-step-visibility task-05：原定义在被删除的
 * SillySpecStepProgress 组件文件（D-005@v1 换数据源统一到 latest_progress），
 * 本组件仍消费 page.tsx 从 change.stages 派生的旧形状（挂载点整体替换归
 * task-07），故收拢为本文件局部类型；task-07 随 steps 链路一并退役。
 */
interface StepInfo {
  /** 步骤序号（1-based） */
  index: number;
  /** 步骤名称 */
  name: string;
  /** 步骤状态（waiting 对齐 design §8 StepStatus.WAITING = 工具 progress.js:41） */
  status: "pending" | "running" | "completed" | "failed" | "waiting";
  /** 关联的 AgentRun ID */
  agent_run_id?: string;
}

const STEP_STATUS_STYLES: Record<
  StepInfo["status"],
  { dot: string; icon: string; text: string }
> = {
  completed: {
    dot: "bg-emerald-500",
    icon: "✓",
    text: "text-emerald-600",
  },
  running: {
    dot: "bg-blue-500",
    icon: "",
    text: "text-blue-600 font-medium",
  },
  failed: {
    dot: "bg-red-500",
    icon: "✗",
    text: "text-red-600",
  },
  // waiting：等待人工介入（design §8 StepStatus.WAITING，对应审核面板投影），
  // 用琥珀色与 pending（灰，尚未开始）区分。
  waiting: {
    dot: "bg-amber-500",
    icon: "⏸",
    text: "text-amber-600 font-medium",
  },
  pending: {
    dot: "bg-gray-300",
    icon: "",
    text: "text-muted-foreground",
  },
};

interface AgentStepProgressProps {
  currentStage: string | null;
  steps: StepInfo[] | undefined;
  hasActiveRun: boolean;
  configEnabled: boolean;
  lastDispatchStatus?: "running" | "completed" | "failed" | null;
  lastDispatchFinishedAt?: string | null;
  lastDispatchSummary?: string | null;
  onRefresh?: () => void;
  refreshing?: boolean;
}

/**
 * 子步骤进度区（原 SillySpecStepProgress 在本组合的实际用样子集，task-05 内联）。
 *
 * 差异（相对被删组件，均为本组合不可达分支的删除）：不接收 onDispatch /
 * dispatching / stageLabels——本组合从不传（FR-05b 操作入口统一归
 * ChangeStageActions），内嵌触发按钮与 stage 标签映射逻辑随之移除；渲染
 * 分支与样式类原样保留（视觉零变化）。
 */
function AgentStepProgress({
  currentStage,
  steps,
  hasActiveRun,
  configEnabled,
  lastDispatchStatus,
  lastDispatchFinishedAt,
  lastDispatchSummary,
  onRefresh,
  refreshing,
}: AgentStepProgressProps) {
  const stageLabel = currentStage ?? "—";

  const validSteps = Array.isArray(steps) ? steps : [];
  const completedCount = validSteps.filter(
    (s) => s.status === "completed"
  ).length;

  const refreshButton = onRefresh && (
    <button
      onClick={onRefresh}
      disabled={refreshing}
      className="text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
    >
      {refreshing ? "刷新中…" : "↻ 刷新"}
    </button>
  );

  // Boundary: no config and no steps → show nothing
  if (!configEnabled && validSteps.length === 0) {
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

  // Boundary: config enabled but no steps data → fallback to simple agent status
  if (validSteps.length === 0) {
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

  // ── Full step progress view ────────────────────────────────────────
  return (
    <section className="rounded-md border bg-card">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-medium">🤖 {stageLabel}</h2>
          <span className="text-[11px] text-muted-foreground">
            {completedCount}/{validSteps.length} 步骤完成
          </span>
        </div>
        {refreshButton}
      </div>

      {/* Step bar — horizontal on wide, vertical on narrow */}
      <div className="px-3 py-2.5">
        {/* Horizontal step bar (sm+) */}
        <div className="hidden sm:flex items-center gap-0 overflow-x-auto">
          {validSteps.map((step, i) => {
            const style = STEP_STATUS_STYLES[step.status];
            return (
              <div key={step.index} className="flex items-center">
                {i > 0 && (
                  <div
                    className={`h-0.5 w-4 ${
                      step.status === "completed" || validSteps[i - 1]?.status === "completed"
                        ? "bg-emerald-300"
                        : "bg-gray-200"
                    }`}
                  />
                )}
                <div className="flex flex-col items-center gap-0.5 min-w-[48px]">
                  <span
                    className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${
                      step.status === "running"
                        ? `${style.dot} animate-pulse`
                        : style.dot
                    } text-white`}
                  >
                    {style.icon || step.index}
                  </span>
                  <span
                    className={`text-[10px] leading-tight text-center max-w-[64px] truncate ${style.text}`}
                    title={step.name}
                  >
                    {step.name}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Vertical step list (< sm) */}
        <div className="flex flex-col gap-1.5 sm:hidden">
          {validSteps.map((step) => {
            const style = STEP_STATUS_STYLES[step.status];
            return (
              <div key={step.index} className="flex items-center gap-2">
                <span
                  className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] ${
                    step.status === "running"
                      ? `${style.dot} animate-pulse`
                      : style.dot
                  } text-white`}
                >
                  {style.icon || step.index}
                </span>
                <span className={`text-xs ${style.text}`}>{step.name}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* AgentRun info area */}
      <div className="border-t px-3 py-2 space-y-2">
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
        ) : null}

        {/* Output summary (collapsible) */}
        {lastDispatchSummary && (
          <details className="group">
            <summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground">
              输出摘要 ▾
            </summary>
            <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-muted/60 px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground">
              {lastDispatchSummary}
            </pre>
          </details>
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
  currentStage: string | null;
  /** 已派生的子步骤（page.tsx 从 change.stages 派生后传入；挂载替换归 task-07） */
  steps: StepInfo[] | undefined;
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
        currentStage={currentStage}
        steps={steps}
        hasActiveRun={agentStatus?.has_active_run ?? false}
        configEnabled={agentStatus?.config_enabled ?? false}
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
