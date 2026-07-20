/**
 * StatusBadge —— 统一状态语义入口(D-005)。
 *
 * 2026-07-20(ql-20260720-005):内部渲染由自写 tailwind 圆角药丸改为 antd Badge,
 * 全项目状态标签统一切 antd(17 处调用点 API 不变)。外观从「圆角药丸 + 浅色背景」
 * 变为 antd Badge 标准的「小圆点 + 文字」。
 *
 * 设计依据:
 * - 蓝图 .sillyspec/changes/2026-06-21-frontend-style-system/tasks/task-06.md
 * - D-005:调用方拿 kind 即决定色,组件内部映射到 antd Badge status。
 *
 * StatusKind → antd Badge status 映射(antd 配色自带):
 *   info → processing(蓝,带脉冲,契合「进行中」) / success → success(绿) /
 *   warning → warning(黄) / error → error(红) / neutral → default(灰)
 */
import * as React from "react";
import { Badge } from "antd";

export type StatusKind = "info" | "success" | "warning" | "error" | "neutral";

export interface StatusBadgeProps {
  /** 状态语义 kind,决定圆点 + 文字配色。 */
  kind: StatusKind;
  /** 状态文案。 */
  children: React.ReactNode;
  /** 可选图标,渲染在圆点之后、文字之前;不传则省略。 */
  icon?: React.ReactNode;
  /** 尺寸:sm 紧凑(默认,text-xs)、md 标准(text-sm)。 */
  size?: "sm" | "md";
  className?: string;
}

/** StatusKind → antd Badge status 映射(antd 配色自带,不再维护 tailwind 色表)。 */
const KIND_TO_ANTD_STATUS: Record<
  StatusKind,
  "success" | "processing" | "default" | "error" | "warning"
> = {
  info: "processing",
  success: "success",
  warning: "warning",
  error: "error",
  neutral: "default",
};

const SIZE_TEXT_CLASS: Record<NonNullable<StatusBadgeProps["size"]>, string> = {
  sm: "text-xs",
  md: "text-sm",
};

/**
 * 状态徽标:antd Badge(status 圆点 + text 文字)。
 * 2026-07-20(ql-20260720-005)由自写 tailwind 圆角药丸改为 antd Badge,
 * 外观变为「小圆点 + 文字」(无背景药丸)。
 */
export function StatusBadge({
  kind,
  children,
  icon,
  size = "sm",
  className,
}: StatusBadgeProps) {
  return (
    <Badge
      className={className}
      status={KIND_TO_ANTD_STATUS[kind]}
      text={
        <span className={SIZE_TEXT_CLASS[size]}>
          {icon}
          {children}
        </span>
      }
    />
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
