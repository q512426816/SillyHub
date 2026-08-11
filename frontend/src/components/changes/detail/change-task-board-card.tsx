"use client";

import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import type { TaskBoard } from "@/lib/tasks";

/**
 * 任务看板摘要卡（次线侧栏，2026-08-11-change-detail-layout-rework / FR-01 / D-001）。
 *
 * 从原 page.tsx 右侧 aside「任务进度」原样抽取：总体进度条 + 各状态计数 + 「查看看板」链接。
 * 无任务拆分（taskBoard 为空或 columns 为空）时返回 null 不渲染（快速修复类自动隐藏）。
 */
export interface ChangeTaskBoardCardProps {
  workspaceId: string;
  changeId: string;
  taskBoard: TaskBoard | null;
}

export function ChangeTaskBoardCard({
  workspaceId,
  changeId,
  taskBoard,
}: ChangeTaskBoardCardProps) {
  if (!taskBoard || taskBoard.columns.length === 0) return null;

  const total = taskBoard.columns.reduce((s, c) => s + c.count, 0);
  const doneCol = taskBoard.columns.find(
    (c) => c.status === "done" || c.status === "completed",
  );
  const doneCount = doneCol?.count ?? 0;
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  return (
    <section className="rounded-md border bg-card">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <h2 className="text-xs font-medium">任务看板</h2>
        <Link
          href={`/workspaces/${workspaceId}/changes/${changeId}/tasks`}
          className="text-[11px] text-primary hover:underline"
        >
          查看看板
        </Link>
      </div>
      <div className="px-3 py-2">
        <div className="mb-1.5 flex items-center justify-between text-[11px]">
          <span className="text-muted-foreground">总体进度</span>
          <span className="text-foreground">
            {doneCount} / {total} 完成
          </span>
        </div>
        <div className="mb-3 h-2 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          {taskBoard.columns.map((col) => (
            <div key={col.status} className="flex items-center gap-2 text-[11px]">
              <Badge
                variant={
                  col.status === "done" || col.status === "completed"
                    ? "success"
                    : col.status === "in_progress"
                      ? "default"
                      : col.status === "blocked"
                        ? "destructive"
                        : "outline"
                }
                className="min-w-[24px] justify-center"
              >
                {col.count}
              </Badge>
              <span className="text-muted-foreground">{col.status}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
