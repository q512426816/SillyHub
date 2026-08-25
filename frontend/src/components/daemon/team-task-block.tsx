"use client";

/**
 * task-12（2026-08-22-team-session-unify / FR-07 / D-001@v1）：
 * 消息流内团队任务块 TeamTaskBlock —— 嵌入会话消息流（原型
 * prototype-team-session-unify.html §01 .team-block），消费 lib/daemon.ts 的
 * TeamMissionSummary（GET /sessions/{id}/team-missions 列表项）：
 *
 *   - 概要行常驻：状态徽标（中文映射）/「N 分身 · 成功 X / 失败 Y」计数 /
 *     预算（花费字段后端概要暂未下发，见 budgetText 注释）；
 *   - 点击头部折叠展开：主控行（mission objective）+ 范围徽标行 + 分身行
 *     （角色徽标 / 状态 / 目标摘要 / 日志·产物入口）；
 *   - 取消按钮（活跃态）：两步确认 → cancelTeamMission（保留端点
 *     POST /api/missions/{id}/cancel）→ onRefresh 由父层重拉列表；
 *   - 活跃态（planning/running/awaiting_input）默认展开、终态默认折叠，
 *     active→终态过渡自动收敛（对齐段族 SubagentBlockView 语义）。
 *
 * 挂载与轮询归 task-11（session-panel）：父层对活跃 mission 5s 调
 * listSessionTeamMissions 后以新 summary props 重渲染，本组件不自建轮询。
 *
 * 约束（task-12 constraints）：不用 antd（对齐段族惯例，也规避按钮中文
 * autoLetterSpacing 拆分）；纯 props 渲染（不读 store / SSE / 本地时钟）；
 * 团队视觉用 violet 固定阶（主题不变量，「团队/主控专用」，对齐现有
 * team-progress.tsx mission 视觉与原型），运行态文字走 brand-* 语义阶
 *（随 html data-theme 换肤，双主题铁律）。
 */

import { memo, useCallback, useEffect, useRef, useState } from "react";

import {
  getAgentRunLogs,
  listAgentFileArtifacts,
  type AgentRunLogEntry,
  type AgentFileArtifactMeta,
} from "@/lib/agent";
import { cancelTeamMission, type TeamMissionSummary } from "@/lib/daemon";
import { ApiError } from "@/lib/api";
import { workspaceTypeBadge } from "@/lib/workspace-types";
import { cn } from "@/lib/utils";

/* ───────────────── 状态 / 角色映射（纯常量） ───────────────── */

/**
 * mission 派生状态徽标元数据（planning|running|awaiting_input|done|degraded|
 * failed|cancelled，task-02 derive_status 扩展档）。配色对齐 team-progress
 * STATUS_BADGE：running 走 brand 语义阶（双主题），其余语义色固定阶。
 */
const MISSION_STATUS_META: Record<string, { label: string; badge: string }> = {
  planning: { label: "规划中", badge: "bg-zinc-100 text-zinc-600" },
  running: { label: "运行中", badge: "bg-brand-100 text-brand-700" },
  awaiting_input: { label: "等待输入", badge: "bg-amber-100 text-amber-800" },
  done: { label: "已完成", badge: "bg-emerald-100 text-emerald-700" },
  degraded: { label: "部分完成", badge: "bg-amber-100 text-amber-800" },
  failed: { label: "失败", badge: "bg-red-100 text-red-700" },
  cancelled: { label: "已取消", badge: "bg-zinc-200 text-zinc-500" },
};

const MISSION_STATUS_FALLBACK = {
  label: "未知状态",
  badge: "bg-zinc-100 text-zinc-500",
};

/** 分身 run 状态文案与颜色（AgentRunStatus + cancelled/interrupted 兜底）。 */
const WORKER_STATUS_META: Record<string, { label: string; cls: string }> = {
  pending: { label: "排队中", cls: "text-muted-foreground" },
  running: { label: "运行中", cls: "text-brand-700" },
  completed: { label: "已完成", cls: "text-emerald-700" },
  failed: { label: "失败", cls: "text-red-600" },
  killed: { label: "已终止", cls: "text-muted-foreground" },
  cancelled: { label: "已取消", cls: "text-muted-foreground" },
  interrupted: { label: "已打断", cls: "text-muted-foreground" },
};

const WORKER_STATUS_FALLBACK = { label: "未知", cls: "text-muted-foreground" };

/** 分身角色中文标注（与 team-progress / mission-console ROLE_LABEL 对齐）。 */
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

/**
 * mission 是否活跃（父层 5s 轮询启停判据，design §5 Phase 3：活跃轮询、
 * 终态停止）。awaiting_input 是会话维度新档（分身全终态、等主控会话下一轮输入）。
 */
export function isActiveTeamMission(status: string): boolean {
  return (
    status === "planning" ||
    status === "running" ||
    status === "awaiting_input"
  );
}

/* ───────────────── 工作区徽标（workspaceMeta 可选注入） ───────────────── */

/**
 * 工作区 id → 展示信息（名称 + 类型）映射。summary.scope_workspace_ids 只有
 * UUID（后端冻结快照不含名称），父层（task-11）可用会话上下文里已有的工作区
 * 信息注入；缺省时组件用短 id 兜底展示，不阻塞渲染。
 */
export interface TeamWorkspaceMetaEntry {
  name: string | null;
  type: string | null;
}

export type TeamWorkspaceMeta = Record<string, TeamWorkspaceMetaEntry>;

/** 工作区徽标（形态对齐 mission-console WsTypeBadgeSpan：类型配色 + 名称优先）。 */
function WsBadge({ entry }: { entry: TeamWorkspaceMetaEntry }) {
  const view = workspaceTypeBadge(entry.type);
  return (
    <span
      title={entry.type ?? undefined}
      className={`inline-flex h-5 shrink-0 items-center rounded border px-1.5 text-[10px] font-semibold ${view.className}`}
    >
      {entry.name || view.label}
    </span>
  );
}

/** 文件大小格式化（B / KB / MB）。 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/* ───────────────── props 契约（task-11 消费） ───────────────── */

export interface TeamTaskBlockProps {
  /** 团队任务概要（listSessionTeamMissions 列表项）。 */
  summary: TeamMissionSummary;
  /**
   * 取消成功后的刷新回调（父层重拉 team-missions 列表）。父层 5s 轮询与
   * 本回调共用同一数据源，组件不区分来源。
   */
  onRefresh?: () => void;
  /** 工作区 id → 名称/类型（可选，徽标美化用，见 TeamWorkspaceMeta）。 */
  workspaceMeta?: TeamWorkspaceMeta;
  /** 会话绑定工作区 ID（用于 per-run 日志/产物查询端点鉴权）。 */
  workspaceId?: string | null;
}

/* ───────────────── 组件 ───────────────── */

export const TeamTaskBlock = memo(function TeamTaskBlock({
  summary,
  onRefresh,
  workspaceMeta,
  workspaceId,
}: TeamTaskBlockProps) {
  const active = isActiveTeamMission(summary.status);
  const [open, setOpen] = useState(active);
  // active → 终态过渡：自动收敛为折叠（终态默认折叠，对齐原型 §03 终态任务块）。
  const prevActiveRef = useRef(active);
  useEffect(() => {
    if (prevActiveRef.current && !active) setOpen(false);
    prevActiveRef.current = active;
  }, [active]);

  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── 分身日志/产物展开状态 ──
  const [expandedLogsRunId, setExpandedLogsRunId] = useState<string | null>(null);
  const [logsData, setLogsData] = useState<AgentRunLogEntry[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState<string | null>(null);

  const [expandedArtifactsRunId, setExpandedArtifactsRunId] = useState<string | null>(null);
  const [artifactsData, setArtifactsData] = useState<AgentFileArtifactMeta[]>([]);
  const [artifactsLoading, setArtifactsLoading] = useState(false);
  const [artifactsError, setArtifactsError] = useState<string | null>(null);

  // 优先用 worker 自身的 workspace_id，回落 mission scope 第一项
  const effectiveWorkspaceId =
    workspaceId ?? summary.scope_workspace_ids[0] ?? null;

  // ql-20260825-003：scope 徽标名称化——父层 workspaceMeta 优先，次选后端
  // summary.scope_workspaces（enriched id+name），都缺才回落 #<id8> 原始徽标。
  const wsEntryOf = useCallback(
    (id: string | null | undefined): TeamWorkspaceMetaEntry | null => {
      if (!id) return null;
      const meta = workspaceMeta?.[id];
      if (meta?.name) return meta;
      const ref = summary.scope_workspaces?.find((w) => w.id === id);
      if (ref?.name) return { name: ref.name, type: meta?.type ?? null };
      return null;
    },
    [workspaceMeta, summary.scope_workspaces],
  );

  const handleToggleLogs = useCallback(
    async (runId: string, runWorkspaceId?: string | null) => {
      if (expandedLogsRunId === runId) {
        setExpandedLogsRunId(null);
        return;
      }
      // ql-20260825-003：per-run 端点按 run 自身工作区鉴权（跨工作区分身用
      // scope[0] 会 403"不属于当前工作区"），回落链：分身自身 → 会话 → scope[0]。
      const wsForRun = runWorkspaceId ?? effectiveWorkspaceId;
      if (!wsForRun) {
        setLogsError("无可用工作区 ID，无法查询日志");
        setExpandedLogsRunId(runId);
        return;
      }
      setExpandedLogsRunId(runId);
      setLogsLoading(true);
      setLogsError(null);
      try {
        const logs = await getAgentRunLogs(wsForRun, runId);
        setLogsData(logs);
      } catch (e) {
        setLogsError(e instanceof ApiError ? e.message : "加载日志失败");
        setLogsData([]);
      } finally {
        setLogsLoading(false);
      }
    },
    [expandedLogsRunId, effectiveWorkspaceId],
  );

  const handleToggleArtifacts = useCallback(
    async (runId: string) => {
      if (expandedArtifactsRunId === runId) {
        setExpandedArtifactsRunId(null);
        return;
      }
      setExpandedArtifactsRunId(runId);
      setArtifactsLoading(true);
      setArtifactsError(null);
      try {
        const files = await listAgentFileArtifacts(runId);
        setArtifactsData(files);
      } catch (e) {
        setArtifactsError(e instanceof ApiError ? e.message : "加载产物失败");
        setArtifactsData([]);
      } finally {
        setArtifactsLoading(false);
      }
    },
    [expandedArtifactsRunId],
  );

  const statusMeta =
    MISSION_STATUS_META[summary.status] ?? MISSION_STATUS_FALLBACK;
  const okCount = summary.workers.filter((w) => w.status === "completed").length;
  const failCount = summary.workers.filter(
    (w) => w.status === "failed" || w.status === "killed",
  ).length;
  const statText = `${summary.workers.length} 分身 · 成功 ${okCount} / 失败 ${failCount}`;
  // 花费/预算槽：TeamMissionSummary 暂无 cost 字段（task-03 DTO），先展示预算；
  // 后端补 cost_usd 后在此拼接「$cost / 预算 $budget」（task-14 gen:types 对齐时校正）。
  const budgetText =
    summary.budget_usd != null && summary.budget_usd > 0
      ? `预算 $${summary.budget_usd.toFixed(2)}`
      : "未设预算";

  const handleCancel = async () => {
    if (cancelling) return;
    setCancelling(true);
    setError(null);
    try {
      await cancelTeamMission(summary.mission_id);
      setConfirming(false);
      onRefresh?.();
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : "取消团队任务失败",
      );
    } finally {
      setCancelling(false);
    }
  };

  return (
    <section
      className="w-full self-stretch overflow-hidden rounded-[10px] border border-violet-200 bg-violet-50/55"
      aria-label="团队任务"
    >
      {/* 概要行（常驻，点击折叠/展开） */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen(!open);
          }
        }}
        className="flex w-full cursor-pointer select-none flex-wrap items-center gap-2 px-3 py-[7px] text-xs"
      >
        <span className="inline-flex shrink-0 items-center gap-1 text-[12px] font-bold text-violet-700">
          <span aria-hidden>👥</span>团队任务
        </span>
        <span
          className={cn(
            "inline-flex h-[21px] shrink-0 items-center rounded-full px-2 text-[11px] font-medium",
            statusMeta.badge,
          )}
        >
          {statusMeta.label}
        </span>
        <span className="min-w-0 shrink-0 text-[11.5px] text-muted-foreground">
          {statText}
        </span>
        <span className="ml-auto shrink-0 font-mono text-[11.5px] text-muted-foreground">
          {budgetText}
        </span>
        <span className="shrink-0 text-[11px] text-violet-700">
          {open ? "收起 ▴" : "展开 ▾"}
        </span>
      </div>

      {/* 展开明细（折叠时不挂载） */}
      {open && (
        <div className="flex flex-col gap-[5px] border-t border-dashed border-violet-200 bg-card px-3 py-2">
          {/* 主控行：mission objective 即主控目标（workers 已排除主控轮，D-009；
              主控状态 = mission 状态，概要行徽标已示，此处不重复） */}
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1.5 text-[12.5px]">
            <span className="inline-flex h-[19px] shrink-0 items-center rounded border border-violet-300 bg-violet-50 px-2 text-[11px] font-semibold text-violet-700">
              🧠 主控
            </span>
            <span
              className="min-w-0 flex-1 truncate text-[11.5px] text-muted-foreground"
              title={summary.objective ?? undefined}
            >
              {summary.objective || "拆解任务并派发分身，随时接你的追问"}
            </span>
          </div>

          {/* 范围徽标行（scope 冻结快照；无 meta 时短 id 兜底） */}
          <div className="flex flex-wrap items-center gap-1.5 px-0.5 text-[11px] text-muted-foreground">
            <span className="shrink-0">范围</span>
            {summary.scope_workspace_ids.length === 0 ? (
              <span className="inline-flex h-5 items-center rounded border border-violet-200 bg-violet-50 px-1.5 text-[10px] font-semibold text-violet-700">
                会话工作区
              </span>
            ) : (
              summary.scope_workspace_ids.map((id) => {
                const entry = wsEntryOf(id);
                return entry ? (
                  <WsBadge key={id} entry={entry} />
                ) : (
                  <span
                    key={id}
                    title={id}
                    className="inline-flex h-5 items-center rounded border border-violet-200 bg-violet-50 px-1.5 font-mono text-[10px] font-semibold text-violet-700"
                  >
                    #{id.slice(0, 8)}
                  </span>
                );
              })
            )}
          </div>

          {/* 分身行 */}
          {summary.workers.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-300 px-3 py-2 text-[11.5px] text-muted-foreground">
              暂无分身。主控接管后将按预设派发。
            </p>
          ) : (
            summary.workers.map((w) => {
              const wsMeta = WORKER_STATUS_META[w.status] ?? WORKER_STATUS_FALLBACK;
              const logsOpen = expandedLogsRunId === w.run_id;
              const artifactsOpen = expandedArtifactsRunId === w.run_id;
              return (
                <div key={w.run_id} className="flex flex-col">
                  <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1.5 text-[12.5px]">
                    <span className="inline-flex h-[19px] shrink-0 items-center rounded border border-border bg-muted px-2 text-[11px] text-muted-foreground">
                      {(w.role && ROLE_LABEL[w.role]) || w.role || "分身"}
                    </span>
                    <span className={cn("shrink-0 text-[12px]", wsMeta.cls)}>
                      {wsMeta.label}
                    </span>
                    {/* ql-20260825-003：分身自身工作区徽标（多 scope 也显示，
                        跨工作区分身可辨识归属；名称链 wsEntryOf，缺名回落 #id） */}
                    {w.workspace_id && (
                      <span className="shrink-0" title={w.workspace_id}>
                        {(() => {
                          const wEntry = wsEntryOf(w.workspace_id);
                          return wEntry ? (
                            <WsBadge entry={wEntry} />
                          ) : (
                            <span className="inline-flex h-5 items-center rounded border border-violet-200 bg-violet-50 px-1.5 font-mono text-[10px] font-semibold text-violet-700">
                              #{w.workspace_id.slice(0, 8)}
                            </span>
                          );
                        })()}
                      </span>
                    )}
                    <span
                      className="min-w-0 flex-1 truncate text-[11.5px] text-muted-foreground"
                      title={w.objective ?? undefined}
                    >
                      {w.objective || "—"}
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleToggleLogs(w.run_id, w.workspace_id)}
                      className={cn(
                        "shrink-0 rounded border px-2 py-0.5 text-[11.5px] hover:bg-muted",
                        logsOpen
                          ? "border-violet-300 bg-violet-50 text-violet-700"
                          : "border-border text-muted-foreground",
                      )}
                    >
                      日志
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleToggleArtifacts(w.run_id)}
                      className={cn(
                        "shrink-0 rounded border px-2 py-0.5 text-[11.5px] hover:bg-muted",
                        artifactsOpen
                          ? "border-violet-300 bg-violet-50 text-violet-700"
                          : "border-border text-muted-foreground",
                      )}
                    >
                      产物
                    </button>
                  </div>

                  {/* 日志展开区 */}
                  {logsOpen && (
                    <div className="ml-4 mt-1 overflow-hidden rounded-lg border border-violet-100 bg-violet-50/30">
                      <div className="max-h-[320px] overflow-y-auto p-2">
                        {logsLoading ? (
                          <p className="text-[11px] text-muted-foreground">加载中…</p>
                        ) : logsError ? (
                          <p className="text-[11px] text-destructive">{logsError}</p>
                        ) : logsData.length === 0 ? (
                          <p className="text-[11px] text-muted-foreground">暂无日志</p>
                        ) : (
                          <pre className="whitespace-pre-wrap break-all font-mono text-[10.5px] leading-relaxed text-foreground">
                            {logsData
                              .map((l) => {
                                const ts = l.timestamp
                                  ? new Date(l.timestamp).toLocaleTimeString("zh-CN")
                                  : "";
                                const ch = l.channel === "tool_call"
                                  ? `[工具]`
                                  : l.channel === "user_input"
                                    ? `[用户]`
                                    : l.channel === "stdout"
                                      ? `[输出]`
                                      : "";
                                const content = l.content_redacted ?? "";
                                return `${ts} ${ch} ${content}`;
                              })
                              .join("\n")}
                          </pre>
                        )}
                      </div>
                    </div>
                  )}

                  {/* 产物展开区 */}
                  {artifactsOpen && (
                    <div className="ml-4 mt-1 overflow-hidden rounded-lg border border-violet-100 bg-violet-50/30">
                      <div className="max-h-[240px] overflow-y-auto p-2">
                        {artifactsLoading ? (
                          <p className="text-[11px] text-muted-foreground">加载中…</p>
                        ) : artifactsError ? (
                          <p className="text-[11px] text-destructive">{artifactsError}</p>
                        ) : artifactsData.length === 0 ? (
                          <p className="text-[11px] text-muted-foreground">暂无产物</p>
                        ) : (
                          <ul className="flex flex-col gap-1">
                            {artifactsData.map((f) => (
                              <li
                                key={f.id}
                                className="flex items-center gap-2 text-[11px]"
                              >
                                <span className="truncate font-medium text-foreground">
                                  {f.original_name}
                                </span>
                                <span className="shrink-0 text-muted-foreground">
                                  {formatFileSize(f.size)}
                                </span>
                                {f.description && (
                                  <span className="truncate text-muted-foreground">
                                    {f.description}
                                  </span>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}

          {/* 取消（活跃态；两步确认，避免误触） */}
          {active && (
            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              {confirming ? (
                <>
                  <span className="text-[11px] text-muted-foreground">
                    确认取消该团队任务？已派分身将停止。
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleCancel()}
                    disabled={cancelling}
                    className="rounded-md bg-red-600 px-2.5 py-0.5 text-[11.5px] font-medium text-white hover:bg-red-700 disabled:opacity-60"
                  >
                    {cancelling ? "取消中…" : "确认取消"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirming(false)}
                    disabled={cancelling}
                    className="rounded-md border border-border px-2.5 py-0.5 text-[11.5px] text-muted-foreground hover:bg-muted"
                  >
                    返回
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirming(true)}
                  className="rounded-md border border-red-200 bg-red-50 px-2.5 py-0.5 text-[11.5px] text-red-600 hover:bg-red-100"
                >
                  取消任务
                </button>
              )}
              {error && <p className="text-[11px] text-destructive">{error}</p>}
            </div>
          )}
        </div>
      )}
    </section>
  );
});
