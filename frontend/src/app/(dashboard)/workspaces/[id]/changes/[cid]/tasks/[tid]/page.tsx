"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { ApiError } from "@/lib/api";
import { getTask, type TaskRead } from "@/lib/tasks";

interface Props {
  params: { id: string; cid: string; tid: string };
}

const PRIORITY_COLORS: Record<string, "destructive" | "default" | "outline"> = {
  P0: "destructive",
  P1: "default",
  P2: "outline",
  P3: "outline",
};

export default function TaskDetailPage({ params }: Props) {
  const workspaceId = params.id;
  const changeId = params.cid;
  const taskId = params.tid;
  const [task, setTask] = useState<TaskRead | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const t = await getTask(workspaceId, taskId);
        setTask(t);
      } catch (err) {
        setPageError(err instanceof ApiError ? err.message : "加载任务失败");
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [workspaceId, taskId]);

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-8">
        <p className="text-sm text-muted-foreground">加载中…</p>
      </div>
    );
  }

  if (pageError || !task) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-8">
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {pageError ?? "任务未找到"}
        </div>
        <Link
          href={`/workspaces/${workspaceId}/changes/${changeId}/tasks`}
          className="mt-4 inline-block text-sm text-primary hover:underline"
        >
          &larr; 回到任务看板
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-8">
      <header className="space-y-1">
        <p className="text-xs text-muted-foreground">
          <Link
            href={`/workspaces/${workspaceId}/changes/${changeId}/tasks`}
            className="hover:underline"
          >
            &larr; 回到任务看板
          </Link>
        </p>
        <div className="flex items-center gap-3">
          <code className="text-xs text-muted-foreground">{task.task_key}</code>
          <h1 className="text-2xl font-semibold tracking-tight">
            {task.title ?? task.task_key}
          </h1>
          <Badge variant={PRIORITY_COLORS[task.priority ?? ""] ?? "outline"}>
            {task.priority ?? "—"}
          </Badge>
          <Badge variant="outline">{task.status}</Badge>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-4 rounded-md border bg-card p-4 text-sm">
        <div>
          <span className="text-muted-foreground">阶段</span>
          <p className="font-medium">{task.phase ?? "—"}</p>
        </div>
        <div>
          <span className="text-muted-foreground">负责人</span>
          <p className="font-medium">{task.owner_key ?? "—"}</p>
        </div>
        <div>
          <span className="text-muted-foreground">预估工时</span>
          <p className="font-medium">
            {task.estimated_hours != null ? `${task.estimated_hours}h` : "—"}
          </p>
        </div>
        <div>
          <span className="text-muted-foreground">影响组件</span>
          <p className="font-medium">
            {task.affected_components.length > 0
              ? task.affected_components.join(", ")
              : "—"}
          </p>
        </div>
        <div>
          <span className="text-muted-foreground">允许路径</span>
          <p className="font-medium">
            {task.allowed_paths.length > 0
              ? task.allowed_paths.join(", ")
              : "—"}
          </p>
        </div>
        <div>
          <span className="text-muted-foreground">依赖</span>
          <p className="font-medium">
            {task.depends_on.length > 0 ? task.depends_on.join(", ") : "无"}
          </p>
        </div>
        <div>
          <span className="text-muted-foreground">阻塞</span>
          <p className="font-medium">
            {task.blocks.length > 0 ? task.blocks.join(", ") : "无"}
          </p>
        </div>
        <div>
          <span className="text-muted-foreground">文件路径</span>
          <p className="font-mono text-xs">{task.path ?? "—"}</p>
        </div>
      </section>

      {task.content && (
        <section className="rounded-md border bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground">
            内容
          </h2>
          <pre className="max-h-[600px] overflow-auto whitespace-pre-wrap text-xs leading-relaxed">
            {task.content}
          </pre>
        </section>
      )}
    </div>
  );
}
