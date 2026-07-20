"use client";

/**
 * PersonalMetricStrip — 指标卡 (5 指标横排)。
 *
 * 指标固定按「本月」统计 (range 切换【本周/本月/全部】已移至「我的任务」查询区,
 * 见 ql-005 / design §3.1)。metrics=null(未就绪/loading)时显示「—」占位。
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

export interface PersonalMetricStripProps {
  /** 指标;null 时所有指标显示「—」占位。 */
  metrics: WorkbenchMetrics | null;
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

export function PersonalMetricStrip({ metrics }: PersonalMetricStripProps) {
  const items: MetricItem[] = [
    {
      key: "task_count",
      label: "本月任务量",
      value: metrics ? `${metrics.task_count}条` : "—",
      color: "blue",
      rule: "本月任务 start_time 区间统计的总条数",
      icon: ClipboardList,
    },
    {
      key: "completion_rate",
      label: "本月完成率",
      value: metrics ? `${Math.round(metrics.completion_rate * 100)}%` : "—",
      color: "green",
      rule: "已完成任务数 / 任务总数;任务数为 0 时显示 0%",
      icon: TrendingUp,
    },
    {
      key: "delay_rate",
      label: "本月延期率",
      value: metrics ? `${Math.round(metrics.delay_rate * 100)}%` : "—",
      color: "amber",
      rule: "已过期且未完成任务数 / 任务总数",
      icon: Hourglass,
    },
    {
      key: "work_hours",
      label: "本月工时统计",
      value: metrics ? `${metrics.work_hours}天` : "—",
      color: "cyan",
      rule: "任务执行实际耗时(task_execute.time_spent)总和",
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
    <SectionCard title="指标" bodyPadding="p-4">
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
