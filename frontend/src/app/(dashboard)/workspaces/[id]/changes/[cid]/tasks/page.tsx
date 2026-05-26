"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { ApiError } from "@/lib/api";
import {
  getTaskBoard,
  reparseTasks,
  type TaskBoard,
  type TaskReparseResponse,
  type TaskSummary,
} from "@/lib/tasks";

interface Props {
  params: { id: string; cid: string };
}

const PRIORITY_COLORS: Record<string, "destructive" | "default" | "outline"> = {
  P0: "destructive",
  P1: "default",
  P2: "outline",
  P3: "outline",
};

const COLUMN_COLORS: Record<string, string> = {
  draft: "bg-muted/50",
  ready: "bg-blue-50 dark:bg-blue-950/20",
  in_progress: "bg-amber-50 dark:bg-amber-950/20",
  review: "bg-purple-50 dark:bg-purple-950/20",
  done: "bg-green-50 dark:bg-green-950/20",
};

function TaskCard({
  task,
  workspaceId,
  changeId,
}: {
  task: TaskSummary;
  workspaceId: string;
  changeId: string;
}) {
  return (
    <Link
      href={`/workspaces/${workspaceId}/changes/${changeId}/tasks/${task.id}`}
      className="block rounded-md border bg-card p-3 shadow-sm transition-shadow hover:shadow-md"
    >
      <div className="flex items-center justify-between gap-2">
        <code className="text-xs text-muted-foreground">{task.task_key}</code>
        {task.priority && (
          <Badge variant={PRIORITY_COLORS[task.priority] ?? "outline"} className="text-[10px] px-1.5 py-0">
            {task.priority}
          </Badge>
        )}
      </div>
      <p className="mt-1 text-sm font-medium leading-snug">
        {task.title ?? task.task_key}
      </p>
      <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
        {task.owner_key && <span>@{task.owner_key}</span>}
        {task.estimated_hours != null && (
          <span>{task.estimated_hours}h</span>
        )}
        {task.affected_components.length > 0 && (
          <span>{task.affected_components.join(", ")}</span>
        )}
      </div>
    </Link>
  );
}

export default function TaskBoardPage({ params }: Props) {
  const workspaceId = params.id;
  const changeId = params.cid;
  const [board, setBoard] = useState<TaskBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [reparseResult, setReparseResult] = useState<TaskReparseResponse | null>(null);
  const [reparsing, setReparsing] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const b = await getTaskBoard(workspaceId, changeId);
        setBoard(b);
      } catch (err) {
        setPageError(err instanceof ApiError ? err.message : "加载看板失败");
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [workspaceId, changeId]);

  const loadBoard = async () => {
    try {
      const b = await getTaskBoard(workspaceId, changeId);
      setBoard(b);
    } catch (err) {
      setPageError(err instanceof ApiError ? err.message : "加载看板失败");
    }
  };

  const handleReparse = async () => {
    setReparsing(true);
    setReparseResult(null);
    try {
      const result = await reparseTasks(workspaceId, changeId);
      setReparseResult(result);
      await loadBoard();
    } catch (err) {
      setPageError(err instanceof ApiError ? err.message : "重新解析失败");
    } finally {
      setReparsing(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-[1400px] px-6 py-8">
        <p className="text-sm text-muted-foreground">加载中…</p>
      </div>
    );
  }

  if (pageError && !board) {
    return (
      <div className="mx-auto max-w-[1400px] px-6 py-8">
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {pageError}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-6 px-6 py-8">
      <header className="flex items-center justify-between">
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">
            <Link href={`/workspaces/${workspaceId}/changes/${changeId}`} className="hover:underline">
              &larr; 回到变更详情
            </Link>
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">任务看板</h1>
        </div>
        <button
          onClick={handleReparse}
          disabled={reparsing}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {reparsing ? "解析中…" : "重新解析任务"}
        </button>
      </header>

      {reparseResult && (
        <div className="rounded-md border bg-muted/50 p-3 text-sm">
          解析完成：新增 {reparseResult.stats.created}，更新{" "}
          {reparseResult.stats.updated}，删除 {reparseResult.stats.deleted}
          {reparseResult.warnings.length > 0 && (
            <span className="ml-2 text-amber-600">
              ({reparseResult.warnings.length} 个警告)
            </span>
          )}
        </div>
      )}

      {board && board.columns.length > 0 ? (
        <div className="grid auto-cols-fr grid-flow-col gap-4">
          {board.columns.map((col) => (
            <div key={col.status} className={`flex flex-col rounded-lg p-3 ${COLUMN_COLORS[col.status] ?? ""}`}>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold">{col.status}</h3>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
                  {col.count}
                </span>
              </div>
              <div className="flex flex-1 flex-col gap-2">
                {col.items.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    workspaceId={workspaceId}
                    changeId={changeId}
                  />
                ))}
                {col.items.length === 0 && (
                  <p className="py-4 text-center text-xs text-muted-foreground">
                    暂无任务
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-md border p-8 text-center text-sm text-muted-foreground">
          暂无任务。点击 &ldquo;重新解析任务&rdquo; 从文件系统加载。
        </div>
      )}
    </div>
  );
}
