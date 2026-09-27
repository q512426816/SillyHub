/**
 * Timeline / TimelineItem —— primer 事件时间线（2026-09-26-core-pages-visual-redesign FR-01 / FR-04）。
 *
 * GitHub timeline 范式：左侧 3px 竖线 + 节点圆标 + 事件标题/时间 + 可折叠日志块
 * （children），tone 区分 default/current/success 三态。业务事件类型映射由消费页面做。
 */
import * as React from "react";

export interface TimelineItemProps {
  /** 节点图标（StateIcon 或业务图标）。 */
  icon: React.ReactNode;
  /** 事件标题。 */
  title: React.ReactNode;
  /** 事件时间（可选，右侧灰字）。 */
  time?: React.ReactNode;
  /** 节点色调：default=中性 / current=当前进行（主题色）/ success=完成（语义绿）。 */
  tone?: "default" | "current" | "success";
  /** 可折叠内容块（日志/输出，可选；提供时渲染折叠开关）。 */
  children?: React.ReactNode;
}

const TONE_RING: Record<NonNullable<TimelineItemProps["tone"]>, string> = {
  default: "hsl(var(--muted-foreground))",
  current: "var(--color-brand-600)",
  success: "hsl(var(--success))",
};

export function TimelineItem({
  icon,
  title,
  time,
  tone = "default",
  children,
}: TimelineItemProps) {
  const [open, setOpen] = React.useState(false);
  return (
    <li className="relative flex gap-3 pb-5 last:pb-0">
      <div className="flex flex-col items-center">
        <div
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border"
          style={{
            borderColor: TONE_RING[tone],
            color: TONE_RING[tone],
            backgroundColor: "hsl(var(--card))",
          }}
        >
          {icon}
        </div>
        <div
          aria-hidden="true"
          className="mt-1 w-px flex-1"
          style={{ backgroundColor: "hsl(var(--border))" }}
        />
      </div>
      <div className="min-w-0 flex-1 pt-1">
        <div className="flex flex-wrap items-center justify-between gap-x-3">
          <div className="text-sm font-medium">{title}</div>
          {time ? (
            <div className="text-xs text-muted-foreground">{time}</div>
          ) : null}
        </div>
        {children ? (
          <div className="mt-1.5">
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="text-xs text-muted-foreground hover:underline"
            >
              {open ? "收起详情" : "展开详情"}
            </button>
            {open ? (
              <div className="mt-1.5 whitespace-pre-wrap rounded-md border px-3 py-2 font-mono text-xs leading-5"
                style={{ borderColor: "hsl(var(--border))", backgroundColor: "hsl(var(--muted))" }}
              >
                {children}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}

export interface TimelineProps {
  children: React.ReactNode;
  className?: string;
}

export function Timeline({ children, className }: TimelineProps) {
  return <ul className={`flex flex-col ${className ?? ""}`}>{children}</ul>;
}
