"use client";

/**
 * OpsDashboard — 知识库运营仪表盘（task-04 / 2026-09-20-knowledge-effect-panel
 * / FR-02 / FR-03 / D-009 / D-008@v3）。
 *
 * 依据：
 *   - design Wave 2 + 原型 prototype-effect-panel.html 的 .panel-grid 布局
 *     （指标大卡 2/3 + 使用率榜 1/3）与四指标子卡形态；挂知识库页顶部
 *     （PageHeader 之下、任务条/树之上，page.tsx）。
 *   - 数据链：useQuery 消费 GET /knowledge/stats（getKnowledgeStats 封装，
 *     task-01 端点）——四指标（覆盖率+8 周迷你趋势 / 死条目 90 天 / 每任务
 *     命中密度 / 新知识生效速度）+ 使用率榜全量（次/任务归一，D-008@v3）。
 *   - 三态：加载 / 空态（未部署新 daemon 的端 hits 不上行，stats 返回零值
 *     指标 → 「暂无使用数据」，design 兼容策略）/ 错误（不白屏）。
 *   - 死条目卡点击展开内嵌清单（卡面「点开清单」）：锚点 + 最后命中时间
 *     （无命中「从未」）——清理/合并动作人工（design 非目标，仅清单引导）。
 *   - 主题铁律：brand-* 语义阶（stroke 走 currentColor 随主题换色）、
 *     阴影/边框/文字全主题 token；中文文案。
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { cn } from "@/lib/utils";
import { getKnowledgeStats, type KnowledgeStatsOut } from "@/lib/knowledge";

/**
 * stats 查询键（distillTasksQueryKey 同款「就地常量导出」惯例——后续条目
 * 卡片流（task-05）徽标复用同一查询或需要主动刷新时消费）。
 */
export function knowledgeStatsQueryKey(workspaceId: string) {
  return ["knowledge", "stats", workspaceId] as const;
}

/**
 * 使用率榜主数值 % 格式（D-008@v3）：per_task×100，小于 10% 两位小数
 * （3.25%），大于等于 10% 一位小数（25.4%）。排序键仍是原值 per_task
 * 降序（本函数仅展示格式）。
 */
export function formatPerTaskPct(perTask: number): string {
  const pct = perTask * 100;
  return `${pct < 10 ? pct.toFixed(2) : pct.toFixed(1)}%`;
}

/** 空态口径：零使用（覆盖率分子 0 且榜空）——未部署新 daemon 或沉淀未被用。 */
function hasNoUsage(stats: KnowledgeStatsOut): boolean {
  return stats.coverage.used_entries === 0 && stats.usage_board.length === 0;
}

/** 覆盖率趋势迷你折线（原型 .heat-card 内 svg polyline）：viewBox 固定，
 * 8 点等距、pct 夹 [0,1] 映射到纵向区间；stroke=currentColor 随主题。 */
const TREND_W = 112;
const TREND_H = 26;

function trendPoints(trend: ReadonlyArray<{ pct: number }>): string {
  const n = trend.length;
  if (n === 0) return "";
  return trend
    .map((p, i) => {
      const x = n > 1 ? (i * (TREND_W - 2)) / (n - 1) : 0;
      const clamped = Math.min(Math.max(p.pct, 0), 1);
      const y = TREND_H - 3 - clamped * (TREND_H - 6);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

/** 死条目最后命中时间（zh-CN 本地化）；无命中 → 「从未」。 */
function deadLastHitText(lastHitAt: string | null | undefined): string {
  if (!lastHitAt) return "从未";
  const d = new Date(lastHitAt);
  return Number.isNaN(d.getTime()) ? "从未" : d.toLocaleDateString("zh-CN");
}

export interface OpsDashboardProps {
  workspaceId: string;
  className?: string;
}

export function OpsDashboard({ workspaceId, className }: OpsDashboardProps) {
  const statsQ = useQuery({
    queryKey: knowledgeStatsQueryKey(workspaceId),
    queryFn: () => getKnowledgeStats(workspaceId),
  });
  // 死条目内嵌清单开关（卡面点击开合；抽屉形态的 jsdom 等价实现，见头注释）。
  const [deadOpen, setDeadOpen] = useState(false);

  const rootCls = cn("flex flex-col gap-3 lg:grid lg:grid-cols-3", className);

  // ── 三态：加载 / 错误 / 空态（均不白屏，占住同版位避免布局跳动）──────────
  if (statsQ.isPending) {
    return (
      <div data-testid="ops-dashboard-loading" className={rootCls}>
        <div className="rounded-lg border border-border bg-card px-4 py-6 text-center text-xs text-muted-foreground shadow-sm lg:col-span-3">
          运营指标加载中…
        </div>
      </div>
    );
  }
  if (statsQ.isError) {
    return (
      <div data-testid="ops-dashboard-error" className={rootCls}>
        <div className="rounded-lg border border-destructive/30 bg-red-50 px-4 py-6 text-center text-xs text-destructive lg:col-span-3">
          运营指标加载失败，请稍后刷新重试。
        </div>
      </div>
    );
  }
  const stats = statsQ.data;
  if (stats && hasNoUsage(stats)) {
    return (
      <div data-testid="ops-dashboard-empty" className={rootCls}>
        <div className="rounded-lg border border-border bg-card px-4 py-6 text-center text-xs text-muted-foreground shadow-sm lg:col-span-3">
          暂无使用数据（部署新 daemon 后自动汇聚各端命中遥测）。
        </div>
      </div>
    );
  }
  if (!stats) return null;

  const { coverage, dead_entries, density, freshness, usage_board } = stats;
  const coveragePct =
    coverage.total_entries > 0
      ? Math.round((coverage.used_entries / coverage.total_entries) * 100)
      : 0;
  // 榜排序（防御性重排：后端已按 per_task 降序，前端不信任传输序）。
  const board = [...usage_board].sort((a, b) => b.per_task - a.per_task);
  const points = trendPoints(coverage.trend);

  return (
    <div data-testid="ops-dashboard" className={rootCls}>
      {/* ── 指标大卡（2/3）：四指标子卡 2×2 + 死条目内嵌清单 ── */}
      <div className="rounded-lg border border-border bg-card p-3.5 shadow-sm lg:col-span-2">
        <div className="mb-2.5 flex items-baseline justify-between">
          <h3 className="text-sm font-bold">知识库运营指标</h3>
          <span className="text-[10.5px] text-muted-foreground">
            多端汇聚 · 剥离开发量
          </span>
        </div>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {/* 覆盖率（大卡）：百分比 + used/total + 迷你周趋势折线 */}
          <div
            data-testid="metric-coverage"
            className="rounded-md border border-border/60 p-2.5"
          >
            <div className="text-[11px] text-muted-foreground">
              知识覆盖率{" "}
              <span className="text-[10px] text-muted-foreground/70">
                被用过的/全部
              </span>
            </div>
            <div className="text-[22px] font-bold leading-7 text-brand-600">
              {coveragePct}%
              <span className="ml-1 text-[11px] font-normal text-muted-foreground">
                {coverage.used_entries}/{coverage.total_entries} 条
              </span>
            </div>
            <svg
              data-testid="coverage-trend"
              viewBox={`0 0 ${TREND_W} ${TREND_H}`}
              className="h-[26px] w-full text-brand-500"
              preserveAspectRatio="none"
              aria-hidden
            >
              {points ? (
                <polyline
                  points={points}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                />
              ) : null}
            </svg>
            <div className="text-[10px] text-muted-foreground/70">近 8 周趋势</div>
          </div>

          {/* 死条目卡：数字 + 点击开合内嵌清单（锚点 + 最后命中/从未） */}
          <button
            type="button"
            data-testid="metric-dead"
            onClick={() => setDeadOpen((v) => !v)}
            aria-expanded={deadOpen}
            className="rounded-md border border-border/60 p-2.5 text-left transition-colors hover:border-brand-400"
          >
            <div className="text-[11px] text-muted-foreground">
              死条目{" "}
              <span className="text-[10px] text-muted-foreground/70">
                90 天零命中
              </span>
            </div>
            <div className="text-[22px] font-bold leading-7 text-warning">
              {dead_entries.length} 条
            </div>
            <div className="text-[10.5px] text-muted-foreground/70">
              {deadOpen ? "收起清单 ↑" : "点开清单 → 清理/合并/降级 ↓"}
            </div>
          </button>

          {/* 密度卡：条/任务 + 口径 tooltip（title 原生提示，D-008@v3 口径注记） */}
          <div
            data-testid="metric-density"
            className="rounded-md border border-border/60 p-2.5"
          >
            <div className="text-[11px] text-muted-foreground">
              每任务命中密度{" "}
              <span
                title="口径：注入锚点总数 ÷ 去重任务数（任务=inject 行 change_name 去重）。零命中任务不进 hits，数值系统性偏高为口径固有。"
                className="cursor-help text-[10px] text-muted-foreground/70 underline decoration-dotted"
              >
                口径 ⓘ
              </span>
            </div>
            <div className="text-[22px] font-bold leading-7">
              {density.per_task_avg.toFixed(1)}
              <span className="ml-1 text-[11px] font-normal text-muted-foreground">
                条/任务
              </span>
            </div>
            <div className="text-[10.5px] text-muted-foreground/70">
              过低=沉淀没被检索到 · 过高=注入过肥
            </div>
          </div>

          {/* 生效速度卡：recent_used/recent_new（近 30 天新增中被用过） */}
          <div
            data-testid="metric-freshness"
            className="rounded-md border border-border/60 p-2.5"
          >
            <div className="text-[11px] text-muted-foreground">
              新知识生效{" "}
              <span className="text-[10px] text-muted-foreground/70">
                近 30 天新增
              </span>
            </div>
            <div className="text-[22px] font-bold leading-7 text-success">
              {freshness.recent_used}/{freshness.recent_new}
            </div>
            <div className="text-[10.5px] text-muted-foreground/70">
              新增条目已被使用——沉淀质量
            </div>
          </div>
        </div>

        {/* 死条目内嵌清单（开合态；全量滚动，锚点截断 + 最后命中时间/从未） */}
        {deadOpen ? (
          <div
            data-testid="dead-entries-panel"
            className="mt-2.5 max-h-44 overflow-y-auto rounded-md border border-border/60 bg-muted/30 p-1.5"
          >
            {dead_entries.length === 0 ? (
              <p className="px-2 py-1.5 text-[11px] text-muted-foreground">
                没有死条目——全部知识近 90 天内被命中过。
              </p>
            ) : (
              dead_entries.map((d) => (
                <div
                  key={d.anchor}
                  data-testid="dead-entry-row"
                  className="flex items-center gap-2 border-b border-border/40 px-2 py-1 text-[11px] last:border-b-0"
                >
                  <span
                    className="min-w-0 flex-1 truncate font-mono text-brand-700"
                    title={d.anchor}
                  >
                    {d.anchor}
                  </span>
                  <span className="shrink-0 text-muted-foreground">
                    最后命中：{deadLastHitText(d.last_hit_at)}
                  </span>
                </div>
              ))
            )}
          </div>
        ) : null}
      </div>

      {/* ── 使用率榜（1/3）：全量滚动，% 主数值 + 绝对次数副显 ── */}
      <div
        data-testid="usage-board"
        className="min-w-0 rounded-lg border border-border bg-card p-3.5 shadow-sm"
      >
        <h3 className="mb-2 text-sm font-bold">
          🔥 知识使用率榜{" "}
          <span className="text-[11px] font-normal text-muted-foreground">
            按每任务触发率排序 · 全量
          </span>
        </h3>
        <div className="max-h-56 overflow-y-auto">
          {board.length === 0 ? (
            <p className="px-1 py-2 text-[11px] text-muted-foreground">
              还没有任何条目被命中。
            </p>
          ) : (
            board.map((item, i) => (
              <div
                key={item.anchor}
                data-testid="usage-board-row"
                className="flex items-center gap-2 border-b border-border/40 py-1 text-xs last:border-b-0"
              >
                <span
                  className={cn(
                    "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[10.5px] font-bold",
                    i === 0
                      ? "bg-brand-600 text-white"
                      : "bg-brand-100 text-brand-700",
                  )}
                >
                  {i + 1}
                </span>
                <span
                  className="min-w-0 flex-1 truncate"
                  title={`${item.anchor} · 命中过 ${item.task_count} 个任务`}
                >
                  {item.anchor}
                </span>
                <span className="shrink-0 font-bold text-brand-700">
                  {formatPerTaskPct(item.per_task)}
                  <span className="ml-1 font-normal text-muted-foreground/70">
                    （{item.total} 次）
                  </span>
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
