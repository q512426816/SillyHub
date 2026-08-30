"use client";

/**
 * notification-bell — 顶栏通知铃铛 + 下拉面板（2026-08-29-approval-notify-push task-11 / FR-09）。
 *
 * 数据全部消费 lib/notifications.ts（task-10）：useUnreadCount（徽标）、
 * useNotifications({limit:20})（最近 20 条）、useNotificationsStream()（SSE 事件
 * 驱动 invalidate，挂载即订阅，无轮询 D-005@v1）。
 *
 * 交互对照 prototype-notification-bell.html：
 *   - 铃铛 + 未读徽标（antd Badge，>99 显示 99+，0 隐藏）
 *   - antd Popover 下拉：头部「通知（N 条未读）」+「全部已读」（无未读禁用）；
 *     条目 = 类型色块图标 + 标题 + 摘要 + 相对时间；未读条目 brand 浅底 + 圆点；
 *     点击条目 = markNotificationRead + invalidate + router.push(link)（link 空仅已读）；
 *     空态文案中文。
 *   - 配色三主题（ai-native/blue/dark）全走语义 token：brand-*（随 data-theme 换肤）、
 *     success/warning/error/info/neutral 状态档（globals.css CSS 变量），
 *     antd Popover 阴影/圆角经 ConfigProvider 主题，无硬编码 hex。
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Popover, Badge } from "antd";
import {
  Bell,
  CheckCheck,
  CheckCircle2,
  Clock,
  Inbox,
  KeyRound,
  TimerOff,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import {
  markAllNotificationsRead,
  markNotificationRead,
  useNotifications,
  useNotificationsStream,
  useUnreadCount,
  type NotificationRead,
} from "@/lib/notifications";
import { queryKeys } from "@/lib/query-keys";
import { formatRelativeTime } from "@/components/sessions/session-list-panel";

/** 面板列表条数（design §7.4 默认 20）。 */
const PANEL_LIST_LIMIT = 20;

/** 四类通知的类型元数据：中文标签 + 状态色（语义 token 类名，不硬编码 hex）+ 图标。 */
const TYPE_META: Record<
  string,
  { label: string; icon: typeof Bell; colorCls: string; labelCls: string }
> = {
  approval_pending: {
    label: "待审核",
    icon: Clock,
    colorCls: "bg-warning/15 text-warning",
    labelCls: "text-warning",
  },
  approval_result: {
    label: "审批结果",
    icon: CheckCircle2,
    colorCls: "bg-success/15 text-success",
    labelCls: "text-success",
  },
  permission_request: {
    label: "权限请求",
    icon: KeyRound,
    colorCls: "bg-info/15 text-info",
    labelCls: "text-info",
  },
  permission_timeout: {
    label: "权限超时",
    icon: TimerOff,
    colorCls: "bg-neutral/20 text-neutral",
    labelCls: "text-neutral",
  },
};

/** 未知类型兜底（后端新增类型时前端不崩）。 */
const FALLBACK_META = {
  label: "通知",
  icon: Bell,
  colorCls: "bg-brand-100 text-brand-600",
  labelCls: "text-brand-600",
};

function typeMeta(type: string) {
  return TYPE_META[type] ?? FALLBACK_META;
}

/** 单条通知条目（导出便于单测渲染断言）。 */
export function NotificationItem({
  notification,
  onClick,
}: {
  notification: NotificationRead;
  onClick: (n: NotificationRead) => void;
}) {
  const meta = typeMeta(notification.type);
  const unread = notification.read_at == null;
  const Icon = meta.icon;

  return (
    <button
      type="button"
      data-testid="notification-item"
      title={notification.title}
      className={`relative flex w-full items-start gap-2.5 border-b border-border-weak py-2.5 pl-3.5 pr-3 text-left transition-colors last:border-b-0 hover:bg-brand-50 ${
        unread ? "bg-brand-50/60" : "bg-transparent"
      }`}
      onClick={() => onClick(notification)}
    >
      {unread && (
        <span
          className="absolute left-0 top-0 h-full w-0.5 bg-brand-600"
          aria-label="未读"
        />
      )}
      <span
        className={`mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-md ${meta.colorCls}`}
      >
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        {/* 元信息行：类型小字标签（左）+ 相对时间（右），标题独占整行避免被标签挤截断 */}
        <span className="flex items-center justify-between gap-2">
          <span className={`text-[10px] font-medium ${meta.labelCls}`}>
            {meta.label}
          </span>
          <span className="shrink-0 text-[11px] text-slate-400">
            {formatRelativeTime(notification.created_at)}
          </span>
        </span>
        <span className="mt-0.5 block truncate text-[13px] font-semibold text-slate-800 dark:text-slate-100">
          {notification.title}
        </span>
        {notification.body && (
          <span className="mt-0.5 block truncate text-xs text-slate-500">
            {notification.body}
          </span>
        )}
      </span>
    </button>
  );
}

/**
 * 通知铃铛：顶栏挂载（top-bar.tsx 头像区旁）。
 * 导出签名：() => JSX.Element（无 props；SSE hook 自取 useSession token）。
 */
export function NotificationBell() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  // task-10 三件套：未读数 / 最近 20 条 / SSE 实时失效（无轮询）。
  const { count } = useUnreadCount();
  const { items } = useNotifications({ limit: PANEL_LIST_LIMIT });
  useNotificationsStream();

  /** 条目点击：标记已读（乐观 invalidate）+ 跳转 link（空则仅已读）。 */
  const handleClick = async (n: NotificationRead) => {
    if (n.read_at == null) {
      try {
        await markNotificationRead(n.id);
      } catch {
        // 已读失败不阻断跳转（列表下次 SSE/聚焦刷新兜底）。
      }
      void queryClient.invalidateQueries({
        queryKey: queryKeys.notifications.all,
      });
    }
    if (n.link) router.push(n.link);
  };

  /** 全部已读：调 API 后 invalidate（列表 + 徽标共用前缀，一次双拉）。 */
  const handleReadAll = async () => {
    try {
      await markAllNotificationsRead();
      void queryClient.invalidateQueries({
        queryKey: queryKeys.notifications.all,
      });
    } catch {
      // 失败静默：徽标/列表保持现状，下次 SSE 事件或聚焦兜底。
    }
  };

  const content = (
    <div className="w-[360px] sm:w-[384px]" data-testid="notification-panel">
      <div className="flex items-center justify-between border-b border-border-weak px-4 pb-2.5 pt-3.5">
        <span className="text-sm font-semibold">
          通知
          {count > 0 && (
            <span className="ml-1 text-brand-600">（{count} 条未读）</span>
          )}
        </span>
        <button
          type="button"
          disabled={count === 0}
          onClick={handleReadAll}
          className="inline-flex items-center gap-1 text-xs text-brand-600 transition-colors hover:underline disabled:cursor-default disabled:text-slate-400 disabled:hover:no-underline"
        >
          <CheckCheck className="h-3.5 w-3.5" />
          全部已读
        </button>
      </div>
      <div className="max-h-[420px] overflow-y-auto">
        {items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-9 text-[13px] text-slate-400">
            <Inbox className="h-10 w-10 opacity-50" />
            暂无通知
          </div>
        ) : (
          items.map((n) => (
            <NotificationItem key={n.id} notification={n} onClick={handleClick} />
          ))
        )}
      </div>
    </div>
  );

  return (
    <Popover
      content={content}
      trigger="click"
      placement="bottomRight"
      open={open}
      onOpenChange={setOpen}
      arrow={false}
    >
      <button
        type="button"
        aria-label={`通知（${count} 条未读）`}
        data-testid="notification-bell-trigger"
        className={`relative inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-brand-50 hover:text-brand-600 ${
          open ? "bg-brand-50 text-brand-600" : ""
        }`}
      >
        <Badge count={count} overflowCount={99} size="small">
          <Bell className="h-5 w-5" />
        </Badge>
      </button>
    </Popover>
  );
}
