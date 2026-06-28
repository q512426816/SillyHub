"use client";

import { useCallback, useEffect, useState } from "react";

import { AgentLogViewer } from "@/components/agent-log-viewer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import {
  cancelMission,
  createMission,
  getAgentRunLogs,
  getMission,
  type AgentRunLogEntry,
  type Mission,
  type MissionArtifact,
  type MissionWorkerRun,
} from "@/lib/agent";

const STATUS_BADGE: Record<string, string> = {
  planning: "bg-gray-100 text-gray-700",
  running: "bg-blue-100 text-blue-700",
  done: "bg-green-100 text-green-700",
  degraded: "bg-yellow-100 text-yellow-800",
  failed: "bg-red-100 text-red-700",
  cancelled: "bg-gray-200 text-gray-500",
};

const ACTIVE = new Set(["planning", "running", "degraded"]);

/** 从 URL ?mission=xxx 读 mission_id（刷新持久化，避免 useSearchParams 的 Suspense 依赖）。 */
function readMissionIdFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("mission");
}

function writeMissionIdToUrl(missionId: string) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.set("mission", missionId);
  window.history.replaceState(null, "", url);
}

/** 成本/预算进度条颜色：绿(<70%) / 黄(70-100%) / 红(>100% 超预算)。 */
function costBarColor(ratio: number): string {
  if (ratio > 1.0) return "bg-red-500";
  if (ratio >= 0.7) return "bg-yellow-500";
  return "bg-green-500";
}

function CostBar({ cost, budget }: { cost: number; budget: number | null }) {
  if (!budget || budget <= 0) {
    return (
      <div className="text-xs text-gray-500">
        成本 ${cost.toFixed(4)}（未设预算）
      </div>
    );
  }
  const ratio = Math.min(cost / budget, 1.5);
  const pct = Math.min(ratio * 100, 100);
  const over = cost > budget;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>
          成本 ${cost.toFixed(4)} / 预算 ${budget.toFixed(2)}
        </span>
        <span className={over ? "font-semibold text-red-600" : ""}>
          {over ? "超预算" : `${Math.round((cost / budget) * 100)}%`}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded bg-gray-100">
        <div
          className={`h-full ${costBarColor(ratio)}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function ArtifactCard({ artifact }: { artifact: MissionArtifact }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded border border-gray-200 bg-gray-50 text-xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-2 py-1 text-left"
      >
        <span className="font-medium">
          📄 {artifact.kind}
          {artifact.kind === "summary" ? "（摘要）" : ""}
        </span>
        <span className="text-gray-400">{open ? "收起" : "展开"}</span>
      </button>
      {open && (
        <pre className="max-h-60 overflow-auto whitespace-pre-wrap border-t border-gray-200 px-2 py-1 font-mono text-[11px] text-gray-700">
          {artifact.content_ref ?? "(空)"}
        </pre>
      )}
    </div>
  );
}

/** Worker 日志面板：内嵌 getAgentRunLogs + AgentLogViewer（展开时拉取+轮询，不跳页）。 */
function WorkerLogPanel({
  workspaceId,
  runId,
  active,
}: {
  workspaceId: string;
  runId: string;
  active: boolean;
}) {
  const [logs, setLogs] = useState<AgentRunLogEntry[] | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setLogs(await getAgentRunLogs(workspaceId, runId));
    } catch {
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }, [workspaceId, runId]);

  useEffect(() => {
    refresh();
    // Worker 仍在跑时轮询（5s）；终态后只拉一次（logs 不再变）。
    if (!active) return;
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh, active]);

  return (
    <div className="border-t border-gray-200 pt-2">
      <AgentLogViewer
        title={`Worker 日志（${runId.slice(0, 8)}）`}
        runId={runId}
        logs={logs}
        loading={loading}
        emptyText="暂无日志（Worker 尚未产出，或仍在排队/执行中）"
        variant="embedded"
        compact
      />
    </div>
  );
}

function WorkerRow({
  worker,
  workspaceId,
}: {
  worker: MissionWorkerRun;
  workspaceId: string;
}) {
  const [logOpen, setLogOpen] = useState(false);
  const statusColor =
    worker.status === "failed"
      ? "text-red-600"
      : worker.status === "completed"
        ? "text-green-700"
        : worker.status === "running"
          ? "text-blue-700"
          : worker.status === "killed"
            ? "text-gray-400"
            : "text-gray-600";
  const workerActive = ACTIVE.has(worker.status) || worker.status === "pending";
  return (
    <li className="space-y-1 rounded border border-gray-200 p-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{worker.role ?? "worker"}</Badge>
        <span className={statusColor}>{worker.status}</span>
        <span className="truncate text-gray-500">{worker.objective ?? ""}</span>
        <button
          type="button"
          onClick={() => setLogOpen((v) => !v)}
          className="ml-auto rounded border border-gray-300 px-2 py-0.5 text-xs text-blue-600 hover:bg-blue-50"
        >
          {logOpen ? "收起日志" : "查看日志"}
        </button>
      </div>
      {worker.artifacts.length > 0 && (
        <div className="space-y-1">
          {worker.artifacts.map((a) => (
            <ArtifactCard key={a.id} artifact={a} />
          ))}
        </div>
      )}
      {logOpen && (
        <WorkerLogPanel
          workspaceId={workspaceId}
          runId={worker.id}
          active={workerActive}
        />
      )}
    </li>
  );
}

export function MissionConsole({ workspaceId }: { workspaceId: string }) {
  const [objective, setObjective] = useState("");
  const [mission, setMission] = useState<Mission | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 刷新持久化：从 URL ?mission=xxx 恢复 mission（避免刷新丢数据）。
  useEffect(() => {
    const missionId = readMissionIdFromUrl();
    if (missionId && !mission) {
      getMission(missionId)
        .then(setMission)
        .catch(() => {
          /* mission 可能已删，静默 */
        });
    }
    // 仅挂载时读一次 URL（refresh 后浏览器保留 query）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = useCallback(async (id: string) => {
    try {
      setMission(await getMission(id));
    } catch {
      /* swallow poll errors */
    }
  }, []);

  // Mission 活跃时轮询状态（10s — backend 连接池小，避免激进轮询）。
  useEffect(() => {
    if (!mission || !ACTIVE.has(mission.status)) return;
    const t = setInterval(() => refresh(mission.id), 10000);
    return () => clearInterval(t);
  }, [mission?.id, mission?.status, refresh]);

  const onCreate = async () => {
    if (!objective.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const m = await createMission(workspaceId, {
        objective: objective.trim(),
        budget_usd: 1.0,
      });
      setMission(m);
      writeMissionIdToUrl(m.id); // 持久化到 URL，刷新可恢复
      setObjective("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onCancel = async () => {
    if (!mission) return;
    try {
      setMission(await cancelMission(mission.id));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  };

  return (
    <section className="space-y-3 rounded-lg border p-4">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        🤝 Agent 团队（Mission）
      </h2>
      <p className="text-sm text-gray-500">
        描述任务目标，Coordinator 会拆解为 Worker 团队，并行派发到 daemon 执行、收敛产出。
        刷新页面会保留当前 Mission。
      </p>

      {!mission && (
        <div className="space-y-2">
          <textarea
            className="w-full rounded border p-2 text-sm"
            rows={2}
            placeholder="例：分析 backend/app/modules/agent/ 目录的架构，输出摘要"
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
          />
          <Button onClick={onCreate} disabled={busy || !objective.trim()}>
            {busy ? "规划中…" : "启动团队"}
          </Button>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      {mission && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={STATUS_BADGE[mission.status] ?? "bg-gray-100"}>
              {mission.status}
            </Badge>
            {ACTIVE.has(mission.status) && (
              <Button variant="outline" size="sm" onClick={onCancel}>
                取消
              </Button>
            )}
          </div>
          <CostBar cost={mission.cost_so_far} budget={mission.budget_usd} />
          <p className="text-sm text-gray-700">{mission.objective}</p>
          <ul className="space-y-2">
            {mission.workers.map((w) => (
              <WorkerRow key={w.id} worker={w} workspaceId={workspaceId} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
