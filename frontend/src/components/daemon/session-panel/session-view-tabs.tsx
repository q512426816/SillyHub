"use client";

/**
 * 会话视图切换（2026-10-22-session-trajectory-third-view / D-001）：
 * 「对话 / 进度 / 轨迹」三态共享控件。
 *
 * 弹窗版（session-panel-dialog）与整页版（session-panel-page，含移动 variant）
 * 复用同一份 JSX——原两处各写一份「对话 / 进度」按钮，轨迹上移成第三视图时
 * 再各改一遍容易漂移，故抽此组件。纯展示：状态由消费方持有（两模式各自
 * `useState` + 整页版按会话持久化）。
 */

import { cn } from "@/lib/utils";

import type { SessionViewMode } from "../turn-timeline";

const VIEW_TABS: ReadonlyArray<{ value: SessionViewMode; label: string }> = [
  { value: "conversation", label: "对话" },
  { value: "all", label: "进度" },
  { value: "trajectory", label: "轨迹" },
];

export interface SessionViewTabsProps {
  value: SessionViewMode;
  // eslint-disable-next-line no-unused-vars -- 接口回调签名形参（同 session-panel 惯例）
  onChange: (mode: SessionViewMode) => void;
  className?: string;
}

export function SessionViewTabs({ value, onChange, className }: SessionViewTabsProps) {
  return (
    <div
      role="tablist"
      aria-label="消息显示范围"
      className={cn(
        "inline-flex items-center rounded-full border bg-muted/50 p-0.5",
        className,
      )}
    >
      {VIEW_TABS.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={value === tab.value}
          data-testid={`session-view-tab-${tab.value}`}
          onClick={() => onChange(tab.value)}
          className={cn(
            "rounded-full px-2.5 py-1 text-[11px] leading-none transition-colors",
            value === tab.value
              ? "bg-card font-medium text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
