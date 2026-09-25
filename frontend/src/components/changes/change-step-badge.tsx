"use client";

/**
 * 列表页 step 级阶段徽章（2026-08-15-change-step-visibility task-04 / design §5 Phase 2.1 /
 * FR-01 / D-003@v1，视觉对齐原型 prototype-change-step-visibility.html 列表徽章段）。
 *
 * stage 主行 = StatusBadge + STAGE_KIND/STAGE_LABELS（与列表页现状完全一致，降级视觉不变）；
 * stepProgress 非空且 step_total>0 时追加摘要副行：三态标记 + 64px 迷你进度条 +
 * "step x/y · 当前步名"（x=已完成步数，对齐原型 2/8→25% / 3/5→60% 的计数口径）。
 *
 * 约束：
 * - 只消费后端摘要三值 current_step_status ∈ "active" | "waiting" | null（null 且步名
 *   null = 全完成，见 service._extract_step_progress）；七值明细枚举（completed/pending/
 *   in-progress/...）由 task-05 时间线渲染，本组件不消费（design §5 Phase 2.1）。
 * - stepProgress null / step_total 0 → 只渲染 stage 主行（D-003@v1 优雅降级，与现状一致）。
 * - 纯展示组件：不拉数据不持状态，数据由 task-06 页面层 useQuery 提供。
 * - STAGE_KIND / STAGE_LABELS 导出供 task-06 列表页接线复用（替代 page.tsx 本地映射）。
 */

import type { components } from "@/lib/api-types";
import { StatusBadge, type StatusKind } from "@/components/ui/status-badge";
import { WORKFLOW_STAGE_LABELS } from "@/components/changes/detail/change-stage-header";

/** step 级进度摘要（api-types 生成，禁止手写）。 */
export type StepProgressSummary = components["schemas"]["StepProgressSummary"];

/** stage → 徽章色语义（与列表页现状 STAGE_KIND 一致：quick/brainstorm 警示、verify 成功…）。
 *
 * 2026-09-25-change-center-thin-flow task-07：thin 走品牌紫阶——StatusBadge 的
 * StatusKind 五值体系无紫，本地扩展 "brand" kind（渲染药丸形紫阶徽章，类名走
 * brand-* 语义阶，随 html data-theme 换肤——themes.ts 单一源铁律）。 */
export type StageBadgeKind = StatusKind | "brand";

export const STAGE_KIND: Record<string, StageBadgeKind> = {
  quick: "warning",
  brainstorm: "warning",
  plan: "info",
  execute: "info",
  verify: "success",
  archive: "neutral",
  // 2026-09-25-change-center-thin-flow：轻量变更品牌紫阶（D-002@v1），与 quick
  // 的 warning 琥珀区分新旧两代辅助流。
  thin: "brand",
  // 2026-08-21 quick：CLI 归档变更读侧终态投影 current_stage='archived'
  //（与平台内 complete_stage 终态同形），列表徽标降级为中性色。
  archived: "neutral",
};

/** stage → 中文标签：主线五阶段复用 change-stage-header 的 WORKFLOW_STAGE_LABELS，
 * 列表页另有 draft（旧数据兜底）/ scan / quick / thin 四个值本地补齐。 */
export const STAGE_LABELS: Record<string, string> = {
  ...WORKFLOW_STAGE_LABELS,
  draft: "草稿",
  scan: "扫描",
  quick: "快速任务（存量）", // task-07：quick 通道退役，存量口径
  thin: "轻量变更", // D-002@v1：中文显示名单一口径
  archived: "已归档",
};

export interface ChangeStepBadgeProps {
  /** 当前阶段（current_stage 原值），null 时整块不渲染。 */
  stage: string | null;
  /** step 级进度摘要；null 或 step_total 0 时降级只渲染 stage 主行。 */
  stepProgress: StepProgressSummary | null;
}

/** 三态标记 + 迷你进度条 + "step x/y · 当前步名"（原型 .step-sub 布局）。 */
function StepSubRow({ progress }: { progress: StepProgressSummary }) {
  const total = progress.step_total;
  // 防御式钳位：异常数据（越界/负数）不崩布局（task 验收：空字段零崩溃）。
  const completed = Math.max(0, Math.min(progress.steps_completed, total));
  const percent = Math.round((completed / total) * 1000) / 10; // 一位小数，避免浮点尾串
  const status = progress.current_step_status;
  const stepName = progress.current_step_name;
  // 全完成：后端约定 current_step_status 与 current_step_name 均为 null。
  const done = status === null && stepName === null;

  return (
    <div
      data-testid="step-sub-row"
      className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground"
    >
      {done ? (
        <span data-testid="step-done-check" className="text-emerald-600" aria-label="全部完成">
          ✓
        </span>
      ) : status === "waiting" ? (
        <span
          data-testid="step-waiting-chip"
          className="rounded-full bg-yellow-100 px-1.5 py-px text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400"
        >
          等待用户决策
        </span>
      ) : status === "active" ? (
        <span
          data-testid="step-active-dot"
          aria-label="当前步骤进行中"
          className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-brand-600"
        />
      ) : (
        // 未知 current_step_status 兜底：灰点占位，零崩溃（后端契约外值防御）。
        <span
          data-testid="step-unknown-dot"
          aria-hidden
          className="h-2 w-2 shrink-0 rounded-full bg-muted-foreground/50"
        />
      )}
      <span
        aria-label="步骤进度条"
        className="h-1 w-16 shrink-0 overflow-hidden rounded-full bg-muted"
      >
        <span
          data-testid="step-bar"
          className={`block h-full rounded-full ${
            done ? "bg-emerald-500" : status === "waiting" ? "bg-yellow-500" : "bg-brand-600"
          }`}
          style={{ width: `${percent}%` }}
        />
      </span>
      <span data-testid="step-count" className="whitespace-nowrap">
        step {completed}/{total}
      </span>
      {done ? (
        <span className="truncate">· 全部完成</span>
      ) : stepName ? (
        <span className="truncate" title={stepName}>
          · {stepName}
        </span>
      ) : null}
    </div>
  );
}

export function ChangeStepBadge({ stage, stepProgress }: ChangeStepBadgeProps) {
  // stage 为 null → 整块不渲染（防御：current_stage 缺失的旧数据由调用方兜底后不该走到这）。
  if (!stage) return null;

  const hasSummary = stepProgress !== null && stepProgress.step_total > 0;
  const kind: StageBadgeKind = STAGE_KIND[stage] ?? "neutral";
  const label = STAGE_LABELS[stage] ?? stage;

  return (
    <div className="inline-flex flex-col items-start">
      {kind === "brand" ? (
        // 轻量变更（thin）品牌紫阶药丸徽章（2026-09-25-change-center-thin-flow
        // task-07）：形态对照原型 prototype-change-center-thin-flow.html .badge.thin
        //（soft 底 + brand 字 + 紫边 + ◈ 符号）；brand-* 语义阶随主题换肤不写死 hex。
        <span className="inline-flex items-center gap-1 rounded-full border border-brand-300 bg-brand-50 px-2 py-px text-xs whitespace-nowrap text-brand-700">
          <span aria-hidden>◈</span>
          {label}
        </span>
      ) : (
        <StatusBadge kind={kind}>{label}</StatusBadge>
      )}
      {hasSummary ? <StepSubRow progress={stepProgress} /> : null}
    </div>
  );
}
