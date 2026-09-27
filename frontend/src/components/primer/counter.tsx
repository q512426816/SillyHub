/**
 * Counter —— primer 计数胶囊（2026-09-26-core-pages-visual-redesign FR-01）。
 *
 * GitHub Counter 质感：灰底圆角胶囊内的数字，active 变体加主题色描边，
 * 用于 UnderlineNav tab 计数 / 列表行计数等。
 */
import * as React from "react";

export interface CounterProps {
  /** 计数值。 */
  count: number;
  /** active=主题色描边（当前 tab 语义）。 */
  active?: boolean;
  className?: string;
}

export function Counter({ count, active = false, className }: CounterProps) {
  return (
    <span
      style={
        active
          ? {
              borderColor: "var(--color-brand-600)",
              color: "var(--color-brand-600)",
            }
          : undefined
      }
      className={`inline-flex min-w-[1.25rem] items-center justify-center rounded-full border bg-muted px-1.5 text-xs font-medium leading-5 ${
        active ? "" : "border-transparent text-muted-foreground"
      } ${className ?? ""}`}
    >
      {count}
    </span>
  );
}
