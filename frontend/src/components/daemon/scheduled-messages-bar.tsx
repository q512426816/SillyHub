"use client";

/**
 * ScheduledMessagesBar —— 会话定时消息展示条
 * （2026-09-07-session-pin-rename-scheduled-send task-08 / FR-04 / D-001@v1）。
 *
 * design §总体方案 Wave 3.4 + 原型 prototype-session-pin-rename-scheduled-send.html
 * 「⏰ 定时消息」面板：挂 MessageQueueBar 邻位（session-panel page / dialog 双挂载点，
 * Grill B-05），水平 chips 列出该会话全部定时条目（dispatch_at 本地时间 + prompt
 * 摘要 + 四态 tag：pending 黄 warning / dispatched 绿 success / cancelled 灰 muted /
 * failed 红 destructive，failed 悬停显 error_message）+ pending 条目 ✕ 取消
 * （Modal.confirm 防误触）。空列表返回 null 不占位（零布局变化验收项）。
 *
 * 数据架构（任务卡 constraints 定案，session-panel 文件头 R4 不变式）：bar 自建
 * **局部 QueryClientProvider** 包数据子树——不依赖外层 Provider（dialog 弹窗渲染
 * 路径无 QueryClientProvider），useScheduledMessages 的 30s 轮询 / 创建取消后的
 * invalidate 全部走该局部 client；父层（panel）创建定时消息成功后递增
 * refreshSignal（SessionUsageBar refreshSignal 同款模式）触发本组件失效重拉，
 * panel 自身零 react-query。
 *
 * 主题：antd Tag 预设色经 ConfigProvider token 取色（双主题铁律）；品牌/错误态
 * 语义阶与 MessageQueueBar 同款（border-input bg-muted/50 / border-destructive）。
 */

import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Clock, X } from "lucide-react";
import { Button, Modal, Tag, Tooltip } from "antd";

import { cn } from "@/lib/utils";
import { ApiError } from "@/lib/api";
import { cancelScheduledMessage, type ScheduledMessageRead } from "@/lib/daemon";
import { useNotify } from "@/lib/errors";
import {
  scheduledMessagesQueryKey,
  useScheduledMessages,
} from "@/hooks/use-scheduled-messages";

/** 摘要截断长度（design：prompt 前 40 字，与 MessageQueueBar SUMMARY_LIMIT 同值）。 */
const SUMMARY_LIMIT = 40;

/**
 * prompt 摘要（bar chip 与 panel 系统提示行「发送「{摘要}」」共用同一截断口径）。
 */
export function summarizeScheduledPrompt(prompt: string): string {
  return prompt.length > SUMMARY_LIMIT ? `${prompt.slice(0, SUMMARY_LIMIT)}…` : prompt;
}

/**
 * dispatch_at（后端 ISO UTC）→ 本地时间「YYYY-MM-DD HH:mm」（分钟级展示对齐原型
 * .sched-item .when 形态；非法值原样返回防御脏数据）。
 */
export function formatScheduledTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 定时条目四态（ScheduledMessageRead.status 后端列 str，窄化 + 未知值兜底）。 */
type ScheduledStatus = "pending" | "dispatched" | "cancelled" | "failed";

function scheduledStatusOf(raw: string): ScheduledStatus | null {
  return raw === "pending" || raw === "dispatched" || raw === "cancelled" || raw === "failed"
    ? raw
    : null;
}

/** 各状态的 tag 元数据（antd Tag 预设色经主题 token 取色 + 中文文案 + chip 配色）。 */
const STATUS_META: Record<
  ScheduledStatus,
  { tagColor: "warning" | "success" | "default" | "error"; label: string; chipCls: string }
> = {
  pending: {
    tagColor: "warning",
    label: "待发送",
    chipCls: "border-input bg-muted/50 text-muted-foreground",
  },
  dispatched: {
    tagColor: "success",
    label: "已发送",
    chipCls: "border-input bg-muted/50 text-muted-foreground opacity-75",
  },
  cancelled: {
    tagColor: "default",
    label: "已取消",
    chipCls: "border-input bg-muted/50 text-muted-foreground opacity-60",
  },
  failed: {
    tagColor: "error",
    label: "失败",
    chipCls: "border-destructive bg-destructive/5 text-destructive",
  },
};

/** 取消竞态状态码：非 pending 409 / 条目已删 404 → 静默 + 失效以服务端为准收敛（use-message-queue 同口径）。 */
const CANCEL_SILENT_STATUSES = new Set([404, 409, 422]);

export interface ScheduledMessagesBarProps {
  /** 会话 id（空串 = 预会话 idle 态 → 整条不渲染）。 */
  sessionId: string;
  /** 刷新信号（父层创建定时消息成功后递增；SessionUsageBar refreshSignal 同款模式）。 */
  refreshSignal?: number;
}

/**
 * 数据子树（局部 Provider 内）：唯一 useScheduledMessages 调用点 + 取消交互。
 */
function ScheduledMessagesList({
  sessionId,
  refreshSignal,
}: {
  sessionId: string;
  refreshSignal: number;
}) {
  // useQueryClient 取到的是外层局部 client（QueryClientProvider 注入，R4 定案）。
  const qc = useQueryClient();
  const notify = useNotify();
  const { scheduled } = useScheduledMessages(sessionId);

  // 父层 refreshSignal 递增（创建成功）→ 失效局部 client 缓存立即重拉（新条目
  // 即时可见，不等 30s 轮询）。0 为初始值不触发。
  useEffect(() => {
    if (refreshSignal <= 0) return;
    void qc.invalidateQueries({ queryKey: scheduledMessagesQueryKey(sessionId) });
  }, [refreshSignal, qc, sessionId]);

  /** 取消 pending 条目：Modal.confirm 防误触 → DELETE → 无论成败失效重拉。 */
  const handleCancel = (msg: ScheduledMessageRead) => {
    Modal.confirm({
      title: "取消定时消息",
      content: (
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          确定取消 {formatScheduledTime(msg.dispatch_at)} 发送
          「{summarizeScheduledPrompt(msg.prompt)}」吗？取消后不会自动发送。
        </p>
      ),
      okText: "取消定时",
      okButtonProps: { danger: true },
      cancelText: "保留",
      onOk: async () => {
        try {
          await cancelScheduledMessage(sessionId, msg.id);
          notify.success("已取消定时消息");
        } catch (err) {
          // 404/409/422 已知竞态（恰好到点派发/已被取消）静默，失效后以服务端为准；
          // 网络 / 5xx 真实失败 toast（use-message-queue ql-20260903-014 同口径）。
          if (!(err instanceof ApiError && CANCEL_SILENT_STATUSES.has(err.status))) {
            notify.error(err, "取消定时消息失败");
          }
        }
        await qc.invalidateQueries({ queryKey: scheduledMessagesQueryKey(sessionId) });
      },
    });
  };

  // 空列表不渲染（验收项：零布局变化）。hooks 先于早返回。
  if (scheduled.length === 0) return null;

  return (
    <div className="shrink-0 border-t bg-card px-5 py-2">
      <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
        {/* 行计数标签（说明本行 chips 为定时消息，对齐 MessageQueueBar「排队消息（N）」）。 */}
        <span className="shrink-0 text-[11px] font-medium text-muted-foreground">
          定时消息（{scheduled.length}）
        </span>

        {scheduled.map((msg) => {
          const status = scheduledStatusOf(msg.status);
          const meta = status ? STATUS_META[status] : null;
          const tag = meta ?? { tagColor: "default" as const, label: msg.status || "未知" };
          const chipCls = meta?.chipCls ?? STATUS_META.cancelled.chipCls;
          return (
            <div
              key={msg.id}
              className={cn(
                "shrink-0 rounded border px-2 py-1 text-[11px] leading-4",
                chipCls,
              )}
            >
              <div className="flex items-center gap-1.5">
                <Clock aria-hidden className="h-3 w-3 shrink-0" />
                {/* 派发时间：本地时区分钟级展示。 */}
                <span className="shrink-0 font-medium tabular-nums">
                  {formatScheduledTime(msg.dispatch_at)}
                </span>
                <span className="max-w-[240px] truncate" title={msg.prompt}>
                  {summarizeScheduledPrompt(msg.prompt)}
                </span>
                {/* 四态 tag：failed 悬停显失败原因（error_code/error_message 审计留档）。 */}
                {msg.status === "failed" ? (
                  <Tooltip
                    title={
                      msg.error_message
                        ? `派发失败：${msg.error_message}${msg.error_code ? `（${msg.error_code}）` : ""}`
                        : "派发失败"
                    }
                  >
                    <Tag color={tag.tagColor} className="!m-0 shrink-0 cursor-help !text-[11px]">
                      {tag.label}
                    </Tag>
                  </Tooltip>
                ) : (
                  <Tag color={tag.tagColor} className="!m-0 shrink-0 !text-[11px]">
                    {tag.label}
                  </Tag>
                )}
                {/* 仅 pending 可取消（后端非 pending 409 双保险）。 */}
                {status === "pending" && (
                  <Tooltip title="取消定时消息">
                    <Button
                      type="text"
                      size="small"
                      icon={<X className="h-3 w-3" />}
                      onClick={() => handleCancel(msg)}
                      aria-label="取消该定时消息"
                      className="!h-5 !min-w-0 !w-5 !p-0"
                    />
                  </Tooltip>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * 对外组件：自建局部 QueryClientProvider 包数据子树（R4 定案——dialog 挂载点
 * 无外层 Provider 也能用；page 挂载点虽有全局 Provider，仍统一走局部 client，
 * 两模式行为一致，创建/取消失效互不越界）。
 */
export function ScheduledMessagesBar({
  sessionId,
  refreshSignal = 0,
}: ScheduledMessagesBarProps) {
  // 局部 client：retry 关闭（辅助信息条，失败静默等下轮轮询；也避免弹窗测试
  // 环境无网络时的重试定时器噪声），聚焦刷新关（30s 轮询已够）。
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, refetchOnWindowFocus: false },
        },
      }),
  );
  // 卸载清缓存（停轮询/失效定时器，防面板切换后残留）。
  useEffect(() => () => client.clear(), [client]);

  // 预会话 idle 态（无 sessionId）整条不渲染（输入栏 ⏰ 入口同刻不出现）。
  if (sessionId === "") return null;

  return (
    <QueryClientProvider client={client}>
      <ScheduledMessagesList sessionId={sessionId} refreshSignal={refreshSignal} />
    </QueryClientProvider>
  );
}
