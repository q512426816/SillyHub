"use client";

/**
 * Agent 团队控制台（单工作区维度 + 项目维度，design §7.3）。
 *
 * task-15 / 2026-08-19-cross-workspace-team-mission：新增 projectMode——
 * 创建走 createProjectMission（scope 多选 + anchor 单选面板）、历史走
 * listProjectMissions、worker 行显示「目标工作区」类型徽标列。非 projectMode
 * （单工作区）路径零改动零回归。
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { AgentLogViewer } from "@/components/agent-log-viewer";
import { MissionSummaryCard } from "@/components/mission-summary-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import {
  cancelMission,
  createMission,
  createProjectMission,
  getAgentRunLogs,
  getMission,
  listMissions,
  listProjectMissions,
  type AgentRunLogEntry,
  type CreateMissionInput,
  type CreateProjectMissionInput,
  type MainAgentConfig,
  type Mission,
  type MissionArtifact,
  type MissionWorkerRun,
  type ProjectMissionResponse,
  type WorkerPresetItem,
} from "@/lib/agent";
import { STATUS_LABELS, labelOf } from "@/lib/status-labels";
import type { WorkspaceBrief } from "@/lib/workspace";
import { workspaceTypeBadge } from "@/lib/workspace-types";

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

/* ── task-15 / 2026-08-19-cross-workspace-team-mission / design §7.3 ──────────
 * 项目维度（projectMode）扩展：worker run 的跨工作区字段 + mission 概要字段。
 * lib/agent.ts 的本地 Mission/MissionWorkerRun 类型早于跨 ws 扩展（且该文件不在
 * 本 task 边界内），此处用扩展接口容忍缺字段：单 ws mission / 轮询 getMission 的
 * 运行时数据已带这些字段（后端 _mission_to_response 统一序列化），读取时兜底。 */

/** worker run 的跨 ws 扩展字段（api-types MissionWorkerRunResponse 已回传）。 */
interface WorkerRunWithTarget extends MissionWorkerRun {
  target_workspace_id?: string | null;
  target_workspace_name?: string | null;
}

/** mission 的项目维度概要字段（api-types MissionResponse 扩展）。 */
export interface ProjectMissionView extends Mission {
  project_id?: string | null;
  scope_workspace_ids?: string[] | null;
  workspace_name?: string | null;
  workspace_type?: string | null;
}

/**
 * ProjectMissionResponse → 本地 Mission 兼容视图（归一可选字段为显式 null）。
 * api-types 的 role/objective 等是可选属性，直接塞进 Mission[] 会因
 * 「可选 → 必填」不可赋值而报错，故逐字段兜底。
 */
function normalizeProjectMission(m: ProjectMissionResponse): ProjectMissionView {
  return {
    ...m,
    workers: (m.workers ?? []).map((w) => ({
      ...w,
      // api-types 的 status 是裸 string；后端值域 = AgentRunStatus 五值联合，
      // 收窄（与本地 Mission 类型对齐，越界值 UI 层 LABEL 兜底显示原值）。
      status: w.status as MissionWorkerRun["status"],
      role: w.role ?? null,
      objective: w.objective ?? null,
      total_cost_usd: w.total_cost_usd ?? null,
      started_at: w.started_at ?? null,
      finished_at: w.finished_at ?? null,
      artifacts: (w.artifacts ?? []).map((a) => ({
        ...a,
        content_ref: a.content_ref ?? null,
      })),
    })),
  };
}

/**
 * scope 变更后的默认 anchor：type=backend-code 优先，否则第一个（design §7.1）。
 * 注意：后端 router.py anchor 缺省分支比对的是 "backend"（词表真值为
 * "backend-code"，永不命中→退化取第一个），前端按词表真值实现并显式传
 * anchor_workspace_id，绕开该后端缺陷（已登记遗留，不属本 task 边界）。
 */
function pickDefaultAnchor(
  candidates: WorkspaceBrief[],
  selectedIds: string[],
): string | null {
  const selected = selectedIds
    .map((id) => candidates.find((c) => c.workspace_id === id))
    .filter((c): c is WorkspaceBrief => c !== undefined);
  if (selected.length === 0) return null;
  const preferred = selected.find((c) => c.type === "backend-code") ?? selected[0];
  return preferred ? preferred.workspace_id : null;
}

/** workspaceTypeBadge 徽标渲染（布局类叠加，形态对齐 LinkWorkspaceDialog 既有用法）。 */
function WsTypeBadgeSpan({ type }: { type: string | null | undefined }) {
  const view = workspaceTypeBadge(type);
  return (
    <span
      className={`inline-flex h-5 shrink-0 items-center rounded border px-1.5 text-[10px] font-semibold ${view.className}`}
    >
      {view.label}
    </span>
  );
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

// perf-remediation task-08 / FR-10：轮询响应为空且本地日志达到阈值时，一次全量
// 重拉兜底（防游标失配长期丢新日志）。本地很少时维持增量即可。
const LOG_FULL_REFETCH_THRESHOLD = 200;

/**
 * perf-remediation task-08 / FR-10 / D-001@v1：把增量响应合并进已有日志。
 * 返回正序（timestamp/id 升序）合并结果，按 id 去重——同 timestamp 边界
 * 重复（增量与已见重叠）由前端吸收（R-06）。新 id 优先增量内容。
 */
export function mergeLogsById(
  existing: AgentRunLogEntry[],
  incoming: AgentRunLogEntry[],
): AgentRunLogEntry[] {
  const byId = new Map<string, AgentRunLogEntry>();
  for (const e of existing) byId.set(e.id, e);
  for (const e of incoming) byId.set(e.id, e);
  return [...byId.values()].sort(
    (a, b) =>
      a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id),
  );
}

/** 取当前已见日志中最早一条的 timestamp（增量游标，desc 下界）。 */
function earliestTimestamp(logs: AgentRunLogEntry[]): string | undefined {
  let min: string | undefined;
  for (const l of logs) {
    if (min === undefined || l.timestamp < min) min = l.timestamp;
  }
  return min;
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
  // 游标与合并读当前已见日志——refresh 用 ref 读避免依赖 logs state（否则
  // refresh 身份随 logs 变化，useEffect 会立即重跑 refresh 造成轮询风暴）。
  const logsRef = useRef<AgentRunLogEntry[]>([]);
  const applyLogs = useCallback((next: AgentRunLogEntry[]) => {
    logsRef.current = next;
    setLogs(next);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const current = logsRef.current;
      const after = current.length > 0 ? earliestTimestamp(current) : undefined;
      const fetched = await getAgentRunLogs(workspaceId, runId, after);
      if (after === undefined) {
        // 首拉：无游标全量（现状语义）。
        applyLogs(fetched);
        return;
      }
      if (fetched.length > 0) {
        // 增量：按 id 去重合并（同 timestamp 边界重复前端吸收，R-06）。
        applyLogs(mergeLogsById(logsRef.current, fetched));
        return;
      }
      // 游标空结果：本地已积压较多时做一次全量重拉兜底（此后恢复增量），
      // 否则维持现状（服务端确无更新）。
      if (current.length >= LOG_FULL_REFETCH_THRESHOLD) {
        applyLogs(await getAgentRunLogs(workspaceId, runId));
      }
    } catch {
      setLogs((prev) => prev ?? []);
    } finally {
      setLoading(false);
    }
  }, [workspaceId, runId, applyLogs]);

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

/**
 * task-15 / design §7.3：worker 行「目标工作区」徽标上下文。
 * 仅 projectMode 传入（null = 单 ws 模式，不渲染该列）。
 * crossWorkspace：mission scope 冻结快照 >1 个工作区——此时 target 为空意味着
 * 落 anchor（design §4.1「NULL = anchor 存量行为」），按 anchor 名补展示；
 * 单 scope mission 的 worker 全落同一工作区，展示无信息量，省略。
 */
interface WorkerTargetContext {
  wsTypeById: Record<string, string | null | undefined>;
  wsNameById: Record<string, string | null | undefined>;
  anchorWorkspaceId: string;
  anchorName: string | null;
  crossWorkspace: boolean;
}

function WorkerRow({
  worker,
  workspaceId,
  targetContext,
}: {
  worker: MissionWorkerRun;
  workspaceId: string;
  targetContext: WorkerTargetContext | null;
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

  // 目标工作区徽标（task-15）：显式 target 优先；跨 ws mission 下缺省 = anchor。
  // 名称解析：target_workspace_name（后端暂未回填）→ page 传入的 wsNameById 兜底
  // → 原始 id / anchor 名兜底，保证跨 ws worker 的目标机器始终可见。
  const extended = worker as WorkerRunWithTarget;
  const explicitTargetId = extended.target_workspace_id ?? null;
  const targetId =
    explicitTargetId ??
    (targetContext?.crossWorkspace ? targetContext.anchorWorkspaceId : null);
  const targetName = explicitTargetId
    ? (extended.target_workspace_name ??
      targetContext?.wsNameById[explicitTargetId] ??
      explicitTargetId)
    : (targetContext?.anchorName ?? null);
  const showTargetBadge = targetContext !== null && targetId !== null;

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
        {showTargetBadge && (
          <span
            className="inline-flex min-w-0 items-center gap-1"
            title="目标工作区（该分身代码落这台机器的工作区）"
          >
            <WsTypeBadgeSpan
              type={targetId ? targetContext.wsTypeById[targetId] : undefined}
            />
            <span className="max-w-44 truncate text-xs text-gray-500">
              {targetName ?? "—"}
            </span>
          </span>
        )}
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

/**
 * task-15 / design §7.3：项目维度发起面板——scope 多选 + anchor 单选。
 * - scope 候选 = 项目关联工作区（page 从 listProjectWorkspaces 加载传入），
 *   每项显示名称 + 类型徽标（8 值词表）+ 工作区状态 + description；
 * - anchor 选项 = scope 已选项，radio 单选，默认 type=backend-code 优先否则第一个；
 * - 越界（scope ⊄ 项目关联 / anchor ∉ scope）由后端 422 拦截，前端展示 detail。
 */
function ProjectScopePanel({
  candidates,
  scopeIds,
  onToggleScope,
  anchorId,
  onAnchorChange,
}: {
  candidates: WorkspaceBrief[];
  scopeIds: string[];
  onToggleScope: (id: string) => void;
  anchorId: string | null;
  onAnchorChange: (id: string) => void;
}) {
  const selected = scopeIds
    .map((id) => candidates.find((c) => c.workspace_id === id))
    .filter((c): c is WorkspaceBrief => c !== undefined);

  return (
    <div className="space-y-3 rounded-md border border-slate-200 bg-white p-3">
      <div className="space-y-1.5">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">
          派发范围（Scope）· 本次会话涉及的工作区（已选 {scopeIds.length}）
        </div>
        <ul className="max-h-56 space-y-1 overflow-y-auto">
          {candidates.map((c) => {
            const checked = scopeIds.includes(c.workspace_id);
            return (
              <li key={c.workspace_id}>
                <label
                  className={`flex cursor-pointer items-center gap-2 rounded border px-2 py-1.5 text-sm ${
                    checked
                      ? "border-blue-200 bg-blue-50/60"
                      : "border-slate-200 bg-white hover:bg-slate-50"
                  }`}
                >
                  <input
                    type="checkbox"
                    aria-label={`派发范围勾选 ${c.name}`}
                    checked={checked}
                    onChange={() => onToggleScope(c.workspace_id)}
                    className="h-4 w-4 shrink-0"
                  />
                  <span className="shrink-0 font-medium text-gray-800">
                    {c.name}
                  </span>
                  <WsTypeBadgeSpan type={c.type} />
                  <span className="shrink-0 text-xs text-gray-400">
                    {labelOf(STATUS_LABELS, c.status)}
                  </span>
                  {c.description && (
                    <span
                      className="min-w-0 flex-1 truncate text-xs text-gray-400"
                      title={c.description}
                    >
                      {c.description}
                    </span>
                  )}
                </label>
              </li>
            );
          })}
        </ul>
        <p className="text-[11px] text-slate-500">
          候选 = 项目关联的工作区（越界由服务端 422 拦截）。范围创建后冻结为快照；
          离线工作区仍可勾选，派发到它会失败但不影响整个任务。
        </p>
      </div>

      <div className="space-y-1.5">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">
          主工作区（Anchor）· 主控运行位置
        </div>
        {selected.length === 0 ? (
          <p className="rounded-md border border-dashed border-slate-300 px-2.5 py-2 text-xs text-slate-400">
            先在上方勾选派发范围，再选主工作区。
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {selected.map((c) => {
              const isAnchor = anchorId === c.workspace_id;
              return (
                <label
                  key={c.workspace_id}
                  className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${
                    isAnchor
                      ? "border-teal-300 bg-teal-50 text-teal-800"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  <input
                    type="radio"
                    name="mission-anchor"
                    aria-label={`主工作区选择 ${c.name}`}
                    checked={isAnchor}
                    onChange={() => onAnchorChange(c.workspace_id)}
                    className="h-3.5 w-3.5 shrink-0"
                  />
                  {c.name}
                  <WsTypeBadgeSpan type={c.type} />
                </label>
              );
            })}
          </div>
        )}
        <p className="text-[11px] text-slate-500">
          默认「后端代码」类型优先，否则取第一个。主控跑在主工作区，按任务性质把工作派到范围内各工作区的机器上执行。
        </p>
      </div>
    </div>
  );
}

/**
 * task-15：项目维度详情信息条（design §3.1 线框「项目/Anchor/Scope」行）。
 * anchor 名优先取 workspace_name（listProjectMissions 回填），轮询 getMission
 * 后该字段不回填（后端设计如此），用 page 传入的 wsNameById 兜底。
 */
function ProjectMissionMeta({
  mission,
  wsTypeById,
  wsNameById,
}: {
  mission: ProjectMissionView;
  wsTypeById: Record<string, string | null | undefined>;
  wsNameById: Record<string, string | null | undefined>;
}) {
  const anchorName =
    mission.workspace_name ?? wsNameById[mission.workspace_id] ?? null;
  const scopeIds = mission.scope_workspace_ids ?? [];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-gray-600">
      <span className="inline-flex items-center gap-1.5">
        <span className="text-gray-400">主工作区</span>
        <WsTypeBadgeSpan type={wsTypeById[mission.workspace_id]} />
        <span className="font-medium text-gray-800">{anchorName ?? "—"}</span>
      </span>
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <span className="text-gray-400">
          派发范围（冻结快照 · {Math.max(scopeIds.length, 1)} 个工作区）
        </span>
        {scopeIds.map((id) => (
          <span key={id} className="inline-flex items-center gap-1">
            <WsTypeBadgeSpan type={wsTypeById[id]} />
            <span className="max-w-40 truncate text-gray-600">
              {wsNameById[id] ?? id}
            </span>
          </span>
        ))}
      </span>
    </div>
  );
}

/**
 * task-15 / R-04：创建预检回传的 binding 缺失清单（后端塞进 constraints.
 * missing_bindings，[{id, name}]）。仅提示不阻断——主控可跳过离线工作区。
 */
function ScopeMissingBindings({ mission }: { mission: Mission }) {
  const raw = mission.constraints?.["missing_bindings"];
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const names = raw
    .map((item) =>
      typeof item === "object" && item !== null && "name" in item
        ? String((item as { name: unknown }).name)
        : null,
    )
    .filter((n): n is string => n !== null);
  if (names.length === 0) return null;
  return (
    <div className="rounded border border-yellow-200 bg-yellow-50 px-3 py-2 text-xs text-yellow-800">
      ⚠ 以下范围工作区暂无可用机器绑定，派发到它们会失败（不影响其余工作区）：
      {names.join("、")}
    </div>
  );
}

export interface MissionConsoleProps {
  /** 单工作区维度：目标工作区 id（非 projectMode 必填；worker 日志/取消按它调用）。 */
  workspaceId?: string;
  /** task-15 / design §7.3：项目维度模式——创建走 createProjectMission、历史走 listProjectMissions、worker 行显示目标工作区徽标。 */
  projectMode?: boolean;
  /** 项目维度必填：项目 id（路由 /projects/{id}/missions 的 id 段）。 */
  projectId?: string;
  /** 项目维度必填：scope 候选（项目关联工作区，page 从 listProjectWorkspaces 加载）。 */
  scopeCandidates?: WorkspaceBrief[];
  /** workspace_id → type 映射（目标工作区徽标配色；page 从候选构建，缺项灰兜底）。 */
  wsTypeById?: Record<string, string | null | undefined>;
  /** workspace_id → name 映射（后端暂不回填 target_workspace_name / getMission 不回填 workspace_name 的前端兜底）。 */
  wsNameById?: Record<string, string | null | undefined>;
}

export function MissionConsole({
  workspaceId,
  projectMode = false,
  projectId,
  scopeCandidates = [],
  wsTypeById = {},
  wsNameById = {},
}: MissionConsoleProps) {
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
  // task-15 / projectMode：scope 多选 + anchor 单选（design §7.3）。
  const [scopeIds, setScopeIds] = useState<string[]>([]);
  const [anchorId, setAnchorId] = useState<string | null>(null);

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
      if (projectMode && projectId) {
        // 项目维度历史（design §7.1 GET /api/projects/{pid}/missions）。
        const list = await listProjectMissions(projectId, { limit: 20 });
        setHistory(list.map(normalizeProjectMission));
      } else {
        setHistory(await listMissions(workspaceId ?? "", { limit: 20 }));
      }
    } catch {
      /* swallow list errors */
    }
  }, [projectMode, projectId, workspaceId]);
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

  /** task-15 / projectMode：勾/退 scope；退选后 anchor 不在范围时重取默认。 */
  const toggleScope = (id: string) => {
    const next = scopeIds.includes(id)
      ? scopeIds.filter((x) => x !== id)
      : [...scopeIds, id];
    setScopeIds(next);
    if (!anchorId || !next.includes(anchorId)) {
      setAnchorId(pickDefaultAnchor(scopeCandidates, next));
    }
  };

  const onCreate = async () => {
    if (!objective.trim()) return;
    // 项目维度：scope 必填 ≥1（后端 422 兜底，前端先拦省一次请求）。
    if (projectMode && scopeIds.length === 0) return;
    if (projectMode && !projectId) return;
    setBusy(true);
    setError(null);
    try {
      const budgetNum = budget.trim() ? Number(budget) : null;
      // 固定 team 模式（D-001@v1）：无条件传 mode="team" + 主控配置（默认值始终传，
      // 即使用户不展开高级 G2）+ 分身预设（默认空数组 → 主控自动拆）。
      const common = {
        objective: objective.trim(),
        budget_usd: budgetNum !== null && budgetNum > 0 ? budgetNum : null,
        mode: "team",
        main_agent_config: mainAgentConfig,
        worker_preset: workers,
      } satisfies CreateMissionInput;
      let m: Mission;
      if (projectMode && projectId) {
        // task-15 / D-005@v1：项目维度创建，scope/anchor 随 payload 上行；
        // anchor 前端已按 backend-code 优先预选，显式传值绕开后端缺省比对缺陷。
        const payload: CreateProjectMissionInput = {
          ...common,
          scope_workspace_ids: scopeIds,
          anchor_workspace_id: anchorId,
        };
        m = normalizeProjectMission(await createProjectMission(projectId, payload));
      } else {
        m = await createMission(workspaceId ?? "", common);
      }
      setMission(m);
      writeMissionIdToUrl(m.id);
      refreshHistory();
      setObjective("");
      setBudget("");
      setAdvancedOpen(false);
      setMainAgentConfig(DEFAULT_MAIN_AGENT_CONFIG);
      setWorkers([]);
      setScopeIds([]);
      setAnchorId(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onCancel = async () => {
    if (!mission) return;
    try {
      // projectMode 下 mission.workspace_id = anchor（鉴权锚，design D-006）。
      setMission(
        await cancelMission(
          projectMode ? mission.workspace_id : (workspaceId ?? ""),
          mission.id,
        ),
      );
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  };

  // 详情态返回创建态：清 mission + 清 URL ?mission（让刷新不再回到详情）。
  const onBack = () => {
    setMission(null);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.delete("mission");
      window.history.replaceState(null, "", url);
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
                  {projectMode && (
                    <span
                      className="whitespace-nowrap text-xs text-gray-400"
                      title="主工作区 · 派发范围（冻结快照）"
                    >
                      主工作区{" "}
                      {(m as ProjectMissionView).workspace_name ??
                        wsNameById[m.workspace_id] ??
                        "—"}{" "}
                      · 范围{" "}
                      {Math.max(
                        (m as ProjectMissionView).scope_workspace_ids?.length ?? 1,
                        1,
                      )}{" "}
                      个工作区
                    </span>
                  )}
                  <span className="whitespace-nowrap text-xs text-gray-400">
                    {new Date(m.created_at).toLocaleString("zh-CN")} · {m.workers.length}{" "}
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
          {/* task-15 / projectMode：scope 多选 + anchor 单选（design §7.3）。 */}
          {projectMode && (
            <ProjectScopePanel
              candidates={scopeCandidates}
              scopeIds={scopeIds}
              onToggleScope={toggleScope}
              anchorId={anchorId}
              onAnchorChange={setAnchorId}
            />
          )}
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
            <Button
              onClick={onCreate}
              disabled={
                busy ||
                !objective.trim() ||
                (projectMode && scopeIds.length === 0)
              }
            >
              {busy ? "启动中…" : "启动"}
            </Button>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      {mission && (
        <div className="space-y-3">
          <div>
            <Button variant="outline" size="sm" onClick={onBack}>
              ← 返回新建
            </Button>
          </div>
          <MissionSummaryCard mission={mission} />

          {/* task-15 / projectMode：anchor + scope 概要条（design §3.1 线框）。 */}
          {projectMode && (
            <ProjectMissionMeta
              mission={mission as ProjectMissionView}
              wsTypeById={wsTypeById}
              wsNameById={wsNameById}
            />
          )}

          {/* task-15 / R-04：创建预检回传的 binding 缺失清单（不阻断，提示可跳过）。 */}
          {projectMode && ACTIVE.has(mission.status) && (
            <ScopeMissingBindings mission={mission} />
          )}

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
            // task-15：projectMode 下 worker 日志/取消按 anchor（mission.workspace_id）
            // 调用（后端 run/日志按 run_id 直查，不校验 ws 归属，anchor 鉴权即可）。
            const logWorkspaceId = projectMode
              ? mission.workspace_id
              : (workspaceId ?? "");
            const targetContext: WorkerTargetContext | null = projectMode
              ? {
                  wsTypeById,
                  wsNameById,
                  anchorWorkspaceId: mission.workspace_id,
                  anchorName:
                    (mission as ProjectMissionView).workspace_name ??
                    wsNameById[mission.workspace_id] ??
                    null,
                  crossWorkspace:
                    ((mission as ProjectMissionView).scope_workspace_ids ?? [])
                      .length > 1,
                }
              : null;
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
                        workspaceId={logWorkspaceId}
                        targetContext={targetContext}
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
                          workspaceId={logWorkspaceId}
                          targetContext={targetContext}
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
