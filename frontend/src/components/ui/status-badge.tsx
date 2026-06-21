/**
 * StatusBadge —— 统一状态语义入口(D-005)。
 *
 * 设计依据:
 * - 蓝图 .sillyspec/changes/2026-06-21-frontend-style-system/tasks/task-06.md
 * - D-005:antd Tag 场景(ppm 业务) + shadcn Badge 场景(通用 UI) 共用同一套
 *   状态色语义,调用方拿 `kind` 即决定色,不再各自维护 STATUS_COLOR map。
 *
 * 色值来源:
 * - 本组件消费 task-05 注入的语义色,以 Tailwind 命名色档位形式表达「主色 + 深色」
 *   双色调(圆点主色 + 文字深色)。Tailwind 命名色 blue/emerald/amber/red/slate 为
 *   调色板默认 key,非硬编码任意值(hex/rgb/Tailwind 任意值语法一律禁止,见 AC-02)。
 * - 语义来源(改色改 globals.css 的 hsl var + tailwind.config 调色板,不改本文件):
 *     info    → tokens.semantic.info    (Tailwind blue-600/700)
 *     success → tokens.semantic.success (Tailwind emerald-600/700)
 *     warning → tokens.semantic.warning (Tailwind amber-500/700)
 *     error   → tokens.semantic.error   (Tailwind red-600/700)
 *     neutral → tokens.color.neutral    (Tailwind slate-500/600)
 *   改色统一改 globals.css 的 `--info / --success / --warning / --error / --color-neutral`
 *   与 tailwind.config 的调色板,本文件不改色值。
 */
import * as React from "react";

import { cn } from "@/lib/utils";

export type StatusKind = "info" | "success" | "warning" | "error" | "neutral";

export interface StatusBadgeProps {
  /** 状态语义 kind,决定圆点 + 文字配色。 */
  kind: StatusKind;
  /** 状态文案。 */
  children: React.ReactNode;
  /** 可选图标,渲染在圆点之后、文字之前;不传则省略。 */
  icon?: React.ReactNode;
  /** 尺寸:sm 紧凑(默认)、md 标准。 */
  size?: "sm" | "md";
  className?: string;
}

/**
 * kind → 圆点主色 / 文字深色 / 背景(极浅)/ 背景边框(略深,圆点用)映射表。
 * 全部走 Tailwind 命名色档位(blue/emerald/amber/red/slate),不硬编码 hex/rgb/任意值。
 */
const KIND_STYLES: Record<
  StatusKind,
  { dot: string; text: string; bg: string }
> = {
  info: {
    dot: "bg-blue-600",
    text: "text-blue-700",
    bg: "bg-blue-50",
  },
  success: {
    dot: "bg-emerald-600",
    text: "text-emerald-700",
    bg: "bg-emerald-50",
  },
  warning: {
    dot: "bg-amber-500",
    text: "text-amber-700",
    bg: "bg-amber-50",
  },
  error: {
    dot: "bg-red-600",
    text: "text-red-700",
    bg: "bg-red-50",
  },
  neutral: {
    dot: "bg-slate-500",
    text: "text-slate-600",
    bg: "bg-slate-100",
  },
};

const SIZE_STYLES: Record<NonNullable<StatusBadgeProps["size"]>, string> = {
  sm: "px-2 py-0.5 text-xs",
  md: "px-2.5 py-1 text-sm",
};

const DOT_SIZE_STYLES: Record<NonNullable<StatusBadgeProps["size"]>, string> = {
  sm: "h-1.5 w-1.5",
  md: "h-2 w-2",
};

/**
 * 状态徽标:圆点(语义主色) + 可选 icon + 文字(语义深色),圆角 full。
 * 圆角 full 与 Badge 的直角 `rounded` 形态区分,语义不同。
 */
export function StatusBadge({
  kind,
  children,
  icon,
  size = "sm",
  className,
}: StatusBadgeProps) {
  const styles = KIND_STYLES[kind];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full font-medium leading-none",
        SIZE_STYLES[size],
        styles.bg,
        styles.text,
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn("inline-block rounded-full", DOT_SIZE_STYLES[size], styles.dot)}
      />
      {icon}
      <span>{children}</span>
    </span>
  );
}

/**
 * 状态文案 → StatusKind 映射(D-005 统一入口)。
 *
 * 规则(小写归一化 + 包含匹配;按优先级 success > error > warning > info > neutral):
 * - success: 完成 / 已完成 / 已关闭 / 已归档 / done / completed / closed / success
 * - error:   失败 / 已作废 / 已驳回 / 延期 / 过期 / error / failed / rejected / overdue / void
 * - warning: 待验收 / 待审 / 待验证 / 审批中 / 变更中 / warning / pending / review
 * - info:    进行中 / 处置中 / 审核中 / info / processing / in-progress
 * - neutral: 未开始 / 草稿 / 已保存 / default / draft / neutral
 *
 * fallback: 未知状态(以上都不命中,含空串/拼写错误) → neutral,不抛错(AC-04)。
 *
 * 兼容 ppm-status-actions.tsx 现有 16 种状态文案(里程碑明细 6 + 问题 7 + 问题变更 3):
 *   草稿→neutral / 审核中→info / 审批中→warning / 已完成→success / 已驳回→error / 已归档→success
 *   已保存→neutral / 处置中→info / 已关闭→success / 已作废→error / 待验证→warning / 变更中→warning
 *   (问题变更重复:审核中→info / 已完成→success / 已作废→error)
 */
const STATUS_KEYWORDS: Array<{ kind: StatusKind; keywords: string[] }> = [
  {
    kind: "success",
    keywords: [
      "完成",
      "已完成",
      "已关闭",
      "已归档",
      "done",
      "completed",
      "closed",
      "success",
      "archived",
    ],
  },
  {
    kind: "error",
    keywords: [
      "失败",
      "已作废",
      "已驳回",
      "延期",
      "过期",
      "error",
      "failed",
      "rejected",
      "overdue",
      "void",
    ],
  },
  {
    kind: "warning",
    keywords: [
      "待验收",
      "待审",
      "待验证",
      "审批中",
      "变更中",
      "warning",
      "pending",
      "review",
      "approve",
      "gold",
    ],
  },
  {
    kind: "info",
    keywords: [
      "进行中",
      "运行中",
      "处置中",
      "审核中",
      "info",
      "processing",
      "in-progress",
      "in progress",
      "blue",
    ],
  },
  {
    kind: "neutral",
    keywords: [
      "未开始",
      "草稿",
      "已保存",
      "default",
      "draft",
      "neutral",
    ],
  },
];

export function fromStatus(statusLabel: string): StatusKind {
  const normalized = String(statusLabel ?? "")
    .trim()
    .toLowerCase();
  if (!normalized) return "neutral";

  // 按优先级顺序匹配:success > error > warning > info > neutral。
  for (const { kind, keywords } of STATUS_KEYWORDS) {
    for (const kw of keywords) {
      if (normalized.includes(kw.toLowerCase())) {
        return kind;
      }
    }
  }
  return "neutral";
}
