"use client";

/**
 * PersonalMetricStrip — 5 指标条 (task-09 / FR-03 / FR-04 / FR-05)。
 *
 * 中栏顶部:5 个指标卡横排(本月任务量/完成率/延期率/工时/缺陷数)。
 * 复用 SectionCard(标题="本月指标");数值颜色用 Tailwind 语义 class
 * 参照 tokens.ts 色值(非原型内联 CSS),对齐原型 5 卡配色 blue/green/amber/cyan/red:
 *   - blue  → text-blue-600    (tokens.color.blue.600=#2563eb,原型 --blue)
 *   - green → text-emerald-600 (tokens.color.semantic.success=#10b981,原型 --green)
 *   - amber → text-amber-600   (tokens.color.semantic.warning=#f59e0b,原型 --amber)
 *   - cyan  → text-cyan-600    (tokens.color.cyan=#06b6d4,原型 --cyan)
 *   - red   → text-red-600     (tokens.color.semantic.error=#ef4444,原型 --red)
 *
 * 格式(design §7.2):
 *   - task_count「N条」(int)
 *   - completion_rate「N%」(0~1 float → ×100 取整)
 *   - delay_rate「N%」(0~1 float → ×100 取整)
 *   - work_hours「N天」(float 天,源 task_execute.time_spent)
 *   - defect_count「N条」(int,不受 range 影响)
 *
 * metrics=null(接口未就绪/loading)时全部显示「—」占位,不报错。
 * 组件为纯展示,数据由 task-08 page.tsx 装配后下传 props。
 */
import { SectionCard } from "@/components/layout";
import type { WorkbenchMetrics } from "@/lib/ppm/types";

export interface PersonalMetricStripProps {
  /** 本月指标;null 时所有指标显示「—」占位。 */
  metrics: WorkbenchMetrics | null;
}

/** 指标颜色语义键(对齐原型 5 卡配色)。 */
type MetricColor = "blue" | "green" | "amber" | "cyan" | "red";

interface MetricItem {
  key: string;
  label: string;
  /** 已格式化的展示值;metrics=null 时由调用方传「—」。 */
  value: string;
  color: MetricColor;
}

/** 颜色 → Tailwind 文本语义 class(参照 tokens.ts 色值)。 */
const COLOR_CLASS: Record<MetricColor, string> = {
  blue: "text-blue-600",
  green: "text-emerald-600",
  amber: "text-amber-600",
  cyan: "text-cyan-600",
  red: "text-red-600",
};

export function PersonalMetricStrip({ metrics }: PersonalMetricStripProps) {
  const items: MetricItem[] = [
    {
      key: "task_count",
      label: "本月任务量",
      value: metrics ? `${metrics.task_count}条` : "—",
      color: "blue",
    },
    {
      key: "completion_rate",
      label: "本月完成率",
      value: metrics ? `${Math.round(metrics.completion_rate * 100)}%` : "—",
      color: "green",
    },
    {
      key: "delay_rate",
      label: "本月延期率",
      value: metrics ? `${Math.round(metrics.delay_rate * 100)}%` : "—",
      color: "amber",
    },
    {
      key: "work_hours",
      label: "本月工时统计",
      value: metrics ? `${metrics.work_hours}天` : "—",
      color: "cyan",
    },
    {
      key: "defect_count",
      label: "缺陷数量",
      value: metrics ? `${metrics.defect_count}条` : "—",
      color: "red",
    },
  ];

  return (
    <SectionCard title="本月指标" bodyPadding="p-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {items.map((m) => (
          <div
            key={m.key}
            className="rounded-lg border border-slate-200 bg-card p-3"
          >
            <div className="text-xs text-muted-foreground">{m.label}</div>
            <div
              className={`mt-1 text-2xl font-semibold tabular-nums ${COLOR_CLASS[m.color]}`}
            >
              {m.value}
            </div>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}
