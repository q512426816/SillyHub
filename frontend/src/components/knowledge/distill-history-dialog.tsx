"use client";

/**
 * 提炼记录弹层（ql-20260918-002 / D-010④ 补口）。
 *
 * 蒸馏会话经 origin=k-distill 在常规会话页隔离，任务条又只在「进行中/完成后
 * 8s 停留」可见——历史蒸馏任务完成后即无任何入口打开对应会话。本弹层列全部
 * 蒸馏任务（后端 list_tasks 不过滤状态），每条可：跳执行会话（agent_session_id
 * 深链，蒸馏会话与续接原会话均可打开）、跳合并后的知识条目（merged_to 反链）。
 */

import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { distillDegradedText, splitMergedTo } from "@/components/knowledge/distill-task-bar";
import { listDistillTasks, type DistillTaskRead } from "@/lib/knowledge";

const STATUS_LABEL: Record<string, string> = {
  pending: "排队中",
  running: "进行中",
  completed: "已完成",
  failed: "失败",
};
const STATUS_CLASS: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  running: "bg-brand-100 text-brand-700",
  completed: "bg-success/10 text-success",
  failed: "bg-error/10 text-error",
};

/** 来源摘要：会话/变更/快速修复（截断 ref）。 */
function sourceText(task: DistillTaskRead): string {
  const head =
    task.source_type === "session"
      ? "会话"
      : task.source_type === "change"
        ? "变更"
        : "快速修复";
  // quick 多选后端投影为 JSON 串（DistillTaskRead.source_ref: string）——解析
  // 成条数展示；解析失败按普通 ref 截断（会话 UUID/变更名）。
  let ref = String(task.source_ref);
  if (task.source_type === "quick") {
    try {
      const parsed = JSON.parse(ref);
      if (Array.isArray(parsed)) ref = `${parsed.length} 条记录`;
    } catch {
      // 单条 quick（旧投影）落普通截断
    }
  }
  return `${head} · ${ref.length > 24 ? `${ref.slice(0, 24)}…` : ref}`;
}

export interface DistillHistoryDialogProps {
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** merged_to 反链跳转（复用知识库页 selectEntry 选中目标条目）。 */
  onJumpToEntry?: (filename: string) => void;
}

export function DistillHistoryDialog({
  workspaceId,
  open,
  onOpenChange,
  onJumpToEntry,
}: DistillHistoryDialogProps) {
  const router = useRouter();
  const { data, isLoading, error } = useQuery({
    queryKey: ["knowledge", "distill-history", workspaceId],
    queryFn: () => listDistillTasks(workspaceId),
    // enabled: open——弹层打开才挂载查询（react-query 缺省 staleTime 0，每次
    // 打开自动重取拿最新状态，无需手动 refetch）。
    enabled: open,
  });

  const items = (data ?? []).slice(0, 50);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>提炼记录</DialogTitle>
          <DialogDescription>
            历史蒸馏任务（最近 50 条）——点击「查看会话」打开执行提炼的会话。
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <p className="py-8 text-center text-xs text-muted-foreground">加载中…</p>
        ) : error ? (
          <p className="py-8 text-center text-xs text-error">加载失败，请稍后重试。</p>
        ) : items.length === 0 ? (
          <p className="py-8 text-center text-xs text-muted-foreground">
            还没有提炼记录——从「沉淀知识」派发第一次蒸馏吧。
          </p>
        ) : (
          <ul data-testid="distill-history-list" className="max-h-[55vh] space-y-1.5 overflow-auto">
            {items.map((task) => (
              <li
                key={task.agent_run_id}
                data-testid="distill-history-item"
                className="flex min-w-0 items-center gap-2 rounded-md border border-border/60 px-2.5 py-2"
              >
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-medium ${
                    STATUS_CLASS[task.status] ?? "bg-muted text-muted-foreground"
                  }`}
                >
                  {STATUS_LABEL[task.status] ?? task.status}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs">{sourceText(task)}</span>
                  <span className="block text-[10.5px] text-muted-foreground">
                    {new Date(task.created_at).toLocaleString("zh-CN")}
                    {task.degraded_reason ? ` · ${distillDegradedText(task.degraded_reason)}` : ""}
                  </span>
                </span>
                {task.merged_to ? (
                  <button
                    type="button"
                    data-testid="distill-history-merged"
                    title={`已合并到 ${task.merged_to}，点击跳转`}
                    onClick={() => {
                      onJumpToEntry?.(splitMergedTo(task.merged_to as string).file);
                      onOpenChange(false);
                    }}
                    className="shrink-0 max-w-32 truncate text-[11px] text-brand-600 hover:underline"
                  >
                    已合并 ↗
                  </button>
                ) : null}
                {task.agent_session_id ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    data-testid="distill-history-session"
                    className="h-6 shrink-0 px-2 text-[11px] text-brand-600"
                    onClick={() => {
                      router.push(`/sessions?session=${task.agent_session_id}`);
                      onOpenChange(false);
                    }}
                  >
                    查看会话 ↗
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
