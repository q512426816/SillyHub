"use client";

/**
 * task-06（2026-08-24-platform-session-feedback-fix / FR-02 / D-001@v1）：
 * Plan 模式确认卡片。
 *
 * 当会话收到 plan_mode_entered 事件时渲染，展示 Agent 生成的计划摘要
 * （objective / tasks / design_snippet），并提供 confirm / revise / cancel
 * 三态操作。revise / cancel 必须填写 feedback；confirm 无需 feedback。
 * 提交成功后调用 onSubmitted，由父组件（task-09）移除卡片。
 *
 * 视觉：品牌色阶 bg-brand-50 / text-brand-700 / border-brand-200 等随
 * html data-theme 换肤，阴影走 shadow-sm token，适配 AI-Native 双主题。
 */

import { useState } from "react";
import { Check, ClipboardList, Loader2, Pencil, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { submitPlanResponse, type PlanSummary } from "@/lib/daemon";
import { cn } from "@/lib/utils";

export interface PlanApprovalCardProps {
  sessionId: string;
  runId: string;
  summary: PlanSummary;
  requestedAt?: string | null;
  onSubmitted?: () => void;
}

type Decision = "confirm" | "revise" | "cancel";

const DECISION_META: Record<
  Decision,
  { label: string; icon: React.ReactNode; variant: "default" | "outline" | "destructive" }
> = {
  confirm: {
    label: "确认计划",
    icon: <Check className="h-3.5 w-3.5" />,
    variant: "default",
  },
  revise: {
    label: "需要修改",
    icon: <Pencil className="h-3.5 w-3.5" />,
    variant: "outline",
  },
  cancel: {
    label: "取消",
    icon: <X className="h-3.5 w-3.5" />,
    variant: "destructive",
  },
};

function formatRequestedAt(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("zh-CN");
}

export function PlanApprovalCard({
  sessionId,
  runId,
  summary,
  requestedAt,
  onSubmitted,
}: PlanApprovalCardProps) {
  const [selected, setSelected] = useState<Decision | null>(null);
  const [feedback, setFeedback] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSelect = (decision: Decision) => {
    setSelected(decision);
    setError(null);
    if (decision === "confirm") {
      setFeedback("");
    }
  };

  const handleSubmit = async () => {
    if (submitting || !selected) return;
    if (selected !== "confirm" && !feedback.trim()) {
      setError("请填写修改/取消原因");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await submitPlanResponse(
        sessionId,
        runId,
        selected,
        selected === "confirm" ? undefined : feedback,
      );
      onSubmitted?.();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "提交失败，请重试";
      setError(msg);
      setSubmitting(false);
    }
  };

  const showFeedback = selected === "revise" || selected === "cancel";

  return (
    <article
      className="overflow-hidden rounded-md border border-brand-200 bg-card shadow-sm"
      data-run-id={runId}
      data-testid="plan-approval-card"
    >
      <header className="flex items-start justify-between gap-2 border-b border-brand-100 bg-brand-50/60 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-brand-100 text-brand-700">
            <ClipboardList className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-foreground">
                计划确认
              </span>
              <span className="rounded bg-brand-100 px-1.5 py-0 text-[10px] font-medium text-brand-700">
                Plan
              </span>
            </div>
            <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
              run {runId.slice(0, 8)}…
            </p>
          </div>
        </div>
        {requestedAt && (
          <span className="shrink-0 text-[10px] text-muted-foreground">
            {formatRequestedAt(requestedAt)}
          </span>
        )}
      </header>

      <div className="space-y-3 px-3 py-3">
        <section>
          <p className="text-[11px] font-medium uppercase text-muted-foreground">
            目标
          </p>
          <p className="mt-1 text-sm font-medium text-foreground">
            {summary.objective || "（无目标描述）"}
          </p>
        </section>

        {summary.tasks && summary.tasks.length > 0 && (
          <section>
            <p className="text-[11px] font-medium uppercase text-muted-foreground">
              任务步骤
            </p>
            <ol className="mt-1 list-decimal space-y-1 pl-4 text-[12px] text-foreground">
              {summary.tasks.map((task, idx) => (
                <li key={idx} className="pl-1 leading-relaxed">
                  {task}
                </li>
              ))}
            </ol>
          </section>
        )}

        {summary.design_snippet && (
          <section>
            <p className="text-[11px] font-medium uppercase text-muted-foreground">
              设计摘要
            </p>
            <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/40 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-foreground">
              {summary.design_snippet}
            </pre>
          </section>
        )}

        <div className="flex flex-wrap gap-2">
          {(Object.keys(DECISION_META) as Decision[]).map((decision) => {
            const meta = DECISION_META[decision];
            const active = selected === decision;
            return (
              <Button
                key={decision}
                type="button"
                size="sm"
                variant={active ? meta.variant : "outline"}
                className={cn(
                  "h-7 gap-1 px-2.5 text-[11px]",
                  active &&
                    decision === "confirm" &&
                    "bg-success text-success-foreground hover:bg-success/90",
                )}
                disabled={submitting}
                onClick={() => handleSelect(decision)}
                aria-pressed={active}
              >
                {meta.icon}
                {meta.label}
              </Button>
            );
          })}
        </div>

        {showFeedback && (
          <div className="animate-fade-in">
            <label
              htmlFor={`plan-feedback-${runId}`}
              className="text-[11px] font-medium uppercase text-muted-foreground"
            >
              {selected === "revise" ? "修改建议" : "取消原因"}
              <span className="ml-0.5 text-error">*</span>
            </label>
            <textarea
              id={`plan-feedback-${runId}`}
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder={
                selected === "revise"
                  ? "请说明需要如何调整计划…"
                  : "请说明取消原因…"
              }
              disabled={submitting}
              className="mt-1 block min-h-[72px] w-full resize-y rounded-md border border-input bg-background px-2.5 py-1.5 text-[12px] text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            />
          </div>
        )}

        {error && (
          <p className="text-[11px] text-destructive" role="alert">
            {error}
          </p>
        )}
      </div>

      <footer className="flex items-center justify-end gap-2 border-t bg-muted/20 px-3 py-2">
        <Button
          type="button"
          size="sm"
          className="h-7 gap-1 px-3 text-[11px]"
          disabled={submitting || !selected}
          onClick={() => void handleSubmit()}
        >
          {submitting ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              提交中…
            </>
          ) : (
            <>
              <Check className="h-3.5 w-3.5" />
              提交决策
            </>
          )}
        </Button>
      </footer>
    </article>
  );
}
