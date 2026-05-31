"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

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
  type ChangeDocContent,
  type ChangeDocMatrix,
  type ChangeRead,
  type ArchiveGateResponse,
  type ArchiveCheckItem,
  type DispatchResponse,
} from "@/lib/changes";
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

// ── Workflow Stages (task-06) ──────────────────────────────────────
const WORKFLOW_STAGES = [
  "draft", "clarifying", "design_review", "ready_for_dev",
  "in_dev", "technical_verification", "business_review",
  "rework_required", "accepted", "archived",
] as const;

const WORKFLOW_STAGE_LABELS: Record<string, string> = {
  draft: "草稿", clarifying: "需求澄清", design_review: "设计评审",
  ready_for_dev: "待开发", in_dev: "开发中",
  technical_verification: "技术验证", business_review: "业务验收",
  rework_required: "需返工", accepted: "已验收", archived: "已归档",
};

const WORKFLOW_STAGE_COLORS: Record<string, "success" | "outline" | "destructive" | "default" | "warning"> = {
  draft: "outline", clarifying: "warning", design_review: "warning",
  ready_for_dev: "default", in_dev: "default",
  technical_verification: "warning", business_review: "warning",
  rework_required: "destructive", accepted: "success", archived: "default",
};

const WORKFLOW_TRANSITIONS: Record<
  string,
  { target: string; label: string; variant: "default" | "outline" | "destructive"; icon?: string }[]
> = {
  draft: [{ target: "clarifying", label: "提交审核", variant: "default", icon: "📝" }],
  clarifying: [{ target: "design_review", label: "提交设计评审", variant: "default", icon: "🔍" }],
  design_review: [
    { target: "ready_for_dev", label: "评审通过", variant: "default", icon: "✅" },
    { target: "clarifying", label: "退回澄清", variant: "destructive", icon: "↩️" },
  ],
  ready_for_dev: [{ target: "in_dev", label: "开始开发", variant: "default", icon: "🚀" }],
  in_dev: [{ target: "technical_verification", label: "提交自测", variant: "default", icon: "🧪" }],
  technical_verification: [
    { target: "business_review", label: "提交验收", variant: "default", icon: "📋" },
    { target: "rework_required", label: "退回返工", variant: "destructive", icon: "⚠️" },
  ],
  business_review: [
    { target: "accepted", label: "验收通过", variant: "default", icon: "✅" },
    { target: "rework_required", label: "退回返工", variant: "destructive", icon: "⚠️" },
  ],
  rework_required: [
    { target: "clarifying", label: "返回澄清", variant: "outline", icon: "↩️" },
    { target: "design_review", label: "返回设计评审", variant: "outline", icon: "↩️" },
    { target: "in_dev", label: "返回开发", variant: "outline", icon: "↩️" },
  ],
  accepted: [{ target: "archived", label: "归档", variant: "default", icon: "📦" }],
  archived: [],
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
  "verification",
  "prototypes",
  "references",
] as const;

const STATUS_COLORS: Record<string, "success" | "outline" | "destructive" | "default" | "warning"> = {
  in_progress: "success",
  draft: "outline",
  proposed: "warning",
  reviewed: "warning",
  approved: "success",
  completed: "success",
  merged: "success",
  rejected: "destructive",
  archived: "default",
  unknown: "destructive",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "草稿",
  proposed: "已提议",
  reviewed: "已审查",
  approved: "已批准",
  in_progress: "进行中",
  completed: "已完成",
  merged: "已合并",
  rejected: "已驳回",
  archived: "已归档",
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
      if (targetStage === "accepted") {
        setArchiveGate(null);
      }
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

  // Auto-load archive gate when entering "accepted" stage
  useEffect(() => {
    if (change?.current_stage === "accepted" && !archiveGate && !loadingArchiveGate) {
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

  const availableTransitions = WORKFLOW_TRANSITIONS[change.current_stage ?? "draft"] ?? [];

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
        {availableTransitions.map((t) => (
          <Button
            key={t.target}
            variant={t.variant}
            size="sm"
            onClick={() => void handleTransition(t.target)}
            disabled={transitioning}
          >
            {t.icon && <span className="mr-1">{t.icon}</span>}
            {t.label}
          </Button>
        ))}
        {change.current_stage === "ready_for_dev" && (
          <Button
            size="sm"
            onClick={() => void handleExecute()}
            disabled={executing}
          >
            {executing ? "执行中…" : "🚀 启动执行"}
          </Button>
        )}
      </div>

      {/* ── Agent Dispatch Status Panel ──────────────────────────── */}
      {agentStatus && (
        <section className="rounded-md border bg-card">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <h2 className="text-xs font-medium">🤖 Agent 运行状态</h2>
            <button
              onClick={() => void refreshAgentStatus()}
              disabled={loadingAgentStatus}
              className="text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              {loadingAgentStatus ? "刷新中…" : "↻ 刷新"}
            </button>
          </div>
          <div className="px-3 py-2.5 space-y-2">
            {!agentStatus.config_enabled ? (
              /* idle — 无 agent 配置 */
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="inline-block h-2 w-2 rounded-full bg-gray-300" />
                <span>当前阶段未配置 Agent</span>
              </div>
            ) : agentStatus.has_active_run ? (
              /* running — 活跃运行中 */
              <div className="flex items-center gap-2 text-xs text-emerald-600">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
                </span>
                <span className="font-medium">Agent 运行中…</span>
              </div>
            ) : agentStatus.last_dispatch?.status === "completed" ? (
              /* completed */
              <div className="flex items-center gap-2 text-xs text-emerald-600">
                <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
                <span className="font-medium">上次执行成功</span>
                {agentStatus.last_dispatch.finished_at && (
                  <span className="text-[11px] text-muted-foreground">
                    · {new Date(agentStatus.last_dispatch.finished_at).toLocaleString()}
                  </span>
                )}
              </div>
            ) : agentStatus.last_dispatch?.status === "failed" ? (
              /* failed */
              <div className="flex items-center gap-2 text-xs text-destructive">
                <span className="inline-block h-2 w-2 rounded-full bg-red-500" />
                <span className="font-medium">上次执行失败</span>
                {agentStatus.last_dispatch.finished_at && (
                  <span className="text-[11px] text-muted-foreground">
                    · {new Date(agentStatus.last_dispatch.finished_at).toLocaleString()}
                  </span>
                )}
              </div>
            ) : (
              /* ready — 可触发 */
              <div className="flex items-center gap-2 text-xs text-blue-600">
                <span className="inline-block h-2 w-2 rounded-full bg-blue-500" />
                <span>就绪，可手动触发 Agent 执行</span>
              </div>
            )}

            {/* 输出摘要 */}
            {agentStatus.last_dispatch?.output_summary && (
              <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded bg-muted/60 px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground">
                {agentStatus.last_dispatch.output_summary}
              </pre>
            )}

            {/* 手动触发按钮 */}
            {agentStatus.config_enabled && !agentStatus.has_active_run && (
              <Button
                size="sm"
                onClick={() => void handleDispatch()}
                disabled={dispatching}
              >
                {dispatching ? "触发中…" : "🤖 触发 Agent 执行"}
              </Button>
            )}
          </div>
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
            {DOC_TABS.filter((dt) => {
              const doc = docExistsMap.get(dt);
              const isSpecial = dt === "prototypes" || dt === "references";
              return isSpecial
                ? (dt === "prototypes"
                    ? (matrix?.prototypes.length ?? 0)
                    : (matrix?.references.length ?? 0)) > 0
                : (doc?.exists ?? false);
            }).length}
            /{DOC_TABS.length} 文档就绪
          </span>
        </div>
        <div className="flex flex-wrap gap-2 px-3 py-3">
          {DOC_TABS.map((dt) => {
            const doc = docExistsMap.get(dt);
            const isSpecial = dt === "prototypes" || dt === "references";
            const count = isSpecial
              ? dt === "prototypes"
                ? (matrix?.prototypes.length ?? 0)
                : (matrix?.references.length ?? 0)
              : 0;
            const exists = isSpecial ? count > 0 : (doc?.exists ?? false);
            const isPartial = isSpecial && count > 0;

            let bg = "bg-gray-100 border-gray-200";
            let textColor = "text-gray-400";
            let icon = "—";
            if (exists && !isPartial) {
              bg = "bg-emerald-50 border-emerald-200/60";
              textColor = "text-emerald-600";
              icon = "✓";
            } else if (isPartial) {
              bg = "bg-amber-50 border-amber-200/60";
              textColor = "text-amber-600";
              icon = "◐";
            }

            return (
              <div
                key={dt}
                className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 ${bg}`}
              >
                <span className={`text-[11px] ${textColor}`}>{icon}</span>
                <span className={`text-[11px] font-medium ${textColor}`}>
                  {dt === "MASTER" ? "MASTER.md" : `${dt}.md`}
                </span>
              </div>
            );
          })}
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
                  {dt === "MASTER" ? "MASTER" : dt}
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

          {change.current_stage === "accepted" && (
            <section className="rounded-md border bg-card">
              <div className="flex items-center justify-between border-b px-3 py-2">
                <h2 className="text-xs font-medium">归档门禁</h2>
                {archiveGate && (
                  <Badge variant={archiveGate.can_archive ? "success" : "destructive"}>
                    {archiveGate.can_archive ? "✅ 全部通过" : `${archiveGate.failed_checks.length} 项未通过`}
                  </Badge>
                )}
              </div>
              <div className="px-3 py-2 space-y-2">
                {loadingArchiveGate ? (
                  <p className="text-xs text-muted-foreground">检查中…</p>
                ) : archiveGate ? (
                  <>
                    {[
                      { check: "no_unresolved_feedback", label: "无未解决反馈" },
                      { check: "ac_confirmed", label: "验收标准已确认" },
                      { check: "tech_verification_passed", label: "技术验证已通过" },
                      { check: "business_review_passed", label: "业务评审已通过" },
                      { check: "feedback_categorized", label: "反馈已分类" },
                      { check: "documents_complete", label: "文档已全部完成" },
                    ].map((item) => {
                      const failed = archiveGate.failed_checks.find((c) => c.check === item.check);
                      const passed = !failed;
                      return (
                        <div key={item.check} className="flex items-center gap-2 text-xs">
                          <span className={passed ? "text-emerald-600" : "text-destructive"}>
                            {passed ? "✓" : "✗"}
                          </span>
                          <span className={passed ? "text-foreground" : "text-destructive"}>
                            {item.label}
                          </span>
                          {!passed && failed?.message && (
                            <span className="text-muted-foreground text-[10px]">— {failed.message}</span>
                          )}
                        </div>
                      );
                    })}
                    <div className="pt-2">
                      <Button
                        size="sm"
                        disabled={!archiveGate.can_archive || archiving}
                        onClick={() => void handleArchive()}
                      >
                        {archiving ? "归档中…" : "📦 确认归档"}
                      </Button>
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">加载归档检查…</p>
                )}
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
