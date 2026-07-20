"use client";

/**
 * PersonalMetricStrip — 指标卡 (5 指标横排)。
 *
 * ql-20260720-004: 指标支持「本周/本月/全部」范围切换(默认全部),label 前缀随 range
 * 动态(本周/本月/无前缀);完成率/延期率在分母 task_count=0 时显示「—」不显示 0%
 * (避免本月无新任务的老员工看到误导性 0%)。range 由父组件 page.tsx 受控持有,
 * 切换时重载 summary。
 */
import {
  Bug,
  ClipboardList,
  Clock3,
  Hourglass,
  TrendingUp,
} from "lucide-react";

import { SectionCard } from "@/components/layout";
import { cn } from "@/lib/utils";
import type { WorkbenchMetrics } from "@/lib/ppm/types";

/** 指标统计范围(对齐后端 GET /workbench/summary?range=)。 */
export type MetricRange = "week" | "month" | "all";

/** 范围切换分段选项。 */
const RANGE_OPTIONS: { value: MetricRange; label: string }[] = [
  { value: "week", label: "本周" },
  { value: "month", label: "本月" },
  { value: "all", label: "全部" },
];

export interface PersonalMetricStripProps {
  /** 指标;null 时所有指标显示「—」占位。 */
  metrics: WorkbenchMetrics | null;
  /** 当前范围(受控,父组件持有)。 */
  range: MetricRange;
  /** 切换范围回调。 */
  onRangeChange: (range: MetricRange) => void;
}

/** 指标颜色语义键(对齐原型 5 卡配色)。 */
type MetricColor = "blue" | "green" | "amber" | "cyan" | "red";

interface MetricItem {
  key: string;
  label: string;
  value: string;
  color: MetricColor;
  /** 该指标口径说明,hover 时 title 显示。 */
  rule: string;
  icon: React.ComponentType<{ className?: string }>;
}

/** 颜色 → 文本/图标底色语义 class(参照 tokens.ts 色值)。 */
const COLOR_CLASS: Record<MetricColor, { text: string; tile: string }> = {
  blue: { text: "text-blue-600", tile: "bg-blue-50 text-blue-600" },
  green: { text: "text-emerald-600", tile: "bg-emerald-50 text-emerald-600" },
  amber: { text: "text-amber-600", tile: "bg-amber-50 text-amber-600" },
  cyan: { text: "text-cyan-600", tile: "bg-cyan-50 text-cyan-600" },
  red: { text: "text-red-600", tile: "bg-red-50 text-red-600" },
};

/** 范围分段切换器(本周/本月/全部)。 */
function RangeSwitch({
  range,
  onChange,
}: {
  range: MetricRange;
  onChange: (r: MetricRange) => void;
}) {
  return (
    <div className="inline-flex items-center rounded-lg border border-border bg-muted/40 p-0.5">
      {RANGE_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={cn(
            "rounded-md px-2.5 py-1 text-xs transition",
            range === opt.value
              ? "bg-background font-medium text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function PersonalMetricStrip({
  metrics,
  range,
  onRangeChange,
}: PersonalMetricStripProps) {
  // label 前缀:本周/本月;全部 → 无前缀
  const prefix = range === "week" ? "本周" : range === "month" ? "本月" : "";
  const rangeWord = prefix || "全部";
  const scopeHint =
    range === "week" ? "本周一起" : range === "month" ? "当月1日起" : "不限时间";

  const items: MetricItem[] = [
    {
      key: "task_count",
      label: `${prefix}任务量`,
      value: metrics ? `${metrics.task_count}条` : "—",
      color: "blue",
      rule: `${rangeWord}开始的任务总数(${scopeHint},按 start_time 归属)`,
      icon: ClipboardList,
    },
    {
      key: "completion_rate",
      label: `${prefix}完成率`,
      value:
        !metrics || metrics.task_count === 0
          ? "—"
          : `${Math.round(metrics.completion_rate * 100)}%`,
      color: "green",
      rule: `${rangeWord}已完成任务数 / ${rangeWord}任务总数;任务数为 0 时显示 —`,
      icon: TrendingUp,
    },
    {
      key: "delay_rate",
      label: `${prefix}延期率`,
      value:
        !metrics || metrics.task_count === 0
          ? "—"
          : `${Math.round(metrics.delay_rate * 100)}%`,
      color: "amber",
      rule: `${rangeWord}已过期且未完成任务数 / ${rangeWord}任务总数`,
      icon: Hourglass,
    },
    {
      key: "work_hours",
      label: `${prefix}工时统计`,
      value: metrics ? `${metrics.work_hours}天` : "—",
      color: "cyan",
      rule: `${rangeWord}执行记录耗时(task_execute.time_spent,人天)总和`,
      icon: Clock3,
    },
    {
      key: "defect_count",
      label: "缺陷数量",
      value: metrics ? `${metrics.defect_count}条` : "—",
      color: "red",
      rule: "当前人名下全部未关闭缺陷数(不受范围影响)",
      icon: Bug,
    },
  ];

  return (
    <SectionCard
      title="指标"
      extra={<RangeSwitch range={range} onChange={onRangeChange} />}
      bodyPadding="p-4"
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {items.map((m) => {
          const Icon = m.icon;
          return (
            <div
              key={m.key}
              title={m.rule}
              className="cursor-help rounded-xl border border-border/60 bg-muted/40 p-3 transition hover:bg-muted/70"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">{m.label}</span>
                <span
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-lg",
                    COLOR_CLASS[m.color].tile,
                  )}
                >
                  <Icon className="size-4" />
                </span>
              </div>
              <div
                className={cn(
                  "mt-2 text-2xl font-bold tabular-nums",
                  COLOR_CLASS[m.color].text,
                )}
              >
                {m.value}
              </div>
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}
