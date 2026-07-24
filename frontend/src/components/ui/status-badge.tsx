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
