/**
 * StateIcon —— primer 状态图标集（2026-09-26-core-pages-visual-redesign FR-01 / D-001@v1）。
 *
 * GitHub octicon 风格 16px stroke 图标（stroke 1.5、currentColor 继承文字色），
 * 是 StateLabel 的默认图标源，也可独立用于列表行/时间线节点。
 *
 * 设计依据:
 * - .sillyspec/changes/2026-09-26-core-pages-visual-redesign/design.md 接口定义节
 * - 对照原型 prototype-github-redesign.html（issue-opened / git-merge / zap / clock）
 */
import * as React from "react";

export type StateIconName =
  | "openCircle"
  | "mergedCheck"
  | "zap"
  | "clock"
  | "check"
  | "x";

export interface StateIconProps {
  /** 图标名。 */
  name: StateIconName;
  /** 边长(px)，列表行内 16 / 胶囊内 12。 */
  size?: number;
  className?: string;
}

/** 单图标 viewBox=0 0 16 16、fill none、stroke currentColor(1.5)。 */
function glyph(name: StateIconName): React.ReactNode {
  switch (name) {
    case "openCircle":
      return (
        <>
          <circle cx="8" cy="8" r="5.5" />
          <circle cx="8" cy="8" r="1.6" fill="currentColor" stroke="none" />
        </>
      );
    case "mergedCheck":
      return (
        <>
          <path d="M4 13V8a4 4 0 014-4h3.5" />
          <circle cx="4" cy="13.5" r="1.6" />
          <path d="M8.5 8.5l2 2 3.5-3.5" />
        </>
      );
    case "zap":
      return <path d="M9 1.5L3 9h3.5L6.5 14.5 13 7H9.5L9 1.5z" />;
    case "clock":
      return (
        <>
          <circle cx="8" cy="8" r="6" />
          <path d="M8 4.5V8l2.5 1.5" />
        </>
      );
    case "check":
      return <path d="M3 8.5l3.5 3.5L13 4.5" />;
    case "x":
      return (
        <>
          <path d="M4 4l8 8" />
          <path d="M12 4l-8 8" />
        </>
      );
  }
}

export function StateIcon({ name, size = 16, className }: StateIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {glyph(name)}
    </svg>
  );
}
