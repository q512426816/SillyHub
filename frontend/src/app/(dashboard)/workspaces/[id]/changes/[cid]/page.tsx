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
import { ApiError } from "@/lib/api";
import {
  getAgentStatus,
  getChange,
  submitStageReview,
  type ChangeRead,
  type DispatchResponse,
} from "@/lib/changes";
import {
  listWorkspaceAgentSessions,
  type AgentSessionListItem,
} from "@/lib/daemon";
import { getTaskBoard, type TaskBoard } from "@/lib/tasks";

interface Props {
  params: { id: string; cid: string };
}

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
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [taskBoard, setTaskBoard] = useState<TaskBoard | null>(null);

  // ── 执行日志流（只读展示：agent 运行状态 / SSE 日志，task-10 退化后保留）──
  const [agentStatus, setAgentStatus] = useState<DispatchResponse | null>(null);
  const [loadingAgentStatus, setLoadingAgentStatus] = useState(false);

  // ── 审批卡（唯一操作区）state ───────────────────────────────────────
  const [transitioning, setTransitioning] = useState(false);
  const [gateComment, setGateComment] = useState("");
  const [notifyResult, setNotifyResult] = useState<{
    notified_session: boolean;
    notify_error: string | null;
  } | null>(null);
  // 绑定会话（change_session_links 最新；前端取工作区最近活跃会话近似展示，D-007）
  const [boundSession, setBoundSession] = useState<AgentSessionListItem | null>(
    null,
  );

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setPageError(null);
      setLoadError(null);
      try {
        const [c, tb, as, sessions] = await Promise.all([
          getChange(workspaceId, changeId),
          getTaskBoard(workspaceId, changeId).catch(() => null),
          getAgentStatus(workspaceId, changeId).catch(() => null),
          listWorkspaceAgentSessions(workspaceId, { include_ended: true }).catch(
            () => [],
          ),
        ]);
        setChange(c);
        setTaskBoard(tb);
        setAgentStatus(as);
        // §8 绑定查询语义 = 工作区最近活跃会话（coalesce(last_active_at, created_at) desc）
        setBoundSession(sessions?.[0] ?? null);
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
    } catch {
      /* silent */
    } finally {
      setLoadingAgentStatus(false);
    }
  }, [workspaceId, changeId]);

  // ── 审批唯一入口 submitStageReview（task-10：notify_session 透传，注入移后端 best-effort）──
  const handleGateAction = useCallback(
    async (action: string) => {
      if (transitioning) return;
      setTransitioning(true);
      setNotifyResult(null);
      try {
        const result = await submitStageReview(
          workspaceId,
          changeId,
          action,
          gateComment || undefined,
          true, // notify_session
        );
        setGateComment("");
        setNotifyResult({
          notified_session: result.notified_session,
          notify_error: result.notify_error ?? null,
        });
        if (result.notified_session) {
          setSuccessMsg("✅ 审批已生效，已通知绑定会话");
          setTimeout(() => setSuccessMsg(null), 3000);
        }
        const [updated, updatedAgentStatus] = await Promise.all([
          getChange(workspaceId, changeId),
          getAgentStatus(workspaceId, changeId).catch(() => null),
        ]);
        setChange(updated);
        setAgentStatus(updatedAgentStatus);
      } catch (err) {
        setPageError(err instanceof ApiError ? err.message : "操作失败");
      } finally {
        setTransitioning(false);
      }
    },
    [workspaceId, changeId, transitioning, gateComment],
  );

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

  // 执行日志流派生（只读：无 dispatch 后不再有 localRunId 兜底）
  const panelRunId = agentStatus?.last_dispatch?.run_id ?? null;
  const panelIsActive = agentStatus?.has_active_run ?? false;

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
        {/* 主线：审批卡 + 智能体执行日志（只读） */}
        <main className="space-y-3">
          <ChangeStageActions
            change={change}
            boundSession={boundSession}
            gateComment={gateComment}
            onGateCommentChange={setGateComment}
            onGateAction={(action) => void handleGateAction(action)}
            transitioning={transitioning}
            notifyResult={notifyResult}
          />
          <ChangeAgentRunLog
            workspaceId={workspaceId}
            panelRunId={panelRunId}
            panelIsActive={panelIsActive}
            agentStatus={agentStatus}
            gateStatus={null}
            currentStage={change.current_stage ?? null}
            steps={steps}
            teamMode={false}
            stageTeamMissionId={null}
            onDone={() => void refreshAgentStatus()}
            onGateStatusChanged={() => undefined}
            onRefresh={() => void refreshAgentStatus()}
            refreshing={loadingAgentStatus}
            onDispatch={() => undefined}
            dispatching={false}
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
