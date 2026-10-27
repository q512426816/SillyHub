"use client";

/**
 * 概览面板（2026-10-15-change-detail-redesign / FR-01 / FR-08 / D-001@v1 / D-006@v1 / D-016@v1）。
 *
 * 首屏按变更状态适配（D-001）：
 * - 在途：待办卡（仅当前有待办时渲染，语义由 `ChangeStageActions` 既有分支承担）→ 变更摘要
 *   四格（当前阶段 / 任务进度 / 已用时长 / 最后信号）→ 最近动态（统一时间线尾部 5 条，**倒序**、
 *   轻量行、**不带**阶段筛选 chips 与合并口径说明——那两者只属「过程」tab）；
 * - 归档：成果总结四格（需求 / 决策 / 改动文件 / 净增行）+ 归档留档摘要（统计行 + 指路产出 tab）
 *   + 最终动态（倒序轻量行）。归档态 MUST NOT 出现执行中类文案，在途态 MUST NOT 出现归档空位。
 *
 * 右信息栏见 `change-overview-side.tsx`（两栏在 lg 以下堆叠）。
 *
 * 取数：本面板**不新增端点**——资产统计复用 `["changeAssets", …]` 既有 queryKey（同 key 命中
 * react-query 缓存，与产出面板/信息栏单一数据源）。最近动态数据由调用方注入（`recentRows`）。
 */
import { useQuery } from "@tanstack/react-query";

import { StatGrid, StateIcon } from "@/components/primer";
import {
  ChangeLastSignal,
  lastSignalFromSteps,
} from "@/components/changes/change-activity-badge";
import { WORKFLOW_STAGE_LABELS } from "@/components/changes/detail/change-stage-header";
import { ChangeStageActions } from "@/components/changes/detail/change-stage-actions";
import { formatDurationZh, useChangeUsage } from "@/components/changes/detail/change-usage-card";
import { ChangeOverviewSide } from "@/components/changes/detail/change-overview-side";
import { getChangeAssets, type ChangeRead } from "@/lib/changes";
import type { AgentSessionListItem } from "@/lib/daemon";
import type { UnifiedRow } from "@/components/changes/detail/merge-change-timeline";

/** 最近动态展示条数（轻量预览；全量在「过程」tab）。 */
const RECENT_LIMIT = 5;

/** 时间显示：本地 MM-DD HH:mm（不可解析保留原文）。 */
function shortTime(at: string | null): string {
  if (!at) return "—";
  const ms = Date.parse(at);
  if (Number.isNaN(ms)) return at;
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function RecentRows({ rows }: { rows: UnifiedRow[] }) {
  return (
    <div className="flex flex-col">
      {rows.map((row) => (
        <div
          key={row.key}
          data-testid="change-overview-recent-row"
          className="flex items-center gap-2 border-b border-dashed py-1.5 last:border-b-0"
        >
          {row.tone === "success" ? (
            <StateIcon name="check" size={14} className="text-success" />
          ) : row.tone === "current" ? (
            <StateIcon name="openCircle" size={14} className="text-brand-600" />
          ) : row.tone === "warning" ? (
            <StateIcon name="zap" size={14} className="text-amber-600" />
          ) : (
            <StateIcon name="clock" size={14} className="text-muted-foreground" />
          )}
          <span className="min-w-0 flex-1 truncate text-xs" title={row.title}>
            {row.title}
          </span>
          {row.stage ? (
            <span
              className="shrink-0 rounded-full border px-2 py-px text-[11px] text-muted-foreground"
              style={{ borderColor: "hsl(var(--border))" }}
            >
              {WORKFLOW_STAGE_LABELS[row.stage] ?? row.stage}
            </span>
          ) : null}
          <span className="shrink-0 text-[11px] text-muted-foreground">{shortTime(row.at)}</span>
        </div>
      ))}
    </div>
  );
}

export interface OverviewPanelProps {
  change: ChangeRead;
  workspaceId: string;
  changeId: string;
  archived: boolean;
  /** 统一时间线合并结果（由调用方注入；本面板只取尾部若干条并倒序）。 */
  recentRows: UnifiedRow[];
  /** 任务进度（tasks[] 勾选比；与「过程」tab 的任务清单同源）。 */
  taskSummary: { checked: number; total: number };
  /** 变更关联会话（listChangeSessions；信息栏显示最近 3 条）。 */
  sessions: AgentSessionListItem[];
  /** 待办卡透传（语义与分支全在 `ChangeStageActions` 内，本面板不做判断）。 */
  boundSession: AgentSessionListItem | null;
  gateComment: string;
  onGateCommentChange: (_v: string) => void;
  onGateAction: (_action: string) => void;
  transitioning: boolean;
  notifyResult: { notified_session: boolean; notify_error: string | null } | null;
}

export function ChangeOverviewPanel({
  change,
  workspaceId,
  changeId,
  archived,
  recentRows,
  taskSummary,
  sessions,
  boundSession,
  gateComment,
  onGateCommentChange,
  onGateAction,
  transitioning,
  notifyResult,
}: OverviewPanelProps) {
  // 资产统计（复用产出面板/信息栏同一 queryKey；零额外请求）。
  const assetsQ = useQuery({
    queryKey: ["changeAssets", workspaceId, changeId],
    queryFn: () => getChangeAssets(workspaceId, changeId),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const assets = assetsQ.data;
  // 用量（与信息栏/用量卡同一 hook 与 queryKey：零额外请求）。
  const usageQ = useChangeUsage("change", workspaceId, changeId);
  const usage = usageQ.data;
  const durationText =
    usage?.duration_ms == null
      ? "—"
      : `${formatDurationZh(usage.duration_ms)}${
          usage.started_at != null && usage.finished_at == null ? "（进行中）" : ""
        }`;

  const recent = [...recentRows].reverse().slice(0, RECENT_LIMIT);
  const lastSignal = lastSignalFromSteps(change.steps);

  const inflightItems = [
    {
      label: "当前阶段",
      value: change.current_stage
        ? (WORKFLOW_STAGE_LABELS[change.current_stage] ?? change.current_stage)
        : "—",
      tone: "brand" as const,
    },
    {
      label: "任务进度",
      value: taskSummary.total === 0 ? "—" : `${taskSummary.checked} / ${taskSummary.total}`,
    },
    {
      label: "已用时长",
      value: durationText,
    },
    {
      label: "最后信号",
      value: lastSignal ? shortTime(lastSignal) : "—",
    },
  ];

  const archivedItems = [
    { label: "需求规则", value: String(assets?.fr_entries?.length ?? 0), tone: "brand" as const },
    { label: "决策蒸馏", value: String(assets?.decisions?.length ?? 0) },
    { label: "改动文件", value: assets?.patch?.files != null ? String(assets.patch.files) : "—" },
    {
      label: "净增行",
      value: assets?.patch
        ? `+${assets.patch.additions ?? 0} / −${assets.patch.deletions ?? 0}`
        : "—",
    },
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_288px]" data-testid="change-overview-panel">
      <div className="flex flex-col gap-3">
        {archived ? null : (
          <ChangeStageActions
            change={change}
            boundSession={boundSession}
            gateComment={gateComment}
            onGateCommentChange={onGateCommentChange}
            onGateAction={onGateAction}
            transitioning={transitioning}
            notifyResult={notifyResult}
          />
        )}

        <section className="rounded-md border bg-card" data-testid="change-overview-summary">
          <div className="flex items-center justify-between gap-2 border-b px-3.5 py-2.5">
            <h2 className="text-xs font-medium">{archived ? "成果总结" : "变更摘要"}</h2>
            <span className="text-[11px] text-muted-foreground">
              {archived ? "已归档" : "非终态每 10 秒自动刷新"}
            </span>
          </div>
          <div className="px-3.5 py-3">
            <StatGrid items={archived ? archivedItems : inflightItems} />
          </div>
        </section>

        {archived ? (
          <section className="rounded-md border bg-card" data-testid="change-overview-ledger">
            <div className="flex items-center justify-between gap-2 border-b px-3.5 py-2.5">
              <h2 className="text-xs font-medium">归档留档</h2>
              <span className="text-[11px] text-muted-foreground">
                change.patch（收尾时点冻结）
              </span>
            </div>
            <div className="flex flex-col gap-1.5 px-3.5 py-3 text-xs">
              {assets?.patch ? (
                <span>
                  patch：<span className="font-mono">{assets.patch.files} 文件 +{assets.patch.additions ?? 0} / −{assets.patch.deletions ?? 0}</span>
                </span>
              ) : (
                <span className="text-muted-foreground">暂无 change.patch 记录。</span>
              )}
              {assets?.delta ? (
                <span className="text-muted-foreground">
                  delta：<span className="font-mono">Before {assets.delta.before_lines ?? "?"} 行 / Delta {assets.delta.delta_lines ?? "?"} 行</span>
                </span>
              ) : null}
              <span className="text-[11px] text-muted-foreground">
                改动文件清单与单文件 diff 见「产出 · 归档留档」。
              </span>
            </div>
          </section>
        ) : null}

        <section className="rounded-md border bg-card" data-testid="change-overview-recent">
          <div className="flex items-center justify-between gap-2 border-b px-3.5 py-2.5">
            <h2 className="text-xs font-medium">{archived ? "最终动态" : "最近动态"}</h2>
            <span className="text-[11px] text-muted-foreground">全量见「过程」</span>
          </div>
          <div className="px-3.5 py-1.5">
            {recent.length === 0 ? (
              <p className="py-3 text-center text-[11px] text-muted-foreground">暂无过程记录。</p>
            ) : (
              <RecentRows rows={recent} />
            )}
          </div>
        </section>

        {/* 最后信号（既有纯前端派生口径，FR-auto-frontend-012 承接）：无信号整行不渲染。 */}
        <ChangeLastSignal lastPushedAt={lastSignal} />
      </div>

      <ChangeOverviewSide
        change={change}
        workspaceId={workspaceId}
        changeId={changeId}
        archived={archived}
        sessions={sessions}
      />
    </div>
  );
}
