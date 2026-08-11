"use client";

import { Badge } from "@/components/ui/badge";

/**
 * 审核历史卡（次线侧栏，2026-08-11-change-detail-layout-rework / FR-03 / FR-03b / D-003）。
 *
 * 替换旧「审查记录」（读已废弃的 change_reviews 死表、对新变更永远空）。本组件读
 * change.stages.review_history（JSON 数组）——后端四个 gate 端点（proposal_review /
 * plan_review / human_test / archive_confirm）与 rerun_stage 真实写入之处。
 *
 * review_history 元素有两种异构形状（Design Grill major 复核）：
 *   ① gate 形状 {decision, comment, submitted_at, from_stage, target_action, user_id}
 *   ② rerun 异构形状 {action, stage, comment, at}（rerun_stage 写入，无 decision/submitted_at）
 * 由 normalizeReviewHistory 归一化为 ReviewHistoryItem，组件只消费归一化结果。
 */

export type ReviewTone = "success" | "warning" | "danger" | "neutral";

export interface ReviewHistoryItem {
  /** 源形状：gate 决策 vs rerun 重跑 */
  kind: "gate" | "rerun";
  /** 已映射的中文标签（gate→按 decision；rerun→「重跑 {stage}」） */
  label: string;
  /** 颜色语义 */
  tone: ReviewTone;
  /** 审核意见（comment），缺失为 null */
  comment: string | null;
  /** 统一时间戳（gate=submitted_at，rerun=at；缺失为 null 置底） */
  at: string | null;
  /** 来源阶段（gate=from_stage，rerun=stage） */
  fromStage: string | null;
}

const DECISION_META: Record<string, { label: string; tone: ReviewTone }> = {
  approve: { label: "确认通过", tone: "success" },
  pass: { label: "测试通过", tone: "success" },
  confirm: { label: "归档确认", tone: "success" },
  revise: { label: "需要修改", tone: "warning" },
  replan: { label: "重新计划", tone: "warning" },
  back_to_propose: { label: "退回文档", tone: "warning" },
  back_to_brainstorm: { label: "退回需求", tone: "warning" },
  doc_mismatch: { label: "文档不符", tone: "warning" },
  unclear: { label: "需求不明确", tone: "danger" },
  bug: { label: "发现 BUG", tone: "danger" },
};

const TONE_VARIANT: Record<ReviewTone, "success" | "warning" | "destructive" | "outline"> = {
  success: "success",
  warning: "warning",
  danger: "destructive",
  neutral: "outline",
};

/**
 * 把 change.stages.review_history 原始元素（unknown）归一化为 ReviewHistoryItem，
 * 兼容 gate / rerun 两种异构形状，按时间倒序（at 缺失置底）。字段缺失宽容兜底不崩。
 *
 * page.tsx 负责：从 change.stages 取 review_history 数组（可能为 undefined/非数组），
 * 传 [] 给本函数则组件显示空态。
 */
export function normalizeReviewHistory(raw: unknown): ReviewHistoryItem[] {
  if (!Array.isArray(raw)) return [];
  const items: ReviewHistoryItem[] = raw.map((el) => {
    const e = (el ?? {}) as Record<string, unknown>;
    const comment = typeof e.comment === "string" ? e.comment : null;
    // rerun 形状：有 action 字段、无 decision
    if (typeof e.action === "string" && e.decision === undefined) {
      const stage = typeof e.stage === "string" ? e.stage : null;
      return {
        kind: "rerun",
        label: stage ? `重跑 ${stage}` : "重跑阶段",
        tone: "neutral",
        comment,
        at: typeof e.at === "string" ? e.at : null,
        fromStage: stage,
      };
    }
    // gate 形状：按 decision 映射
    const decision = typeof e.decision === "string" ? e.decision : "";
    const meta = DECISION_META[decision] ?? {
      label: decision || "审核",
      tone: "neutral" as ReviewTone,
    };
    return {
      kind: "gate",
      label: meta.label,
      tone: meta.tone,
      comment,
      at: typeof e.submitted_at === "string" ? e.submitted_at : null,
      fromStage: typeof e.from_stage === "string" ? e.from_stage : null,
    };
  });
  items.sort((a, b) => {
    if (!a.at && !b.at) return 0;
    if (!a.at) return 1;
    if (!b.at) return -1;
    return b.at.localeCompare(a.at);
  });
  return items;
}

export interface ChangeReviewHistoryCardProps {
  /** 已归一化的审核历史（page.tsx 调 normalizeReviewHistory 产出，已倒序） */
  reviewHistory: ReviewHistoryItem[];
}

export function ChangeReviewHistoryCard({
  reviewHistory,
}: ChangeReviewHistoryCardProps) {
  return (
    <section className="rounded-md border bg-card">
      <div className="border-b px-3 py-2">
        <h2 className="text-xs font-medium">审核历史 ({reviewHistory.length})</h2>
      </div>
      {reviewHistory.length === 0 ? (
        <p className="px-3 py-3 text-xs text-muted-foreground">暂无审核历史。</p>
      ) : (
        <div className="divide-y">
          {reviewHistory.map((r, i) => (
            <div key={`${r.at ?? ""}-${i}`} className="px-3 py-2 text-xs">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant={TONE_VARIANT[r.tone]}>{r.label}</Badge>
                {r.fromStage ? (
                  <span className="text-[11px] text-muted-foreground">
                    · {r.fromStage}
                  </span>
                ) : null}
                {r.at ? (
                  <span className="text-[11px] text-muted-foreground">
                    · {new Date(r.at).toLocaleString()}
                  </span>
                ) : null}
              </div>
              {r.comment ? (
                <p className="mt-1 whitespace-pre-wrap text-muted-foreground">
                  {r.comment}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
