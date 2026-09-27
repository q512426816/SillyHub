/**
 * StateLabel —— primer 状态胶囊（2026-09-26-core-pages-visual-redesign FR-01 / D-001@v1）。
 *
 * GitHub Label 质感的浅底深字细边框胶囊，颜色全部经主题 token：
 * open/merged 走 brand 阶（进行中/已归档的 GitHub 紫语义随主题换肤），
 * attention/done/error/neutral 走 semantic soft 底 + HSL 语义主值文字，
 * 零硬编码 hex（铁律，值见 themes.ts semanticSoft 与 globals.css）。
 *
 * attention 双态用 iconName 区分：zap=轻量变更闪电 / clock=等待输入时钟（默认 zap）。
 * thin/quick 徽章口径承接 FR-auto-frontend-020（轻量出身归档后仍可辨识）。
 */
import * as React from "react";

import { StateIcon, type StateIconName } from "./state-icon";

export type StateLabelVariant =
  | "open"
  | "merged"
  | "attention"
  | "done"
  | "error"
  | "neutral";

export interface StateLabelProps {
  /** 状态变体，决定配色与默认图标。 */
  variant: StateLabelVariant;
  /** 状态文案，如「进行中」「已归档」。 */
  children: React.ReactNode;
  /** 是否带 12px 状态图标（默认 true）。 */
  withIcon?: boolean;
  /** 图标覆写，仅 variant=attention 时有意义：zap=轻量闪电(默认) / clock=等待时钟。 */
  iconName?: "zap" | "clock";
  /** sm=列表行内(默认) / md=页头。 */
  size?: "sm" | "md";
  className?: string;
}

/** 变体 → 配色 token（底色 / 文字与边框色，全部 CSS var，零硬编码）。 */
const VARIANT_STYLE: Record<
  StateLabelVariant,
  { bg: string; fg: string; icon: StateIconName }
> = {
  open: {
    bg: "var(--color-brand-50)",
    fg: "var(--color-brand-600)",
    icon: "openCircle",
  },
  merged: {
    bg: "var(--color-brand-50)",
    fg: "var(--color-brand-600)",
    icon: "mergedCheck",
  },
  attention: {
    bg: "var(--semantic-warning-soft)",
    fg: "hsl(var(--warning))",
    icon: "zap",
  },
  done: {
    bg: "var(--semantic-success-soft)",
    fg: "hsl(var(--success))",
    icon: "check",
  },
  error: {
    bg: "var(--semantic-error-soft)",
    fg: "hsl(var(--error))",
    icon: "x",
  },
  neutral: {
    bg: "var(--semantic-neutral-soft)",
    fg: "hsl(var(--muted-foreground))",
    icon: "check",
  },
};

const SIZE_CLASS: Record<NonNullable<StateLabelProps["size"]>, string> = {
  sm: "text-xs px-2 py-0.5 gap-1",
  md: "text-sm px-2.5 py-1 gap-1.5",
};

export function StateLabel({
  variant,
  children,
  withIcon = true,
  iconName,
  size = "sm",
  className,
}: StateLabelProps) {
  const style = VARIANT_STYLE[variant];
  const icon: StateIconName =
    variant === "attention" && iconName ? iconName : style.icon;
  return (
    <span
      style={{ backgroundColor: style.bg, color: style.fg, borderColor: style.fg }}
      className={`inline-flex items-center rounded-md border font-medium ${SIZE_CLASS[size]} ${className ?? ""}`}
    >
      {withIcon ? <StateIcon name={icon} size={12} /> : null}
      {children}
    </span>
  );
}
