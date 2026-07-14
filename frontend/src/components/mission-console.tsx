"use client";

import { useCallback, useEffect, useState } from "react";

import { AgentLogViewer } from "@/components/agent-log-viewer";
import { MissionSummaryCard } from "@/components/mission-summary-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import {
  cancelMission,
  createMission,
  getAgentRunLogs,
  getMission,
  listMissions,
  type AgentRunLogEntry,
  type CreateMissionInput,
  type MainAgentConfig,
  type Mission,
  type MissionArtifact,
  type MissionWorkerRun,
  type WorkerPresetItem,
} from "@/lib/agent";

/** 任务级状态徽标配色（STATUS_LABEL 控中文文案）。 */
const STATUS_BADGE: Record<string, string> = {
  planning: "bg-gray-100 text-gray-700",
  running: "bg-blue-100 text-blue-700",
  done: "bg-green-100 text-green-700",
  degraded: "bg-yellow-100 text-yellow-800",
  failed: "bg-red-100 text-red-700",
  cancelled: "bg-gray-200 text-gray-500",
};

/** 任务级状态中文（D-005@v1，藏英文 status）。 */
const STATUS_LABEL: Record<string, string> = {
  planning: "规划中",
  running: "运行中",
  done: "已完成",
  degraded: "部分完成",
  failed: "失败",
  cancelled: "已取消",
};

/** 分身（worker run）级状态中文。 */
const WORKER_STATUS_LABEL: Record<string, string> = {
  pending: "排队中",
  running: "运行中",
  completed: "已完成",
  failed: "失败",
  killed: "已终止",
};

const ACTIVE = new Set(["planning", "running", "degraded"]);

/** 分身角色中文标注（主控拆解出的分工）。 */
const ROLE_LABEL: Record<string, string> = {
  arch: "架构分析",
  code_style: "代码规范",
  test: "测试",
  integration: "集成",
  risk: "风险",
  impl: "实现",
  verify: "验证",
  orchestrator: "主控",
};

// team 配置面板选项（agent_type 与 provider 自由组合）。
const AGENT_TYPE_OPTIONS = [
  { value: "claude_code", label: "Claude Code" },
  { value: "codex", label: "Codex" },
  { value: "cursor", label: "Cursor" },
] as const;

const PROVIDER_OPTIONS = [
  { value: "claude", label: "Claude（Anthropic）" },
  { value: "glm", label: "GLM（智谱）" },
  { value: "gpt", label: "GPT（OpenAI）" },
  { value: "deepseek", label: "DeepSeek" },
] as const;

const WORKER_ROLE_OPTIONS = [
  { value: "arch", label: "架构分析" },
  { value: "code_style", label: "代码规范" },
  { value: "test", label: "测试" },
  { value: "integration", label: "集成" },
  { value: "risk", label: "风险" },
  { value: "impl", label: "实现" },
  { value: "verify", label: "验证" },
] as const;

// 默认主控配置（claude_code + claude，强模型推荐）。
const DEFAULT_MAIN_AGENT_CONFIG: MainAgentConfig = {
  agent_type: "claude_code",
  provider: "claude",
  model: "claude-sonnet-4-6",
};

// 默认新增分身模板（高级手动预设用）。
function makeEmptyWorker(): WorkerPresetItem {
  return { agent_type: "claude_code", model: "", objective: "", role: "impl" };
}

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

/**
 * 主控拆解面板：体现「主控 → 分身团队」的拆解关系。
 * planning 显示「主控正在拆解…」；有分身显示主控的任务理解 + 角色分布。
 */
function CoordinatorPanel({ mission }: { mission: Mission }) {
  const summary = mission.constraints?.coordinator_summary;
  const summaryText =
    typeof summary === "string" && summary.trim() ? summary.trim() : null;
  const workers = mission.workers.filter((w) => w.role !== "orchestrator");
  const roleCounts = new Map<string, number>();
  for (const w of workers) {
    const r = w.role ?? "worker";
    roleCounts.set(r, (roleCounts.get(r) ?? 0) + 1);
  }

  if (mission.status === "planning") {
    return (
      <div className="rounded border border-blue-200 bg-blue-50 p-3 text-sm">
        <div className="flex items-center gap-2 font-medium text-blue-700">
          <span className="animate-pulse">🧠</span> 主控正在拆解任务，规划分身分工…
        </div>
      </div>
    );
  }

  return (
    <div className="rounded border border-gray-200 bg-gray-50 p-3 text-sm">
      <div className="flex items-center gap-2 font-medium">
        🧠 主控
        <Badge variant="outline" className="text-xs">
          已拆解为 {workers.length} 个分身
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
  role,
  active,
}: {
  workspaceId: string;
  runId: string;
  role: string;
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
        title={role === "orchestrator" ? "主控日志" : "分身日志"}
        runId={runId}
        logs={logs}
        loading={loading}
        emptyText="暂无日志（分身尚未产出，或仍在排队/执行中）"
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
  const [objOpen, setObjOpen] = useState(false);
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
        <Badge
          variant="outline"
          className={
            role === "orchestrator"
              ? "border-violet-400 text-violet-700 text-xs"
              : "text-xs"
          }
        >
          {role === "orchestrator" ? "主控" : (ROLE_LABEL[role] ?? role)}
        </Badge>
        <span className={statusColor}>
          {WORKER_STATUS_LABEL[worker.status] ?? worker.status}
        </span>
        <button
          type="button"
          onClick={() => setLogOpen((v) => !v)}
          className="ml-auto rounded border border-gray-300 px-2 py-0.5 text-xs text-blue-600 hover:bg-blue-50"
        >
          {logOpen ? "收起日志" : "查看日志"}
        </button>
      </div>
      {worker.objective && (
        <div className="text-xs text-gray-600">
          <button
            type="button"
            onClick={() => setObjOpen((v) => !v)}
            className="text-gray-500 hover:text-gray-700"
          >
            {objOpen ? "▾ 收起分工目标" : "▸ 分工目标（点开看完整）"}
          </button>
          {objOpen && (
            <p className="mt-1 whitespace-pre-wrap rounded bg-gray-50 p-2">
              {worker.objective}
            </p>
          )}
        </div>
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
          role={role}
          active={workerActive}
        />
      )}
    </li>
  );
}

/**
 * 高级配置面板（task-04，D-002@v1）：默认折叠，用户想精细控制分身时展开。
 * 主控配置 + 分身列表（留空 = 主控自动拆）。
 */
function TeamConfigPanel({
  mainAgent,
  onMainAgentChange,
  workers,
  onWorkersChange,
}: {
  mainAgent: MainAgentConfig;
  onMainAgentChange: (next: MainAgentConfig) => void;
  workers: WorkerPresetItem[];
  onWorkersChange: (next: WorkerPresetItem[]) => void;
}) {
  const updateWorker = (idx: number, patch: Partial<WorkerPresetItem>) => {
    onWorkersChange(
      workers.map((w, i) => (i === idx ? { ...w, ...patch } : w)),
    );
  };
  const removeWorker = (idx: number) => {
    onWorkersChange(workers.filter((_, i) => i !== idx));
  };
  const addWorker = () => {
    onWorkersChange([...workers, makeEmptyWorker()]);
  };

  return (
    <div className="space-y-4 rounded-md border border-violet-200 bg-violet-50/40 p-3.5">
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-violet-700">
          <span>🧠</span> 主控配置
        </div>
        <p className="text-[11px] text-slate-500">
          不填走默认（Claude · claude-sonnet-4-6）。主控像项目经理，读分身产出后再决策。
        </p>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-slate-600">AI 类型</span>
            <select
              aria-label="主控 AI 类型"
              className="h-[34px] rounded-md border border-slate-300 bg-white px-2.5 text-[13px] text-slate-800"
              value={mainAgent.agent_type}
              onChange={(e) =>
                onMainAgentChange({ ...mainAgent, agent_type: e.target.value })
              }
            >
              {AGENT_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-slate-600">厂家</span>
            <select
              aria-label="主控厂家"
              className="h-[34px] rounded-md border border-slate-300 bg-white px-2.5 text-[13px] text-slate-800"
              value={mainAgent.provider}
              onChange={(e) =>
                onMainAgentChange({ ...mainAgent, provider: e.target.value })
              }
            >
              {PROVIDER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-slate-600">模型</span>
            <input
              type="text"
              aria-label="主控模型"
              placeholder="如 claude-sonnet-4-6"
              className="h-[34px] rounded-md border border-slate-300 bg-white px-2.5 text-[13px] text-slate-800"
              value={mainAgent.model}
              onChange={(e) =>
                onMainAgentChange({ ...mainAgent, model: e.target.value })
              }
            />
          </label>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-violet-700">
            <span>👥</span> 分身列表（{workers.length}）
          </div>
          <button
            type="button"
            onClick={addWorker}
            className="rounded-md border border-violet-300 bg-white px-2.5 py-1 text-xs font-semibold text-violet-700 hover:bg-violet-100"
          >
            + 添加分身
          </button>
        </div>
        <p className="text-[11px] text-slate-500">
          留空 = 主控自动拆。手动预设后，主控按列表派发并动态调度。
        </p>

        {workers.length === 0 && (
          <div className="rounded-md border border-dashed border-slate-300 bg-white px-3 py-3 text-center text-xs text-slate-400">
            尚未添加分身。留空即由主控自动拆解。
          </div>
        )}

        <ul className="space-y-2">
          {workers.map((w, idx) => (
            <li
              key={idx}
              className="space-y-2 rounded-md border border-slate-200 bg-white p-2.5"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-slate-600">
                  分身 #{idx + 1}
                </span>
                <button
                  type="button"
                  onClick={() => removeWorker(idx)}
                  aria-label={`删除分身 ${idx + 1}`}
                  className="rounded border border-slate-300 px-2 py-0.5 text-xs text-red-600 hover:bg-red-50"
                >
                  删除
                </button>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] text-slate-500">AI 类型</span>
                  <select
                    aria-label={`分身 ${idx + 1} AI 类型`}
                    className="h-[32px] rounded-md border border-slate-300 bg-white px-2 text-[12.5px] text-slate-800"
                    value={w.agent_type}
                    onChange={(e) =>
                      updateWorker(idx, { agent_type: e.target.value })
                    }
                  >
                    {AGENT_TYPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] text-slate-500">角色</span>
                  <select
                    aria-label={`分身 ${idx + 1} 角色`}
                    className="h-[32px] rounded-md border border-slate-300 bg-white px-2 text-[12.5px] text-slate-800"
                    value={w.role}
                    onChange={(e) => updateWorker(idx, { role: e.target.value })}
                  >
                    {WORKER_ROLE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] text-slate-500">模型</span>
                  <input
                    type="text"
                    aria-label={`分身 ${idx + 1} 模型`}
                    placeholder="如 glm-4.6 / gpt-4o / deepseek-chat"
                    className="h-[32px] rounded-md border border-slate-300 bg-white px-2 text-[12.5px] text-slate-800"
                    value={w.model}
                    onChange={(e) => updateWorker(idx, { model: e.target.value })}
                  />
                </label>
              </div>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-slate-500">分工目标</span>
                <input
                  type="text"
                  aria-label={`分身 ${idx + 1} 分工目标`}
                  placeholder="这个分身具体干什么"
                  className="h-[32px] rounded-md border border-slate-300 bg-white px-2 text-[12.5px] text-slate-800"
                  value={w.objective}
                  onChange={(e) =>
                    updateWorker(idx, { objective: e.target.value })
                  }
                />
              </label>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function MissionConsole({ workspaceId }: { workspaceId: string }) {
  const [objective, setObjective] = useState("");
  const [budget, setBudget] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [mainAgentConfig, setMainAgentConfig] = useState<MainAgentConfig>(
    DEFAULT_MAIN_AGENT_CONFIG,
  );
  const [workers, setWorkers] = useState<WorkerPresetItem[]>([]);
  const [mission, setMission] = useState<Mission | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<Mission[]>([]);

  useEffect(() => {
    const missionId = readMissionIdFromUrl();
    if (missionId && !mission) {
      getMission(missionId)
        .then(setMission)
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshHistory = useCallback(async () => {
    try {
      setHistory(await listMissions(workspaceId, { limit: 20 }));
    } catch {
      /* swallow list errors */
    }
  }, [workspaceId]);
  useEffect(() => {
    refreshHistory();
  }, [refreshHistory]);

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
      // 固定 team 模式（D-001@v1）：无条件传 mode="team" + 主控配置（默认值始终传，
      // 即使用户不展开高级 G2）+ 分身预设（默认空数组 → 主控自动拆）。
      const payload: CreateMissionInput = {
        objective: objective.trim(),
        budget_usd: budgetNum !== null && budgetNum > 0 ? budgetNum : null,
        mode: "team",
        main_agent_config: mainAgentConfig,
        worker_preset: workers,
      };
      const m = await createMission(workspaceId, payload);
      setMission(m);
      writeMissionIdToUrl(m.id);
      refreshHistory();
      setObjective("");
      setBudget("");
      setAdvancedOpen(false);
      setMainAgentConfig(DEFAULT_MAIN_AGENT_CONFIG);
      setWorkers([]);
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
      {/* 历史收进顶部按钮（默认收起，D-007@v1） */}
      {history.length > 0 && (
        <details className="rounded border bg-gray-50 p-2">
          <summary className="cursor-pointer text-sm font-medium text-slate-700">
            历史（{history.length}）▾
          </summary>
          <ul className="mt-2 max-h-72 space-y-1 overflow-y-auto">
            {history.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => {
                    setMission(m);
                    writeMissionIdToUrl(m.id);
                  }}
                  title={m.objective || "(无目标)"}
                  className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-gray-100 ${
                    mission?.id === m.id ? "bg-blue-50 ring-1 ring-blue-200" : ""
                  }`}
                >
                  <Badge
                    className={STATUS_BADGE[m.status] ?? "bg-gray-100 text-gray-700"}
                  >
                    {STATUS_LABEL[m.status] ?? m.status}
                  </Badge>
                  <span className="min-w-0 flex-1 truncate text-gray-800">
                    {m.objective || "(无目标)"}
                  </span>
                  <span className="whitespace-nowrap text-xs text-gray-400">
                    {new Date(m.created_at).toLocaleString()} · {m.workers.length}{" "}
                    分身
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      {!mission && (
        <div className="space-y-2">
          <textarea
            className="w-full rounded border p-2 text-sm"
            rows={3}
            placeholder={"描述你要 AI 团队做什么…\n例：把这几天的销售数据整理成周报，重点标出环比下降最多的三个产品"}
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
          />
          <p className="text-xs text-gray-500">
            只写目标就行。派几个分身、各自分工由主控自动决定。
          </p>

          {/* 高级：手动配分身（默认折叠，D-002@v1） */}
          <details
            open={advancedOpen}
            onToggle={(e) => setAdvancedOpen(e.currentTarget.open)}
            className="rounded border border-slate-200 bg-white p-2"
          >
            <summary className="cursor-pointer text-sm font-medium text-slate-600">
              高级：手动配分身（默认不用动，想精细控制再展开）
            </summary>
            <div className="mt-2">
              <TeamConfigPanel
                mainAgent={mainAgentConfig}
                onMainAgentChange={setMainAgentConfig}
                workers={workers}
                onWorkersChange={setWorkers}
              />
            </div>
          </details>

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
                placeholder="留空 = 不限"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
              />
            </div>
            <Button onClick={onCreate} disabled={busy || !objective.trim()}>
              {busy ? "启动中…" : "启动"}
            </Button>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      {mission && (
        <div className="space-y-3">
          <MissionSummaryCard mission={mission} />

          {ACTIVE.has(mission.status) && (
            <div>
              <Button variant="outline" size="sm" onClick={onCancel}>
                取消任务
              </Button>
            </div>
          )}

          <p className="text-sm text-gray-700">{mission.objective}</p>

          <CoordinatorPanel mission={mission} />

          {(() => {
            const mainAgent =
              mission.workers.find((w) => w.role === "orchestrator") ?? null;
            const workerRuns = mission.workers.filter(
              (w) => w.role !== "orchestrator",
            );
            return (
              <>
                {mainAgent && (
                  <div className="rounded-md border border-violet-200 bg-violet-50/40 p-2">
                    <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-violet-700">
                      🧠 主控
                    </div>
                    <ul className="space-y-2">
                      <WorkerRow
                        key={mainAgent.id}
                        worker={mainAgent}
                        workspaceId={workspaceId}
                      />
                    </ul>
                  </div>
                )}
                <div>
                  <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                    👥 分身（{workerRuns.length}）
                  </div>
                  {workerRuns.length === 0 ? (
                    <p className="rounded-md border border-dashed border-gray-200 bg-white px-3 py-2 text-xs text-gray-400">
                      暂无分身。主控接管后将自动派发。
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {workerRuns.map((w) => (
                        <WorkerRow
                          key={w.id}
                          worker={w}
                          workspaceId={workspaceId}
                        />
                      ))}
                    </ul>
                  )}
                </div>
              </>
            );
          })()}
        </div>
      )}
    </section>
  );
}
