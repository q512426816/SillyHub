"use client";

/**
 * ChatMessageAvatar — 聊天消息行共享头像（2026-09-09-sessions-visual-refresh
 * task-03 / D-003@v1 / D-006@v2）。
 *
 * 单聊（turn-timeline 旧路径 / turn-segment-views v2 段路径对话视图）与群聊
 * （group-chat-panel 消息行）三处同源消费——消息角色化的视觉锚点：
 *   - kind="agent"：品牌渐变底（from-brand-600 to-info，随主题换肤）+ 外圈
 *     光环（1.5px brand-400/40）+ Bot 图标 + shadow-primary；dark 主题下渐变
 *     自动映射青色系（brand 阶翻转）；
 *   - kind="user"：avatar 有值 → 图片（useAvatarSrc 解析：文件中心 URL 带
 *     token 取 blob / 外链直用）；无值 → muted 底 + name 首字（群聊成员分色
 *     由消费方经 className 附加，本构件不抹平成员区分——D-006@v2）。
 */
import { memo } from "react";
import { Bot } from "lucide-react";

import { cn } from "@/lib/utils";
import { useAvatarSrc } from "./use-avatar-src";

export interface ChatMessageAvatarProps {
  kind: "agent" | "user";
  /** user 侧显示名（取首字回退）；agent 侧忽略 */
  name?: string;
  /** 自定义头像图片 URL（群聊成员已上传头像）；非空时优先于首字回退渲染图片 */
  avatar?: string | null;
  /** 像素尺寸，默认 32（消息行）；28 供紧凑场景 */
  size?: 28 | 32;
  title?: string;
  /** 附加类（群聊成员首字分色等场景；图片态作外层 span 类） */
  className?: string;
}

const SIZE_CLS: Record<28 | 32, { box: string; icon: string; text: string }> = {
  28: { box: "h-7 w-7", icon: "h-3.5 w-3.5", text: "text-[11px]" },
  32: { box: "h-8 w-8", icon: "h-4 w-4", text: "text-xs" },
};

export const ChatMessageAvatar = memo(function ChatMessageAvatar({
  kind,
  name,
  avatar,
  size = 32,
  title,
  className,
}: ChatMessageAvatarProps) {
  const sizeCls = SIZE_CLS[size];
  // D-006@v2：avatar 图片优先与 kind 无关（群聊 agent 成员也可上传自定义头像）；
  // 有图渲染图片（agent 侧外圈光环保留），无图按 kind 回退（agent=Bot 渐变 / user=首字）。
  const src = useAvatarSrc(avatar);

  if (src) {
    return (
      <span
        title={title}
        data-testid="chat-message-avatar-img"
        className={cn(
          "relative inline-flex shrink-0 overflow-hidden rounded-full",
          kind === "agent" && "shadow-primary",
          sizeCls.box,
          className,
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- blob objectURL/外链，非静态资源 */}
        <img src={src} alt={name ?? "头像"} className="h-full w-full object-cover" />
        {kind === "agent" && (
          <span
            aria-hidden
            className="pointer-events-none absolute -inset-[3px] rounded-full border-[1.5px] border-brand-400/40"
          />
        )}
      </span>
    );
  }

  if (kind === "agent") {
    return (
      <span
        aria-hidden
        title={title}
        data-testid="chat-message-avatar-agent"
        className={cn(
          "relative flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-600 to-info text-white shadow-primary",
          sizeCls.box,
          className,
        )}
      >
        <Bot className={sizeCls.icon} />
        {/* 外圈光环：绝对定位描边环，不占布局（v4 原型 .avatar.agent::after） */}
        <span
          aria-hidden
          className="pointer-events-none absolute -inset-[3px] rounded-full border-[1.5px] border-brand-400/40"
        />
      </span>
    );
  }

  const initial = (name || "?").trim().slice(0, 1) || "?";
  return (
    <span
      aria-hidden
      title={title}
      data-testid="chat-message-avatar-user"
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full border border-border/60 bg-muted font-medium text-muted-foreground",
        sizeCls.box,
        sizeCls.text,
        className,
      )}
    >
      {initial.toUpperCase()}
    </span>
  );
});
