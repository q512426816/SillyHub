"use client";

/**
 * 活跃变更总览卡片（2026-09-02-changes-overview-card task-06 / FR-01·FR-05·FR-06）。
 *
 * 依据：
 *   - tasks/task-06.md implementation / acceptance / constraints（信息架构与三态）
 *   - design.md §4（数据契约：sillyspec_status 摘要 + 32KB 超限计数降级）、§5 前端段
 *     （视觉基准 = 本变更 prototype-changes-overview.html v2）
 *   - 数据链路（FR-06 机器维度分组）：fetchMyBinding(workspaceId) 取绑定 daemon_id →
 *     listDaemonMachines 机器视图按 id 匹配 → machine.sillyspec_status
 *     （task-05 产物，api-types 生成版 MachineSillySpecStatusRead，null=CLI 能力缺失）。
 *
 * 只读监控卡（design §2 Non-Goals：清理 ghost / resolve 冲突仍走 CLI，卡片仅展示
 * 指引文案，无写操作按钮）。挂载归 task-07（工作台 SectionCard 网格）。
 *
 * 三态展示：
 *   - sillyspec_status 为 null/undefined → 「总览不可用（sillyspec 未安装/版本过低）」占位；
 *   - generated_at 陈旧（> STALE_THRESHOLD_MS，采集 60s×多轮未刷新的启发式）→
 *     「数据可能过期」琥珀标记（daemon 瞬态失败保留上次快照，design §5 三态矩阵③）；
 *   - 超限降级（changes 缺失但 active_changes>0，daemon 32KB 预算计数模式）→
 *     「列表过大，仅计数」，健康条计数仍有效。
 *
 * 相对时间复用 @/components/changes/change-activity-badge 的 parseIsoLikeMs/formatAge
 * （ISO 白名单防御解析 + 刚刚/x 分钟前/x 小时前/x 天前分档，不重复造轮子）。
 */
import { Fragment, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Tag } from "antd";

import { SectionCard } from "@/components/layout";
import {
  formatAge,
  parseIsoLikeMs,
} from "@/components/changes/change-activity-badge";
import type { components } from "@/lib/api-types";
import { listDaemonMachines } from "@/lib/daemon";
import { errMessage } from "@/lib/errors";
import { fetchMyBinding } from "@/lib/workspace-binding";
import { cn } from "@/lib/utils";

/** task-05 产物：机器视图 sillyspec_status 嵌套（api-types 生成版，禁止手写）。 */
type SillySpecStatus = components["schemas"]["MachineSillySpecStatusRead"];
/** changes[] 单项（宽松全 nullable，宁宽勿断）。 */
type SillySpecChange = components["schemas"]["DaemonHeartbeatSillySpecChange"];

/** 主管线 6 阶段（schema 另有 quick/explore 两键走旁路徽标，不进管线）。 */
const MAIN_STAGES = ["scan", "brainstorm", "plan", "execute", "verify", "archive"] as const;

/** quick/explore 旁路徽标（原型 .badge.quick；violet 固定信息色，同 PROVIDER_TONES 先例）。 */
const BYPASS_BADGES: Record<string, string> = {
  quick: "⚡ quick",
  explore: "🧭 explore",
};
const BYPASS_BADGE_CLASS =
  "rounded border border-violet-300 bg-violet-50 px-1.5 py-px text-[11px] font-medium whitespace-nowrap text-violet-700";

/**
 * generated_at 陈旧阈值：daemon 采集周期默认 60s + 心跳窗口，连续多轮未刷新即视为
 * 可能过期（瞬态失败保留旧快照的上报语义，design §5 三态矩阵③）。
 */
const STALE_THRESHOLD_MS = 5 * 60_000;

/** 机器列表轮询间隔（对齐 workspace-daemon-status 30s 心跳级 cadence）。 */
const MACHINES_POLL_MS = 30_000;

/** 缓存键（allowed_paths 只允许本文件，不进 query-keys.ts 工厂，就地常量）。 */
const QUERY_KEY_ROOT = ["changes-overview-card"] as const;

// ── 纯函数 helpers（模块级，无 React 依赖）──────────────────────────────────

/** ISO 原文 → 相对时间文案；null/畸形回退原文（同 change-activity-badge 空闲分支）。 */
function relativeAge(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = parseIsoLikeMs(iso);
  return t !== null ? formatAge(Date.now() - t) : iso;
}

/** last_active 排序键（epoch ms；null/畸形沉底）。 */
function lastActiveKey(c: SillySpecChange): number {
  if (!c.last_active) return Number.NEGATIVE_INFINITY;
  return parseIsoLikeMs(c.last_active) ?? Number.NEGATIVE_INFINITY;
}

/** steps 进度文案（"4/8"；缺失 → "—"）。 */
function stepsText(c: SillySpecChange): string {
  const completed = c.steps?.completed;
  const total = c.steps?.total;
  return completed != null && total != null ? `${completed}/${total}` : "—";
}

/** 冲突 type → 展示元数据（spec=紫 / 进度=琥珀，对齐原型 .cz-type；未知 type 原样中性展示）。 */
function conflictTypeMeta(type: string | null | undefined): {
  label: string;
  className: string;
} {
  switch (type) {
    case "spec-tree":
      return { label: "spec", className: "bg-violet-100 text-violet-700" };
    case "progress":
      return { label: "进度", className: "bg-warning/15 text-warning" };
    default:
      return { label: type || "—", className: "bg-muted text-muted-foreground" };
  }
}

// ── 子组件 ──────────────────────────────────────────────────────────────────

/** 健康条圆点计数项（绿=活跃 / 红=ghost·冲突，语义色走主题 token）。 */
function HealthDot({
  tone,
  children,
}: {
  tone: "success" | "error";
  children: React.ReactNode;
}) {
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap">
      <span
        aria-hidden
        className={cn("size-2 rounded-full", tone === "success" ? "bg-success" : "bg-error")}
      />
      {children}
    </span>
  );
}

/**
 * 6 点主管线（scan→archive）。current_stage 命中主管线 → 前序 done / 自身 cur /
 * 后续 todo；quick/explore/未知阶段不进管线（调用方改渲染旁路徽标，未知阶段全 todo）。
 * 每个点带 aria-label（"scan 已完成"等）供读屏与测试断言真实可访问语义。
 */
function StagePipeline({ currentStage }: { currentStage: string | null }) {
  const curIdx = (MAIN_STAGES as readonly string[]).indexOf(currentStage ?? "");
  return (
    <div className="flex min-w-56 flex-1 items-start" aria-label="阶段管线">
      {MAIN_STAGES.map((stage, i) => {
        const state = i < curIdx ? "done" : i === curIdx ? "cur" : "todo";
        return (
          <Fragment key={stage}>
            {i > 0 && (
              <span
                aria-hidden
                className={cn(
                  "mt-1 h-0.5 min-w-2 flex-1",
                  i <= curIdx ? "bg-brand-600" : "bg-border",
                )}
              />
            )}
            <span className="flex shrink-0 flex-col items-center gap-1">
              <span
                role="img"
                aria-label={`${stage} ${state === "done" ? "已完成" : state === "cur" ? "进行中" : "待办"}`}
                className={cn(
                  "size-2.5 rounded-full border-2",
                  state === "done" && "border-brand-600 bg-brand-600",
                  state === "cur" && "border-brand-600 bg-transparent",
                  state === "todo" && "border-border bg-transparent",
                )}
              />
              <span
                className={cn(
                  "whitespace-nowrap text-[10px] text-muted-foreground",
                  state === "cur" && "font-semibold text-brand-600",
                )}
              >
                {stage}
              </span>
            </span>
          </Fragment>
        );
      })}
    </div>
  );
}

/** steps 进度条（role=progressbar 原生 ARIA，brand 语义阶填充）。 */
function StepsBar({
  completed,
  total,
  label,
}: {
  completed: number;
  total: number;
  label: string;
}) {
  const pct = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;
  return (
    <div
      role="progressbar"
      aria-label={`步骤进度 ${label}`}
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      className="h-1.5 w-28 max-w-56 shrink-0 overflow-hidden rounded-full bg-border"
    >
      <div className="h-full rounded-full bg-brand-600" style={{ width: `${pct}%` }} />
    </div>
  );
}

/**
 * 活跃（非 ghost）变更行：名称 mono + stage 徽标（antd Tag，色经 ConfigProvider
 * token 不手写）+ 主管线/旁路徽标 + steps 进度 + last_active 相对时间。
 */
function ActiveChangeRow({ change }: { change: SillySpecChange }) {
  const stage = change.current_stage ?? null;
  const isBypass = stage === "quick" || stage === "explore";
  const stageLabel = change.stage_label?.trim() || stage || "—";
  const completed = change.steps?.completed ?? null;
  const total = change.steps?.total ?? null;
  return (
    <li className="border-b px-4 py-3 transition-colors hover:bg-muted/50">
      <div className="flex flex-wrap items-center gap-2">
        <span className="break-all font-mono text-[13px] font-semibold">
          {change.name || "—"}
        </span>
        <Tag color="processing" className="m-0">
          {stageLabel}
        </Tag>
        <span className="flex-1" />
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          步骤 {stepsText(change)}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
        {isBypass && stage ? (
          <span className={BYPASS_BADGE_CLASS}>{BYPASS_BADGES[stage] ?? stage}</span>
        ) : (
          <StagePipeline currentStage={stage} />
        )}
        {completed != null && total != null && total > 0 && (
          <StepsBar completed={completed} total={total} label={change.name ?? ""} />
        )}
        <span className="ml-auto whitespace-nowrap text-xs text-muted-foreground">
          最近活跃 {relativeAge(change.last_active)}
        </span>
      </div>
    </li>
  );
}

/** ghost 残留行（折叠组展开后）：旁路徽标 + ghost 徽标 + stage + steps + 最近活跃。 */
function GhostRow({ change }: { change: SillySpecChange }) {
  const stage = change.current_stage ?? null;
  const bypassLabel =
    stage === "quick" || stage === "explore" ? (BYPASS_BADGES[stage] ?? null) : null;
  const stageLabel = change.stage_label?.trim() || stage || "—";
  return (
    <li className="border-t px-4 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="break-all font-mono text-[12px]">{change.name || "—"}</span>
        {bypassLabel !== null && <span className={BYPASS_BADGE_CLASS}>{bypassLabel}</span>}
        <span className="rounded border border-error/40 bg-error/10 px-1.5 py-px text-[11px] font-medium whitespace-nowrap text-error">
          ghost
        </span>
        <Tag className="m-0">{stageLabel}</Tag>
        <span className="flex-1" />
        <span className="text-xs text-muted-foreground">{stepsText(change)}</span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        最近活跃 {relativeAge(change.last_active)}
      </p>
    </li>
  );
}

// ── 主组件 ──────────────────────────────────────────────────────────────────

export interface ChangesOverviewCardProps {
  /** 工作区 id（FR-06：经 my-binding 的 daemon_id 定位机器，选 sillyspec_status 数据源）。 */
  workspaceId: string;
  className?: string;
}

/**
 * 「活跃变更总览」SectionCard（只读监控）：卡头健康条 → 全部/需关注过滤 tab →
 * 变更行管线 → ghost 折叠组 → 未决冲突区 → 卡尾排序说明。
 */
export function ChangesOverviewCard({ workspaceId, className }: ChangesOverviewCardProps) {
  const [filterTab, setFilterTab] = useState<"all" | "attention">("all");
  const [ghostExpanded, setGhostExpanded] = useState(false);

  // FR-06 数据源定位链：my-binding.daemon_id → machines.id 匹配。
  // fetchMyBinding 内部 catch → null（不抛错）；binding 变化随 queryKey 重查。
  const bindingQ = useQuery({
    queryKey: [...QUERY_KEY_ROOT, "binding", workspaceId],
    queryFn: () => fetchMyBinding(workspaceId),
  });
  const daemonId = bindingQ.data?.daemon_id ?? null;

  const machinesQ = useQuery({
    queryKey: [...QUERY_KEY_ROOT, "machines"],
    queryFn: () => listDaemonMachines({ limit: 100 }),
    enabled: daemonId !== null,
    refetchInterval: MACHINES_POLL_MS,
  });

  const machine =
    daemonId !== null
      ? (machinesQ.data?.items.find((m) => m.id === daemonId) ?? null)
      : null;
  const status: SillySpecStatus | null = machine?.sillyspec_status ?? null;

  // 占位/降级三态判定（优先级：加载 → 错误 → 未绑定 → 机器缺失 → 总览不可用）。
  let placeholder: string | null = null;
  if (bindingQ.isPending || (daemonId !== null && machinesQ.isPending)) {
    placeholder = "加载中…";
  } else if (machinesQ.isError) {
    placeholder = `读取机器数据失败：${errMessage(machinesQ.error, "请稍后重试")}`;
  } else if (daemonId === null) {
    placeholder = "该工作区未绑定守护进程机器，无法读取总览";
  } else if (machine === null) {
    placeholder = "绑定的守护进程机器不在列表中（可能已离线），无法读取总览";
  } else if (status === null) {
    placeholder = "总览不可用（sillyspec 未安装/版本过低）";
  }

  // 超限降级（design §4：32KB 预算计数模式——changes 缺失但计数在）。
  const degraded =
    status !== null && status.changes == null && (status.active_changes ?? 0) > 0;

  const changes = status?.changes ?? [];
  const ghosts = changes.filter((c) => c.ghost === true);
  const actives = changes.filter((c) => c.ghost !== true);
  const ghostsSorted = [...ghosts].sort((a, b) => lastActiveKey(b) - lastActiveKey(a));

  const conflicts = status?.pending_conflicts ?? [];
  const conflictNames = new Set(
    conflicts.map((c) => c.change).filter((n): n is string => !!n),
  );
  // 需关注 = ghost ∪ 冲突关联 change（按名并集，原型口径：17 ghost + 11 冲突 = 28）。
  const attentionNames = new Set<string>([
    ...ghosts.map((g) => g.name).filter((n): n is string => !!n),
    ...conflictNames,
  ]);

  // 健康条计数（envelope 计数字段优先，列表兜底——截断/降级时列表不全）。
  const activeCount = status?.healthy_count ?? actives.length;
  const ghostCount = status?.ghost_count ?? ghosts.length;
  const conflictCount = status?.conflict_count ?? conflicts.length;
  const totalCount = status?.active_changes ?? changes.length;

  const generatedMs = status?.generated_at ? parseIsoLikeMs(status.generated_at) : null;
  const stale = generatedMs !== null && Date.now() - generatedMs > STALE_THRESHOLD_MS;

  // 冲突区 type 汇总（"spec ×2 · 进度 ×9"，按展示标签聚合）。
  const typeCounts = new Map<string, number>();
  for (const c of conflicts) {
    const label = conflictTypeMeta(c.type).label;
    typeCounts.set(label, (typeCounts.get(label) ?? 0) + 1);
  }
  const typeSummary = [...typeCounts.entries()]
    .map(([label, n]) => `${label} ×${n}`)
    .join(" · ");

  // 过滤 tab 作用域：仅过滤活跃变更行（ghost 组与冲突区两 tab 均展示——本就是关注焦点）。
  const visibleActives =
    filterTab === "all"
      ? [...actives].sort((a, b) => lastActiveKey(b) - lastActiveKey(a))
      : [...actives]
          .filter((c) => c.name != null && conflictNames.has(c.name))
          .sort((a, b) => lastActiveKey(b) - lastActiveKey(a));

  return (
    <SectionCard title="活跃变更总览" bodyPadding="p-0" className={className}>
      {placeholder !== null ? (
        <p
          className="px-4 py-8 text-center text-xs text-muted-foreground"
          data-testid="changes-overview-placeholder"
        >
          {placeholder}
        </p>
      ) : (
        <>
          {/* 卡头健康条（含降级模式——计数仍有效） */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b px-4 py-2.5 text-xs text-muted-foreground">
            <HealthDot tone="success">活跃 {activeCount}</HealthDot>
            <HealthDot tone="error">残留 (ghost) {ghostCount}</HealthDot>
            <HealthDot tone="error">未决冲突 {conflictCount}</HealthDot>
            <span className="whitespace-nowrap" title={status?.generated_at ?? undefined}>
              更新于 {generatedMs !== null ? formatAge(Date.now() - generatedMs) : "—"}
            </span>
            {stale && (
              <span className="rounded border border-warning/30 bg-warning/10 px-1.5 py-0.5 text-[11px] text-warning">
                数据可能过期
              </span>
            )}
            <span className="ml-auto whitespace-nowrap rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px]">
              ok={status?.ok == null ? "—" : String(status.ok)} · warnings=
              {status?.warnings_count ?? "—"} · errors={status?.errors_count ?? "—"}
            </span>
          </div>

          {degraded ? (
            /* 超限降级：仅计数（健康条仍有效），不渲染明细列表 */
            <div className="px-4 py-6 text-center text-xs text-muted-foreground">
              <p>列表过大，仅计数</p>
              <p className="mt-1">
                变更明细因心跳载荷预算降级未上报，仅健康计数可用
              </p>
            </div>
          ) : (
            <>
              {/* 过滤 tab（带计数；原型 .tabs） */}
              <div className="flex gap-1 px-4 pt-2">
                {(
                  [
                    { key: "all", label: "全部", count: totalCount },
                    { key: "attention", label: "需关注", count: attentionNames.size },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    aria-pressed={filterTab === t.key}
                    onClick={() => setFilterTab(t.key)}
                    className={cn(
                      "rounded-t border-x border-t px-3 py-1 text-xs",
                      filterTab === t.key
                        ? "border-border bg-muted font-semibold text-brand-700"
                        : "border-transparent text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {t.label} <span className="text-[11px]">{t.count}</span>
                  </button>
                ))}
              </div>

              {/* 活跃变更行（last_active 倒序） */}
              {visibleActives.length === 0 ? (
                <p className="border-b px-4 py-3 text-xs text-muted-foreground">
                  {filterTab === "all" ? "暂无活跃变更" : "暂无需要关注的活跃变更"}
                </p>
              ) : (
                <ul>
                  {visibleActives.map((c) => (
                    <ActiveChangeRow key={c.name ?? Math.random()} change={c} />
                  ))}
                </ul>
              )}

              {/* ghost 折叠组（默认折一行：计数 + 清理指引 code；展开逐行） */}
              {ghosts.length > 0 && (
                <div className="border-b">
                  <button
                    type="button"
                    aria-expanded={ghostExpanded}
                    onClick={() => setGhostExpanded((v) => !v)}
                    className="flex w-full flex-wrap items-center gap-1.5 px-4 py-2 text-left text-xs text-muted-foreground hover:text-brand-600"
                  >
                    <span aria-hidden>{ghostExpanded ? "▾" : "▸"}</span>
                    <span className="font-semibold text-error">
                      残留记录 (ghost) {ghosts.length} 个
                    </span>
                    <span>—— 目录已不存在 · 步骤长期停滞 · 建议清理</span>
                    <code className="rounded border bg-muted px-1 py-px font-mono text-[11px]">
                      sillyspec doctor --cleanup-ghosts --confirm
                    </code>
                    <span className="text-brand-600">
                      {ghostExpanded ? "收起" : "展开查看"}
                    </span>
                  </button>
                  {ghostExpanded && (
                    <ul>
                      {ghostsSorted.map((c) => (
                        <GhostRow key={c.name ?? Math.random()} change={c} />
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {/* 未决冲突区（双列网格 + resolve 指引，仅展示不写操作） */}
              {conflicts.length > 0 && (
                <div className="border-b bg-muted px-4 py-3">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span className="text-[13px] font-semibold text-error">
                      未决同步冲突 ({conflicts.length})
                    </span>
                    <span className="text-xs text-muted-foreground">
                      —— <span>{typeSummary}</span> → 处理{" "}
                      <code className="rounded border bg-card px-1 font-mono text-[11px]">
                        sillyspec platform resolve
                      </code>
                    </span>
                  </div>
                  <div className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
                    {conflicts.map((c, i) => {
                      const meta = conflictTypeMeta(c.type);
                      return (
                        <div
                          key={`${c.type ?? "?"}-${c.change ?? "?"}-${i}`}
                          className="flex min-w-0 items-center gap-1.5"
                        >
                          <span
                            className={cn(
                              "shrink-0 rounded px-1 text-[10px] leading-4",
                              meta.className,
                            )}
                          >
                            {meta.label}
                          </span>
                          <code
                            className="truncate font-mono text-[11px] text-foreground"
                            title={c.change ?? undefined}
                          >
                            {c.change || "—"}
                          </code>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}

          {/* 卡尾：排序说明 + 数据源机器（FR-06 机器维度可追溯） */}
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-[11px] text-muted-foreground">
            <span>排序：last_active 倒序 · active_changes={totalCount}</span>
            <span>数据源机器：{machine?.hostname || daemonId}</span>
          </div>
        </>
      )}
    </SectionCard>
  );
}
