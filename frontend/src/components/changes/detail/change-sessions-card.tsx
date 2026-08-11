"use client";

import { useState } from "react";

import { ChangeSessionSection } from "@/components/changes/change-session-section";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * 会话调试卡（次线侧栏入口，2026-08-11-change-detail-layout-rework / FR-02 / D-002 +
 * ql-20260811-002 修复）。
 *
 * 原版把 ChangeSessionSection（两栏 grid `md:grid-cols-[230px_1fr]`：会话列表 + 问答面板）
 * 整包塞进 320px 折叠卡——`md:` 是视口断点非容器断点，桌面视口下即使容器只有 320px 也强制
 * 两栏 → 面板被挤到 ~80px 根本用不了。改为：侧栏紧凑入口卡（标题+说明+「打开」按钮），点击
 * 在宽 Dialog（max-w-6xl × 85vh）里渲染完整 ChangeSessionSection——容器有足够横向空间让
 * 两栏布局正常工作。黑盒复用 ChangeSessionSection 不改其内部。Dialog 内容仅 open 时 mount
 * （radix Portal 惰性），关闭即卸载，无空载请求与 SSE 连接。
 */
export interface ChangeSessionsCardProps {
  workspaceId: string;
  changeId: string;
}

export function ChangeSessionsCard({ workspaceId, changeId }: ChangeSessionsCardProps) {
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded-md border bg-card px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-xs font-medium">会话调试</h2>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            在变更上下文中提问 / 调试（点开进入）
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          打开
        </Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex h-[85vh] max-w-6xl flex-col gap-0 p-0">
          <DialogHeader className="border-b px-4 py-3">
            <DialogTitle className="text-sm">会话调试</DialogTitle>
            <DialogDescription className="text-[11px]">
              历史会话列表 + 问答面板（与主线执行日志分开）
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-hidden p-3">
            <ChangeSessionSection workspaceId={workspaceId} changeId={changeId} />
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
