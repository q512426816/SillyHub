"use client";

import { useState } from "react";

import { ChangeFileTree } from "@/components/change-file-tree";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * 变更文件卡（次线侧栏入口，2026-08-11-change-detail-layout-rework / FR-02 / D-002 +
 * ql-20260811-002 修复）。
 *
 * 原版把 ChangeFileTree（含默认预览 iframe/编辑器，ql-20260709-004）整包塞进 320px 折叠卡，
 * 预览挤崩看不了。改为：侧栏紧凑入口卡（标题+说明+「打开」按钮），点击在宽 Dialog
 * （max-w-6xl × 85vh）里渲染完整 ChangeFileTree——给文件树+预览足够横向空间。
 * 黑盒复用 ChangeFileTree 不改其内部。Dialog 内容仅 open 时 mount（radix Portal 惰性），
 * 关闭即卸载，无空载请求。
 */
export interface ChangeFilesCardProps {
  workspaceId: string;
  changeId: string;
}

export function ChangeFilesCard({ workspaceId, changeId }: ChangeFilesCardProps) {
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded-md border bg-card px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-xs font-medium">变更文件</h2>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            改动文件树 + 预览（点开查看）
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          打开
        </Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex h-[85vh] max-w-6xl flex-col gap-0 p-0">
          <DialogHeader className="border-b px-4 py-3">
            <DialogTitle className="text-sm">变更文件</DialogTitle>
            <DialogDescription className="text-[11px]">
              改动文件树与内容预览
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-hidden p-3">
            <ChangeFileTree workspaceId={workspaceId} changeId={changeId} />
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
