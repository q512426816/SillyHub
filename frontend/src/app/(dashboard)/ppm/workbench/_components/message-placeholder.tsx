"use client";

/**
 * MessagePlaceholder — 消息通知 / 绩效考评 EmptyState 占位 (task-11 / D-007@v1)。
 *
 * D-007@v1:消息通知与绩效考评本期只做占位,不建后端 notification/performance 表与接口
 * (design §3 非目标)。复用 EmptyState,props 支持自定义 title/description,
 * 绩效考评占位时复用本组件传不同 title/文案即可。
 */
import { Bell } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";
import { SectionCard } from "@/components/layout";

export interface MessagePlaceholderProps {
  /** 卡片标题,默认「消息通知」,复用作绩效考评占位时可传「绩效考评」。 */
  title?: string;
  /** 空态主文案,默认「消息功能开发中」。 */
  emptyTitle?: string;
  /** 空态描述,默认「消息通知模块暂未上线,后续单独开放。」。 */
  description?: string;
}

export function MessagePlaceholder({
  title = "消息通知",
  emptyTitle = "消息功能开发中",
  description = "消息通知模块暂未上线,后续单独开放。",
}: MessagePlaceholderProps) {
  return (
    <SectionCard title={title} bodyPadding="p-4">
      <EmptyState
        icon={<Bell className="size-5" />}
        title={emptyTitle}
        description={description}
      />
    </SectionCard>
  );
}
