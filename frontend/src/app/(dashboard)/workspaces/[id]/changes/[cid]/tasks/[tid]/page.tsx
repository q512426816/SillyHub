"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { AgentModelInput } from "@/components/AgentModelInput";
import { AgentProviderSelect } from "@/components/AgentProviderSelect";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  PageContainer,
  PageHeader,
} from "@/components/layout";
import { ApiError } from "@/lib/api";
import {
  createAgentRun,
  getAgentRunLogs,
  listAgentRuns,
  listDaemonRuntimes,
  type AgentRun,
  type DaemonRuntime,
} from "@/lib/agent";
import { getChange, type ChangeRead } from "@/lib/changes";
import { STATUS_LABELS, labelOf } from "@/lib/status-labels";
import { getTask, type TaskRead } from "@/lib/tasks";
import { transitionTask } from "@/lib/workflow";

interface Props {
  params: { id: string; cid: string; tid: string };
}

const STATUS_COLORS: Record<
  string,
  "outline" | "default" | "warning" | "success" | "destructive"
> = {
  draft: "outline",
  ready: "default",
  in_progress: "warning",
  review: "default",
  done: "success",
};

const PRIORITY_COLORS: Record<
  string,
  "destructive" | "warning" | "default" | "outline"
> = {
  P0: "destructive",
  P1: "warning",
  P2: "default",
  P3: "outline",
};

const TASK_TRANSITIONS: Record<
  string,
  { target: string; label: string }[]
> = {
  draft: [{ target: "ready", label: "标记就绪" }],
  ready: [{ target: "in_progress", label: "开始执行" }],
  in_progress: [{ target: "review", label: "提交审查" }],
  review: [{ target: "done", label: "标记完成" }],
};

interface TimelineEntry {
  id: string;
  timestamp: string;
  badge: string;
  badgeColor: "default" | "outline" | "warning" | "success";
  description: string;
}

/* ---- Acceptance-criteria parser ---- */
interface Criterion {
  text: string;
  status: "done" | "in_progress" | "pending";
}

function parseCriteria(content: string | null): Criterion[] {
  if (!content) return [];
  const criteria: Criterion[] = [];

  // Match lines like "- [x] ..." or "- [ ] ..." or "* [x] ..." etc.
  const checkboxRe = /^\s*[-*]\s*\[([ xX~])\]\s*(.+)/gm;
  let match;
  while ((match = checkboxRe.exec(content)) !== null) {
    const marker = match[1]?.toLowerCase() ?? "";
    const text = (match[2] ?? "").trim();
    if (!text) continue;
    let status: Criterion["status"] = "pending";
    if (marker === "x") status = "done";
    else if (marker === "~") status = "in_progress";
    criteria.push({ text, status });
  }

  // If no checkbox patterns found, look for section-based criteria
  if (criteria.length === 0) {
    const sectionRe =
      /(?:Acceptance Criteria|验收标准|完成标准)[\s\S]*?\n((?:\s*[-*]\s+.+\n?)+)/i;
    const sectionMatch = sectionRe.exec(content);
    if (sectionMatch) {
      const lines = (sectionMatch[1] ?? "").split("\n");
      for (const line of lines) {
        const cleaned = line.replace(/^\s*[-*]\s+/, "").trim();
        if (cleaned) {
          criteria.push({ text: cleaned, status: "pending" });
        }
      }
    }
  }

  return criteria;
}

/* ---- Tool-call description extractor ---- */
function toolCallDescription(content: string | null | undefined): string {
  // ql-20260616-002：上游 content_redacted 可为 null（后端 schema str|None）。
  const safe = content ?? "";
  if (!safe) return "";
  try {
    const parsed = JSON.parse(safe);
    if (parsed.name) return `Tool: ${parsed.name}`;
    if (parsed.tool) return `Tool: ${parsed.tool}`;
    return safe.length > 80 ? safe.slice(0, 80) + "..." : safe;
  } catch {
    return safe.length > 80 ? safe.slice(0, 80) + "..." : safe;
  }
}

export default function TaskDetailPage({ params }: Props) {
  const workspaceId = params.id;
  const changeId = params.cid;
  const taskId = params.tid;

  const [task, setTask] = useState<TaskRead | null>(null);
  const [change, setChange] = useState<ChangeRead | null>(null);
  const [agentRuns, setAgentRuns] = useState<AgentRun[]>([]);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [transitioning, setTransitioning] = useState(false);
  const [showAgentForm, setShowAgentForm] = useState(false);
  const [creatingRun, setCreatingRun] = useState(false);
  const [daemonRuntimes, setDaemonRuntimes] = useState<DaemonRuntime[]>([]);
  const [preferredBackend, setPreferredBackend] = useState<"server" | "daemon">("server");
  // Selected agent provider for this run; null follows workspace.default_agent.
  const [runProvider, setRunProvider] = useState<string | null>(null);
  const [runModel, setRunModel] = useState<string | null>(null);
  const [runtimesLoading, setRuntimesLoading] = useState(false);

  /* ---- Data loading ---- */
  const loadTask = useCallback(async () => {
    setLoading(true);
    setPageError(null);
    try {
      const [t, c] = await Promise.all([
        getTask(workspaceId, taskId),
        getChange(workspaceId, changeId).catch(() => null),
      ]);
      setTask(t);
      setChange(c);

      // Load agent runs for this task
      const runs = await listAgentRuns(workspaceId, taskId).catch(() => []);
      setAgentRuns(runs);

      // Build timeline from runs and their logs
      const entries: TimelineEntry[] = [];

      for (const run of runs) {
        const runMeta: string[] = [run.agent_type];
        if (run.spec_strategy) runMeta.push(run.spec_strategy);
        if (run.profile_version) runMeta.push(`profile ${run.profile_version}`);
        entries.push({
          id: `run-${run.id}`,
          timestamp: run.created_at,
          badge: "已创建",
          badgeColor: "default",
          description: `智能体运行已创建（${runMeta.join(", ")}）`,
        });

        if (run.started_at) {
          entries.push({
            id: `run-${run.id}-start`,
            timestamp: run.started_at,
            badge: "智能体运行",
            badgeColor:
              run.status === "completed"
                ? "success"
                : run.status === "failed"
                  ? "outline"
                  : "warning",
            description: `运行 ${labelOf(STATUS_LABELS, run.status)}`,
          });
        }

        // Load logs for this run to extract tool_call entries
        try {
          const logs = await getAgentRunLogs(workspaceId, run.id);
          const toolCalls = logs.filter((l) => l.channel === "tool_call");
          for (const tc of toolCalls) {
            entries.push({
              id: tc.id,
              timestamp: tc.timestamp,
              badge: "工具调用",
              badgeColor: "outline",
              description: toolCallDescription(tc.content_redacted),
            });
          }
        } catch {
          // Skip log loading errors
        }
      }

      // Sort by timestamp descending
      entries.sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      );
      setTimeline(entries);
    } catch (err) {
      setPageError(
        err instanceof ApiError ? err.message : "加载任务失败",
      );
    } finally {
      setLoading(false);
    }
  }, [workspaceId, changeId, taskId]);

  useEffect(() => {
    void loadTask();
  }, [loadTask]);

  /* ---- Status transition handler ---- */
  const handleTransition = async (targetStatus: string) => {
    if (!task) return;
    setTransitioning(true);
    setPageError(null);
    try {
      const result = await transitionTask(workspaceId, taskId, targetStatus);
      setTask({ ...task, status: result.status });
    } catch (err) {
      setPageError(
        err instanceof ApiError ? err.message : "状态转移失败",
      );
    } finally {
      setTransitioning(false);
    }
  };

  /* ---- Agent run creation handler ---- */
  const handleCreateAgentRun = async () => {
    if (!task) return;
    setCreatingRun(true);
    setPageError(null);
    try {
      await createAgentRun(workspaceId, {
        task_id: task.id,
        lease_id: "", // lease not required from UI
        agent_type: "claude_code",
        preferred_backend: preferredBackend,
        provider: runProvider,
        model: runModel,
      });
      setShowAgentForm(false);
      // Reload to pick up the new run
      await loadTask();
    } catch (err) {
      setPageError(
        err instanceof ApiError ? err.message : "创建智能体运行失败",
      );
    } finally {
      setCreatingRun(false);
    }
  };

  /* ---- Loading state ---- */
  if (loading) {
    return (
      <PageContainer className="gap-5">
        <p className="text-xs text-muted-foreground">加载中...</p>
      </PageContainer>
    );
  }

  /* ---- Error / not-found state ---- */
  if (pageError || !task) {
    return (
      <PageContainer className="gap-5">
        <div className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
          {pageError ?? "任务未找到"}
        </div>
        <Link
          href={`/workspaces/${workspaceId}/changes/${changeId}/tasks`}
          className="text-xs text-primary hover:underline"
        >
          &larr; 任务看板
        </Link>
      </PageContainer>
    );
  }

  const changeKey = change?.change_key ?? changeId;
  const availableTransitions = TASK_TRANSITIONS[task.status] ?? [];
  const criteria = parseCriteria(task.content);

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return iso;
    }
  };

  const criterionIcon = (status: Criterion["status"]) => {
    switch (status) {
      case "done":
        return <span className="text-emerald-600">&#10003;</span>;
      case "in_progress":
        return <span className="text-amber-600">&#9684;</span>;
      case "pending":
        return <span className="text-muted-foreground">&#9675;</span>;
    }
  };

  return (
    <PageContainer className="gap-5">
      {/* ---- Breadcrumb ---- */}
      <nav className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <Link
          href={`/workspaces/${workspaceId}/changes`}
          className="hover:underline"
        >
          变更中心
        </Link>
        <span>/</span>
        <Link
          href={`/workspaces/${workspaceId}/changes/${changeId}`}
          className="hover:underline"
        >
          {changeKey}
        </Link>
        <span>/</span>
        <Link
          href={`/workspaces/${workspaceId}/changes/${changeId}/tasks`}
          className="hover:underline"
        >
          任务看板
        </Link>
        <span>/</span>
        <span className="text-foreground">{task.task_key}</span>
      </nav>

      {/* ---- Error banner ---- */}
      {pageError && (
        <div className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
          {pageError}
        </div>
      )}

      {/* ---- Header ---- */}
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2 text-base font-semibold">
            <span className="truncate">
              {task.task_key}: {task.title ?? task.task_key}
            </span>
            <Badge variant={STATUS_COLORS[task.status] ?? "outline"}>
              {labelOf(STATUS_LABELS, task.status)}
            </Badge>
            {task.priority && (
              <Badge variant={PRIORITY_COLORS[task.priority] ?? "outline"}>
                {task.priority}
              </Badge>
            )}
          </span>
        }
        actions={
          <>
            {availableTransitions.map((t) => (
              <Button
                key={t.target}
                size="sm"
                onClick={() => void handleTransition(t.target)}
                disabled={transitioning}
              >
                {t.label}
              </Button>
            ))}
            <Link
              href={`/workspaces/${workspaceId}/changes/${changeId}`}
              className="inline-flex"
            >
              <Button size="sm" variant="outline">
                查看文件
              </Button>
            </Link>
            <Button
              size="sm"
              onClick={() => {
                setShowAgentForm(!showAgentForm);
                if (!showAgentForm) {
                  setRuntimesLoading(true);
                  listDaemonRuntimes()
                    .then((runtimes) => {
                      setDaemonRuntimes(runtimes);
                      const hasOnline = runtimes.some((r) => r.status === "online");
                      setPreferredBackend(hasOnline ? "daemon" : "server");
                    })
                    .catch(() => {
                      setDaemonRuntimes([]);
                      setPreferredBackend("server");
                    })
                    .finally(() => setRuntimesLoading(false));
                }
              }}
            >
              分配给 Agent
            </Button>
          </>
        }
      />

      {/* ---- Agent assignment form ---- */}
      {showAgentForm && (
        <div className="rounded-md border bg-card p-3">
          <div className="mb-2 border-b px-3 py-2 text-xs font-medium">
            分配 Agent
          </div>
          <div className="flex flex-col gap-3 px-3 pt-2">
            <div className="flex items-end gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-muted-foreground">
                  智能体类型
                </label>
                <select
                  className="h-7 rounded border border-input bg-background px-2 text-xs"
                  disabled
                >
                  <option>Claude Code</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-muted-foreground">
                  Agent provider
                </label>
                <AgentProviderSelect
                  value={runProvider}
                  onChange={setRunProvider}
                  includeDefault="跟随工作区默认"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-muted-foreground">
                  Agent model
                </label>
                <AgentModelInput value={runModel} onChange={setRunModel} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-muted-foreground">
                  运行位置
                </label>
                <div className="flex items-center gap-3 h-7">
                  <label className="flex cursor-pointer items-center gap-1.5 text-xs">
                    <input
                      type="radio"
                      name="run-backend"
                      value="server"
                      checked={preferredBackend === "server"}
                      onChange={() => setPreferredBackend("server")}
                      className="accent-primary"
                    />
                    在服务器运行
                  </label>
                  <label
                    className={`flex items-center gap-1.5 text-xs ${
                      daemonRuntimes.some((r) => r.status === "online")
                        ? "cursor-pointer"
                        : "cursor-not-allowed opacity-40"
                    }`}
                  >
                    <input
                      type="radio"
                      name="run-backend"
                      value="daemon"
                      checked={preferredBackend === "daemon"}
                      onChange={() => setPreferredBackend("daemon")}
                      disabled={
                        !daemonRuntimes.some((r) => r.status === "online")
                      }
                      className="accent-primary"
                    />
                    在本地运行
                    {daemonRuntimes.some((r) => r.status === "online") && (
                      <Badge variant="success" className="text-[9px] px-1 py-0">
                        {daemonRuntimes.filter((r) => r.status === "online").length} 在线
                      </Badge>
                    )}
                  </label>
                </div>
              </div>
              <Button
                size="sm"
                onClick={() => void handleCreateAgentRun()}
                disabled={creatingRun}
              >
                {creatingRun ? "创建中..." : "确认分配"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowAgentForm(false)}
              >
                取消
              </Button>
            </div>
            {runtimesLoading && (
              <p className="text-[11px] text-muted-foreground">检查运行时状态...</p>
            )}
          </div>
        </div>
      )}

      {/* ---- Two-column grid ---- */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Left: Task Info */}
        <div className="rounded-md border bg-card">
          <div className="mb-2 border-b px-3 py-2 text-xs font-medium">
            任务信息
          </div>
          <div className="px-3 pb-2">
            <div className="flex justify-between border-b py-1.5 text-xs">
              <span className="text-muted-foreground">任务 Key</span>
              <code className="font-mono">{task.task_key}</code>
            </div>
            <div className="flex justify-between border-b py-1.5 text-xs">
              <span className="text-muted-foreground">所属变更</span>
              <Link
                href={`/workspaces/${workspaceId}/changes/${changeId}`}
                className="text-primary hover:underline"
              >
                {changeKey}
              </Link>
            </div>
            <div className="flex justify-between border-b py-1.5 text-xs">
              <span className="text-muted-foreground">阶段</span>
              <span>{task.phase ?? "—"}</span>
            </div>
            <div className="flex justify-between border-b py-1.5 text-xs">
              <span className="text-muted-foreground">优先级</span>
              <span>{task.priority ?? "—"}</span>
            </div>
            <div className="flex justify-between border-b py-1.5 text-xs">
              <span className="text-muted-foreground">负责人</span>
              <span>{task.owner_key ?? "—"}</span>
            </div>
            <div className="flex justify-between border-b py-1.5 text-xs">
              <span className="text-muted-foreground">预估工时</span>
              <span>
                {task.estimated_hours != null
                  ? `${task.estimated_hours}h`
                  : "—"}
              </span>
            </div>
            <div className="flex justify-between gap-2 border-b py-1.5 text-xs">
              <span className="shrink-0 text-muted-foreground">
                影响组件
              </span>
              <div className="flex flex-wrap justify-end gap-1">
                {task.affected_components.length > 0
                  ? task.affected_components.map((c) => (
                      <Badge key={c} variant="outline">
                        {c}
                      </Badge>
                    ))
                  : <span>—</span>}
              </div>
            </div>
            <div className="flex justify-between border-b py-1.5 text-xs">
              <span className="text-muted-foreground">依赖</span>
              <span>
                {task.depends_on.length > 0
                  ? task.depends_on.join(", ")
                  : "无"}
              </span>
            </div>
            <div className="flex justify-between py-1.5 text-xs">
              <span className="text-muted-foreground">阻塞</span>
              <span>
                {task.blocks.length > 0 ? task.blocks.join(", ") : "无"}
              </span>
            </div>
          </div>
        </div>

        {/* Right: Execution Context */}
        <div className="rounded-md border bg-card">
          <div className="mb-2 border-b px-3 py-2 text-xs font-medium">
            执行上下文
          </div>
          <div className="space-y-3 px-3 pb-3">
            {task.allowed_paths.length > 0 && (
              <div>
                <p className="mb-1 text-[11px] text-muted-foreground">
                  允许的路径
                </p>
                <pre className="rounded bg-muted/30 p-2 text-[11px] font-mono leading-4">
                  {task.allowed_paths.join("\n")}
                </pre>
              </div>
            )}
            {task.path && (
              <div>
                <p className="mb-1 text-[11px] text-muted-foreground">
                  文件路径
                </p>
                <pre className="rounded bg-muted/30 p-2 text-[11px] font-mono leading-4">
                  {task.path}
                </pre>
              </div>
            )}
            {task.content && (
              <div>
                <p className="mb-1 text-[11px] text-muted-foreground">
                  内容预览
                </p>
                <pre className="max-h-[300px] overflow-auto rounded bg-muted/30 p-2 text-[11px] font-mono leading-4">
                  {task.content}
                </pre>
              </div>
            )}
            {task.allowed_paths.length === 0 && !task.path && !task.content && (
              <p className="py-4 text-center text-xs text-muted-foreground">
                无执行上下文信息
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ---- Acceptance Criteria ---- */}
      {criteria.length > 0 && (
        <div className="rounded-md border bg-card">
          <div className="mb-2 border-b px-3 py-2 text-xs font-medium">
            验收标准
          </div>
          <div className="px-3 pb-2">
            {criteria.map((c, i) => (
              <div
                key={i}
                className="flex items-center gap-2 border-b py-1.5 text-xs last:border-b-0"
              >
                <span className="w-4 text-center">{criterionIcon(c.status)}</span>
                <span
                  className={
                    c.status === "done"
                      ? "text-muted-foreground line-through"
                      : ""
                  }
                >
                  {c.text}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ---- Execution History Timeline ---- */}
      <div className="rounded-md border bg-card">
        <div className="mb-2 flex items-center justify-between border-b px-3 py-2">
          <span className="text-xs font-medium">执行历史</span>
          {agentRuns.length > 0 && (
            <Link
              href={`/workspaces/${workspaceId}/changes/${changeId}/tasks`}
              className="text-[11px] text-primary hover:underline"
            >
              查看智能体日志
            </Link>
          )}
        </div>
        <div className="px-3 pb-3">
          {timeline.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">
              暂无执行记录
            </p>
          ) : (
            <div className="flex flex-col">
              {timeline.map((entry) => (
                <div
                  key={entry.id}
                  className="flex gap-3 border-l-2 border-muted py-1.5 pl-3"
                >
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {formatDate(entry.timestamp)}
                  </span>
                  <Badge variant={entry.badgeColor} className="shrink-0">
                    {entry.badge}
                  </Badge>
                  <span className="truncate text-xs">{entry.description}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ---- Agent Runs Detail ---- */}
      {agentRuns.length > 0 && (
        <div className="rounded-md border bg-card">
          <div className="mb-2 border-b px-3 py-2 text-xs font-medium">
            智能体运行详情
          </div>
          <div className="px-3 pb-2">
            {agentRuns.map((run) => (
              <div
                key={run.id}
                className="flex flex-wrap items-center gap-2 border-b py-2 text-xs last:border-b-0"
              >
                <span className="font-mono text-[11px] text-muted-foreground">
                  {run.id.slice(0, 8)}
                </span>
                <Badge
                  variant={
                    run.status === "completed"
                      ? "success"
                      : run.status === "failed"
                        ? "destructive"
                        : run.status === "running"
                          ? "warning"
                          : "outline"
                  }
                >
                  {labelOf(STATUS_LABELS, run.status)}
                </Badge>
                <Badge variant="outline">{run.agent_type}</Badge>
                {run.spec_strategy && (
                  <Badge variant="outline">{run.spec_strategy}</Badge>
                )}
                {run.profile_version && (
                  <Badge variant="outline">
                    profile: {run.profile_version}
                  </Badge>
                )}
                {run.diff_summary && (
                  <span className="text-[11px] text-muted-foreground">
                    {run.diff_summary}
                  </span>
                )}
                <span className="ml-auto text-[11px] text-muted-foreground">
                  {formatDate(run.created_at)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </PageContainer>
  );
}
