"use client";

/**
 * agent-log/liveness-badge.tsx —— agent 会话活性状态徽章/小灯。
 *
 * 2026-09-07-agent-liveness-states task-14（design §5.4 D-004 两层展示 / FR-05）：
 * 五态视觉（对照 prototype-agent-liveness-states.html）——working=info 呼吸、
 * blocked=destructive 呼吸、idle=warning、ended=muted、unknown=虚线降调。
 * 双主题铁律：全部走语义色阶（info/warning/destructive/muted），无硬编码色值。
 */
import { cn } from "@/lib/utils";
import type { AgentLogListItem } from "@/lib/agent-logs";

/** 五态视觉映射（badge 与 dot 共用单一源）。 */
export const LIVENESS_META: Record<
  NonNullable<AgentLogListItem["state"]>,
  { label: string; badgeCls: string; dotCls: string; pulse: boolean }
> = {
  working: {
    label: "在干活",
    badgeCls: "border-info-200 bg-info-50 text-info-700",
    dotCls: "bg-info-500",
    pulse: true,
  },
  blocked: {
    label: "在等你",
    badgeCls: "border-destructive-200 bg-destructive-50 text-destructive-700",
    dotCls: "bg-destructive-500",
    pulse: true,
  },
  idle: {
    label: "空闲",
    badgeCls: "border-warning-200 bg-warning-50 text-warning-700",
    dotCls: "bg-warning-500",
    pulse: false,
  },
  ended: {
    label: "已结束",
    badgeCls: "border-border bg-muted text-muted-foreground",
    dotCls: "bg-muted-foreground/50",
    pulse: false,
  },
  unknown: {
    label: "未知",
    badgeCls: "border-dashed border-border text-muted-foreground",
    dotCls: "bg-muted-foreground/40",
    pulse: false,
  },
};

/** 悬停详情文案（D-004：完整信息只在悬浮卡与总览卡两处）。 */
export function livenessTitle(entry: {
  state: NonNullable<AgentLogListItem["state"]>;
  state_evidence?: string | null;
  state_derived_at?: string | null;
  last_event_at?: string | null;
}): string {
  const meta = LIVENESS_META[entry.state];
  const parts = [`活性：${meta.label}（${entry.state}）`];
  if (entry.state_evidence) parts.push(`证据：${entry.state_evidence}`);
  if (entry.last_event_at) parts.push(`最后事件：${entry.last_event_at}`);
  if (entry.state_derived_at) parts.push(`推导于：${entry.state_derived_at}`);
  return parts.join(" · ");
}

/** 徽章形态（agent 日志面板行尾 / 总览卡分组）。 */
export function LivenessBadge({
  state,
  className,
}: {
  state: NonNullable<AgentLogListItem["state"]>;
  className?: string;
}) {
  const meta = LIVENESS_META[state];
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-full border px-2 text-[11px] font-medium",
        meta.badgeCls,
        className,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", meta.dotCls, meta.pulse && "animate-pulse")} />
      {meta.label}
    </span>
  );
}

/** 小灯形态（~18px 状态点；预留会话列表行尾用——本期待总览卡承接，见 task-14 注记）。 */
export function LivenessDot({
  state,
  title,
  className,
}: {
  state: NonNullable<AgentLogListItem["state"]>;
  title?: string;
  className?: string;
}) {
  const meta = LIVENESS_META[state];
  return (
    <span
      title={title}
      aria-label={title ?? meta.label}
      className={cn(
        "inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center",
        className,
      )}
    >
      <span className={cn("h-2 w-2 rounded-full", meta.dotCls, meta.pulse && "animate-pulse")} />
    </span>
  );
}
