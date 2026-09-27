/**
 * IssueRow / IssueRowHeader —— primer 两段式列表行（2026-09-26-core-pages-visual-redesign FR-01 / FR-03）。
 *
 * GitHub Issues 行范式：左状态图标 + 主行（标题+key）+ 副行元数据 + 右侧元数据列；
 * hover 背景微亮 + hoverActions 浮现。leading 插槽供批量模式由列表容器渲染 checkbox。
 * IssueRowHeader 与行同 grid template 对齐（表头语义）。
 */
import * as React from "react";

import { StateIcon } from "./state-icon";
import type { StateLabelVariant } from "./state-label";

/** 行网格列：行首插槽 | 状态图标 | 主体（两段） | 右侧元数据。 */
export const ISSUE_ROW_GRID =
  "grid grid-cols-[auto_auto_minmax(0,1fr)_auto] items-start gap-x-3";

export interface IssueRowProps {
  /** 状态变体，决定左侧 16px 状态图标。 */
  state: StateLabelVariant;
  /** 主行标题（通常含 key mono 链接）。 */
  title: React.ReactNode;
  /** 副行元数据（阶段胶囊/组件 tag/消耗，可选）。 */
  meta?: React.ReactNode;
  /** 右侧元数据列（负责人/时间）。 */
  right?: React.ReactNode;
  /** 整行点击。 */
  onClick?: () => void;
  /** hover 时浮现的快捷操作（右侧）。 */
  hoverActions?: React.ReactNode;
  /** 行首插槽（批量模式 checkbox 由容器传入）。 */
  leading?: React.ReactNode;
  className?: string;
}

const STATE_TO_ICON: Record<StateLabelVariant, Parameters<typeof StateIcon>[0]["name"]> =
  {
    open: "openCircle",
    merged: "mergedCheck",
    attention: "zap",
    done: "check",
    error: "x",
    neutral: "check",
  };

export function IssueRow({
  state,
  title,
  meta,
  right,
  onClick,
  hoverActions,
  leading,
  className,
}: IssueRowProps) {
  const interactive = typeof onClick === "function";
  return (
    <div
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === "Enter") onClick();
            }
          : undefined
      }
      className={`group relative ${ISSUE_ROW_GRID} px-3 py-2.5 text-sm transition-colors ${
        interactive ? "cursor-pointer hover:bg-muted/60" : ""
      } ${className ?? ""}`}
    >
      {leading ? <div className="flex items-center pt-0.5">{leading}</div> : null}
      <div className="flex items-center pt-0.5 text-muted-foreground">
        <StateIcon name={STATE_TO_ICON[state]} size={16} />
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2">{title}</div>
        {meta ? (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            {meta}
          </div>
        ) : null}
      </div>
      <div className="flex items-start justify-end gap-3 text-xs text-muted-foreground">
        {right}
        {hoverActions ? (
          <div className="hidden items-center gap-1 group-hover:flex">
            {hoverActions}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export interface IssueRowHeaderProps {
  /** 列头内容：与 IssueRow 的 leading/title/right 三段对齐。 */
  leading?: React.ReactNode;
  title: React.ReactNode;
  right?: React.ReactNode;
  className?: string;
}

export function IssueRowHeader({
  leading,
  title,
  right,
  className,
}: IssueRowHeaderProps) {
  return (
    <div
      className={`${ISSUE_ROW_GRID} border-b px-3 py-2 text-xs font-medium text-muted-foreground ${
        className ?? ""
      }`}
      style={{ borderBottomColor: "hsl(var(--border))" }}
    >
      {leading ? <div>{leading}</div> : <div />}
      <div />
      <div>{title}</div>
      <div className="flex justify-end">{right}</div>
    </div>
  );
}
