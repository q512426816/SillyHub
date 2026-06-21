"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  PageContainer,
  PageHeader,
} from "@/components/layout";
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
  draft: "bg-muted/30",
  ready: "bg-blue-50/60",
  in_progress: "bg-amber-50/60",
  review: "bg-violet-50/60",
  done: "bg-emerald-50/60",
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
      className="block rounded border bg-card p-2.5 transition-shadow hover:shadow-sm"
    >
      <div className="flex items-center justify-between gap-2">
        <code className="text-[11px] text-muted-foreground">{task.task_key}</code>
        {task.priority && (
          <Badge variant={PRIORITY_COLORS[task.priority] ?? "outline"} className="text-[10px] px-1 py-0">
            {task.priority}
          </Badge>
        )}
      </div>
      <p className="mt-1 text-xs font-medium leading-snug">
        {task.title ?? task.task_key}
      </p>
      <div className="mt-1.5 flex flex-wrap gap-2 text-[10px] text-muted-foreground">
        {task.owner_key && <span>@{task.owner_key}</span>}
        {task.estimated_hours != null && <span>{task.estimated_hours}h</span>}
        {task.affected_components.length > 0 && (
          <span className="truncate">{task.affected_components.join(", ")}</span>
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
      <PageContainer>
        <p className="text-xs text-muted-foreground">加载中…</p>
      </PageContainer>
    );
  }

  if (pageError && !board) {
    return (
      <PageContainer>
        <div className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
          {pageError}
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer className="gap-5">
      <p className="text-[11px] text-muted-foreground">
        <Link href={`/workspaces/${workspaceId}/changes/${changeId}`} className="hover:underline">
          ← 变更详情
        </Link>
      </p>
      <PageHeader
        title="任务看板"
        actions={
          <Button
            size="sm"
            onClick={() => void handleReparse()}
            disabled={reparsing}
          >
            {reparsing ? "解析中…" : "重新解析"}
          </Button>
        }
      />

      {reparseResult && (
        <div className="rounded border bg-muted/40 px-3 py-2 text-xs">
          解析完成：新增 {reparseResult.stats.created}，更新{" "}
          {reparseResult.stats.updated}，删除 {reparseResult.stats.deleted}
          {reparseResult.warnings.length > 0 && (
            <span className="ml-1 text-amber-600">
              ({reparseResult.warnings.length} 个警告)
            </span>
          )}
        </div>
      )}

      {board && board.columns.length > 0 ? (
        <div className="grid auto-cols-fr grid-flow-col gap-3">
          {board.columns.map((col) => (
            <div key={col.status} className={`flex flex-col rounded-md p-2.5 ${COLUMN_COLORS[col.status] ?? ""}`}>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-xs font-semibold">{col.status}</h3>
                <span className="rounded bg-muted/60 px-1.5 py-px text-[10px]">
                  {col.count}
                </span>
              </div>
              <div className="flex flex-1 flex-col gap-1.5">
                {col.items.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    workspaceId={workspaceId}
                    changeId={changeId}
                  />
                ))}
                {col.items.length === 0 && (
                  <p className="py-4 text-center text-[11px] text-muted-foreground">
                    暂无任务
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-md border py-12 text-center text-xs text-muted-foreground">
          暂无任务。点击&ldquo;重新解析&rdquo;从文件系统加载。
        </div>
      )}
    </PageContainer>
  );
}
