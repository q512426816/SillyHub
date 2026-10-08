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
 *   - 图维度卡（2026-10-08-platform-knowledge-graph task-08 / FR-07 / D-004@v1）：
 *     「图·孤儿」「图·悬空」两子卡挂指标网格（既有四卡零改动）——overview 计数
 *     与图谱页同 key 共享缓存；点开清单懒加载 query 端点 items top-50，行点击
 *     深链 /knowledge/graph?preset=…；available=false 按 reason 六键文案分支，
 *     计数 null 渲染「—」（overview 子块独立容错，D-001@v2）。
 */

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { cn } from "@/lib/utils";
import {
  getKnowledgeGraphOverview,
  getKnowledgeGraphQuery,
  getKnowledgeStats,
  type GraphDanglingItem,
  type GraphOrphanItem,
  type GraphOverviewData,
  type GraphQueryOut,
  type KnowledgeStatsOut,
} from "@/lib/knowledge";
import {
  knowledgeGraphOverviewQueryKey,
  knowledgeGraphQueryKey,
} from "@/lib/query-keys";

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

/**
 * 知识图不可用文案（task-08 / D-001@v2 六稳定键分支）：unbound 绑定引导 /
 * offline·timeout 稍后再试 / upgrade_required 升级提示 / invalid_input 输入
 * 错误 / rpc_error 服务异常——HTTP 200 恒信封不弹错，卡位按 reason 呈引导。
 */
export function graphReasonText(reason: string | null | undefined): string {
  switch (reason) {
    case "unbound":
      return "未绑定 daemon 运行时——绑定后可查看知识图完整性";
    case "offline":
      return "daemon 离线，稍后再试";
    case "timeout":
      return "知识图查询超时，稍后再试";
    case "upgrade_required":
      return "daemon 或 sillyspec CLI 版本过旧，升级后可查看";
    case "invalid_input":
      return "查询参数有误";
    case "rpc_error":
      return "知识图服务异常，稍后再试";
    default:
      return "知识图暂不可用";
  }
}

/** 信封 data → 孤儿清单（运行时防御：旧后端/异常形状回退空数组）。 */
function asOrphanItems(data: GraphQueryOut["data"]): GraphOrphanItem[] {
  if (!data || !("items" in data) || !Array.isArray(data.items)) return [];
  return data.items as GraphOrphanItem[];
}

/** 信封 data → 悬空清单（运行时防御同上）。 */
function asDanglingItems(data: GraphQueryOut["data"]): GraphDanglingItem[] {
  if (!data || !("items" in data) || !Array.isArray(data.items)) return [];
  return data.items as GraphDanglingItem[];
}

/** 图维度子卡（task-08 / D-004@v1）：口径小注「知识图完整性」，主数值警示色；
 * 不可用态（加载/错误/available=false）降级为占位文案卡（版位占住不跳动）。 */
function GraphMetricCard({
  testId,
  label,
  count,
  open,
  onToggle,
  unavailableText,
}: {
  testId: string;
  label: string;
  count: number | null;
  open: boolean;
  onToggle: () => void;
  unavailableText: string | null;
}) {
  if (unavailableText != null) {
    return (
      <div
        data-testid={testId}
        className="rounded-md border border-border/60 p-2.5"
      >
        <div className="text-[11px] text-muted-foreground">
          {label}{" "}
          <span className="text-[10px] text-muted-foreground/70">
            知识图完整性
          </span>
        </div>
        <div className="mt-1 text-[11px] leading-5 text-muted-foreground">
          {unavailableText}
        </div>
      </div>
    );
  }
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onToggle}
      aria-expanded={open}
      className="rounded-md border border-border/60 p-2.5 text-left transition-colors hover:border-brand-400"
    >
      <div className="text-[11px] text-muted-foreground">
        {label}{" "}
        <span className="text-[10px] text-muted-foreground/70">
          知识图完整性
        </span>
      </div>
      <div className="text-[22px] font-bold leading-7 text-warning">
        {count == null ? "—" : `${count} 条`}
      </div>
      <div className="text-[10.5px] text-muted-foreground/70">
        {open ? "收起清单 ↑" : "点开清单 → 知识图谱 ↓"}
      </div>
    </button>
  );
}

/** 图维度清单面板：行=锚点+kind（悬空含缺失目标 title），点击深链图谱页对应
 * preset 查询；清单数据走 query 端点 items top-50（overview 只回计数）。 */
function GraphListPanel({
  workspaceId,
  preset,
  pending,
  error,
  reason,
  items,
}: {
  workspaceId: string;
  preset: "orphans" | "dangling";
  pending: boolean;
  error: boolean;
  reason: string | null;
  items: ReadonlyArray<{ id: string; kind: string; detail?: string }>;
}) {
  const href = `/workspaces/${workspaceId}/knowledge/graph?preset=${preset}`;
  return (
    <div
      data-testid={`graph-${preset}-panel`}
      className="mt-2.5 max-h-44 overflow-y-auto rounded-md border border-border/60 bg-muted/30 p-1.5"
    >
      {pending ? (
        <p className="px-2 py-1.5 text-[11px] text-muted-foreground">
          清单加载中…
        </p>
      ) : error ? (
        <p className="px-2 py-1.5 text-[11px] text-muted-foreground">
          清单加载失败，稍后再试。
        </p>
      ) : reason ? (
        <p className="px-2 py-1.5 text-[11px] text-muted-foreground">
          {reason}
        </p>
      ) : items.length === 0 ? (
        <p className="px-2 py-1.5 text-[11px] text-muted-foreground">
          {preset === "orphans"
            ? "没有孤儿节点——零度/无强边条目为空。"
            : "没有悬空引用——变更日志/文档引用全部可解析。"}
        </p>
      ) : (
        items.map((item) => (
          <Link
            key={`${item.id}:${item.kind}`}
            data-testid={`graph-${preset}-row`}
            href={href}
            title={item.detail || item.id}
            className="flex items-center gap-2 border-b border-border/40 px-2 py-1 text-[11px] last:border-b-0 hover:bg-brand-50/60"
          >
            <span
              className="min-w-0 flex-1 truncate font-mono text-brand-700"
              title={item.id}
            >
              {item.id}
            </span>
            <span className="shrink-0 text-muted-foreground/80">
              {item.kind}
            </span>
          </Link>
        ))
      )}
    </div>
  );
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
  // 失效命中（幽灵锚）清单开关（2026-09-25-knowledge-stats-layering）。
  const [orphanOpen, setOrphanOpen] = useState(false);
  // ── 知识图维度卡（task-08 / D-004@v1）：overview 计数与图谱页同 key 共享
  // 缓存（零额外请求）；清单点开才拉 query 端点 items top-50（懒加载）。
  const graphOverviewQ = useQuery({
    queryKey: knowledgeGraphOverviewQueryKey(workspaceId),
    queryFn: () => getKnowledgeGraphOverview(workspaceId),
  });
  const [graphOrphanOpen, setGraphOrphanOpen] = useState(false);
  const [graphDanglingOpen, setGraphDanglingOpen] = useState(false);
  const graphOrphansQ = useQuery({
    queryKey: knowledgeGraphQueryKey(workspaceId, "orphans"),
    queryFn: () => getKnowledgeGraphQuery(workspaceId, "orphans"),
    enabled: graphOrphanOpen,
  });
  const graphDanglingQ = useQuery({
    queryKey: knowledgeGraphQueryKey(workspaceId, "dangling"),
    queryFn: () => getKnowledgeGraphQuery(workspaceId, "dangling"),
    enabled: graphDanglingOpen,
  });

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
  // 运行时防御（评审 P2 收口）：旧后端过渡窗口可能不带新字段（TS 类型已生成但
  // 运行时缺省），?? 兜底避免 undefined.length / undefined 渲染崩溃。
  const orphan_anchors = stats.orphan_anchors ?? [];
  const coveragePct =
    coverage.total_entries > 0
      ? Math.round((coverage.used_entries / coverage.total_entries) * 100)
      : 0;
  // 可路由口径主数值（分母分层）：INDEX 路由可达条目为分母——unmapped/uncategorized
  // 等结构性不可路由桶不再系统性压低读数；routable=0（INDEX 空且非退化形态）回退全集。
  const routablePct =
    coverage.routable_entries > 0
      ? Math.round(
          (coverage.routable_used_entries / coverage.routable_entries) * 100,
        )
      : coveragePct;
  const dataUntilText = stats.data_until
    ? `数据截至 ${new Date(stats.data_until).toLocaleString("zh-CN")}`
    : "";
  // 榜排序（防御性重排：后端已按 per_task 降序，前端不信任传输序）。
  const board = [...usage_board].sort((a, b) => b.per_task - a.per_task);
  const points = trendPoints(coverage.trend);

  // ── 图维度三态派生（overview 信封，D-001@v2）：加载/错误/available=false →
  // 卡位文案分支（reason 六键）；available=true → 计数（子块失败 null → 「—」）。
  const graphUnavailableText = graphOverviewQ.isPending
    ? "知识图数据加载中…"
    : graphOverviewQ.isError
      ? "知识图数据暂不可用，稍后再试。"
      : !graphOverviewQ.data?.available
        ? graphReasonText(graphOverviewQ.data?.reason)
        : null;
  const graphOverviewData: GraphOverviewData | null =
    graphUnavailableText == null ? (graphOverviewQ.data?.data ?? null) : null;
  const graphOrphansCount = graphOverviewData?.orphans_count ?? null;
  const graphDanglingCount = graphOverviewData?.dangling_count ?? null;
  const orphanListReason =
    graphOrphansQ.data && !graphOrphansQ.data.available
      ? graphReasonText(graphOrphansQ.data.reason)
      : null;
  const danglingListReason =
    graphDanglingQ.data && !graphDanglingQ.data.available
      ? graphReasonText(graphDanglingQ.data.reason)
      : null;

  return (
    <div data-testid="ops-dashboard" className={rootCls}>
      {/* ── 指标大卡（2/3）：四指标子卡 2×2 + 死条目内嵌清单 ── */}
      <div className="rounded-lg border border-border bg-card p-3.5 shadow-sm lg:col-span-2">
        <div className="mb-2.5 flex items-baseline justify-between">
          <h3 className="text-sm font-bold">知识库运营指标</h3>
          <span className="text-[10.5px] text-muted-foreground">
            多端汇聚 · 剥离开发量{dataUntilText ? ` · ${dataUntilText}` : ""}
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
                被用过的/可路由
              </span>
            </div>
            <div className="text-[22px] font-bold leading-7 text-brand-600">
              {routablePct}%
              <span className="ml-1 text-[11px] font-normal text-muted-foreground">
                {coverage.routable_used_entries}/{coverage.routable_entries} 条
              </span>
            </div>
            <div className="text-[10px] text-muted-foreground/70">
              全集口径 {coveragePct}%（{coverage.used_entries}/
              {coverage.total_entries} 条，含不可路由桶）
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

          {/* 图·孤儿卡（task-08 / D-004@v1）：零度/无强边孤儿计数，清单深链图谱页 */}
          <GraphMetricCard
            testId="metric-graph-orphans"
            label="图·孤儿"
            count={graphOrphansCount}
            open={graphOrphanOpen}
            onToggle={() => setGraphOrphanOpen((v) => !v)}
            unavailableText={graphUnavailableText}
          />

          {/* 图·悬空卡：变更日志/文档引用缺失目标计数，清单深链图谱页 */}
          <GraphMetricCard
            testId="metric-graph-dangling"
            label="图·悬空"
            count={graphDanglingCount}
            open={graphDanglingOpen}
            onToggle={() => setGraphDanglingOpen((v) => !v)}
            unavailableText={graphUnavailableText}
          />
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

        {/* 失效命中（幽灵锚）单列（2026-09-25-knowledge-stats-layering）：历史命中
            但当前知识树无对应条目（知识面换代/标题漂移）——「没人用」与「对不上」
            是两类信号，与死条目/榜单分开呈现 */}
        {orphan_anchors.length > 0 ? (
          <>
            <button
              type="button"
              data-testid="orphan-toggle"
              onClick={() => setOrphanOpen((v) => !v)}
              aria-expanded={orphanOpen}
              className="mt-2 w-full rounded-md border border-border/60 px-2 py-1 text-left text-[10.5px] text-muted-foreground transition-colors hover:border-brand-400"
            >
              {orphanOpen
                ? `收起失效命中 ↑`
                : `失效命中 ${orphan_anchors.length} 个（历史命中但对不上当前条目）↓`}
            </button>
            {orphanOpen ? (
              <div
                data-testid="orphan-entries-panel"
                className="mt-1.5 max-h-36 overflow-y-auto rounded-md border border-border/60 bg-muted/30 p-1.5"
              >
                {orphan_anchors.map((o) => (
                  <div
                    key={o.anchor}
                    data-testid="orphan-entry-row"
                    className="flex items-center gap-2 border-b border-border/40 px-2 py-1 text-[11px] last:border-b-0"
                  >
                    <span
                      className="min-w-0 flex-1 truncate font-mono text-muted-foreground"
                      title={o.anchor}
                    >
                      {o.anchor}
                    </span>
                    <span className="shrink-0 text-muted-foreground/80">
                      {o.total} 次{o.last_hit ? ` · 最后 ${new Date(o.last_hit).toLocaleDateString("zh-CN")}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </>
        ) : null}

        {/* 图维度清单面板（task-08）：行=锚点+kind，点击深链图谱页对应 preset
            查询（与图谱页同 query key，切片数据共享缓存）；仅可用态展开 */}
        {graphOrphanOpen && graphUnavailableText == null ? (
          <GraphListPanel
            workspaceId={workspaceId}
            preset="orphans"
            pending={graphOrphansQ.isPending}
            error={graphOrphansQ.isError}
            reason={orphanListReason}
            items={asOrphanItems(graphOrphansQ.data?.data)}
          />
        ) : null}
        {graphDanglingOpen && graphUnavailableText == null ? (
          <GraphListPanel
            workspaceId={workspaceId}
            preset="dangling"
            pending={graphDanglingQ.isPending}
            error={graphDanglingQ.isError}
            reason={danglingListReason}
            items={asDanglingItems(graphDanglingQ.data?.data)}
          />
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
