"use client";

/**
 * 轨迹工具栏（2026-10-22-trajectory-view-redesign / D-003 / D-016 / D-020）。
 *
 * 四项控件（受控）：
 *   - 时长：实际时长 / 等宽两种时间线投影切换（全局偏好由消费方持久化）；
 *   - 轮次：全部收起 / 展开；
 *   - 调用：全部收起 / 展开；
 *   - 搜索：按文本过滤账本（AND 分词在视图模型层）。
 *
 * 纯展示：所有状态由 `TrajectoryView` 持有。
 */

import { cn } from "@/lib/utils";

export type TrajectoryScaleMode = "duration" | "equal";

export interface TrajectoryToolbarProps {
  query: string;
  // eslint-disable-next-line no-unused-vars -- 接口回调签名形参（同 session-panel 惯例）
  onQueryChange: (value: string) => void;
  scaleMode: TrajectoryScaleMode;
  // eslint-disable-next-line no-unused-vars -- 接口回调签名形参
  onScaleModeChange: (mode: TrajectoryScaleMode) => void;
  allTurnsCollapsed: boolean;
  onToggleAllTurns: () => void;
  allCallsCollapsed: boolean;
  onToggleAllCalls: () => void;
  className?: string;
}

const BTN =
  "inline-flex h-6 items-center gap-1 rounded border border-border bg-card px-2 text-[11px] text-foreground transition-colors hover:bg-muted";

export function TrajectoryToolbar({
  query,
  onQueryChange,
  scaleMode,
  onScaleModeChange,
  allTurnsCollapsed,
  onToggleAllTurns,
  allCallsCollapsed,
  onToggleAllCalls,
  className,
}: TrajectoryToolbarProps) {
  return (
    <div
      role="toolbar"
      aria-label="轨迹工具栏"
      data-testid="trajectory-toolbar"
      className={cn(
        "flex h-8 shrink-0 items-center gap-1.5 border-b border-border bg-card px-3",
        className,
      )}
    >
      <button
        type="button"
        className={BTN}
        aria-pressed={scaleMode === "equal"}
        title={scaleMode === "equal" ? "当前：等宽操作（点击改回实际时长）" : "当前：实际时长（点击改为等宽操作）"}
        onClick={() => onScaleModeChange(scaleMode === "duration" ? "equal" : "duration")}
      >
        时长 · {scaleMode === "duration" ? "实际" : "等宽"}
      </button>
      <button
        type="button"
        className={BTN}
        aria-pressed={allTurnsCollapsed}
        title={allTurnsCollapsed ? "展开所有轮次" : "收起所有轮次"}
        onClick={onToggleAllTurns}
      >
        轮次 · {allTurnsCollapsed ? "展开" : "收起"}
      </button>
      <button
        type="button"
        className={BTN}
        aria-pressed={allCallsCollapsed}
        title={allCallsCollapsed ? "展开所有调用" : "收起所有调用"}
        onClick={onToggleAllCalls}
      >
        调用 · {allCallsCollapsed ? "展开" : "收起"}
      </button>
      <div className="ml-auto flex h-6 w-[220px] items-center gap-1.5 rounded border border-border bg-background px-2">
        <span aria-hidden className="text-[11px] text-muted-foreground">⌕</span>
        <input
          type="search"
          aria-label="搜索轨迹"
          placeholder="搜索轨迹"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          className="h-full min-w-0 flex-1 bg-transparent text-[11px] text-foreground outline-none placeholder:text-muted-foreground"
        />
      </div>
    </div>
  );
}
