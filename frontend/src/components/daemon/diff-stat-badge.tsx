"use client";

/**
 * 2026-10-29-edit-diff-stat-badge（FR-01/FR-02）：Edit/Write 工具调用完成后
 * 的 diff 统计徽标（GitHub diff stat 口径）——`+N`（绿）`-M`（红），removed=0
 * 只显示 +N（不显示 -0）。跑马灯完成态条目与进度视图工具行尾共用本组件，
 * 保证两处样式与口径一致；数据源统一为 diffStatFromPatch（agent-log/tool-diff，
 * 与展开区行级 diff 同解析器）。
 *
 * 最小组件：无状态无副作用；颜色用 emerald/destructive 语义色（双主题安全，
 * 与跑马灯状态点 dotClass 同族）。
 */

export interface DiffStatBadgeProps {
  /** 新增行数（structuredPatch `+` 行计数）。 */
  added: number;
  /** 删除行数（structuredPatch `-` 行计数）；0 时只渲染 +N。 */
  removed: number;
  /** 根节点 data-testid（缺省 diff-stat-badge）。 */
  testId?: string;
}

export function DiffStatBadge({ added, removed, testId }: DiffStatBadgeProps) {
  return (
    <span
      data-testid={testId ?? "diff-stat-badge"}
      title={`本次文件改动：新增 ${added} 行${removed > 0 ? `、删除 ${removed} 行` : ""}`}
      className="flex shrink-0 items-center gap-1 font-mono tabular-nums leading-none"
    >
      <span className="text-emerald-600">+{added}</span>
      {removed > 0 && <span className="text-destructive">-{removed}</span>}
    </span>
  );
}
