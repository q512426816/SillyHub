"use client";

/**
 * MessageQueueBar —— 会话消息排队展示条（2026-08-21-session-message-queue task-02）。
 *
 * 设计依据（changes/2026-08-21-session-message-queue/design.md §3.1 / §3.2）：
 *   - 水平滚动 chips 栏：running / reconnecting 期间入队的消息在此排队可视化；
 *   - 每条显示 prompt 前 40 字摘要 + 附件数（D-004 附件排队，仅引用已落库 ids）；
 *   - failed 条目红色语义边框（border/text-destructive）+ 重试/删除按钮
 *     （D-003 失败留队头，不自动重试，重试仅由用户点击触发）；
 *   - pending 条目提供删除按钮；sending 条目转 spinner 不提供操作；
 *   - 队列满（entries.length >= max，D-002 默认 5）显示「队列已满（N/N）」；
 *   - 点击条目展开查看完整 displayPrompt（带附件标记行）与失败原因。
 *
 * 纯展示组件：队列状态由 useMessageQueue 持有，本组件只按 props 渲染；
 * 满员判断由父级传入的 entries/max 得出，组件不持有队列上限语义。
 * 主题：品牌态用 brand-* 语义阶（sending），错误态用 destructive 语义色；
 * 空队列返回 null（不渲染）。
 */

import { useState } from "react";
import { AlertTriangle, Clock, RefreshCw, RotateCcw, X } from "lucide-react";
import { Button, Tag, Tooltip } from "antd";

import { cn } from "@/lib/utils";
import type { QueueEntry } from "@/hooks/use-message-queue";

/** 摘要截断长度（design §3.2：prompt 前 40 字）。 */
const SUMMARY_LIMIT = 40;

/** 各投递状态的视觉元数据（chip 边框/底色 + 状态图标 + 中文文案）。 */
const STATUS_META: Record<
  QueueEntry["status"],
  { icon: typeof Clock; iconCls: string; chipCls: string; label: string }
> = {
  pending: {
    icon: Clock,
    iconCls: "text-muted-foreground",
    chipCls: "border-input bg-muted/50 text-muted-foreground",
    label: "等待中",
  },
  sending: {
    icon: RefreshCw,
    iconCls: "text-brand-600 animate-spin",
    chipCls: "border-brand-200 bg-brand-50/40 text-brand-700",
    label: "发送中",
  },
  failed: {
    icon: AlertTriangle,
    iconCls: "text-destructive",
    chipCls: "border-destructive bg-destructive/5 text-destructive",
    label: "发送失败",
  },
};

export interface MessageQueueBarProps {
  /** 排队条目（useMessageQueue.queue，含 pending/sending/failed）。 */
  entries: QueueEntry[];
  /** 删除条目（接 useMessageQueue.removeEntry）。 */
  onRemove: (id: string) => void;
  /** 重试失败条目（接 useMessageQueue.retryEntry）。 */
  onRetry: (id: string) => void;
  /** 队列上限（D-002 默认 5），仅用于满员提示文案（N/max），判断由父级渲染 entries 决定。 */
  max?: number;
}

export function MessageQueueBar({
  entries,
  onRemove,
  onRetry,
  max = 5,
}: MessageQueueBarProps) {
  /** 当前展开查看完整内容的条目 id（点击条目切换；单条展开即可）。 */
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // 空队列不渲染（design §3.2；hooks 先于早返回，保证条件顺序合法）。
  if (entries.length === 0) return null;

  const isFull = entries.length >= max;

  return (
    <div className="shrink-0 border-t bg-card px-5 py-2">
      <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
        {/* 队列计数标签（说明本行 chips 为排队消息）。 */}
        <span className="shrink-0 text-[11px] font-medium text-muted-foreground">
          排队消息（{entries.length}）
        </span>

        {/* D-002：满员提示（antd Tag 预设 warning，经主题 token 取色）。 */}
        {isFull && (
          <Tag color="warning" className="!m-0 shrink-0 !text-[11px]">
            队列已满（{entries.length}/{max}）
          </Tag>
        )}

        {entries.map((entry) => {
          const meta = STATUS_META[entry.status];
          const StatusIcon = meta.icon;
          const expanded = expandedId === entry.id;
          const summary =
            entry.prompt.length > SUMMARY_LIMIT
              ? `${entry.prompt.slice(0, SUMMARY_LIMIT)}…`
              : entry.prompt;

          return (
            <div
              key={entry.id}
              className={cn(
                "shrink-0 rounded border px-2 py-1 text-[11px] leading-4",
                meta.chipCls,
              )}
            >
              <div className="flex items-start gap-1">
                {/* 点击条目主体：展开/收起完整 displayPrompt（design §3.2）。 */}
                <button
                  type="button"
                  onClick={() => setExpandedId(expanded ? null : entry.id)}
                  aria-label={`${meta.label}，${expanded ? "收起" : "展开查看完整内容"}：${summary}`}
                  title={expanded ? "收起" : "展开查看完整内容"}
                  className="flex min-w-0 items-start gap-1.5 text-left"
                >
                  {entry.status === "failed" ? (
                    /* failed：悬停图标直接看失败原因（展开区亦有完整原因）。 */
                    <Tooltip
                      title={
                        entry.errorMsg ? `发送失败：${entry.errorMsg}` : "发送失败"
                      }
                    >
                      <AlertTriangle
                        className={cn("mt-0.5 h-3 w-3 shrink-0", meta.iconCls)}
                      />
                    </Tooltip>
                  ) : (
                    <StatusIcon
                      className={cn("mt-0.5 h-3 w-3 shrink-0", meta.iconCls)}
                    />
                  )}
                  <span
                    className={cn(
                      "min-w-0",
                      expanded
                        ? "max-w-[420px] whitespace-pre-wrap break-all"
                        : "max-w-[280px] truncate",
                    )}
                  >
                    {expanded ? entry.displayPrompt : summary}
                  </span>
                  {/* 附件数（D-004：折叠态显示；展开态 displayPrompt 已含附件标记行）。 */}
                  {!expanded && entry.attachmentIds.length > 0 && (
                    <Tooltip title={`含 ${entry.attachmentIds.length} 个附件`}>
                      <span className="mt-0.5 shrink-0 opacity-80">
                        📎 {entry.attachmentIds.length}
                      </span>
                    </Tooltip>
                  )}
                </button>

                {/* D-003：failed → 重试（仅用户触发）。 */}
                {entry.status === "failed" && (
                  <Tooltip title="重试发送">
                    <Button
                      type="text"
                      size="small"
                      icon={<RotateCcw className="h-3 w-3" />}
                      onClick={() => onRetry(entry.id)}
                      aria-label="重试发送该消息"
                      className="!h-5 !min-w-0 !w-5 !p-0"
                    />
                  </Tooltip>
                )}

                {/* pending / failed → 删除；sending 投递中不可操作。 */}
                {entry.status !== "sending" && (
                  <Tooltip title="从队列移除">
                    <Button
                      type="text"
                      size="small"
                      icon={<X className="h-3 w-3" />}
                      onClick={() => onRemove(entry.id)}
                      aria-label="从队列移除该消息"
                      className="!h-5 !min-w-0 !w-5 !p-0"
                    />
                  </Tooltip>
                )}
              </div>

              {/* 展开态：失败原因完整展示（D-003 errorMsg）。 */}
              {expanded && entry.errorMsg && (
                <div className="mt-1 max-w-[440px] break-all text-destructive">
                  发送失败：{entry.errorMsg}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
