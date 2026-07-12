"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { AgentModelInput } from "@/components/AgentModelInput";
import { AgentRunPanel } from "@/components/agent-run-panel";
import type { GateStatusEvent } from "@/lib/agent-stream";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AgentProviderSelect } from "@/components/AgentProviderSelect";
import { ChangeFileTree } from "@/components/change-file-tree";
import { ChangeSessionSection } from "@/components/changes/change-session-section";
import {
  PageContainer,
  PageHeader,
} from "@/components/layout";
import { ApiError } from "@/lib/api";
import {
  approveChange,
  executeChange,
  getChange,
  rejectChange,
  checkArchiveGate,
  getAgentStatus,
  triggerDispatch,
  proposalReview,
  planReview,
  humanTest,
  archiveConfirm,
  type ChangeRead,
  type ArchiveGateResponse,
  type DispatchResponse,
  listReviews,
  submitReview,
  transitionChange,
  type ReviewEntry,
} from "@/lib/changes";
import { SillySpecStepProgress, type StepInfo } from "@/components/sillyspec-step-progress";
import { StageTeamConfig, type StageWorkerPreset } from "@/components/stage-team-config";
import { TeamProgress } from "@/components/team-progress";
import { getTaskBoard, type TaskBoard } from "@/lib/tasks";

interface Props {
  params: { id: string; cid: string };
}

// ── Workflow Stages (主线 6 stage，对齐 design §5 Phase 4) ──────────
// quick/blocked/archived 退化为 status 徽标（非线性节点），不进本数组。
// 当 current_stage 为这三态时，WORKFLOW_STAGES.indexOf 返回 -1，
// 步骤条早返回 null，由独立 STATUS_BADGE 徽标承载语义。
const WORKFLOW_STAGES = [
  "brainstorm", "plan", "execute", "verify", "archive",
] as const;

const WORKFLOW_STAGE_LABELS: Record<string, string> = {
  brainstorm: "需求分析",
  plan: "规划", execute: "执行",
  verify: "验证", archive: "归档",
};

const WORKFLOW_STAGE_COLORS: Record<string, "success" | "outline" | "destructive" | "default" | "warning"> = {
  brainstorm: "warning",
  plan: "default", execute: "default",
  verify: "warning", archive: "default",
};

// quick/blocked/archived 三态 status 徽标（非线性节点，独立呈现）
const STATUS_BADGE: Record<string, { label: string; variant: "success" | "outline" | "destructive" | "default" | "warning" }> = {
  quick: { label: "快速修复", variant: "default" },
  blocked: { label: "已阻塞", variant: "destructive" },
  archived: { label: "已归档", variant: "success" },
};

// Gate panel config: 由 change.pending_review 投影字段驱动（对齐 task-03 PendingReview 枚举）
// 4 个面板分别对应 proposal_review / plan_review / human_test / archive_confirm。
const GATE_PANELS: Record<string, {
  title: string;
  description: string;
  actions: { label: string; variant: "default" | "outline" | "destructive"; action: string }[];
}> = {
  proposal_review: {
    title: "四件套已生成，请确认",
    description: "智能体 已生成 proposal / requirements / design / tasks，请审阅后决定",
    actions: [
      { label: "确认通过", variant: "default", action: "proposal_approve" },
      { label: "需要修改", variant: "outline", action: "proposal_revise" },
      { label: "需求不明确", variant: "destructive", action: "proposal_unclear" },
    ],
  },
  plan_review: {
    title: "执行计划已生成，请确认",
    description: "智能体 已生成执行计划，请审阅后决定",
    actions: [
      { label: "确认计划", variant: "default", action: "plan_approve" },
      { label: "重新计划", variant: "outline", action: "plan_replan" },
      { label: "退回文档", variant: "destructive", action: "plan_back_to_propose" },
      { label: "退回需求", variant: "destructive", action: "plan_back_to_brainstorm" },
    ],
  },
  human_test: {
    title: "自动验证通过，请人工测试",
    description: "智能体 已完成自动验证，请进行人工测试（发现 BUG / 文档不符即返工反馈）",
    actions: [
      { label: "测试通过", variant: "default", action: "test_pass" },
      { label: "发现 BUG", variant: "destructive", action: "test_bug" },
      { label: "文档不符", variant: "outline", action: "test_doc_mismatch" },
    ],
  },
  archive_confirm: {
    title: "归档确认",
    description: "所有验证已通过，确认归档此变更",
    actions: [{ label: "确认归档", variant: "default", action: "archive_confirm" }],
  },
};

const APPROVAL_LABELS: Record<string, string> = {
  pending: "待审批",
  approved: "已批准",
  rejected: "已驳回",
  not_required: "无需审批",
};

const COMPONENT_EMOJI: Record<string, string> = {
  frontend: "🌐",
  web: "🌐",
  backend: "⚙️",
  api: "⚙️",
  agent: "🤖",
  parser: "🔌",
  git: "🔀",
  docs: "📄",
  documentation: "📄",
};

function getComponentEmoji(name: string): string {
  const lower = name.toLowerCase();
  for (const [key, emoji] of Object.entries(COMPONENT_EMOJI)) {
    if (lower.includes(key)) return emoji;
  }
  return "📦";
}

export default function ChangeDetailPage({ params }: Props) {
  const workspaceId = params.id;
  const changeId = params.cid;
  const [change, setChange] = useState<ChangeRead | null>(null);
  const [loadingDoc, setLoadingDoc] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reviews, setReviews] = useState<ReviewEntry[]>([]);
  const [transitioning, setTransitioning] = useState(false);
  const [reviewComment, setReviewComment] = useState("");
  const [taskBoard, setTaskBoard] = useState<TaskBoard | null>(null);
  const [rejectionInput, setRejectionInput] = useState("");
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // ── Archive gate state (task-06) ───────────────────────────────────
  const [archiveGate, setArchiveGate] = useState<ArchiveGateResponse | null>(null);
  const [loadingArchiveGate, setLoadingArchiveGate] = useState(false);

  // ── Agent Dispatch state ───────────────────────────────────────────
  const [agentStatus, setAgentStatus] = useState<DispatchResponse | null>(null);
  const [loadingAgentStatus, setLoadingAgentStatus] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  // 阶段流转 / 手动派发使用的 agent provider 覆盖（FR-02，2026-06-14-agent-runtime-selection）
  const [stageProvider, setStageProvider] = useState<string | null>(null);
  const [stageModel, setStageModel] = useState<string | null>(null);
  // team-mode 开关（task-08，D-002/D-003）：execute/verify 流转时是否用团队执行。
  // 默认 false（单 worker 零回归）；true 时 transition/execute 链路透传 team_mode=true。
  const [teamMode, setTeamMode] = useState(false);
  // task-08：stage team worker 预设（mode=team 时携带，D-002@v2 用户预设）。
  // stage 化默认（execute→impl，verify→verify）；透传给 backend 留 task-09 三入口接通。
  const [stageWorkers, setStageWorkers] = useState<StageWorkerPreset[]>([]);
  // task-08：stage team mission 创建后的 missionId（用于 TeamProgress 展示）。
  // task-09 接通：transition team_mode dispatch 返回 mission_id 时 set，驱动 TeamProgress。
  const [stageTeamMissionId, setStageTeamMissionId] = useState<string | null>(null);
  const [gateStatus, setGateStatus] = useState<GateStatusEvent | null>(null);
  const [gateComment, setGateComment] = useState("");

  // ── Agent Log Stream state ──────────────────────────────────────────
  const [logsExpanded, setLogsExpanded] = useState(false);

  // R-06 localRunId 兜底：dispatch 成功后立即指向新 run，不等 refresh；
  // refreshAgentStatus 完成后清空让派生 activeRunId 接管。
  const [localRunId, setLocalRunId] = useState<string | null>(null);

  // Auto-expand logs when agent becomes active or has last_dispatch
  useEffect(() => {
    if (!logsExpanded && (agentStatus?.has_active_run || agentStatus?.last_dispatch)) {
      setLogsExpanded(true);
    }
  }, [agentStatus?.has_active_run, agentStatus?.last_dispatch]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setPageError(null);
      setLoadError(null);
      try {
        const [c, r, tb, as] = await Promise.all([
          getChange(workspaceId, changeId),
          listReviews(workspaceId, changeId).catch(() => []),
          getTaskBoard(workspaceId, changeId).catch(() => null),
          getAgentStatus(workspaceId, changeId).catch(() => null),
        ]);
        setChange(c);
        setReviews(r);
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

  const handleTransition = async (targetStage: string) => {
    if (!change) return;
    setTransitioning(true);
    setPageError(null);
    try {
      // task-09：team_mode 透传 worker_preset + main_agent_config（D-002/D-003@v2）。
      // main_agent_config 从 stage provider/model 派生（agent_type 跟随 workspace 默认，
      // StageTeamConfig 主 agent 只读展示 provider/model）。worker_preset 仅 team 时携带。
      const mainAgentConfig = teamMode
        ? {
            ...(stageProvider ? { provider: stageProvider } : {}),
            ...(stageModel ? { model: stageModel } : {}),
          }
        : undefined;
      const result = await transitionChange(
        workspaceId,
        changeId,
        targetStage,
        undefined,
        stageProvider,
        stageModel,
        teamMode,
        teamMode ? stageWorkers : undefined,
        mainAgentConfig,
      );
      // Backend returns { change: {...}, agent_dispatch: {...} }
      const changeData = result.change;
      setChange({
        ...change,
        current_stage: targetStage,
        status: changeData.status ?? change.status,
        stages: (changeData.stages as Record<string, unknown>) ?? change.stages,
      });
      // Show agent dispatch feedback
      if (result.agent_dispatch?.dispatched) {
        setSuccessMsg(`🤖 智能体 已自动派发 (${result.agent_dispatch.stage ?? targetStage})`);
        setTimeout(() => setSuccessMsg(null), 4000);
        // task-09：team_mode dispatch 返回 mission_id，驱动 TeamProgress 展示。
        if (result.agent_dispatch.mission_id) {
          setStageTeamMissionId(result.agent_dispatch.mission_id);
        }
      } else if (result.agent_dispatch && !result.agent_dispatch.dispatched) {
        const reason = result.agent_dispatch.reason;
        if (reason === "active_run_exists") {
          setSuccessMsg("⚠️ 智能体 已在运行中，跳过重复派发");
          setTimeout(() => setSuccessMsg(null), 3000);
        }
      }
      // Refresh agent status after transition
      try {
        const as = await getAgentStatus(workspaceId, changeId);
        setAgentStatus(as);
      } catch { /* silent */ }
    } catch (err) {
      if (err instanceof ApiError) {
        const violations = (err.details as { violations?: string[] })?.violations;
        setPageError(violations ? violations.join("；") : err.message);
      } else {
        setPageError("状态转移失败");
      }
    } finally {
      setTransitioning(false);
    }
  };

  const handleSubmitReview = async (verdict: "approve" | "reject") => {
    setTransitioning(true);
    setPageError(null);
    try {
      const review = await submitReview(workspaceId, changeId, verdict, reviewComment || undefined);
      setReviews((prev) => [...prev, review]);
      setReviewComment("");
    } catch (err) {
      setPageError(err instanceof ApiError ? err.message : "提交审查失败");
    } finally {
      setTransitioning(false);
    }
  };

  const handleApprove = async () => {
    if (!change) return;
    setTransitioning(true);
    setPageError(null);
    try {
      await approveChange(workspaceId, change.change_key, "admin");
      setChange({ ...change, approval_status: "approved" });
    } catch (err) {
      setPageError(err instanceof ApiError ? err.message : "审批操作失败");
    } finally {
      setTransitioning(false);
    }
  };

  const handleReject = async () => {
    if (!change || !rejectionInput.trim()) return;
    setTransitioning(true);
    setPageError(null);
    try {
      await rejectChange(workspaceId, change.change_key, rejectionInput.trim());
      setChange({ ...change, approval_status: "rejected", rejection_reason: rejectionInput.trim() });
      setRejectionInput("");
      setShowRejectInput(false);
    } catch (err) {
      setPageError(err instanceof ApiError ? err.message : "驳回操作失败");
    } finally {
      setTransitioning(false);
    }
  };

  const handleExecute = async () => {
    if (!change) return;
    setExecuting(true);
    setPageError(null);
    setSuccessMsg(null);
    try {
      const result = await executeChange(workspaceId, change.change_key, stageProvider, stageModel, teamMode);
      if (result.ok) {
        // Refresh change data after successful execution
        const updated = await getChange(workspaceId, changeId);
        setChange(updated);
        setSuccessMsg("✅ 智能体执行已启动 (run_id: " + (result.run_id?.slice(0, 8) ?? "unknown") + ")");
        setTimeout(() => setSuccessMsg(null), 5000);
      }
    } catch (err) {
      setPageError(err instanceof ApiError ? err.message : "启动执行失败");
    } finally {
      setExecuting(false);
    }
  };

  // ── Archive gate handler (task-06) ──────────────────────────────
  const loadArchiveGate = async () => {
    setLoadingArchiveGate(true);
    try {
      const result = await checkArchiveGate(workspaceId, changeId);
      setArchiveGate(result);
    } catch (err) {
      setPageError(err instanceof ApiError ? err.message : "加载归档检查失败");
    } finally {
      setLoadingArchiveGate(false);
    }
  };

  // ── Agent Dispatch handler ─────────────────────────────────────────
  const refreshAgentStatus = useCallback(async () => {
    setLoadingAgentStatus(true);
    try {
      const as = await getAgentStatus(workspaceId, changeId);
      setAgentStatus(as);
      // R-06：refresh 完成，activeRunId 已追上 localRunId（同值），清空让派生值接管，
      // 避免 localRunId 永久卡住导致 isRunActive=false 时 panelIsActive 仍 true。
      setLocalRunId(null);
    } catch { /* silent */ } finally {
      setLoadingAgentStatus(false);
    }
  }, [workspaceId, changeId]);

  const handleDispatch = async () => {
    setDispatching(true);
    setPageError(null);
    try {
      const result = await triggerDispatch(workspaceId, changeId, stageProvider, stageModel);

      // 软失败（200 OK + dispatched:false）：dispatch_result.error 携带真实原因
      // （如 daemon-client root 校验失败 / dispatch_error）。不抛 ApiError，必须显式读。
      // 不读则前端无任何提示（既不 success 也不 error）—— 前端 dispatch 错误不显示 bug。
      if (result.dispatch_result && !result.dispatch_result.dispatched) {
        const dr = result.dispatch_result;
        const reasonText =
          dr.reason && dr.reason !== "dispatch_error" ? `（${dr.reason}）` : "";
        setPageError(
          dr.error ? `派发失败${reasonText}：${dr.error}` : `派发失败${reasonText}`,
        );
        // 软失败时仍 refresh agent status（last_dispatch 可能更新），但不展开日志面板
        void refreshAgentStatus();
        return;
      }

      setAgentStatus(result);
      setLogsExpanded(true);

      if (result.has_active_run && result.last_dispatch?.run_id) {
        setSuccessMsg("🤖 智能体 已触发执行");
        setTimeout(() => setSuccessMsg(null), 3000);
        // R-06：立即 setLocalRunId → panelRunId 立即指向新 run → panel 内 hook
        // useEffect（runId 变化）触发重连，不等 refreshAgentStatus。
        // 对照原 :515-553 立即触发 SSE 连接(newRunId) 的语义。
        setLocalRunId(result.last_dispatch.run_id);
      }
      // 异步 refresh（不阻塞 UI），完成后 localRunId 清空、activeRunId 接管
      void refreshAgentStatus();
    } catch (err) {
      setPageError(err instanceof ApiError ? err.message : "触发智能体失败");
    } finally {
      setDispatching(false);
    }
  };

  // ── Agent Log Stream（R-06 localRunId 兜底派生）─────────────────────
  const activeRunId = agentStatus?.last_dispatch?.run_id ?? null;
  const isRunActive = agentStatus?.has_active_run ?? false;
  // R-06：localRunId 优先（dispatch 立即值），回落到 refresh 后的 activeRunId
  const panelRunId = localRunId ?? activeRunId;
  // R-06：localRunId 非 null = 刚 dispatch 必活跃，强制连 SSE；否则回退 isRunActive（D-001）
  const panelIsActive = localRunId !== null ? true : isRunActive;

  // R-01：onDone 稳定引用 useCallback，run 结束触发 refresh（内含 setLocalRunId(null)）
  const handleChangesRunDone = useCallback(() => {
    setLocalRunId(null);
    void refreshAgentStatus();
  }, [refreshAgentStatus]);

  // ── Manual refresh: agent-status + change ─────────────────────────
  const refreshAll = useCallback(async () => {
    try {
      const [c, as] = await Promise.all([
        getChange(workspaceId, changeId),
        getAgentStatus(workspaceId, changeId),
      ]);
      setChange(c);
      setAgentStatus(as);
    } catch { /* silent */ }
  }, [workspaceId, changeId]);


  // Auto-load archive gate when entering archive stage
  useEffect(() => {
    if (change?.current_stage === "archive" && !archiveGate && !loadingArchiveGate) {
      void loadArchiveGate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [change?.current_stage]);

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

  // pending_review 为只读投影（task-03 后端 DTO），驱动 GATE_PANELS。
  // 无投影（null/undefined）时无审核面板。
  const gatePanel = GATE_PANELS[change.pending_review ?? ""];

  const handleGateAction = async (action: string) => {
    if (transitioning) return;
    setTransitioning(true);
    try {
      if (action === "proposal_approve") {
        await proposalReview(workspaceId, changeId, "approve", gateComment || undefined);
      } else if (action === "proposal_revise") {
        await proposalReview(workspaceId, changeId, "revise", gateComment || undefined);
      } else if (action === "proposal_unclear") {
        await proposalReview(workspaceId, changeId, "unclear", gateComment || undefined);
      } else if (action === "plan_approve") {
        await planReview(workspaceId, changeId, "approve", gateComment || undefined);
      } else if (action === "plan_replan") {
        await planReview(workspaceId, changeId, "replan", gateComment || undefined);
      } else if (action === "plan_back_to_propose") {
        await planReview(workspaceId, changeId, "back_to_propose", gateComment || undefined);
      } else if (action === "plan_back_to_brainstorm") {
        await planReview(workspaceId, changeId, "back_to_brainstorm", gateComment || undefined);
      } else if (action === "test_pass") {
        await humanTest(workspaceId, changeId, "pass", gateComment || undefined);
      } else if (action === "test_bug") {
        await humanTest(workspaceId, changeId, "bug", gateComment || undefined);
      } else if (action === "test_doc_mismatch") {
        await humanTest(workspaceId, changeId, "doc_mismatch", gateComment || undefined);
      } else if (action === "archive_confirm") {
        await archiveConfirm(workspaceId, changeId, gateComment || undefined);
      } else if (action === "transition_execute") {
        // task-09：transition_execute 分支也透传 team worker_preset + main_agent_config。
        const mainAgentConfig = teamMode
          ? {
              ...(stageProvider ? { provider: stageProvider } : {}),
              ...(stageModel ? { model: stageModel } : {}),
            }
          : undefined;
        await transitionChange(
          workspaceId,
          changeId,
          "execute",
          undefined,
          stageProvider,
          stageModel,
          teamMode,
          teamMode ? stageWorkers : undefined,
          mainAgentConfig,
        );
      }
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

  return (
    <PageContainer className="gap-5">
      <p className="text-[11px] text-muted-foreground">
        <Link href={`/workspaces/${workspaceId}/changes`} className="hover:underline">
          ← 变更列表
        </Link>
      </p>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <span className="truncate">{change.title ?? change.change_key}</span>
            {(() => {
              // quick/blocked/archived 三态走 STATUS_BADGE；
              // 主线 6 stage 走 WORKFLOW_STAGE_LABELS/COLORS；
              // 旧值（brownfield）走 ?? "未知" 兜底不崩。
              const stage = change.current_stage ?? "draft";
              const statusBadge = STATUS_BADGE[stage];
              if (statusBadge) {
                return (
                  <Badge variant={statusBadge.variant}>
                    {statusBadge.label}
                  </Badge>
                );
              }
              return (
                <Badge variant={WORKFLOW_STAGE_COLORS[stage] ?? "outline"}>
                  {WORKFLOW_STAGE_LABELS[stage] ?? stage ?? "未知"}
                </Badge>
              );
            })()}
          </span>
        }
        subtitle={
          <span className="flex flex-wrap gap-x-5 gap-y-0.5">
            <span>Key: <code className="font-mono">{change.change_key}</code></span>
            <span>类型: {change.change_type ?? "—"}</span>
            <span>位置: {change.location}</span>
            <span>影响: {change.affected_components.length > 0 ? change.affected_components.join(", ") : "—"}</span>
          </span>
        }
      />

      {change.current_stage && (() => {
        const currentIndex = WORKFLOW_STAGES.indexOf(change.current_stage as typeof WORKFLOW_STAGES[number]);
        if (currentIndex < 0) return null;
        const stagesObj = change.stages as Record<string, { lastActive?: string }> | null;
        const lastActive = stagesObj?.[change.current_stage]?.lastActive ?? change.updated_at;
        return (
          <div className="rounded-md border bg-card px-3 py-2">
            <div className="flex flex-wrap items-center gap-1">
              {WORKFLOW_STAGES.map((stage, i) => {
                const isCompleted = currentIndex > i;
                const isCurrent = currentIndex === i;
                return (
                  <div key={stage} className="flex items-center">
                    <div
                      className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-medium ${
                        isCurrent
                          ? "bg-primary text-primary-foreground"
                          : isCompleted
                            ? "bg-emerald-500 text-white"
                            : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {isCompleted ? "✓" : i + 1}
                    </div>
                    <span
                      className={`ml-1 text-[11px] ${
                        isCurrent ? "text-foreground font-medium" : "text-muted-foreground"
                      }`}
                    >
                      {WORKFLOW_STAGE_LABELS[stage]}
                    </span>
                    {i < WORKFLOW_STAGES.length - 1 && <div className="mx-1 h-px w-3 bg-border" />}
                  </div>
                );
              })}
            </div>
            {lastActive && (
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                当前阶段: {new Date(lastActive).toLocaleString()}
              </p>
            )}
          </div>
        );
      })()}

      <div className="flex items-center gap-2">
        <Link
          href={`/workspaces/${workspaceId}/changes/${changeId}/tasks`}
          className="inline-flex h-7 items-center rounded bg-primary px-2 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          任务看板
        </Link>
        {!gatePanel && (agentStatus?.has_active_run || agentStatus?.config_enabled) && (
          <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2">
            <div className="h-2 w-2 animate-pulse rounded-full bg-primary" />
            <span className="text-xs text-muted-foreground">
              智能体正在执行 {WORKFLOW_STAGE_LABELS[change.current_stage ?? "draft"] ?? change.current_stage} 阶段
            </span>
          </div>
        )}
      </div>

      {gatePanel && (
        <section className="rounded-md border-2 border-primary/20 bg-primary/5 px-4 py-3 space-y-2.5">
          <div>
            <p className="text-sm font-semibold">{gatePanel.title}</p>
            <p className="text-xs text-muted-foreground">{gatePanel.description}</p>
          </div>
          <textarea
            className="w-full rounded border border-input bg-background px-2.5 py-1.5 text-xs focus:border-ring focus:outline-none"
            rows={2}
            placeholder="审核意见（可选）"
            value={gateComment}
            onChange={(e) => setGateComment(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            {gatePanel.actions.map((a) => (
              <Button
                key={a.action}
                variant={a.variant}
                size="sm"
                onClick={() => void handleGateAction(a.action)}
                disabled={transitioning}
              >
                {a.label}
              </Button>
            ))}
          </div>
        </section>
      )}

      {/* ── Agent Provider Override（FR-02）─────────────────────── */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          Agent provider（阶段流转 / 手动派发时生效）
        </span>
        <AgentProviderSelect
          value={stageProvider}
          onChange={setStageProvider}
          includeDefault="跟随工作区默认"
        />
        <AgentModelInput
          value={stageModel}
          onChange={setStageModel}
          className="w-[260px]"
        />
      </div>

      {/* ── team-mode 开关（task-08，D-002）────────────────────── */}
      {/* execute + verify stage 可配 team（v1 D-002：brainstorm/plan 不 team）。
          渲染时机：plan 审核通过将进 execute / 已在 execute / 已在 verify / human_test 待流转。
          紫色对齐 mission-console task-07（violet-500）。默认 false 零回归。 */}
      {(change.pending_review === "plan_review" ||
        change.current_stage === "execute" ||
        change.current_stage === "verify" ||
        change.pending_review === "human_test") && (
        <div className="space-y-2">
          <label className="flex items-center gap-2.5 rounded-md border border-violet-500/40 bg-violet-50 px-3 py-2 text-xs">
            <button
              type="button"
              role="switch"
              aria-checked={teamMode}
              aria-label="用团队执行"
              onClick={() => setTeamMode(!teamMode)}
              className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                teamMode ? "bg-violet-500" : "bg-muted"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  teamMode ? "translate-x-4" : "translate-x-0.5"
                }`}
              />
            </button>
            <span className="font-medium text-violet-900">用团队{change.current_stage === "verify" ? "验证" : "执行"}</span>
            <span className="text-muted-foreground">
              （多 worker 并行{change.current_stage === "verify" ? "核验" : "写"}，主 agent 指挥 + 合并）
            </span>
          </label>

          {/* team 开启时展开 stage worker 预设（task-08 / D-002@v2）。
              stage 化：execute→impl workers，verify→verify workers。
              具体透传给 backend 走 task-09 三入口接通。 */}
          {teamMode && (
            <StageTeamConfig
              stage={change.current_stage === "verify" ? "verify" : "execute"}
              workers={stageWorkers}
              onWorkersChange={setStageWorkers}
              provider={stageProvider ?? undefined}
              model={stageModel ?? undefined}
            />
          )}
        </div>
      )}

      {/* ── TeamProgress（task-08）：stage team mission 进度展示 ────── */}
      {/* task-09 接通：transition team_mode dispatch 返回 mission_id 时展示。 */}
      {teamMode && stageTeamMissionId && (
        <TeamProgress
          missionId={stageTeamMissionId}
          workspaceId={workspaceId}
        />
      )}

      {/* ── SillySpec Step Progress ─────────────────────────────── */}
      <SillySpecStepProgress
        currentStage={change.current_stage}
        steps={(() => {
            const stages = change.stages as Record<string, unknown> | null;
            if (!stages || !change.current_stage) return undefined;
            // Try top-level steps first (legacy)
            const topLevel = stages.steps;
            if (Array.isArray(topLevel)) return topLevel as StepInfo[];
            // Try nested under current stage: stages[current_stage].steps = {completed:[], pending:[]}
            const stageData = stages[change.current_stage] as Record<string, unknown> | undefined;
            if (stageData?.steps && typeof stageData.steps === "object" && !Array.isArray(stageData.steps)) {
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
          })()}
        hasActiveRun={agentStatus?.has_active_run ?? false}
        configEnabled={agentStatus?.config_enabled ?? false}
        lastDispatchStatus={agentStatus?.last_dispatch?.status as "running" | "completed" | "failed" | null}
        lastDispatchFinishedAt={agentStatus?.last_dispatch?.finished_at}
        lastDispatchSummary={agentStatus?.last_dispatch?.output_summary}
        onRefresh={() => void refreshAgentStatus()}
        refreshing={loadingAgentStatus}
        onDispatch={() => void handleDispatch()}
        dispatching={dispatching}
        stageLabels={WORKFLOW_STAGE_LABELS}
      />

      {/* ── Agent 执行日志（AgentRunPanel 接管 SSE + 审批 + input，FR-01/FR-04）── */}
      {panelRunId && (
        <div className="rounded-md border bg-card">
          <button
            className="flex w-full items-center justify-between border-b px-3 py-2 text-left"
            onClick={() => setLogsExpanded(!logsExpanded)}
          >
              <div className="flex items-center gap-2">
                <h2 className="text-xs font-medium">智能体执行日志</h2>
                {/* task-12 / design §5.7：gate_status 徽标。数据源合并——SSE gate_status_changed
                    （实时优先）回退 agentStatus.last_dispatch.gate_status（初始/刷新，gate 已
                    decided 不再发 SSE 时兜底）。pending/running→客观核验中；decided+无 errors→
                    已通过；decided+errors / failed→核验失败（附 errors 摘要）。 */}
                {(() => {
                  const gs =
                    gateStatus?.gate_status ??
                    agentStatus?.last_dispatch?.gate_status ??
                    null;
                  if (!gs) return null;
                  const errs =
                    gateStatus?.errors_summary ??
                    (agentStatus?.last_dispatch?.gate_result?.errors?.length
                      ? String(agentStatus.last_dispatch.gate_result.errors).slice(0, 500)
                      : null);
                  const isRunning = gs === "pending" || gs === "running";
                  const isPassed = gs === "decided" && !errs;
                  const isFailed = gs === "failed" || (gs === "decided" && !!errs);
                  return (
                    <Badge
                      variant={isPassed ? "success" : isFailed ? "destructive" : "outline"}
                      className={isRunning ? "animate-pulse" : ""}
                    >
                      {isPassed ? "✓ 已通过" : isFailed ? "✗ 核验失败" : "客观核验中…"}
                    </Badge>
                  );
                })()}
                <span className="text-[11px] text-muted-foreground">
                  {agentStatus?.last_dispatch?.status ? ` · ${agentStatus.last_dispatch.status}` : ""}
                </span>
              </div>
            <span className="text-[11px] text-muted-foreground">
              {logsExpanded ? "▾ 收起" : "▸ 展开"}
            </span>
          </button>
          {logsExpanded && (
            <div className="p-2">
              <AgentRunPanel
                workspaceId={workspaceId}
                runId={panelRunId}
                isActive={panelIsActive}
                title="智能体执行日志"
                isLive={panelIsActive}
                summary={
                  <span className="text-[11px] text-muted-foreground">
                    {agentStatus?.last_dispatch?.status ? ` · ${agentStatus.last_dispatch.status}` : ""}
                  </span>
                }
                onDone={handleChangesRunDone}
                onGateStatusChanged={setGateStatus}
              />
            </div>
          )}
        </div>
      )}

      {pageError && (
        <div className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
          {pageError}
        </div>
      )}

      {successMsg && (
        <div className="rounded border border-green-300 bg-green-50 px-3 py-2 text-xs text-green-700">
          {successMsg}
        </div>
      )}

      {/* ── 会话（变更级问答/调试，2026-07-09-change-detail-session / FR-05）── */}
      <section className="rounded-md border bg-card">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <h2 className="text-xs font-medium">会话</h2>
          <span className="text-[11px] text-muted-foreground">在该变更上下文中提问 / 调试</span>
        </div>
        <div className="p-3">
          <ChangeSessionSection workspaceId={workspaceId} changeId={changeId} />
        </div>
      </section>

      <section className="rounded-md border bg-card">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <h2 className="text-xs font-medium">变更文件</h2>
        </div>
        <div className="p-3">
          <ChangeFileTree workspaceId={workspaceId} changeId={changeId} />
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <aside className="space-y-3">
          {change.approval_status && change.approval_status !== "not_required" && (
            <section className="rounded-md border bg-card">
              <div className="border-b px-3 py-2">
                <h2 className="text-xs font-medium">审批状态</h2>
              </div>
              <div className="px-3 py-2 space-y-2">
                <div className="flex items-center gap-2">
                  <Badge
                    variant={
                      change.approval_status === "approved"
                        ? "success"
                        : change.approval_status === "rejected"
                          ? "destructive"
                          : "warning"
                    }
                  >
                    {APPROVAL_LABELS[change.approval_status] ?? change.approval_status}
                  </Badge>
                </div>
                {change.approval_status === "rejected" && change.rejection_reason && (
                  <p className="text-xs text-destructive">驳回原因：{change.rejection_reason}</p>
                )}
                {change.approval_status === "approved" && change.approved_by && (
                  <p className="text-[11px] text-muted-foreground">
                    审批人: {change.approved_by}
                    {change.approved_at && ` · ${new Date(change.approved_at).toLocaleString()}`}
                  </p>
                )}
                {change.approval_status === "pending" && (
                  <div className="space-y-2 pt-1">
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => void handleApprove()} disabled={transitioning}>
                        批准
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => setShowRejectInput(!showRejectInput)}
                        disabled={transitioning}
                      >
                        驳回
                      </Button>
                    </div>
                    {showRejectInput && (
                      <div className="space-y-2">
                        <input
                          type="text"
                          className="w-full rounded border border-input bg-background px-2.5 py-1.5 text-xs focus:border-ring focus:outline-none"
                          placeholder="输入驳回原因"
                          value={rejectionInput}
                          onChange={(e) => setRejectionInput(e.target.value)}
                        />
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => void handleReject()}
                          disabled={transitioning || !rejectionInput.trim()}
                        >
                          确认驳回
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </section>
          )}

          <section className="rounded-md border bg-card">
            <div className="border-b px-3 py-2">
              <h2 className="text-xs font-medium">审查记录 ({reviews.length})</h2>
            </div>
            {reviews.length === 0 ? (
              <p className="px-3 py-3 text-xs text-muted-foreground">暂无审查记录。</p>
            ) : (
              <div className="divide-y">
                {reviews.map((r) => (
                  <div key={r.id} className="px-3 py-2 text-xs">
                    <div className="flex items-center gap-1.5">
                      <Badge variant={r.verdict === "approve" ? "success" : "destructive"}>
                        {r.verdict === "approve" ? "通过" : "驳回"}
                      </Badge>
                      <span className="text-[11px] text-muted-foreground">
                        {new Date(r.created_at).toLocaleDateString()}
                      </span>
                    </div>
                    {r.comment && (
                      <p className="mt-1 text-muted-foreground">{r.comment}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {change.affected_components.length > 0 && (
            <section className="rounded-md border bg-card">
              <div className="border-b px-3 py-2">
                <h2 className="text-xs font-medium">影响组件</h2>
              </div>
              <div className="flex flex-col gap-1.5 px-3 py-2">
                {change.affected_components.map((comp) => (
                  <div
                    key={comp}
                    className="flex items-center gap-2 rounded-md bg-muted/40 px-3 py-1.5 text-xs"
                  >
                    <span>{getComponentEmoji(comp)}</span>
                    <span className="font-medium">{comp}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {taskBoard && taskBoard.columns.length > 0 && (() => {
            const total = taskBoard.columns.reduce((s, c) => s + c.count, 0);
            const doneCol = taskBoard.columns.find((c) => c.status === "done" || c.status === "completed");
            const doneCount = doneCol?.count ?? 0;
            const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;
            return (
              <section className="rounded-md border bg-card">
                <div className="flex items-center justify-between border-b px-3 py-2">
                  <h2 className="text-xs font-medium">任务进度</h2>
                  <Link
                    href={`/workspaces/${workspaceId}/changes/${changeId}/tasks`}
                    className="text-[11px] text-primary hover:underline"
                  >
                    查看看板
                  </Link>
                </div>
                <div className="px-3 py-2">
                  <div className="mb-1.5 flex items-center justify-between text-[11px]">
                    <span className="text-muted-foreground">总体进度</span>
                    <span className="text-foreground">{doneCount} / {total} 完成</span>
                  </div>
                  <div className="mb-3 h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {taskBoard.columns.map((col) => (
                      <div key={col.status} className="flex items-center gap-2 text-[11px]">
                        <Badge
                          variant={
                            col.status === "done" || col.status === "completed"
                              ? "success"
                              : col.status === "in_progress"
                                ? "default"
                                : col.status === "blocked"
                                  ? "destructive"
                                  : "outline"
                          }
                          className="min-w-[24px] justify-center"
                        >
                          {col.count}
                        </Badge>
                        <span className="text-muted-foreground">{col.status}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            );
          })()}

          {["proposed", "reviewed"].includes(change.status) && (
            <section className="rounded-md border bg-card p-3">
              <h3 className="mb-2">提交审查</h3>
              <textarea
                className="mb-2 w-full rounded border border-input bg-background px-2.5 py-1.5 text-xs focus:border-ring focus:outline-none"
                rows={3}
                placeholder="审查意见（可选）"
                value={reviewComment}
                onChange={(e) => setReviewComment(e.target.value)}
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => void handleSubmitReview("approve")}
                  disabled={transitioning}
                >
                  通过
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => void handleSubmitReview("reject")}
                  disabled={transitioning}
                >
                  驳回
                </Button>
              </div>
            </section>
          )}
        </aside>
      </div>
    </PageContainer>
  );
}
