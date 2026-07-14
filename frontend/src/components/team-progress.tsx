"use client";

/**
 * task-08（2026-07-12-team-main-agent-orchestration / FR-8）：Team 进度组件。
 *
 * 三入口之一「execute·verify stage」与「会话用团队分析」共用的进度展示。
 * 渲染三块：
 *   1. 主 agent（orchestrator）决策日志：从 mission.constraints.orchestrator_log
 *      取主 agent 调度决策（dispatch/get_result/converge 等步骤的 note）。
 *      设计 §5 MCP report_progress(note) 写入；brownfield 无字段→空态。
 *   2. Worker 进度列表：mission.workers（含 status / role / objective / artifacts），
 *      复用 mission-console WorkerRow 的样式（紫系 violet，对齐 team 主题）。
 *   3. CostBar：mission.cost_so_far / budget_usd 进度条。
 *
 * 与 mission-console 区别：
 *   - mission-console = 创建入口 + 进度（含 mode 选择 / 配置面板 / 创建表单）。
 *   - team-progress = 只读进度展示（绑定 missionId，不带创建表单），
 *     供 stage / 会话内嵌（这些入口已通过其它方式建好 mission）。
 *
 * 实现说明（偏离 TaskCard）：
 *   TaskCard 写「复用 mission-console 的 WorkerRow/CostBar」，但 mission-console
 *   正被 task-07 并行修改（team 配置面板），且 CostBar/WorkerRow 当前未 export。
 *   为避免与 task-07 的频繁改动撞文件冲突，team-progress 独立实现简化版组件
 *   （样式 / 行为对齐 mission-console），逻辑等价、降耦。
 */

import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import {
  cancelMission,
  getMission,
  type Mission,
  type MissionArtifact,
  type MissionWorkerRun,
} from "@/lib/agent";

/** 主 agent / worker 活跃态（用于轮询节奏控制）。 */
const ACTIVE_STATUS = new Set(["planning", "running", "degraded"]);

/** Worker 角色中文标注（与 mission-console ROLE_LABEL 对齐）。 */
const ROLE_LABEL: Record<string, string> = {
  arch: "架构分析",
  code_style: "代码规范",
  test: "测试",
  integration: "集成",
  risk: "风险",
  impl: "实现",
  verify: "验证",
  orchestrator: "主 Agent",
};

const STATUS_BADGE: Record<string, string> = {
  planning: "bg-gray-100 text-gray-700",
  running: "bg-blue-100 text-blue-700",
  done: "bg-green-100 text-green-700",
  degraded: "bg-yellow-100 text-yellow-800",
  failed: "bg-red-100 text-red-700",
  cancelled: "bg-gray-200 text-gray-500",
};

/** 轮询间隔：mission 活跃时 5s 拉一次（与 mission-console 10s 同数量级，team 场景更密）。 */
const POLL_MS = 5000;

export interface TeamProgressProps {
  /** Mission ID（必填，无则渲染空态）。 */
  missionId: string;
  /** 工作空间 ID（worker 日志查看用，目前 team-progress 不内嵌日志面板，预留）。 */
  workspaceId?: string;
  /** 紧凑模式（会话内嵌用，去除 section 边框 + 缩小标题）。 */
  compact?: boolean;
  /**
   * 轮询间隔（毫秒），测试用。生产默认 5000。
   * 活跃态 mission 自动拉取；终态停止轮询。
   */
  pollMs?: number;
}

export function TeamProgress({ missionId, workspaceId, compact, pollMs }: TeamProgressProps) {
  const [mission, setMission] = useState<Mission | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const m = await getMission(missionId);
      setMission(m);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "加载团队任务失败");
    } finally {
      setLoading(false);
    }
  }, [missionId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 活跃态轮询；终态停止
  useEffect(() => {
    if (!mission || !ACTIVE_STATUS.has(mission.status)) return;
    const interval = pollMs ?? POLL_MS;
    const t = setInterval(() => { void refresh(); }, interval);
    return () => clearInterval(t);
  }, [mission?.id, mission?.status, refresh, pollMs]);

  const handleCancel = useCallback(async () => {
    if (!mission) return;
    try {
      setMission(await cancelMission(workspaceId ?? "", mission.id));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "取消团队任务失败");
    }
  }, [mission]);

  // 主 agent 决策日志：constraints.orchestrator_log = [{ ts, note, step }] | string[]
  // brownfield mission 无此字段 → 空态展示（design §5 MCP report_progress 写入）
  const orchestratorLog = extractOrchestratorLog(mission?.constraints);

  const sectionClass = compact
    ? "space-y-3"
    : "space-y-3 rounded-lg border border-violet-200 bg-violet-50/20 p-4";

  if (loading) {
    return (
      <section className={sectionClass}>
        <p className="text-xs text-muted-foreground">加载团队任务进度…</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className={sectionClass}>
        <p className="text-xs text-destructive">{error}</p>
        <Button variant="outline" size="sm" onClick={() => void refresh()}>
          重试
        </Button>
      </section>
    );
  }

  if (!mission) {
    return (
      <section className={sectionClass}>
        <p className="text-xs text-muted-foreground">未找到团队任务。</p>
      </section>
    );
  }

  // workers 拆分：主 agent（role=orchestrator）单独展示，普通 worker 列表
  const mainAgent = mission.workers.find((w) => w.role === "orchestrator") ?? null;
  const workerRuns = mission.workers.filter((w) => w.role !== "orchestrator");

  return (
    <section className={sectionClass}>
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className={`font-semibold ${compact ? "text-sm" : "text-base"}`}>
          🤝 团队任务进度
        </h3>
        <div className="flex items-center gap-2">
          <Badge className={STATUS_BADGE[mission.status] ?? "bg-gray-100"}>
            {mission.status}
          </Badge>
          {ACTIVE_STATUS.has(mission.status) && (
            <Button variant="outline" size="sm" onClick={handleCancel}>
              取消
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void refresh()}
            title="刷新"
          >
            刷新
          </Button>
        </div>
      </header>

      {/* objective + CostBar */}
      <div className="space-y-2">
        <p className="text-xs text-foreground">{mission.objective}</p>
        <TeamCostBar cost={mission.cost_so_far} budget={mission.budget_usd} />
      </div>

      {/* 主 agent 决策日志（orchestrator_log，brownfield 空→提示） */}
      <div className="rounded-md border border-violet-200 bg-white p-3">
        <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-violet-700">
          🧠 主 Agent 决策
        </div>
        {mainAgent && (
          <div className="mb-2 flex flex-wrap items-center gap-1.5 text-[11px]">
            <Badge variant="outline" className="text-[10px]">
              {mainAgent.status}
            </Badge>
            {mainAgent.objective && (
              <span className="text-muted-foreground">{mainAgent.objective}</span>
            )}
          </div>
        )}
        {orchestratorLog.length > 0 ? (
          <ul className="space-y-1">
            {orchestratorLog.map((entry, idx) => (
              <li key={idx} className="flex gap-2 text-[11px] leading-relaxed">
                <span className="shrink-0 font-mono text-slate-400">
                  {entry.ts ?? `#${idx + 1}`}
                </span>
                <span className="text-slate-700">{entry.note}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[11px] text-slate-400">
            主 agent 尚未上报决策（report_progress）。
            {mainAgent?.status === "running"
              ? " 主 agent 正在运行，决策稍后显示。"
              : ""}
          </p>
        )}
      </div>

      {/* Worker 进度列表（复用 mission-console WorkerRow 风格） */}
      <div>
        <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-violet-700">
          👥 Worker 进度（{workerRuns.length}）
        </div>
        {workerRuns.length === 0 ? (
          <p className="rounded-md border border-dashed border-slate-300 bg-white px-3 py-2 text-[11px] text-slate-400">
            暂无 Worker。主 agent 接管后将按预设派发。
          </p>
        ) : (
          <ul className="space-y-2">
            {workerRuns.map((w) => (
              <TeamWorkerRow key={w.id} worker={w} />
            ))}
          </ul>
        )}
      </div>

      {/* 预留 workspaceId 引用（避免 lint unused），未来 worker 日志面板用 */}
      {workspaceId === "__unused__" && null}
    </section>
  );
}

/* ---------- 内部组件（与 mission-console 样式对齐，独立实现避免 task-07 冲突） ---------- */

function costBarColor(ratio: number): string {
  if (ratio > 1.0) return "bg-red-500";
  if (ratio >= 0.7) return "bg-yellow-500";
  return "bg-green-500";
}

function TeamCostBar({ cost, budget }: { cost: number; budget: number | null }) {
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

function TeamArtifactCard({ artifact }: { artifact: MissionArtifact }) {
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

function TeamWorkerRow({ worker }: { worker: MissionWorkerRun }) {
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
  const role = worker.role ?? "worker";
  return (
    <li className="space-y-1 rounded border border-gray-200 bg-white p-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="text-xs">
          {ROLE_LABEL[role] ?? role}
        </Badge>
        <span className="text-[11px] text-gray-400">[{role}]</span>
        <span className={statusColor}>{worker.status}</span>
      </div>
      {worker.objective && (
        <p className="text-xs text-gray-600">
          <span className="text-gray-400">分工目标：</span>
          {worker.objective}
        </p>
      )}
      {worker.total_cost_usd !== null && worker.total_cost_usd > 0 && (
        <p className="text-[11px] text-gray-400">
          成本 ${worker.total_cost_usd.toFixed(4)}
        </p>
      )}
      {worker.artifacts.length > 0 && (
        <div className="space-y-1">
          {worker.artifacts.map((a) => (
            <TeamArtifactCard key={a.id} artifact={a} />
          ))}
        </div>
      )}
    </li>
  );
}

/* ---------- helpers ---------- */

interface OrchestratorLogEntry {
  ts?: string;
  note: string;
  step?: string;
}

/**
 * 从 mission.constraints 提取主 agent 决策日志。
 * 支持两种格式：
 *   - [{ ts, note, step }]（标准）
 *   - ["决策1", "决策2"]（简写，brownfield）
 * 任意字段缺失 → 返回空数组（UI 走空态）。
 */
function extractOrchestratorLog(
  constraints: Record<string, unknown> | null | undefined,
): OrchestratorLogEntry[] {
  if (!constraints) return [];
  const raw = constraints.orchestrator_log;
  if (!Array.isArray(raw)) return [];
  const out: OrchestratorLogEntry[] = [];
  for (const item of raw) {
    if (typeof item === "string") {
      out.push({ note: item });
    } else if (item && typeof item === "object") {
      const obj = item as Record<string, unknown>;
      const note = typeof obj.note === "string" ? obj.note : null;
      if (!note) continue;
      out.push({
        note,
        ts: typeof obj.ts === "string" ? obj.ts : undefined,
        step: typeof obj.step === "string" ? obj.step : undefined,
      });
    }
  }
  return out;
}
