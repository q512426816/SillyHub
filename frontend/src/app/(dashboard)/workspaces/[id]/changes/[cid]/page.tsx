"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import {
  approveChange,
  executeChange,
  getChange,
  getChangeDocumentContent,
  getChangeDocuments,
  rejectChange,
  submitFeedback,
  checkArchiveGate,
  getAgentStatus,
  triggerDispatch,
  proposalReview,
  planReview,
  humanTest,
  archiveConfirm,
  type ChangeDocContent,
  type ChangeDocMatrix,
  type ChangeRead,
  type ArchiveGateResponse,
  type DispatchResponse,
  type HumanGate,
} from "@/lib/changes";
import { SillySpecStepProgress, type StepInfo } from "@/components/sillyspec-step-progress";
import {
  streamAgentRunLogs,
  getAgentRunLogs,
  type AgentRunLogEntry,
  type StreamLogEvent,
} from "@/lib/agent";
import { getTaskBoard, type TaskBoard } from "@/lib/tasks";
import {
  listReviews,
  submitReview,
  transitionChange,
  type ReviewEntry,
} from "@/lib/workflow";

interface Props {
  params: { id: string; cid: string };
}

// ── Workflow Stages (unified with SillySpec) ───────────────────────
const WORKFLOW_STAGES = [
  "draft", "scan", "brainstorm", "propose", "plan",
  "execute", "verify", "quick", "archive", "archived", "blocked",
] as const;

const WORKFLOW_STAGE_LABELS: Record<string, string> = {
  draft: "草稿", scan: "扫描", brainstorm: "需求分析",
  propose: "提案", plan: "规划", execute: "执行",
  verify: "验证", archive: "归档", quick: "快速修复",
  archived: "已归档", blocked: "已阻塞",
};

const WORKFLOW_STAGE_COLORS: Record<string, "success" | "outline" | "destructive" | "default" | "warning"> = {
  draft: "outline", scan: "default", brainstorm: "warning",
  propose: "warning", plan: "default", execute: "default",
  verify: "warning", archive: "default", quick: "default",
  archived: "success", blocked: "destructive",
};

// Gate panel config: what to show for each human_gate value
const GATE_PANELS: Record<string, {
  title: string;
  description: string;
  actions: { label: string; variant: "default" | "outline" | "destructive"; action: string }[];
}> = {
  need_requirement_input: {
    title: "请补充需求",
    description: "Agent 分析后认为需求不够明确，请补充详细信息",
    actions: [{ label: "重新分析需求", variant: "default", action: "redispatch_brainstorm" }],
  },
  need_proposal_review: {
    title: "四件套已生成，请确认",
    description: "Agent 已生成 proposal / requirements / design / tasks，请审阅后决定",
    actions: [
      { label: "确认通过", variant: "default", action: "proposal_approve" },
      { label: "需要修改", variant: "outline", action: "proposal_revise" },
      { label: "需求不明确", variant: "destructive", action: "proposal_unclear" },
    ],
  },
  need_plan_review: {
    title: "执行计划已生成，请确认",
    description: "Agent 已生成执行计划，请审阅后决定",
    actions: [
      { label: "确认计划", variant: "default", action: "plan_approve" },
      { label: "重新计划", variant: "outline", action: "plan_replan" },
      { label: "退回文档", variant: "destructive", action: "plan_back_to_propose" },
      { label: "退回需求", variant: "destructive", action: "plan_back_to_brainstorm" },
    ],
  },
  need_human_test: {
    title: "自动验证通过，请人工测试",
    description: "Agent 已完成自动验证，请进行人工测试",
    actions: [
      { label: "测试通过", variant: "default", action: "test_pass" },
      { label: "发现 BUG", variant: "destructive", action: "test_bug" },
      { label: "文档不符", variant: "outline", action: "test_doc_mismatch" },
    ],
  },
  need_archive_confirm: {
    title: "归档确认",
    description: "所有验证已通过，确认归档此变更",
    actions: [{ label: "确认归档", variant: "default", action: "archive_confirm" }],
  },
  blocked: {
    title: "需要人工介入",
    description: "Agent 自动修复达到上限，需要人工处理",
    actions: [
      { label: "退回执行", variant: "outline", action: "transition_execute" },
    ],
  },
};

const APPROVAL_LABELS: Record<string, string> = {
  pending: "待审批",
  approved: "已批准",
  rejected: "已驳回",
  not_required: "无需审批",
};

const DOC_TABS = [
  "MASTER",
  "proposal",
  "requirements",
  "design",
  "plan",
  "tasks",
  "verify_result",
  "module_impact",
  "prototypes",
  "references",
] as const;

const DOC_LABELS: Record<string, string> = {
  MASTER: "MASTER.md",
  proposal: "proposal.md",
  requirements: "requirements.md",
  design: "design.md",
  plan: "plan.md",
  tasks: "tasks.md",
  verify_result: "verify-result.md",
  module_impact: "module-impact.md",
  prototypes: "prototypes",
  references: "references",
};

// 必需文档（四件套）— 完整度"就绪"计数只以此为分母
const REQUIRED_DOCS = ["proposal", "design", "requirements", "tasks"] as const;
// 可选/阶段性文档 — 单独展示存在状态，不计入完整度分母
const OPTIONAL_DOCS = [
  "plan",
  "verify_result",
  "module_impact",
  "MASTER",
  "prototypes",
  "references",
] as const;

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
  const [matrix, setMatrix] = useState<ChangeDocMatrix | null>(null);
  const [activeDoc, setActiveDoc] = useState<string>("MASTER");
  const [docContent, setDocContent] = useState<ChangeDocContent | null>(null);
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

  // ── Feedback form state (task-06) ──────────────────────────────────
  const [feedbackCategory, setFeedbackCategory] = useState<string>("");
  const [feedbackText, setFeedbackText] = useState("");
  const [submittingFeedback, setSubmittingFeedback] = useState(false);

  // ── Archive gate state (task-06) ───────────────────────────────────
  const [archiveGate, setArchiveGate] = useState<ArchiveGateResponse | null>(null);
  const [loadingArchiveGate, setLoadingArchiveGate] = useState(false);
  const [archiving, setArchiving] = useState(false);

  // ── Agent Dispatch state ───────────────────────────────────────────
  const [agentStatus, setAgentStatus] = useState<DispatchResponse | null>(null);
  const [loadingAgentStatus, setLoadingAgentStatus] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [gateComment, setGateComment] = useState("");

  // ── Agent Log Stream state ──────────────────────────────────────────
  const [agentLogs, setAgentLogs] = useState<AgentRunLogEntry[]>([]);
  const [logsExpanded, setLogsExpanded] = useState(false);
  const [logStreaming, setLogStreaming] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setPageError(null);
      setLoadError(null);
      try {
        const [c, m, r, tb, as] = await Promise.all([
          getChange(workspaceId, changeId),
          getChangeDocuments(workspaceId, changeId),
          listReviews(workspaceId, changeId).catch(() => []),
          getTaskBoard(workspaceId, changeId).catch(() => null),
          getAgentStatus(workspaceId, changeId).catch(() => null),
        ]);
        setChange(c);
        setMatrix(m);
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

  const handleDocSelect = async (docType: string) => {
    setActiveDoc(docType);
    setLoadingDoc(true);
    setDocContent(null);
    try {
      if (docType === "prototypes" || docType === "references") {
        setDocContent(null);
      } else {
        const content = await getChangeDocumentContent(workspaceId, changeId, docType);
        setDocContent(content);
      }
    } catch {
      setDocContent(null);
    } finally {
      setLoadingDoc(false);
    }
  };

  const handleTransition = async (targetStage: string) => {
    if (!change) return;
    setTransitioning(true);
    setPageError(null);
    try {
      const result = await transitionChange(workspaceId, changeId, targetStage);
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
        setSuccessMsg(`🤖 Agent 已自动派发 (${result.agent_dispatch.phase ?? targetStage})`);
        setTimeout(() => setSuccessMsg(null), 4000);
      } else if (result.agent_dispatch && !result.agent_dispatch.dispatched) {
        const reason = result.agent_dispatch.reason;
        if (reason === "active_run_exists") {
          setSuccessMsg("⚠️ Agent 已在运行中，跳过重复派发");
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

  const docExistsMap = new Map(matrix?.documents.map((d) => [d.doc_type, d]) ?? []);

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
      const result = await executeChange(workspaceId, change.change_key);
      if (result.ok) {
        // Refresh change data after successful execution
        const updated = await getChange(workspaceId, changeId);
        setChange(updated);
        setSuccessMsg("✅ Agent 执行已启动 (run_id: " + (result.run_id?.slice(0, 8) ?? "unknown") + ")");
        setTimeout(() => setSuccessMsg(null), 5000);
      }
    } catch (err) {
      setPageError(err instanceof ApiError ? err.message : "启动执行失败");
    } finally {
      setExecuting(false);
    }
  };

  // ── Feedback submit handler (task-06) ────────────────────────────
  const handleSubmitFeedback = async () => {
    if (!change || !feedbackCategory || !feedbackText.trim()) return;
    setSubmittingFeedback(true);
    setPageError(null);
    try {
      const result = await submitFeedback(
        workspaceId,
        changeId,
        feedbackCategory,
        feedbackText.trim(),
      );
      setChange({
        ...change,
        current_stage: result.current_stage ?? change.current_stage,
        status: result.status ?? change.status,
      });
      setFeedbackCategory("");
      setFeedbackText("");
      setSuccessMsg("✅ 反馈已提交");
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err) {
      setPageError(err instanceof ApiError ? err.message : "提交反馈失败");
    } finally {
      setSubmittingFeedback(false);
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
  const refreshAgentStatus = async () => {
    setLoadingAgentStatus(true);
    try {
      const as = await getAgentStatus(workspaceId, changeId);
      setAgentStatus(as);
    } catch { /* silent */ } finally {
      setLoadingAgentStatus(false);
    }
  };

  const handleDispatch = async () => {
    setDispatching(true);
    setPageError(null);
    try {
      const result = await triggerDispatch(workspaceId, changeId);
      setAgentStatus(result);
      if (result.has_active_run) {
        setSuccessMsg("🤖 Agent 已触发执行");
        setTimeout(() => setSuccessMsg(null), 3000);
      }
    } catch (err) {
      setPageError(err instanceof ApiError ? err.message : "触发 Agent 失败");
    } finally {
      setDispatching(false);
    }
  };

  const handleArchive = async () => {
    if (!change) return;
    setArchiving(true);
    setPageError(null);
    try {
      await handleTransition("archived");
      setSuccessMsg("📦 变更已归档");
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err) {
      setPageError(err instanceof ApiError ? err.message : "归档失败");
    } finally {
      setArchiving(false);
    }
  };

  // ── Agent Log Stream ────────────────────────────────────────────────
  const activeRunId = agentStatus?.last_dispatch?.run_id ?? null;
  const isRunActive = agentStatus?.has_active_run ?? false;

  const loadHistoryLogs = useCallback(() => {
    if (!activeRunId || !workspaceId) return;
    getAgentRunLogs(workspaceId, activeRunId)
      .then((logs) => setAgentLogs(logs))
      .catch(() => {});
  }, [activeRunId, workspaceId]);

  const connectLogStream = useCallback(() => {
    if (!activeRunId || !workspaceId || eventSourceRef.current) return;
    if (!isRunActive) {
      // Not running — just load history
      loadHistoryLogs();
      return;
    }
    setLogStreaming(true);
    // Load historical logs first
    loadHistoryLogs();
    // Connect SSE for real-time updates
    const es = streamAgentRunLogs(
      workspaceId,
      activeRunId,
      (evt: StreamLogEvent) => {
        setAgentLogs((prev) => {
          if (evt.log_id && prev.some((l) => l.id === evt.log_id)) return prev;
          return [
            ...prev,
            {
              id: evt.log_id ?? crypto.randomUUID(),
              run_id: activeRunId,
              timestamp: evt.timestamp,
              channel: evt.channel,
              content_redacted: evt.content,
            },
          ];
        });
      },
      () => {
        setLogStreaming(false);
        eventSourceRef.current = null;
        void refreshAgentStatus();
      },
      () => {
        setLogStreaming(false);
        eventSourceRef.current = null;
      },
    );
    eventSourceRef.current = es;
  }, [activeRunId, workspaceId, isRunActive, loadHistoryLogs]);

  // Connect when logs expanded
  useEffect(() => {
    if (logsExpanded && activeRunId && !eventSourceRef.current) {
      connectLogStream();
    }
    if (!activeRunId && eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
      setLogStreaming(false);
    }
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [logsExpanded, activeRunId, connectLogStream]);

  // Auto-scroll logs
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [agentLogs]);

  // Auto-load archive gate when entering archive stage
  useEffect(() => {
    if (change?.current_stage === "archive" && !archiveGate && !loadingArchiveGate) {
      void loadArchiveGate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [change?.current_stage]);

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-6">
        <p className="text-xs text-muted-foreground">加载中…</p>
      </div>
    );
  }

  if (loadError || !change) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-6">
        <div className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
          {loadError ?? "变更未找到"}
        </div>
        <Link
          href={`/workspaces/${workspaceId}/changes`}
          className="mt-3 inline-block text-xs text-primary hover:underline"
        >
          ← 变更列表
        </Link>
      </div>
    );
  }

  const humanGate = (change.human_gate ?? "none") as HumanGate;
  const gatePanel = GATE_PANELS[humanGate];

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
        await transitionChange(workspaceId, changeId, "execute");
      }
      setGateComment("");
      const updated = await getChange(workspaceId, changeId);
      setChange(updated);
    } catch (err) {
      setPageError(err instanceof ApiError ? err.message : "操作失败");
    } finally {
      setTransitioning(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 px-6 py-6">
      <header>
        <p className="text-[11px] text-muted-foreground">
          <Link href={`/workspaces/${workspaceId}/changes`} className="hover:underline">
            ← 变更列表
          </Link>
        </p>
        <div className="mt-0.5 flex items-center gap-2">
          <h1 className="truncate">{change.title ?? change.change_key}</h1>
          <Badge variant={WORKFLOW_STAGE_COLORS[change.current_stage ?? "draft"] ?? "outline"}>
            {WORKFLOW_STAGE_LABELS[change.current_stage ?? "draft"] ?? change.current_stage ?? "未知"}
          </Badge>
        </div>
        <div className="mt-1 flex flex-wrap gap-x-5 gap-y-0.5 text-xs text-muted-foreground">
          <span>Key: <code className="font-mono">{change.change_key}</code></span>
          <span>类型: {change.change_type ?? "—"}</span>
          <span>位置: {change.location}</span>
          <span>影响: {change.affected_components.length > 0 ? change.affected_components.join(", ") : "—"}</span>
        </div>
      </header>

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

      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/workspaces/${workspaceId}/changes/${changeId}/tasks`}
          className="inline-flex h-7 items-center rounded bg-primary px-2 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          任务看板
        </Link>
        {gatePanel && (
          <div className="rounded-md border bg-card px-3 py-2.5 space-y-2">
            <div>
              <p className="text-sm font-medium">{gatePanel.title}</p>
              <p className="text-[11px] text-muted-foreground">{gatePanel.description}</p>
            </div>
            <textarea
              className="w-full rounded border border-input bg-background px-2.5 py-1.5 text-xs focus:border-ring focus:outline-none"
              rows={2}
              placeholder="审核意见（可选）"
              value={gateComment}
              onChange={(e) => setGateComment(e.target.value)}
            />
            <div className="flex flex-wrap gap-1.5">
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
          </div>
        )}
        {humanGate === "none" && (agentStatus?.has_active_run || agentStatus?.config_enabled) && (
          <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2">
            <div className="h-2 w-2 animate-pulse rounded-full bg-primary" />
            <span className="text-xs text-muted-foreground">
              Agent 正在执行 {WORKFLOW_STAGE_LABELS[change.current_stage ?? "draft"] ?? change.current_stage} 阶段
            </span>
          </div>
        )}
      </div>

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

      {/* ── Agent Log Viewer ────────────────────────────────────── */}
      {activeRunId && (
        <section className="rounded-md border bg-card">
          <button
            className="flex w-full items-center justify-between border-b px-3 py-2 text-left"
            onClick={() => {
              const next = !logsExpanded;
              setLogsExpanded(next);
              if (next && !agentLogs.length) {
                void loadHistoryLogs();
              }
            }}
          >
            <div className="flex items-center gap-2">
              <h2 className="text-xs font-medium">Agent 执行日志</h2>
              {logStreaming && (
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                </span>
              )}
              {!logStreaming && agentStatus?.last_dispatch?.status === "failed" && (
                <span className="inline-block h-2 w-2 rounded-full bg-red-500" />
              )}
              {!logStreaming && agentStatus?.last_dispatch?.status === "completed" && (
                <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
              )}
              <span className="text-[11px] text-muted-foreground">
                {agentLogs.length > 0 ? `${agentLogs.length} 条` : ""}
                {agentStatus?.last_dispatch?.status ? ` · ${agentStatus.last_dispatch.status}` : ""}
              </span>
            </div>
            <span className="text-[11px] text-muted-foreground">
              {logsExpanded ? "▾ 收起" : "▸ 展开"}
            </span>
          </button>
          {logsExpanded && (
            <div className="max-h-80 overflow-auto px-3 py-2 font-mono text-[11px] leading-relaxed">
              {agentLogs.length === 0 ? (
                <p className="text-muted-foreground">暂无日志…</p>
              ) : (
                agentLogs.map((log) => (
                  <div key={log.id} className="flex gap-2 py-0.5">
                    <span className="shrink-0 text-muted-foreground">
                      {log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : ""}
                    </span>
                    <span
                      className={`shrink-0 rounded px-1 text-[10px] font-semibold ${
                        log.channel === "tool_call"
                          ? "bg-blue-100 text-blue-700"
                          : log.channel === "stderr"
                            ? "bg-amber-100 text-amber-700"
                            : log.channel === "pending_input"
                              ? "bg-amber-100 text-amber-700"
                              : log.channel === "user_input"
                                ? "bg-blue-100 text-blue-700"
                                : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {log.channel === "tool_call"
                        ? "TOOL"
                        : log.channel === "stderr"
                          ? "WARN"
                          : log.channel === "pending_input"
                            ? "INPUT"
                            : log.channel === "user_input"
                              ? "SENT"
                              : "INFO"}
                    </span>
                    <span className="min-w-0 flex-1 whitespace-pre font-mono text-foreground">
                      {log.content_redacted}
                    </span>
                  </div>
                ))
              )}
              <div ref={logEndRef} />
            </div>
          )}
        </section>
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

      <section className="rounded-md border bg-card">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <h2 className="text-xs font-medium">变更文档完整性</h2>
          <span className="text-[11px] text-muted-foreground">
            {REQUIRED_DOCS.filter((dt) => docExistsMap.get(dt)?.exists ?? false).length}
            /{REQUIRED_DOCS.length} 必需文档就绪
          </span>
        </div>
        <div className="space-y-2 px-3 py-3">
          <div>
            <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              必需文档
            </p>
            <div className="flex flex-wrap gap-2">
              {REQUIRED_DOCS.map((dt) => {
                const exists = docExistsMap.get(dt)?.exists ?? false;
                const bg = exists
                  ? "bg-emerald-50 border-emerald-200/60"
                  : "bg-red-50 border-red-200/60";
                const textColor = exists ? "text-emerald-600" : "text-destructive";
                return (
                  <div
                    key={dt}
                    className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 ${bg}`}
                  >
                    <span className={`text-[11px] ${textColor}`}>{exists ? "✓" : "✗"}</span>
                    <span className={`text-[11px] font-medium ${textColor}`}>
                      {DOC_LABELS[dt] ?? `${dt}.md`}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              可选 / 阶段性文档
            </p>
            <div className="flex flex-wrap gap-2">
              {OPTIONAL_DOCS.map((dt) => {
                const isSpecial = dt === "prototypes" || dt === "references";
                const count = isSpecial
                  ? dt === "prototypes"
                    ? (matrix?.prototypes.length ?? 0)
                    : (matrix?.references.length ?? 0)
                  : 0;
                const exists = isSpecial
                  ? count > 0
                  : (docExistsMap.get(dt)?.exists ?? false);

                let bg = "bg-gray-100 border-gray-200";
                let textColor = "text-gray-400";
                let icon = "—";
                if (exists) {
                  bg = "bg-emerald-50 border-emerald-200/60";
                  textColor = "text-emerald-600";
                  icon = isSpecial ? "◐" : "✓";
                }

                return (
                  <div
                    key={dt}
                    className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 ${bg}`}
                  >
                    <span className={`text-[11px] ${textColor}`}>{icon}</span>
                    <span className={`text-[11px] font-medium ${textColor}`}>
                      {DOC_LABELS[dt] ?? `${dt}.md`}
                      {isSpecial && count > 0 && ` (${count})`}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <section className="rounded-md border bg-card">
          <div className="flex flex-wrap gap-px border-b bg-muted/40 px-2 pt-1.5">
            {DOC_TABS.map((dt) => {
              const doc = docExistsMap.get(dt);
              const isSpecial = dt === "prototypes" || dt === "references";
              const count = isSpecial
                ? dt === "prototypes"
                  ? (matrix?.prototypes.length ?? 0)
                  : (matrix?.references.length ?? 0)
                : 0;
              const exists = isSpecial ? count > 0 : (doc?.exists ?? false);

              return (
                <button
                  key={dt}
                  onClick={() => handleDocSelect(dt)}
                  className={`rounded-t px-2.5 py-1 text-[11px] font-medium transition-colors ${
                    activeDoc === dt
                      ? "bg-card text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {dt === "verify_result"
                    ? "verify"
                    : dt === "module_impact"
                      ? "module-impact"
                      : dt}
                  {!isSpecial && !exists && (
                    <span className="ml-0.5 opacity-40">∅</span>
                  )}
                  {isSpecial && count > 0 && (
                    <span className="ml-0.5 rounded bg-muted px-1 text-[10px]">
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="p-3">
            {loadingDoc ? (
              <p className="text-xs text-muted-foreground">加载中…</p>
            ) : activeDoc === "prototypes" ? (
              matrix && matrix.prototypes.length > 0 ? (
                <ul className="space-y-0.5">
                  {matrix.prototypes.map((p) => (
                    <li key={p} className="font-mono text-[11px]">{p}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">无 prototype 文件。</p>
              )
            ) : activeDoc === "references" ? (
              matrix && matrix.references.length > 0 ? (
                <ul className="space-y-0.5">
                  {matrix.references.map((r) => (
                    <li key={r} className="font-mono text-[11px]">{r}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">无 reference 文件。</p>
              )
            ) : docContent ? (
              docContent.exists ? (
                <pre className="max-h-[500px] overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-4">
                  {docContent.content}
                </pre>
              ) : (
                <p className="text-xs text-muted-foreground">
                  文档 <code>{activeDoc}</code> 尚未创建。
                </p>
              )
            ) : (
              <p className="text-xs text-muted-foreground">选择一个 Tab 查看内容。</p>
            )}
          </div>
        </section>

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

          {(change.current_stage === "business_review" || change.current_stage === "technical_verification") && (
            <section className="rounded-md border bg-card p-3">
              <h3 className="mb-2 text-xs font-medium">提交反馈（返工）</h3>
              <div className="space-y-2">
                <div>
                  <label className="mb-1 block text-[11px] text-muted-foreground">反馈类别</label>
                  <select
                    className="w-full rounded border border-input bg-background px-2.5 py-1.5 text-xs focus:border-ring focus:outline-none"
                    value={feedbackCategory}
                    onChange={(e) => setFeedbackCategory(e.target.value)}
                  >
                    <option value="">— 选择类别 —</option>
                    <option value="A">A — Bug / 快速修复</option>
                    <option value="B">B — 需求理解错误（重设计）</option>
                    <option value="C">C — 歧义 / 信息不足</option>
                    <option value="D">D — 衍生新 change（当前通过）</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-muted-foreground">反馈内容</label>
                  <textarea
                    className="w-full rounded border border-input bg-background px-2.5 py-1.5 text-xs focus:border-ring focus:outline-none"
                    rows={3}
                    placeholder="描述具体问题…"
                    value={feedbackText}
                    onChange={(e) => setFeedbackText(e.target.value)}
                    maxLength={2000}
                  />
                </div>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={submittingFeedback || !feedbackCategory || !feedbackText.trim()}
                  onClick={() => void handleSubmitFeedback()}
                >
                  {submittingFeedback ? "提交中…" : "提交反馈并退回"}
                </Button>
              </div>
            </section>
          )}

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
    </div>
  );
}
