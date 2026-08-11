"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { PageContainer, PageHeader } from "@/components/layout";
import { Badge } from "@/components/ui/badge";
import { ChangeAgentRunLog } from "@/components/changes/detail/change-agent-run-log";
import { ChangeFilesCard } from "@/components/changes/detail/change-files-card";
import {
  ChangeReviewHistoryCard,
  normalizeReviewHistory,
} from "@/components/changes/detail/change-review-history-card";
import { ChangeSessionsCard } from "@/components/changes/detail/change-sessions-card";
import {
  ChangeStageActions,
} from "@/components/changes/detail/change-stage-actions";
import {
  ChangeStageHeader,
  WORKFLOW_STAGE_LABELS,
} from "@/components/changes/detail/change-stage-header";
import { ChangeTaskBoardCard } from "@/components/changes/detail/change-task-board-card";
import type { StepInfo } from "@/components/sillyspec-step-progress";
import type { StageWorkerPreset } from "@/components/stage-team-config";
import type { GateStatusEvent } from "@/lib/agent-stream";
import { ApiError } from "@/lib/api";
import {
  advanceChangeStage,
  getAgentStatus,
  getChange,
  runVerifyGate,
  submitStageReview,
  triggerDispatch,
  type ChangeRead,
  type DispatchResponse,
  type VerifyGateResponse,
} from "@/lib/changes";
import { getTaskBoard, type TaskBoard } from "@/lib/tasks";

interface Props {
  params: { id: string; cid: string };
}

// task-12（2026-08-11-change-center-on-demand，FR-06/D-005）：主线阶段下一阶段映射。
// 对齐后端 TRANSITIONS（brainstorm→plan→execute→verify→archive 线性单出口）。archive 终态无下一阶段。
const NEXT_STAGE: Record<string, string> = {
  brainstorm: "plan",
  plan: "execute",
  execute: "verify",
  verify: "archive",
};

// quick/blocked/archived 三态 status 徽标（非线性节点，独立呈现）
const STATUS_BADGE: Record<
  string,
  { label: string; variant: "success" | "outline" | "destructive" | "default" }
> = {
  quick: { label: "快速修复", variant: "default" },
  blocked: { label: "已阻塞", variant: "destructive" },
  archived: { label: "已归档", variant: "success" },
};

export default function ChangeDetailPage({ params }: Props) {
  const workspaceId = params.id;
  const changeId = params.cid;
  const [change, setChange] = useState<ChangeRead | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [transitioning, setTransitioning] = useState(false);
  const [taskBoard, setTaskBoard] = useState<TaskBoard | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // ── Agent Dispatch / 推进 / 门禁 state ───────────────────────────
  const [agentStatus, setAgentStatus] = useState<DispatchResponse | null>(null);
  const [loadingAgentStatus, setLoadingAgentStatus] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [stageProvider, setStageProvider] = useState<string | null>(null);
  const [stageModel, setStageModel] = useState<string | null>(null);
  const [teamMode, setTeamMode] = useState(false);
  const [stageWorkers, setStageWorkers] = useState<StageWorkerPreset[]>([]);
  const [stageTeamMissionId, setStageTeamMissionId] = useState<string | null>(null);
  const [gateStatus, setGateStatus] = useState<GateStatusEvent | null>(null);
  const [gateComment, setGateComment] = useState("");
  const [advancing, setAdvancing] = useState(false);
  const [verifyGate, setVerifyGate] = useState<VerifyGateResponse | null>(null);
  // R-06 localRunId 兜底：dispatch 成功后立即指向新 run，不等 refresh
  const [localRunId, setLocalRunId] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setPageError(null);
      setLoadError(null);
      try {
        const [c, tb, as] = await Promise.all([
          getChange(workspaceId, changeId),
          getTaskBoard(workspaceId, changeId).catch(() => null),
          getAgentStatus(workspaceId, changeId).catch(() => null),
        ]);
        setChange(c);
        setTaskBoard(tb);
        setAgentStatus(as);
      } catch (err) {
        setLoadError(err instanceof ApiError ? err.message : "加载变更详情失败");
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [workspaceId, changeId]);

  const refreshAgentStatus = useCallback(async () => {
    setLoadingAgentStatus(true);
    try {
      const as = await getAgentStatus(workspaceId, changeId);
      setAgentStatus(as);
      // R-06：refresh 完成，activeRunId 已追上 localRunId，清空让其接管
      setLocalRunId(null);
    } catch {
      /* silent */
    } finally {
      setLoadingAgentStatus(false);
    }
  }, [workspaceId, changeId]);

  const nextStage = change?.current_stage
    ? (NEXT_STAGE[change.current_stage] ?? null)
    : null;

  /** 重新派发当前阶段 agent（POST /dispatch，task-12 保留）。 */
  const handleDispatch = async () => {
    setDispatching(true);
    setPageError(null);
    try {
      const result = await triggerDispatch(
        workspaceId,
        changeId,
        stageProvider,
        stageModel,
      );
      // 软失败（200 OK + dispatched:false）
      if (result.dispatch_result && !result.dispatch_result.dispatched) {
        const dr = result.dispatch_result;
        const reasonText =
          dr.reason && dr.reason !== "dispatch_error" ? `（${dr.reason}）` : "";
        setPageError(
          dr.error ? `派发失败${reasonText}：${dr.error}` : `派发失败${reasonText}`,
        );
        void refreshAgentStatus();
        return;
      }
      setAgentStatus(result);
      if (result.has_active_run && result.last_dispatch?.run_id) {
        setSuccessMsg("🤖 智能体 已触发执行");
        setTimeout(() => setSuccessMsg(null), 3000);
        setLocalRunId(result.last_dispatch.run_id);
      }
      void refreshAgentStatus();
    } catch (err) {
      setPageError(err instanceof ApiError ? err.message : "触发智能体失败");
    } finally {
      setDispatching(false);
    }
  };

  /** task-12（FR-06/D-005）：「推进」调 advance-stage 显式推进到下一阶段并 dispatch。 */
  const handleAdvance = async () => {
    if (!change || !nextStage) return;
    setDispatching(true);
    setPageError(null);
    try {
      const mainAgentConfig = teamMode
        ? {
            ...(stageProvider ? { provider: stageProvider } : {}),
            ...(stageModel ? { model: stageModel } : {}),
          }
        : undefined;
      const result = await advanceChangeStage(workspaceId, changeId, nextStage, {
        provider: stageProvider,
        model: stageModel,
        teamMode,
        workerPreset: teamMode ? stageWorkers : undefined,
        mainAgentConfig,
      });
      const changeData = result.change;
      setChange({
        ...change,
        current_stage: (changeData.current_stage as string) ?? nextStage,
        status: changeData.status ?? change.status,
        stages: (changeData.stages as Record<string, unknown>) ?? change.stages,
      });
      if (result.agent_dispatch?.dispatched) {
        setSuccessMsg(
          `🤖 已推进到「${WORKFLOW_STAGE_LABELS[nextStage] ?? nextStage}」并派发智能体`,
        );
        setTimeout(() => setSuccessMsg(null), 4000);
        if (result.agent_dispatch.agent_run_id) {
          setLocalRunId(result.agent_dispatch.agent_run_id);
        }
        if (result.agent_dispatch.mission_id) {
          setStageTeamMissionId(result.agent_dispatch.mission_id);
        }
      } else if (result.agent_dispatch && !result.agent_dispatch.dispatched) {
        const reason = result.agent_dispatch.reason;
        if (reason === "active_run_exists") {
          setSuccessMsg("⚠️ 智能体 已在运行中，跳过重复派发");
          setTimeout(() => setSuccessMsg(null), 3000);
        } else {
          setSuccessMsg(`已推进到「${WORKFLOW_STAGE_LABELS[nextStage] ?? nextStage}」`);
          setTimeout(() => setSuccessMsg(null), 3000);
        }
      }
      void refreshAgentStatus();
    } catch (err) {
      if (err instanceof ApiError) {
        const violations = (err.details as { violations?: string[] })?.violations;
        setPageError(violations ? violations.join("；") : err.message);
      } else {
        setPageError("推进失败");
      }
    } finally {
      setDispatching(false);
    }
  };

  /** task-12（D-003/D-008）：run-verify-gate 软调用，结果交用户决策。 */
  const handleRunVerifyGate = async () => {
    setAdvancing(true);
    setPageError(null);
    try {
      const result = await runVerifyGate(workspaceId, changeId);
      setVerifyGate(result);
      if (result.source === "unavailable") {
        setSuccessMsg("验证门禁暂不可用（daemon 离线 / 无代码根），请人工核验");
        setTimeout(() => setSuccessMsg(null), 4000);
      }
    } catch (err) {
      setPageError(err instanceof ApiError ? err.message : "运行验证门禁失败");
    } finally {
      setAdvancing(false);
    }
  };

  // ── Agent Log Stream（R-06 localRunId 兜底派生）──
  const activeRunId = agentStatus?.last_dispatch?.run_id ?? null;
  const isRunActive = agentStatus?.has_active_run ?? false;
  const panelRunId = localRunId ?? activeRunId;
  const panelIsActive = localRunId !== null ? true : isRunActive;

  const handleChangesRunDone = useCallback(() => {
    setLocalRunId(null);
    void refreshAgentStatus();
  }, [refreshAgentStatus]);

  const refreshAll = useCallback(async () => {
    try {
      const [c, as] = await Promise.all([
        getChange(workspaceId, changeId),
        getAgentStatus(workspaceId, changeId),
      ]);
      setChange(c);
      setAgentStatus(as);
    } catch {
      /* silent */
    }
  }, [workspaceId, changeId]);

  // gate_status_changed SSE 收到后刷新（decided/failed → 推进按钮及时出现）
  useEffect(() => {
    if (!gateStatus) return;
    if (gateStatus.gate_status === "decided" || gateStatus.gate_status === "failed") {
      void refreshAll();
    }
  }, [gateStatus, refreshAll]);

  // gate 审核唯一入口 submitStageReview（task-13/FR-06）
  const handleGateAction = async (action: string) => {
    if (transitioning) return;
    setTransitioning(true);
    try {
      await submitStageReview(
        workspaceId,
        changeId,
        action,
        gateComment || undefined,
      );
      setGateComment("");
      const [updated, updatedAgentStatus] = await Promise.all([
        getChange(workspaceId, changeId),
        getAgentStatus(workspaceId, changeId),
      ]);
      setChange(updated);
      setAgentStatus(updatedAgentStatus);
    } catch (err) {
      setPageError(err instanceof ApiError ? err.message : "操作失败");
    } finally {
      setTransitioning(false);
    }
  };

  if (loading) {
    return (
      <PageContainer>
        <p className="text-xs text-muted-foreground">加载中…</p>
      </PageContainer>
    );
  }

  if (loadError || !change) {
    return (
      <PageContainer>
        <div className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
          {loadError ?? "变更未找到"}
        </div>
        <Link
          href={`/workspaces/${workspaceId}/changes`}
          className="mt-3 inline-block text-xs text-primary hover:underline"
        >
          ← 变更列表
        </Link>
      </PageContainer>
    );
  }

  // 子步骤进度派生（从 change.stages，搬自原 page.tsx）
  const steps: StepInfo[] | undefined = (() => {
    const stages = change.stages as Record<string, unknown> | null;
    if (!stages || !change.current_stage) return undefined;
    const topLevel = stages.steps;
    if (Array.isArray(topLevel)) return topLevel as StepInfo[];
    const stageData = stages[change.current_stage] as
      | Record<string, unknown>
      | undefined;
    if (
      stageData?.steps &&
      typeof stageData.steps === "object" &&
      !Array.isArray(stageData.steps)
    ) {
      const s = stageData.steps as { completed?: string[]; pending?: string[] };
      const result: StepInfo[] = [];
      let idx = 1;
      for (const name of s.completed ?? []) {
        result.push({ index: idx++, name, status: "completed" });
      }
      for (const name of s.pending ?? []) {
        result.push({ index: idx++, name, status: "pending" });
      }
      return result.length > 0 ? result : undefined;
    }
    return undefined;
  })();

  // 审核历史派生（从 change.stages.review_history，归一化 gate/rerun 双形状）
  const reviewHistory = normalizeReviewHistory(
    (change.stages as Record<string, unknown> | null)?.review_history,
  );

  return (
    <PageContainer className="gap-5">
      <p className="text-[11px] text-muted-foreground">
        <Link
          href={`/workspaces/${workspaceId}/changes`}
          className="hover:underline"
        >
          ← 变更列表
        </Link>
      </p>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <span className="truncate">{change.title ?? change.change_key}</span>
            {(() => {
              const stage = change.current_stage ?? "draft";
              const statusBadge = STATUS_BADGE[stage];
              if (statusBadge) {
                return (
                  <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
                );
              }
              return (
                <Badge variant="outline">
                  {WORKFLOW_STAGE_LABELS[stage] ?? stage ?? "未知"}
                </Badge>
              );
            })()}
          </span>
        }
        subtitle={
          <span className="flex flex-wrap gap-x-5 gap-y-0.5">
            <span>
              Key: <code className="font-mono">{change.change_key}</code>
            </span>
            <span>类型: {change.change_type ?? "—"}</span>
            <span>位置: {change.location}</span>
            <span>
              影响:{" "}
              {change.affected_components.length > 0
                ? change.affected_components.join(", ")
                : "—"}
            </span>
          </span>
        }
      />

      {/* 阶段步骤条（主线宏观进度） */}
      <ChangeStageHeader
        currentStage={change.current_stage ?? null}
        stages={change.stages as Record<string, unknown> | null}
        updatedAt={change.updated_at ?? null}
      />

      {pageError ? (
        <div className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
          {pageError}
        </div>
      ) : null}
      {successMsg ? (
        <div className="rounded border border-green-300 bg-green-50 px-3 py-2 text-xs text-green-700">
          {successMsg}
        </div>
      ) : null}

      {/* 左主右辅两栏（移动端 <lg 单列：次线堆叠在主线下方） */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* 主线：当前阶段操作 + 智能体执行日志 */}
        <main className="space-y-3">
          <ChangeStageActions
            change={change}
            agentStatus={agentStatus}
            nextStage={nextStage}
            verifyGate={verifyGate}
            gateComment={gateComment}
            onGateCommentChange={setGateComment}
            onGateAction={handleGateAction}
            onAdvance={handleAdvance}
            onRunVerifyGate={handleRunVerifyGate}
            onDispatch={handleDispatch}
            transitioning={transitioning}
            dispatching={dispatching}
            advancing={advancing}
            stageProvider={stageProvider}
            onStageProviderChange={setStageProvider}
            stageModel={stageModel}
            onStageModelChange={setStageModel}
            teamMode={teamMode}
            onTeamModeChange={setTeamMode}
            stageWorkers={stageWorkers}
            onStageWorkersChange={setStageWorkers}
          />
          <ChangeAgentRunLog
            workspaceId={workspaceId}
            panelRunId={panelRunId}
            panelIsActive={panelIsActive}
            agentStatus={agentStatus}
            gateStatus={gateStatus}
            currentStage={change.current_stage ?? null}
            steps={steps}
            teamMode={teamMode}
            stageTeamMissionId={stageTeamMissionId}
            onDone={handleChangesRunDone}
            onGateStatusChanged={setGateStatus}
            onRefresh={() => void refreshAgentStatus()}
            refreshing={loadingAgentStatus}
            onDispatch={() => void handleDispatch()}
            dispatching={dispatching}
          />
        </main>

        {/* 次线：变更文件 / 会话调试 / 审核历史 / 任务看板 */}
        <aside className="space-y-3">
          <ChangeFilesCard workspaceId={workspaceId} changeId={changeId} />
          <ChangeSessionsCard workspaceId={workspaceId} changeId={changeId} />
          <ChangeReviewHistoryCard reviewHistory={reviewHistory} />
          <ChangeTaskBoardCard
            workspaceId={workspaceId}
            changeId={changeId}
            taskBoard={taskBoard}
          />
        </aside>
      </div>
    </PageContainer>
  );
}
