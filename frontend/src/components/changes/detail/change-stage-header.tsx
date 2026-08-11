"use client";

/**
 * 阶段步骤条（主线顶部宏观进度，2026-08-11-change-detail-layout-rework / FR-01 / D-001）。
 *
 * 从原 page.tsx 顶部内联步骤条原样抽取，逻辑零改动：5 大阶段圆形节点，已完成显对勾、
 * 当前高亮、未到弱化；非线性三态（quick/blocked/archived）或未知阶段 indexOf<0 时返回 null
 * 不渲染（由 PageHeader 徽标承载）。导出 WORKFLOW_STAGE_LABELS 供 page.tsx 复用避免重复。
 */

export const WORKFLOW_STAGES = [
  "brainstorm", "plan", "execute", "verify", "archive",
] as const;

export const WORKFLOW_STAGE_LABELS: Record<string, string> = {
  brainstorm: "需求分析",
  plan: "规划",
  execute: "执行",
  verify: "验证",
  archive: "归档",
};

export interface ChangeStageHeaderProps {
  /** 当前阶段（current_stage），可空 */
  currentStage: string | null;
  /** change.stages（JSON），用于取当前阶段 lastActive */
  stages: Record<string, unknown> | null;
  /** change.updated_at，lastActive 缺失时兜底 */
  updatedAt: string | null;
}

export function ChangeStageHeader({
  currentStage,
  stages,
  updatedAt,
}: ChangeStageHeaderProps) {
  if (!currentStage) return null;
  const currentIndex = WORKFLOW_STAGES.indexOf(
    currentStage as (typeof WORKFLOW_STAGES)[number],
  );
  if (currentIndex < 0) return null;

  const stagesObj = stages as Record<string, { lastActive?: string }> | null;
  const lastActive =
    stagesObj?.[currentStage]?.lastActive ?? updatedAt ?? null;

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
                  isCurrent
                    ? "text-foreground font-medium"
                    : "text-muted-foreground"
                }`}
              >
                {WORKFLOW_STAGE_LABELS[stage]}
              </span>
              {i < WORKFLOW_STAGES.length - 1 && (
                <div className="mx-1 h-px w-3 bg-border" />
              )}
            </div>
          );
        })}
      </div>
      {lastActive ? (
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          当前阶段: {new Date(lastActive).toLocaleString()}
        </p>
      ) : null}
    </div>
  );
}
