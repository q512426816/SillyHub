"use client";

/**
 * RuleNotePanel — 个人工作台规则说明静态文本 (task-11 / FR-11)。
 *
 * 无接口,纯静态 ol 列表;口径对齐 design §7.2(指标) / §7.3(日历双圆点)。
 */
import { SectionCard } from "@/components/layout";

const RULES: string[] = [
  "任务量 / 完成率 / 延期率按本月任务 start_time 区间统计。",
  "完成率 = 已完成任务数 / 本月任务总数;任务数为 0 时显示 0%。",
  "延期率 = 已过期且未完成任务数 / 本月任务总数。",
  "工时统计取任务执行实际耗时(task_execute.time_spent)。",
  "日历左点 = 当日任务负载:绿正常 / 黄偏满 / 红过载。",
  "日历右点 = 延期预警:绿正常 / 红预警。",
  "缺陷数 = 当前人名下全部未关闭缺陷数(不受范围影响)。",
];

export function RuleNotePanel() {
  return (
    <SectionCard title="规则说明" bodyPadding="p-4">
      <ul className="space-y-1 text-xs text-muted-foreground">
        {RULES.map((r) => (
          <li key={r}>· {r}</li>
        ))}
      </ul>
    </SectionCard>
  );
}
