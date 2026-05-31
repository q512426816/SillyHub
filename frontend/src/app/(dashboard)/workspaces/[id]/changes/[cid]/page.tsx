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
  type ChangeDocContent,
  type ChangeDocMatrix,
  type ChangeRead,
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

const STAGES = ["scan", "brainstorm", "plan", "execute", "verify", "archived"] as const;
const STAGE_LABELS: Record<string, string> = {
  scan: "扫描",
  brainstorm: "构思",
  plan: "规划",
  execute: "执行",
  verify: "验证",
  archived: "归档",
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

const TRANSITIONS: Record<string, { target: string; label: string; variant: "default" | "outline" | "destructive" }[]> = {
  draft: [{ target: "proposed", label: "提议", variant: "default" }],
  proposed: [{ target: "reviewed", label: "标记已审查", variant: "default" }, { target: "rejected", label: "驳回", variant: "destructive" }],
  reviewed: [{ target: "approved", label: "批准", variant: "default" }, { target: "rejected", label: "驳回", variant: "destructive" }],
  approved: [{ target: "in_progress", label: "开始执行", variant: "default" }],
  in_progress: [{ target: "completed", label: "标记完成", variant: "default" }],
  completed: [{ target: "merged", label: "标记已合并", variant: "default" }],
  rejected: [{ target: "draft", label: "回到草稿", variant: "outline" }],
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

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setPageError(null);
      setLoadError(null);
      try {
        const [c, m, r, tb] = await Promise.all([
          getChange(workspaceId, changeId),
          getChangeDocuments(workspaceId, changeId),
          listReviews(workspaceId, changeId).catch(() => []),
          getTaskBoard(workspaceId, changeId).catch(() => null),
        ]);
        setChange(c);
        setMatrix(m);
        setReviews(r);
        setTaskBoard(tb);
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

  const handleTransition = async (targetStatus: string) => {
    if (!change) return;
    setTransitioning(true);
    setPageError(null);
    try {
      const result = await transitionChange(workspaceId, changeId, targetStatus);
      setChange({ ...change, status: result.status });
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
    try {
      const result = await executeChange(workspaceId, change.change_key);
      if (result.ok) {
        // Refresh change data after successful execution
        const updated = await getChange(workspaceId, changeId);
        setChange(updated);
        setPageError(null);
      }
    } catch (err) {
      setPageError(err instanceof ApiError ? err.message : "启动执行失败");
    } finally {
      setExecuting(false);
    }
  };

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

  const availableTransitions = TRANSITIONS[change.status] ?? [];

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
          <Badge variant={STATUS_COLORS[change.status] ?? "outline"}>
            {STATUS_LABELS[change.status] ?? change.status}
          </Badge>
          {change.current_stage !== "archived" && change.current_stage !== "completed" && (
            <Button
              size="sm"
              onClick={() => void handleExecute()}
              disabled={executing}
            >
              {executing ? "执行中…" : "🚀 启动执行"}
            </Button>
          )}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-5 gap-y-0.5 text-xs text-muted-foreground">
          <span>Key: <code className="font-mono">{change.change_key}</code></span>
          <span>类型: {change.change_type ?? "—"}</span>
          <span>位置: {change.location}</span>
          <span>影响: {change.affected_components.length > 0 ? change.affected_components.join(", ") : "—"}</span>
        </div>
      </header>

      {change.current_stage && (() => {
        const currentIndex = STAGES.indexOf(change.current_stage as typeof STAGES[number]);
        if (currentIndex < 0) return null;
        const stagesObj = change.stages as Record<string, { lastActive?: string }> | null;
        const lastActive = stagesObj?.[change.current_stage]?.lastActive ?? change.updated_at;
        return (
          <div className="rounded-md border bg-card px-3 py-2">
            <div className="flex items-center gap-1">
              {STAGES.map((stage, i) => {
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
                      {STAGE_LABELS[stage]}
                    </span>
                    {i < STAGES.length - 1 && <div className="mx-1 h-px flex-1 bg-border" />}
                  </div>
                );
              })}
            </div>
            {lastActive && (
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                最后活跃: {new Date(lastActive).toLocaleString()}
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
            {t.label}
          </Button>
        ))}
      </div>

      {pageError && (
        <div className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
          {pageError}
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
