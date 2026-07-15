"use client";

/**
 * PersonalMetricStrip — 5 指标条 + 范围切换 (task-09 / FR-05)。
 *
 * 中栏顶部:范围切换(本周/本月/全部,对齐原型任务操作表 range)+ 5 指标卡横排
 * (任务量/完成率/延期率/工时/缺陷数)。范围切换 → page 重查 summary(range),
 * 指标数据源对齐(week/month/all 区间聚合)。
 *
 * 数值颜色用 Tailwind 语义 class 参照 tokens.ts 色值,对齐原型 5 卡配色
 * blue/green/amber/cyan/red。缺陷数量不受 range 影响(FR-10,固定标签)。
 *
 * 格式(design §7.2):
 *   - task_count「N条」/ completion_rate「N%」/ delay_rate「N%」
 *   - work_hours「N天」(float 天,源 task_execute.time_spent)
 *   - defect_count「N条」(不受 range)
 *
 * metrics=null(接口未就绪/loading)时全部显示「—」占位,不报错。
 */
import { SectionCard } from "@/components/layout";
import type { WorkbenchMetrics } from "@/lib/ppm/types";

/** 指标范围(与 page.tsx Range 一致)。 */
type Range = "week" | "month" | "all";

const RANGE_LABEL: Record<Range, string> = {
  week: "本周",
  month: "本月",
  all: "全部",
};

const RANGE_OPTIONS: Range[] = ["week", "month", "all"];

export interface PersonalMetricStripProps {
  /** 指标;null 时所有指标显示「—」占位。 */
  metrics: WorkbenchMetrics | null;
  /** 当前范围。 */
  range: Range;
  /** 范围切换回调(page 重查 summary + 任务表过滤)。 */
  onRangeChange: (_r: Range) => void;
}

/** 指标颜色语义键(对齐原型 5 卡配色)。 */
type MetricColor = "blue" | "green" | "amber" | "cyan" | "red";

interface MetricItem {
  key: string;
  label: string;
  value: string;
  color: MetricColor;
  /** 该指标口径说明,hover 时 title 显示(取代 RuleNotePanel 卡片)。 */
  rule: string;
}

/** 颜色 → Tailwind 文本语义 class(参照 tokens.ts 色值)。 */
const COLOR_CLASS: Record<MetricColor, string> = {
  blue: "text-blue-600",
  green: "text-emerald-600",
  amber: "text-amber-600",
  cyan: "text-cyan-600",
  red: "text-red-600",
};

export function PersonalMetricStrip({
  metrics,
  range,
  onRangeChange,
}: PersonalMetricStripProps) {
  const prefix = RANGE_LABEL[range];
  const items: MetricItem[] = [
    {
      key: "task_count",
      label: `${prefix}任务量`,
      value: metrics ? `${metrics.task_count}条` : "—",
      color: "blue",
      rule: "本月任务 start_time 区间统计的总条数",
    },
    {
      key: "completion_rate",
      label: `${prefix}完成率`,
      value: metrics ? `${Math.round(metrics.completion_rate * 100)}%` : "—",
      color: "green",
      rule: "已完成任务数 / 任务总数;任务数为 0 时显示 0%",
    },
    {
      key: "delay_rate",
      label: `${prefix}延期率`,
      value: metrics ? `${Math.round(metrics.delay_rate * 100)}%` : "—",
      color: "amber",
      rule: "已过期且未完成任务数 / 任务总数",
    },
    {
      key: "work_hours",
      label: `${prefix}工时统计`,
      value: metrics ? `${metrics.work_hours}天` : "—",
      color: "cyan",
      rule: "任务执行实际耗时(task_execute.time_spent)总和",
    },
    {
      key: "defect_count",
      label: "缺陷数量",
      value: metrics ? `${metrics.defect_count}条` : "—",
      color: "red",
      rule: "当前人名下全部未关闭缺陷数(不受范围影响)",
    },
  ];

  return (
    <SectionCard
      title="指标"
      extra={
        <div className="flex items-center gap-1">
          {RANGE_OPTIONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => onRangeChange(r)}
              className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                range === r
                  ? "bg-primary text-primary-foreground"
                  : "border border-input bg-background hover:bg-accent"
              }`}
            >
              {RANGE_LABEL[r]}
            </button>
          ))}
        </div>
      }
      bodyPadding="p-4"
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {items.map((m) => (
          <div
            key={m.key}
            title={m.rule}
            className="cursor-help rounded-lg border border-slate-200 bg-card p-3"
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
