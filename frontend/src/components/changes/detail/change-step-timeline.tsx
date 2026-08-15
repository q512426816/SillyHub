"use client";

import { Fragment, memo } from "react";

import { WORKFLOW_STAGE_LABELS } from "@/components/changes/detail/change-stage-header";
import type { components } from "@/lib/api-types";

/**
 * 步骤时间线明细项（components.schemas.StepTimelineEntry，2026-08-15-change-step-visibility）。
 *
 * 类型来自 pnpm gen:types 生成的 api-types（禁止手写字段）。数据源
 * latest_progress.steps 经后端 _extract_step_progress 归一化：
 *   - stage 分组按 STAGE_ORDER 定序（quick 及未知 stage 追加在后）+ 组内按
 *     ordering——entries 顺序即展示顺序，本组件不再排序（design §5 Phase 2.2）；
 *   - completed_at 已归一 ISO 8601 UTC，前端直接展示字符串，不做 new Date()
 *     解析（规避 Safari 日期坑，归一化责任在后端，Grill #18）；
 *   - output 后端已截断 200 字，前端再叠 line-clamp + word-break（R-05）。
 */
export type StepTimelineEntry = components["schemas"]["StepTimelineEntry"];

// ── 七值状态色映射（design §7：CLI 原值透传，前端白名单色映射） ──────────
// 对齐后端 model.StepStatus 7 值 + progress.js 实证常见 3 值；未知值按
// pending 灰渲染（兜底，不炸）。
const DOT_CLASS: Record<string, string> = {
  completed: "bg-emerald-500",
  "in-progress": "bg-blue-500 animate-pulse",
  pending: "bg-gray-300",
  waiting: "bg-amber-500",
  failed: "bg-red-500",
  blocked: "bg-orange-500",
  stale: "bg-orange-500",
};

const NAME_CLASS: Record<string, string> = {
  completed: "text-foreground",
  "in-progress": "text-blue-600 font-medium",
  pending: "text-muted-foreground",
  waiting: "text-amber-600 font-medium",
  failed: "text-red-600",
  blocked: "text-orange-600",
  stale: "text-orange-600",
};

/** 步骤名右侧状态文案；completed 显示完成时间（见 TimelineItem），pending/未知不显示（原型未来步灰收起） */
const STATUS_LABEL: Record<string, string> = {
  "in-progress": "进行中",
  waiting: "等待中",
  failed: "失败",
  blocked: "已阻塞",
  stale: "已过期",
};

function dotClass(status: string): string {
  return DOT_CLASS[status] ?? "bg-gray-300";
}

function nameClass(status: string): string {
  return NAME_CLASS[status] ?? "text-muted-foreground";
}

interface TimelineItemProps {
  entry: StepTimelineEntry;
  /** 父级派生的稳定 key（`${stage}-${ordering}`），用于 DOM data-key 便于测试/调试 */
  itemKey: string;
}

/**
 * 单条时间线节点。React.memo + react-query structuralSharing（引用相等跳过
 * re-render）实现 entry 级 diff：轮询刷新时仅状态变化的节点重渲染，未变化
 * 节点引用相等直接跳过，不整列重挂（R-04「不乱跳」）。
 */
const TimelineItem = memo(function TimelineItem({
  entry,
  itemKey,
}: TimelineItemProps) {
  const label = STATUS_LABEL[entry.status];
  return (
    <div className="relative pt-2 pb-3.5" data-key={itemKey}>
      {/* 状态点：绝对定位贴左侧时间线脊（原型 .tl-dot） */}
      <span
        aria-hidden
        data-status={entry.status}
        className={`absolute -left-[25px] top-[10px] h-3 w-3 shrink-0 rounded-full border-2 border-card ${dotClass(entry.status)}`}
      />
      <div className="flex items-center gap-2 text-[13px] leading-snug">
        <span className={`min-w-0 flex-1 break-words ${nameClass(entry.status)}`}>
          {entry.name}
        </span>
        {entry.status === "completed" && entry.completed_at ? (
          <time
            dateTime={entry.completed_at}
            title={entry.completed_at}
            className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground"
          >
            {entry.completed_at}
          </time>
        ) : label ? (
          <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
            {label}
          </span>
        ) : null}
      </div>
      {entry.status === "waiting" && entry.wait_reason ? (
        <p className="mt-1 break-words text-xs text-amber-600">
          等待原因：{entry.wait_reason}
        </p>
      ) : null}
      {entry.output ? (
        <p
          title={entry.output}
          className="mt-1 line-clamp-2 max-w-[560px] break-words text-xs leading-relaxed text-muted-foreground"
        >
          {entry.output}
        </p>
      ) : null}
    </div>
  );
});

interface StageGroupHeaderProps {
  stage: string;
  /** 该组已完成步数 / 总步数 */
  done: number;
  total: number;
}

/** stage 组头：组名 + 完成数/总数（原型 .stage-group） */
function StageGroupHeader({ stage, done, total }: StageGroupHeaderProps) {
  const label = WORKFLOW_STAGE_LABELS[stage] ?? stage;
  const allDone = done === total;
  return (
    <div
      data-stage={stage}
      className="mb-1 mt-3.5 flex items-center gap-1.5 text-xs text-muted-foreground first:mt-0"
    >
      <span aria-hidden>{allDone ? "✅" : "•"}</span>
      <span className="font-medium text-foreground/80">{label}</span>
      <span>
        {done}/{total} 步完成
      </span>
    </div>
  );
}

export interface ChangeStepTimelineProps {
  /** step 级时间线明细（ChangeRead.steps）；null/undefined/空数组不渲染（降级，D-003@v1） */
  steps: StepTimelineEntry[] | null;
}

/**
 * 变更详情步骤时间线（2026-08-15-change-step-visibility / FR-02 / D-005@v1）。
 *
 * 按 stage 分组的垂直时间线，替代已删除的 SillySpecStepProgress（旧组件数据源
 * 是 change.stages dispatch 快照，与新 latest_progress 数据源并存会同屏不一致，
 * design Grill #17）。样式对齐原型 prototype-change-step-visibility.html 第②段
 * （timeline / tl-item / tl-dot / stage-group）。
 */
export function ChangeStepTimeline({ steps }: ChangeStepTimelineProps) {
  // 空态：无明细数据时不渲染任何节点（调用方布局不受影响，不抛错）
  if (!steps || steps.length === 0) return null;

  // 连续同 stage 归组——后端已保证 entries 按 STAGE_ORDER 分组定序 + 组内
  // ordering 排序（service._extract_step_progress），此处纯分组遍历不排序。
  const groups: { stage: string; entries: StepTimelineEntry[] }[] = [];
  for (const entry of steps) {
    const last = groups[groups.length - 1];
    if (last && last.stage === entry.stage) {
      last.entries.push(entry);
    } else {
      groups.push({ stage: entry.stage, entries: [entry] });
    }
  }

  return (
    <div
      data-testid="change-step-timeline"
      className="relative pl-[26px] before:absolute before:left-2 before:top-1.5 before:bottom-1.5 before:w-0.5 before:bg-border"
    >
      {groups.map((group) => (
        <Fragment key={group.stage}>
          <StageGroupHeader
            stage={group.stage}
            done={group.entries.filter((e) => e.status === "completed").length}
            total={group.entries.length}
          />
          {group.entries.map((entry) => {
            // 稳定 key：stage + ordering 组合（CLI 表列 ordering NOT NULL
            // DEFAULT 0，真实数据组内唯一），diff 只动变化节点不整列重挂。
            const itemKey = `${entry.stage}-${entry.ordering}`;
            return (
              <TimelineItem key={itemKey} entry={entry} itemKey={itemKey} />
            );
          })}
        </Fragment>
      ))}
    </div>
  );
}
