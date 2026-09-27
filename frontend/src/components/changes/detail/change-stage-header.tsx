"use client";

/**
 * 阶段 checks 横条（主线顶部宏观进度，2026-08-11-change-detail-layout-rework / FR-01 / D-001；
 * 2026-09-26-core-pages-visual-redesign task-06 重排为 GitHub PR checks 风格 / FR-04）。
 *
 * 视觉：✓已完成=语义绿勾图标、●当前=主题色高亮、○待办=灰空心（primer StateIcon），
 * 阶段间连接线，对照原型「变更详情」视图六阶段 checks 横条；非线性三态
 * （quick/blocked/archived）或未知阶段 indexOf<0 时返回 null 不渲染（由 PageHeader
 * 徽标承载）。导出 WORKFLOW_STAGE_LABELS 供 page.tsx 复用避免重复。
 *
 * 阶段-步骤联动（ql-20260821-017）：传入 stepStages + onStageClick 时节点升级为
 * button——有步骤数据的阶段可点击（aria-pressed 表选中、brand ring 高亮），点击
 * 由 page.tsx 切换 focusStage 筛选下方步骤时间线；无步骤数据阶段 disabled 弱化。
 * 未传联动 props 时渲染与纯展示一致（向后兼容）。
 */

import { StateIcon } from "@/components/primer";

export const WORKFLOW_STAGES = [
  "brainstorm", "plan", "execute", "verify", "archive",
] as const;

export const WORKFLOW_STAGE_LABELS: Record<string, string> = {
  brainstorm: "需求分析",
  plan: "规划",
  execute: "执行",
  verify: "验证",
  archive: "归档",
  // 2026-09-25-change-center-thin-flow task-07：辅助阶段标签（供 change-step-timeline
  // 组标题与 [cid] 详情页复用，防裸显英文；WORKFLOW_STAGES 主线数组不动——thin
  // 不进主管线渲染，主管线 indexOf<0 分支不受影响）。
  thin: "轻量变更",
  quick: "快速任务（存量）",
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

  // 终态别名兼容：CLI 归档 / 后端读侧投影会把 current_stage 写成 'archived'，
  // 但工作流阶段名仍是 'archive'。映射到阶段条可识别的 key，保持节点高亮/对勾
  // 及下方步骤时间线 focusStage（stage='archive'）联动一致。
  const displayStage = currentStage === "archived" ? "archive" : currentStage;

  const currentIndex = WORKFLOW_STAGES.indexOf(
    displayStage as (typeof WORKFLOW_STAGES)[number],
  );
  if (currentIndex < 0) return null;

  // 联动模式：stepStages + onStageClick 同时提供才把节点升级为可点击 button
  const linked = stepStages !== null && onStageClick !== null;

  const stagesObj = stages as Record<string, { lastActive?: string }> | null;
  const lastActive =
    stagesObj?.[displayStage]?.lastActive ?? updatedAt ?? null;

  return (
    <div className="rounded-md border bg-card px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-1">
        {WORKFLOW_STAGES.map((stage, i) => {
          const isCompleted = currentIndex > i;
          const isCurrent = currentIndex === i;
          const hasSteps = stepStages?.includes(stage) ?? false;
          const isFocused = focusStage === stage;

          // checks 段：图标（✓绿勾 / ●当前主题色开圆 / ○灰空心）+ 阶段名
          const segClass = `flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs transition-colors ${
            isFocused
              ? "font-semibold text-brand-600"
              : isCurrent
                ? "font-semibold text-foreground"
                : isCompleted
                  ? "text-foreground"
                  : "text-muted-foreground"
          } ${
            linked && isFocused
              ? "ring-2 ring-brand-500 ring-offset-2 ring-offset-card"
              : ""
          } ${
            linked && !isFocused && hasSteps
              ? "group-hover:ring-2 group-hover:ring-brand-500/40 group-hover:ring-offset-1 group-hover:ring-offset-card"
              : ""
          }`;

          const nodeInner = (
            <>
              {isCompleted ? (
                <StateIcon name="check" size={16} className="shrink-0 text-success" />
              ) : isCurrent ? (
                <StateIcon name="openCircle" size={16} className="shrink-0 text-primary" />
              ) : (
                <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                  <span className="h-3 w-3 rounded-full border-2 border-border" />
                </span>
              )}
              {WORKFLOW_STAGE_LABELS[stage]}
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
                  className={`group ${segClass} ${
                    hasSteps
                      ? "cursor-pointer"
                      : "cursor-not-allowed opacity-60"
                  }`}
                >
                  {nodeInner}
                </button>
              ) : (
                <span className={segClass}>{nodeInner}</span>
              )}
              {i < WORKFLOW_STAGES.length - 1 && (
                <div aria-hidden="true" className="mx-1 h-px w-4 bg-border" />
              )}
            </div>
          );
        })}
      </div>
      {lastActive ? (
        <p className="mt-1.5 text-xs text-muted-foreground">
          当前阶段: {new Date(lastActive).toLocaleString("zh-CN")}
        </p>
      ) : null}
    </div>
  );
}
