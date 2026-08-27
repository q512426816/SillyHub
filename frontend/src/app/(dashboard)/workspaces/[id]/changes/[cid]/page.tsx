"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { PageContainer, PageHeader } from "@/components/layout";
import { Badge } from "@/components/ui/badge";
import { ChangeAgentRunLog } from "@/components/changes/detail/change-agent-run-log";
import { ChangeFilesCard } from "@/components/changes/detail/change-files-card";
import {
  ChangeReviewHistoryCard,
  normalizeReviewHistory,
} from "@/components/changes/detail/change-review-history-card";
import { ChangeSessionsCard } from "@/components/changes/detail/change-sessions-card";
import { ChangeStageActions } from "@/components/changes/detail/change-stage-actions";
import {
  ChangeStageHeader,
  WORKFLOW_STAGE_LABELS,
} from "@/components/changes/detail/change-stage-header";
import { ChangeStepTimeline } from "@/components/changes/detail/change-step-timeline";
import { ChangeTaskBoardCard } from "@/components/changes/detail/change-task-board-card";
import { QuicklogLinkedCard } from "@/components/changes/detail/quicklog-linked-card";
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

/** 变更详情查询 key（task-07 / D-004@v1：react-query 缓存定位与审批后失效重取） */
const CHANGE_QUERY_KEY = (workspaceId: string, changeId: string) =>
  ["change", workspaceId, changeId] as const;

/** 非终态轮询间隔（design §5 Phase 2.3：详情页 10s） */
const DETAIL_REFETCH_MS = 10_000;

/**
 * 变更终态判定（design §5 Phase 2.4 可测试定义）：status 为 archived 或
 * location 为 archive 即终态——changes 表仅 active/archived 两值，无 failed
 * （失败语义在 steps 层由 7 值枚举承载）。data 未就绪按非终态处理（继续拉取）。
 */
export function isTerminalChange(
  change: Pick<ChangeRead, "status" | "location"> | null | undefined,
): boolean {
  if (!change) return false;
  return change.status === "archived" || change.location === "archive";
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
  const queryClient = useQueryClient();

  // ── 变更详情（task-07 / D-004@v1：react-query 智能轮询替换原裸 useEffect）──
  // 非终态 10s 周期刷新、终态停轮（isTerminalChange）；refetchIntervalInBackground
  // 默认 false = 页面不可见暂停；structuralSharing 默认开启 = 内容未变跳过
  // re-render（不乱跳），queryFn 保持原 getChange 请求参数。
  // ql-20260816-001：请求已出错且无数据（变更被删/硬 404）→ 停轮，防无限空轮。
  const changeQuery = useQuery({
    queryKey: CHANGE_QUERY_KEY(workspaceId, changeId),
    queryFn: () => getChange(workspaceId, changeId),
    refetchInterval: (query) => {
      if (query.state.error && !query.state.data) return false;
      return isTerminalChange(query.state.data) ? false : DETAIL_REFETCH_MS;
    },
  });
  const change = changeQuery.data ?? null;
  const changeError = changeQuery.error;
  // loading / loadError 语义对齐原裸 load：仅初次加载（尚无数据）进入加载屏 /
  // 错误屏；轮询或审批后刷新失败不打断已渲染内容（react-query 按策略自动重试）。
  const loading = changeQuery.isPending;
  const loadError =
    changeQuery.isError && !changeQuery.data
      ? changeError instanceof ApiError
        ? changeError.message
        : "加载变更详情失败"
      : null;

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

  // ── 阶段-步骤联动（ql-20260821-017）：点击阶段步骤条节点筛选步骤时间线 ──
  // stepStages = steps 中实际有条目的阶段集合（决定哪些节点可点）；再次点击
  // 同一阶段取消筛选；current_stage 非线性（quick 等）时步骤条不渲染，联动
  // 入口自然缺席，focusStage 恒为 null 无副作用。
  const [focusStage, setFocusStage] = useState<string | null>(null);

  // ── 辅助数据（任务看板 / agent 状态 / 绑定会话近似）：一次性加载，不随详情轮询 ──
  useEffect(() => {
    let cancelled = false;
    setPageError(null);
    const loadSide = async () => {
      const [tb, as, sessions] = await Promise.all([
        getTaskBoard(workspaceId, changeId).catch(() => null),
        getAgentStatus(workspaceId, changeId).catch(() => null),
        listWorkspaceAgentSessions(workspaceId, { include_ended: true }).catch(
          () => [],
        ),
      ]);
      if (cancelled) return;
      setTaskBoard(tb);
      setAgentStatus(as);
      // §8 绑定查询语义 = 工作区最近活跃会话（coalesce(last_active_at, created_at) desc）
      setBoundSession(sessions?.[0] ?? null);
    };
    void loadSide();
    return () => {
      cancelled = true;
    };
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
        // 审批后刷新（task-07）：变更详情改 query 失效重取，agent 状态保持原拉取
        const [, updatedAgentStatus] = await Promise.all([
          queryClient
            .invalidateQueries({
              queryKey: CHANGE_QUERY_KEY(workspaceId, changeId),
            })
            .catch(() => undefined),
          getAgentStatus(workspaceId, changeId).catch(() => null),
        ]);
        setAgentStatus(updatedAgentStatus);
      } catch (err) {
        setPageError(err instanceof ApiError ? err.message : "操作失败");
      } finally {
        setTransitioning(false);
      }
    },
    [workspaceId, changeId, transitioning, gateComment, queryClient],
  );

  if (loading) {
    return (
      <PageContainer size="full">
        <p className="text-xs text-muted-foreground">加载中…</p>
      </PageContainer>
    );
  }

  if (loadError || !change) {
    return (
      <PageContainer size="full">
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

  // 审核历史派生（从 change.stages.review_history，归一化 gate/rerun 双形状）
  const reviewHistory = normalizeReviewHistory(
    (change.stages as Record<string, unknown> | null)?.review_history,
  );

  // 执行日志流派生（只读：无 dispatch 后不再有 localRunId 兜底）
  const panelRunId = agentStatus?.last_dispatch?.run_id ?? null;
  const panelIsActive = agentStatus?.has_active_run ?? false;

  // 阶段-步骤联动派生：steps 条目出现的阶段去重（含 quick 等非线性 stage，
  // 但步骤条只渲染 5 大阶段节点，非 WORKFLOW_STAGES 值仅参与 includes 判断）
  const stepStages =
    change.steps && change.steps.length > 0
      ? Array.from(new Set(change.steps.map((e) => e.stage)))
      : [];

  return (
    <PageContainer size="full" className="gap-5">
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

      {/* 阶段步骤条（主线宏观进度；节点可点击筛选下方步骤时间线，ql-20260821-017） */}
      <ChangeStageHeader
        currentStage={change.current_stage ?? null}
        stages={change.stages as Record<string, unknown> | null}
        updatedAt={change.updated_at ?? null}
        stepStages={stepStages}
        focusStage={focusStage}
        onStageClick={(stage) =>
          setFocusStage((prev) => (prev === stage ? null : stage))
        }
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
        {/* 主线：审批卡 + 步骤时间线 + 智能体执行日志（只读） */}
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

          {/* 步骤时间线（task-07 / D-005@v1：数据源 latest_progress.steps，替换旧
              SillySpecStepProgress 的 change.stages 派生挂载；steps 缺失降级不渲染，
              组件内自空态兜底，D-003；focusStage 与上方阶段节点联动 ql-20260821-017） */}
          {change.steps && change.steps.length > 0 ? (
            <section
              data-testid="change-step-timeline-card"
              className="rounded-md border bg-card"
            >
              <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
                <h2 className="text-xs font-medium">
                  📋 步骤时间线 ({change.steps.length})
                </h2>
                {focusStage ? (
                  <button
                    type="button"
                    onClick={() => setFocusStage(null)}
                    aria-label="清除阶段筛选"
                    className="inline-flex shrink-0 items-center gap-1 rounded-full border border-brand-300 bg-brand-500/10 px-2 py-px text-[11px] text-brand-600 transition-colors hover:bg-brand-500/20"
                  >
                    {WORKFLOW_STAGE_LABELS[focusStage] ?? focusStage} ✕
                  </button>
                ) : null}
              </div>
              <div className="px-3 py-2.5">
                <ChangeStepTimeline
                  steps={change.steps}
                  focusStage={focusStage}
                />
              </div>
            </section>
          ) : null}

          <ChangeAgentRunLog
            workspaceId={workspaceId}
            panelRunId={panelRunId}
            panelIsActive={panelIsActive}
            agentStatus={agentStatus}
            gateStatus={null}
            // steps/currentStage 链路已随旧 SillySpecStepProgress 挂载退役
            // （task-07，step 明细统一走上方 ChangeStepTimeline；prop 已删
            // ql-20260816-001）
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

        {/* 次线：变更文件 / 会话调试 / 审核历史 / 任务看板 / 关联快速任务 */}
        <aside className="space-y-3">
          <ChangeFilesCard workspaceId={workspaceId} changeId={changeId} />
          <QuicklogLinkedCard
            workspaceId={workspaceId}
            changeKey={change.change_key}
          />
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
