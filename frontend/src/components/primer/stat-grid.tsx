/**
 * StatGrid —— primer 统计格（2026-09-26-core-pages-visual-redesign FR-01 / FR-06）。
 *
 * GitHub Insights 范式：细边框容器内 N 格统计（label 灰小字 + value 大数字 mono），
 * tone=brand/warning 走语义阶着色，供工作区概览统计四格等消费。
 */
import * as React from "react";

export interface StatGridItem {
  label: string;
  value: React.ReactNode;
  /** default=前景色 / brand=品牌阶 / warning=警示阶。 */
  tone?: "default" | "brand" | "warning";
}

export interface StatGridProps {
  items: StatGridItem[];
  className?: string;
}

const TONE_COLOR: Record<NonNullable<StatGridItem["tone"]>, string | undefined> = {
  default: undefined,
  brand: "var(--color-brand-600)",
  warning: "hsl(var(--warning))",
};

export function StatGrid({ items, className }: StatGridProps) {
  return (
    <div
      className={`grid divide-x overflow-hidden rounded-lg border ${className ?? ""}`}
      style={{
        gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))`,
        borderColor: "hsl(var(--border))",
      }}
    >
      {items.map((item) => (
        <div key={item.label} className="flex flex-col gap-1 px-4 py-3">
          <div className="text-xs text-muted-foreground">{item.label}</div>
          <div
            className="font-mono text-2xl font-semibold leading-8"
            style={item.tone && item.tone !== "default" ? { color: TONE_COLOR[item.tone] } : undefined}
          >
            {item.value}
          </div>
        </div>
      ))}
    </div>
  );
}
