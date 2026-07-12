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

/** Worker 角色中文标注（Coordinator 拆解出的分工，体现团队结构）。 */
const ROLE_LABEL: Record<string, string> = {
  arch: "架构分析",
  code_style: "代码规范",
  test: "测试",
  integration: "集成",
  risk: "风险",
  impl: "实现",
  verify: "验证",
};

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

/**
 * Coordinator 拆解面板：体现"Coordinator → Worker 团队"的拆解关系（不再是黑盒）。
 * - planning: 显示"Coordinator 正在拆解..."
 * - 有 workers: 显示 Coordinator summary（一句话理解）+ 拆解为 N 个 Worker + 角色分布
 */
function CoordinatorPanel({ mission }: { mission: Mission }) {
  const summary = mission.constraints?.coordinator_summary;
  const summaryText =
    typeof summary === "string" && summary.trim() ? summary.trim() : null;
  const workers = mission.workers;
  // 角色分布（体现 Coordinator 的分工决策）
  const roleCounts = new Map<string, number>();
  for (const w of workers) {
    const r = w.role ?? "worker";
    roleCounts.set(r, (roleCounts.get(r) ?? 0) + 1);
  }

  if (mission.status === "planning") {
    return (
      <div className="rounded border border-blue-200 bg-blue-50 p-3 text-sm">
        <div className="flex items-center gap-2 font-medium text-blue-700">
          <span className="animate-pulse">🧠</span> Coordinator 正在拆解任务为
          Worker 团队…
        </div>
        <p className="mt-1 text-xs text-blue-600">
          调用 GLM 分析任务，规划 Worker 角色与分工，完成后并行派发到 daemon。
        </p>
      </div>
    );
  }

  return (
    <div className="rounded border border-gray-200 bg-gray-50 p-3 text-sm">
      <div className="flex items-center gap-2 font-medium">
        🧠 Coordinator
        <Badge variant="outline" className="text-xs">
          已拆解为 {workers.length} 个 Worker
        </Badge>
      </div>
      {summaryText && (
        <p className="mt-1 text-xs text-gray-600">
          <span className="text-gray-400">任务理解：</span>
          {summaryText}
        </p>
      )}
      {roleCounts.size > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          <span className="text-xs text-gray-400">分工：</span>
          {[...roleCounts.entries()].map(([role, n]) => (
            <Badge key={role} variant="outline" className="text-[11px]">
              {ROLE_LABEL[role] ?? role}
              {n > 1 ? ` ×${n}` : ""}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

function ArtifactCard({ artifact }: { artifact: MissionArtifact }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded border border-gray-200 bg-white text-xs">
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
  const role = worker.role ?? "worker";
  return (
    <li className="space-y-1 rounded border border-gray-200 p-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="text-xs">
          {ROLE_LABEL[role] ?? role}
        </Badge>
        <span className="text-[11px] text-gray-400">[{role}]</span>
        <span className={statusColor}>{worker.status}</span>
        <button
          type="button"
          onClick={() => setLogOpen((v) => !v)}
          className="ml-auto rounded border border-gray-300 px-2 py-0.5 text-xs text-blue-600 hover:bg-blue-50"
        >
          {logOpen ? "收起日志" : "查看日志"}
        </button>
      </div>
      {worker.objective && (
        <p className="text-xs text-gray-600">
          <span className="text-gray-400">分工目标：</span>
          {worker.objective}
        </p>
      )}
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

function ModeCard({
  selected,
  onClick,
  icon,
  title,
  desc,
  meta,
  accent,
}: {
  selected: boolean;
  onClick: () => void;
  icon: string;
  title: string;
  desc: string;
  meta: string;
  accent: "emerald" | "violet";
}) {
  // 选中态配色照原型：single 绿系 / team 紫系（border + bg + radio 实心点）
  const selectedBorder =
    accent === "emerald" ? "border-emerald-500" : "border-violet-500";
  const selectedBg =
    accent === "emerald" ? "bg-emerald-50" : "bg-violet-50";
  const radioBorder =
    accent === "emerald" ? "border-emerald-600" : "border-violet-600";
  const radioDot =
    accent === "emerald" ? "bg-emerald-600" : "bg-violet-600";

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`relative cursor-pointer rounded-lg border-[1.5px] bg-white p-3.5 text-left transition-all hover:border-slate-400 ${
        selected ? `${selectedBorder} ${selectedBg}` : "border-slate-200"
      }`}
    >
      <div className="mb-1.5 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
          <span className="text-base">{icon}</span>
          {title}
        </span>
        {/* radio 圈：选中时实心点（emerald/violet），未选中空圈 */}
        <span
          className={`relative h-[18px] w-[18px] rounded-full border-2 ${
            selected ? radioBorder : "border-slate-300"
          }`}
        >
          {selected && (
            <span
              className={`absolute inset-[3px] rounded-full ${radioDot}`}
            />
          )}
        </span>
      </div>
      <p className="text-xs leading-relaxed text-slate-500">{desc}</p>
      <p className="mt-1.5 text-[11px] text-slate-400">{meta}</p>
    </button>
  );
}

export function MissionConsole({ workspaceId }: { workspaceId: string }) {
  const [objective, setObjective] = useState("");
  const [budget, setBudget] = useState("");
  const [mode, setMode] = useState<"single" | "team">("single");
  const [mission, setMission] = useState<Mission | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const missionId = readMissionIdFromUrl();
    if (missionId && !mission) {
      getMission(missionId)
        .then(setMission)
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = useCallback(async (id: string) => {
    try {
      setMission(await getMission(id));
    } catch {
      /* swallow poll errors */
    }
  }, []);

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
      const budgetNum = budget.trim() ? Number(budget) : null;
      const m = await createMission(workspaceId, {
        objective: objective.trim(),
        budget_usd: budgetNum !== null && budgetNum > 0 ? budgetNum : null,
        mode,
      });
      setMission(m);
      writeMissionIdToUrl(m.id);
      setObjective("");
      setBudget("");
      setMode("single");
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

          {/* 模式选择：single（绿）/ team（紫），照原型双卡片布局 */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-600">模式</label>
            <div className="grid grid-cols-2 gap-3">
              <ModeCard
                selected={mode === "single"}
                onClick={() => setMode("single")}
                icon="👤"
                title="single"
                desc="单 agent 跑完全程。默认，零回归。"
                meta="适用：小任务、问答、简单修改"
                accent="emerald"
              />
              <ModeCard
                selected={mode === "team"}
                onClick={() => setMode("team")}
                icon="👥"
                title="team"
                desc="Coordinator 拆 1-5 个 Worker 并行，Finalizer 合并。"
                meta="适用：扫描、多模块、重构、核验"
                accent="violet"
              />
            </div>
          </div>

          {/* team 预览：角色 chips + 预算提示（仅 team 选中时） */}
          {mode === "team" && (
            <div className="mt-3.5 rounded-md border border-dashed border-slate-300 bg-slate-50 p-3">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Team 预览 · Coordinator（GLM）将拆解为
              </div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(ROLE_LABEL).map(([role, label]) => (
                  <span
                    key={role}
                    className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11.5px] font-semibold text-slate-700"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-violet-500" />
                    {role} · {label}
                  </span>
                ))}
              </div>
              <div className="mt-2.5 rounded-r-sm border-l-[3px] border-amber-500 bg-amber-50 px-3 py-2 text-xs text-slate-700">
                ⚠️ team 模式将拆分 1-5 个 worker 并行，多 worker 烧 token，建议设置预算上限。
                Finalizer 单点合并避免并发写冲突。
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-medium text-muted-foreground">
                费用上限（USD，可选）
              </label>
              <input
                type="number"
                min="0"
                step="0.5"
                className="w-44 rounded border p-2 text-sm"
                placeholder="如 4.0（留空=不限）"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
              />
            </div>
            <Button onClick={onCreate} disabled={busy || !objective.trim()}>
              {busy ? "规划中…" : mode === "team" ? "👥 启动团队" : "启动团队"}
            </Button>
          </div>
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

          {/* Coordinator 拆解面板：体现拆解关系（不再是黑盒） */}
          <CoordinatorPanel mission={mission} />

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
