"use client";

/**
 * 阶段步骤条（主线顶部宏观进度，2026-08-11-change-detail-layout-rework / FR-01 / D-001）。
 *
 * 从原 page.tsx 顶部内联步骤条原样抽取：5 大阶段圆形节点，已完成显对勾、
 * 当前高亮、未到弱化；非线性三态（quick/blocked/archived）或未知阶段 indexOf<0 时返回 null
 * 不渲染（由 PageHeader 徽标承载）。导出 WORKFLOW_STAGE_LABELS 供 page.tsx 复用避免重复。
 *
 * 阶段-步骤联动（ql-20260821-017）：传入 stepStages + onStageClick 时节点升级为
 * button——有步骤数据的阶段可点击（aria-pressed 表选中、brand ring 高亮），点击
 * 由 page.tsx 切换 focusStage 筛选下方步骤时间线；无步骤数据阶段 disabled 弱化。
 * 未传联动 props 时渲染与旧版纯展示完全一致（向后兼容，旧测试零改动）。
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
  /** 步骤时间线中实际有条目的阶段集合（联动可选范围）；空数组/未传 = 不启用联动 */
  stepStages?: readonly string[] | null;
  /** 当前筛选聚焦的阶段（null = 全部）；选中节点 brand ring 高亮 */
  focusStage?: string | null;
  /** 节点点击回调（联动模式）；与 stepStages 同传才生效 */
  onStageClick?: ((_stage: string) => void) | null;
}

export function ChangeStageHeader({
  currentStage,
  stages,
  updatedAt,
  stepStages = null,
  focusStage = null,
  onStageClick = null,
}: ChangeStageHeaderProps) {
  if (!currentStage) return null;
  const currentIndex = WORKFLOW_STAGES.indexOf(
    currentStage as (typeof WORKFLOW_STAGES)[number],
  );
  if (currentIndex < 0) return null;

  // 联动模式：stepStages + onStageClick 同时提供才把节点升级为可点击 button
  const linked = stepStages !== null && onStageClick !== null;

  const stagesObj = stages as Record<string, { lastActive?: string }> | null;
  const lastActive =
    stagesObj?.[currentStage]?.lastActive ?? updatedAt ?? null;

  return (
    <div className="rounded-md border bg-card px-3 py-2">
      <div className="flex flex-wrap items-center gap-1">
        {WORKFLOW_STAGES.map((stage, i) => {
          const isCompleted = currentIndex > i;
          const isCurrent = currentIndex === i;
          const hasSteps = stepStages?.includes(stage) ?? false;
          const isFocused = focusStage === stage;

          const circleClass = `w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-medium transition-shadow ${
            isCurrent
              ? "bg-primary text-primary-foreground"
              : isCompleted
                ? "bg-emerald-500 text-white"
                : "bg-muted text-muted-foreground"
          } ${
            linked && isFocused
              ? "ring-2 ring-brand-500 ring-offset-2 ring-offset-card"
              : ""
          } ${
            linked && !isFocused && hasSteps
              ? "group-hover:ring-2 group-hover:ring-brand-500/40 group-hover:ring-offset-1 group-hover:ring-offset-card"
              : ""
          }`;

          const labelClass = `ml-1 text-[11px] transition-colors ${
            isFocused
              ? "text-brand-600 font-medium"
              : isCurrent
                ? "text-foreground font-medium"
                : "text-muted-foreground"
          }`;

          const nodeInner = (
            <>
              <div className={circleClass}>
                {isCompleted ? "✓" : i + 1}
              </div>
              <span className={labelClass}>
                {WORKFLOW_STAGE_LABELS[stage]}
              </span>
            </>
          );

          return (
            <div key={stage} className="flex items-center">
              {linked ? (
                <button
                  type="button"
                  disabled={!hasSteps}
                  aria-pressed={isFocused}
                  onClick={() => onStageClick?.(stage)}
                  title={
                    !hasSteps
                      ? "该阶段暂无步骤记录"
                      : isFocused
                        ? "点击取消筛选，显示全部步骤"
                        : "点击筛选该阶段步骤"
                  }
                  className={`group flex items-center rounded-md py-0.5 pr-0.5 ${
                    hasSteps
                      ? "cursor-pointer"
                      : "cursor-not-allowed opacity-60"
                  }`}
                >
                  {nodeInner}
                </button>
              ) : (
                nodeInner
              )}
              {i < WORKFLOW_STAGES.length - 1 && (
                <div className="mx-1 h-px w-3 bg-border" />
              )}
            </div>
          );
        })}
      </div>
      {lastActive ? (
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          当前阶段: {new Date(lastActive).toLocaleString("zh-CN")}
        </p>
      ) : null}
    </div>
  );
}
