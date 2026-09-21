"use client";

/**
 * ScanDocsStatsPanel — 扫描文档运营指标面板（task-03 /
 * 2026-09-21-scan-docs-ops-panel / FR-03 / FR-04 / FR-07 /
 * D-001@v1 / D-002@v1 / D-003@v1）。
 *
 * 依据：
 *   - design Wave 2 + 原型 prototype-scan-docs-ops-panel.html 的 .ops 布局
 *     （指标大卡 2/3 + 榜单卡 1/3）；视觉/结构复刻知识库 OpsDashboard
 *     （frontend/src/components/knowledge/ops-dashboard.tsx）形态。
 *   - 数据链：useQuery 消费 GET /scan-docs/stats（getScanDocsStats 封装，
 *     task-02 端点）——四指标（覆盖率+8 周趋势 / 陈旧 90 天 / 每项目密度 /
 *     近 30 天鲜活）+ 注入频次/最近更新双榜（D-003@v1 双 tab）。
 *   - 三态：加载 / 错误 / 空文档（freshness.total=0）均占住同版位不白屏；
 *     面板数据链独立，失败不影响页面主列表。
 *   - 路径显示剥前缀口径：stale_docs/recent_board 的 path 是 DB 原始形态
 *     （可能带 docs/ 或 .sillyspec/docs/ 前缀），展示时剥掉（stripPathPrefix
 *     与树构建同口径）；injection.board 后端已剥前缀直接显示。
 *   - 主题铁律：brand-* 语义阶（stroke 走 currentColor 随主题换色）、
 *     阴影/边框/文字全主题 token；中文文案。
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { cn } from "@/lib/utils";
import {
  getScanDocsStats,
  scanDocsStatsQueryKey,
  type ScanDocsStats,
} from "@/lib/scan-docs";
import { stripPathPrefix } from "@/lib/scan-docs-tree";

/** 空态口径：无文档（freshness.total=0）——没扫过或全部不存在。 */
function hasNoDocs(stats: ScanDocsStats): boolean {
  return stats.freshness.total === 0;
}

/** 覆盖率趋势迷你折线（照 ops-dashboard trendPoints）：viewBox 固定，8 点等距；
 * 知识库趋势是 0~1 的 pct，这里是周更新篇数（updated），按序列最大值归一到
 * 纵向区间（全零序列画底部平线）；stroke=currentColor 随主题。 */
const TREND_W = 112;
const TREND_H = 26;

function trendPoints(trend: ReadonlyArray<{ updated: number }>): string {
  const n = trend.length;
  if (n === 0) return "";
  const max = Math.max(...trend.map((t) => t.updated), 0);
  return trend
    .map((t, i) => {
      const x = n > 1 ? (i * (TREND_W - 2)) / (n - 1) : 0;
      const clamped = max > 0 ? Math.min(Math.max(t.updated / max, 0), 1) : 0;
      const y = TREND_H - 3 - clamped * (TREND_H - 6);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

/** 陈旧清单「最后修改」列：YYYY-MM-DD（本地时区）；空/非法 → 「未知」。 */
function staleDateText(iso: string | null | undefined): string {
  if (!iso) return "未知";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "未知";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 最近更新榜相对时间：<1 天按小时、天级按天、周级按周，更久落本地化日期。 */
function relativeTimeText(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "未知";
  const diffHours = Math.floor((Date.now() - d.getTime()) / 3_600_000);
  if (diffHours < 24) return `${Math.max(diffHours, 1)} 小时前`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays} 天前`;
  const diffWeeks = Math.floor(diffDays / 7);
  if (diffWeeks < 5) return `${diffWeeks} 周前`;
  return d.toLocaleDateString("zh-CN");
}

export interface ScanDocsStatsPanelProps {
  workspaceId: string;
  className?: string;
}

export function ScanDocsStatsPanel({
  workspaceId,
  className,
}: ScanDocsStatsPanelProps) {
  const statsQ = useQuery({
    queryKey: scanDocsStatsQueryKey(workspaceId),
    queryFn: () => getScanDocsStats(workspaceId),
  });
  // 陈旧清单开关（卡面点击开合，照 ops-dashboard 死条目卡形态）。
  const [staleOpen, setStaleOpen] = useState(false);
  // 榜单双 tab（D-003@v1）：注入频次默认 / 最近更新。
  const [boardTab, setBoardTab] = useState<"injection" | "recent">("injection");

  const rootCls = cn("flex flex-col gap-3 lg:grid lg:grid-cols-3", className);

  // ── 三态：加载 / 错误 / 空文档（均不白屏，占住同版位避免布局跳动）──────────
  if (statsQ.isPending) {
    return (
      <div data-testid="scan-docs-ops-panel" className={rootCls}>
        <div
          data-testid="scan-docs-ops-panel-loading"
          className="rounded-lg border border-border bg-card px-4 py-6 text-center text-xs text-muted-foreground shadow-sm lg:col-span-3"
        >
          运营指标加载中…
        </div>
      </div>
    );
  }
  if (statsQ.isError) {
    return (
      <div data-testid="scan-docs-ops-panel" className={rootCls}>
        <div
          data-testid="scan-docs-ops-panel-error"
          className="rounded-lg border border-destructive/30 bg-red-50 px-4 py-6 text-center text-xs text-destructive lg:col-span-3"
        >
          运营指标加载失败，请稍后刷新重试
        </div>
      </div>
    );
  }
  const stats = statsQ.data;
  if (stats && hasNoDocs(stats)) {
    return (
      <div data-testid="scan-docs-ops-panel" className={rootCls}>
        <div
          data-testid="scan-docs-ops-panel-empty"
          className="rounded-lg border border-border bg-card px-4 py-6 text-center text-xs text-muted-foreground shadow-sm lg:col-span-3"
        >
          暂无扫描文档（点击「重新扫描」从文件系统解析后展示运营指标）。
        </div>
      </div>
    );
  }
  if (!stats) return null;

  const { coverage, stale_docs, density, freshness, recent_board, injection } =
    stats;
  // 综合覆盖率（design 口径）：七件套 + 模块文档合并分子分母，取整百分比。
  const covHave = coverage.std_have + coverage.module_have;
  const covExpected = coverage.std_expected + coverage.module_expected;
  const coveragePct =
    covExpected > 0 ? Math.round((covHave / covExpected) * 100) : 0;
  const points = trendPoints(coverage.trend);

  return (
    <div data-testid="scan-docs-ops-panel" className={rootCls}>
      {/* ── 指标大卡（2/3）：四指标子卡 2×2 + 陈旧清单内嵌开合 ── */}
      <div className="rounded-lg border border-border bg-card p-3.5 shadow-sm lg:col-span-2">
        <div className="mb-2.5 flex items-baseline justify-between">
          <h3 className="text-sm font-bold">扫描文档运营指标</h3>
          <span className="text-[10.5px] text-muted-foreground">
            覆盖 · 鲜活 · 结构健康
          </span>
        </div>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {/* 覆盖率（大卡）：综合百分比 + 两档明细 + 迷你周趋势折线 */}
          <div
            data-testid="metric-coverage"
            className="rounded-md border border-border/60 p-2.5"
          >
            <div className="text-[11px] text-muted-foreground">
              标准文档覆盖率{" "}
              <span className="text-[10px] text-muted-foreground/70">
                实有 / 应有
              </span>
            </div>
            <div className="text-[22px] font-bold leading-7 text-brand-600">
              {coveragePct}%
              <span className="ml-1 text-[11px] font-normal text-muted-foreground">
                {covHave}/{covExpected} 项
              </span>
            </div>
            <div className="mt-0.5 text-[10.5px] text-muted-foreground">
              七件套 {coverage.std_have}/{coverage.std_expected} · 模块文档{" "}
              {coverage.module_have}/{coverage.module_expected}
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
            <div className="text-[10px] text-muted-foreground/70">
              近 8 周更新趋势
            </div>
          </div>

          {/* 陈旧卡：数字 + 点击开合内嵌清单（剥前缀路径 + 最后修改/未知） */}
          <button
            type="button"
            data-testid="metric-stale"
            onClick={() => setStaleOpen((v) => !v)}
            aria-expanded={staleOpen}
            className="rounded-md border border-border/60 p-2.5 text-left transition-colors hover:border-brand-400"
          >
            <div className="text-[11px] text-muted-foreground">
              陈旧文档{" "}
              <span className="text-[10px] text-muted-foreground/70">
                90 天未更新
              </span>
            </div>
            <div className="text-[22px] font-bold leading-7 text-warning">
              {stale_docs.length} 篇
            </div>
            <div className="text-[10.5px] text-muted-foreground/70">
              {staleOpen ? "收起清单 ↑" : "点开清单 → 补写 / 归档 / 重扫 ↓"}
            </div>
          </button>

          {/* 密度卡：篇/项目 + 口径 tooltip（原生 title，design 口径注记） */}
          <div
            data-testid="metric-density"
            className="rounded-md border border-border/60 p-2.5"
          >
            <div className="text-[11px] text-muted-foreground">
              每项目文档密度{" "}
              <span
                title="口径：exists 文档总数 ÷ 项目数（docs 树第一层目录）。过低=项目文档缺失 · 过高=单项目文档臃肿。"
                className="cursor-help text-[10px] text-muted-foreground/70 underline decoration-dotted"
              >
                口径 ⓘ
              </span>
            </div>
            <div className="text-[22px] font-bold leading-7">
              {density.per_project_avg.toFixed(1)}
              <span className="ml-1 text-[11px] font-normal text-muted-foreground">
                篇/项目
              </span>
            </div>
            <div className="text-[10.5px] text-muted-foreground/70">
              过低=项目文档缺失 · 过高=单项目文档臃肿
            </div>
          </div>

          {/* 鲜活卡：recent_updated/total（近 30 天更新占比的分子分母） */}
          <div
            data-testid="metric-freshness"
            className="rounded-md border border-border/60 p-2.5"
          >
            <div className="text-[11px] text-muted-foreground">
              近 30 天更新{" "}
              <span className="text-[10px] text-muted-foreground/70">
                鲜活度
              </span>
            </div>
            <div className="text-[22px] font-bold leading-7 text-success">
              {freshness.recent_updated}
              <span className="ml-1 text-[11px] font-normal text-muted-foreground">
                / {freshness.total} 篇
              </span>
            </div>
            <div className="text-[10.5px] text-muted-foreground/70">
              重扫后最新内容已入库
            </div>
          </div>
        </div>

        {/* 陈旧清单（开合态；max-h-44 滚动，上限 200 条后端已截） */}
        {staleOpen ? (
          <div
            data-testid="stale-docs-panel"
            className="mt-2.5 max-h-44 overflow-y-auto rounded-md border border-border/60 bg-muted/30 p-1.5"
          >
            {stale_docs.length === 0 ? (
              <p className="px-2 py-1.5 text-[11px] text-muted-foreground">
                没有陈旧文档——全部文档近 90 天内有更新。
              </p>
            ) : (
              stale_docs.map((d) => (
                <div
                  key={d.path}
                  data-testid="stale-doc-row"
                  className="flex items-center gap-2 border-b border-border/40 px-2 py-1 text-[11px] last:border-b-0"
                >
                  <span
                    className="min-w-0 flex-1 truncate font-mono text-brand-700"
                    title={d.path}
                  >
                    {stripPathPrefix(d.path)}
                  </span>
                  <span className="shrink-0 text-muted-foreground">
                    最后修改：{staleDateText(d.last_modified_at)}
                  </span>
                </div>
              ))
            )}
          </div>
        ) : null}
      </div>

      {/* ── 榜单卡（1/3）：注入频次（默认）/ 最近更新 双 tab（D-003@v1）── */}
      <div className="min-w-0 rounded-lg border border-border bg-card p-3.5 shadow-sm">
        <div
          role="tablist"
          aria-label="榜单视图"
          className="mb-2 flex gap-1"
        >
          <button
            type="button"
            role="tab"
            aria-selected={boardTab === "injection"}
            data-testid="board-tab-injection"
            onClick={() => setBoardTab("injection")}
            className={
              boardTab === "injection"
                ? "rounded-sm border border-brand-400 bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-600"
                : "rounded-sm border border-transparent px-3 py-1 text-xs text-muted-foreground hover:text-brand-600"
            }
          >
            🔥 注入频次
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={boardTab === "recent"}
            data-testid="board-tab-recent"
            onClick={() => setBoardTab("recent")}
            className={
              boardTab === "recent"
                ? "rounded-sm border border-brand-400 bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-600"
                : "rounded-sm border border-transparent px-3 py-1 text-xs text-muted-foreground hover:text-brand-600"
            }
          >
            🕘 最近更新
          </button>
        </div>

        {boardTab === "injection" ? (
          <>
            <p className="mb-1.5 text-[11px] text-muted-foreground">
              近 30 天 {injection.total_30d} 次 · {injection.docs_hit_30d} 篇
            </p>
            <div
              data-testid="injection-board"
              className="max-h-56 overflow-y-auto"
            >
              {injection.total_30d === 0 ? (
                <p className="px-1 py-2 text-[11px] text-muted-foreground">
                  暂无注入数据（CLI 升级后自动汇聚）
                </p>
              ) : (
                injection.board.map((item, i) => (
                  <div
                    key={item.path}
                    data-testid="injection-board-row"
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
                      className="min-w-0 flex-1 truncate font-mono"
                      title={item.path}
                    >
                      {item.path}
                    </span>
                    <span className="shrink-0 font-bold text-brand-700">
                      {item.hits_30d} 次
                    </span>
                  </div>
                ))
              )}
            </div>
          </>
        ) : (
          <div
            data-testid="recent-board"
            className="max-h-56 overflow-y-auto"
          >
            {recent_board.length === 0 ? (
              <p className="px-1 py-2 text-[11px] text-muted-foreground">
                暂无最近更新记录。
              </p>
            ) : (
              recent_board.map((item, i) => (
                <div
                  key={item.path}
                  data-testid="recent-board-row"
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
                    className="min-w-0 flex-1 truncate font-mono"
                    title={item.path}
                  >
                    {stripPathPrefix(item.path)}
                  </span>
                  <span className="shrink-0 text-muted-foreground">
                    {relativeTimeText(item.last_modified_at)}
                  </span>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
