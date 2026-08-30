"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { getChangeUsage, type ChangeUsageRead } from "@/lib/changes";
import { getQuicklogUsage } from "@/lib/quicklog";
import { cn } from "@/lib/utils";

/**
 * ChangeUsageCard —— 变更/快速修复执行用量卡（2026-08-30-change-center-usage-stats
 * task-07，FR-05 / D-007@v1）。
 *
 * 双 kind 复用（design 总体方案 Wave 3）：kind="change" 变更详情页
 * （ChangeStageHeader 下方）与 kind="quicklog" 快速修复抽屉底部（关联会话卡旁）
 * 两渲染点统一消费，接线归 task-09。
 *
 * 取数（D-007@v1）：react-query useQuery 自取数，对齐同渲染点
 * change-sessions-card / quicklog-sessions-card 先例（两渲染点均在
 * QueryClientProvider 内，不沿用 session-usage-bar 的 useEffect 模式——其规避的
 * 是会话浮窗零 react-query 约束，本卡无此约束）；queryKey 含
 * kind+workspaceId+refKey 三要素；不设 refetchInterval（不引入轮询——usage 为
 * run 终态落库数据，随详情页打开/抽屉打开刷新即可）。
 *
 * 视觉基准：prototype-change-center-usage.html 场景三/四（usage-bar 摘要行 +
 * 分模型折叠明细 + 口径注脚）；数字/命中率格式化对齐 session-usage-bar 私有
 * helper 口径（其 helper 未导出，抽公共库属另一变更范围——R-02 处理方式，
 * 此处私有复制 + 注释锚定，D-003@v1 同公式）。
 *
 * 边界态：取数失败/404（含抽屉开着条目被删的竞态）→「暂无用量数据」静默降级
 * 不弹错；无执行（三元组全 None + totals 全 0）→「尚无关联执行……」引导文案。
 */

/** 「未记录」兜底桶名（backend usage_service 对无明细 run 的统一填充值，恒末位）。 */
const UNRECORDED_MODEL = "未记录";

/** 口径注脚（usage-note 小字）：按 kind 分叉——change 声明并集去重/共享会话/
 * 软删会话/纯执行时长口径；quicklog 声明恒走关联会话链路（无派发锚点）。 */
const USAGE_NOTE_TEXT: Record<ChangeUsageCardProps["kind"], string> = {
  change:
    "统计平台派发执行与关联会话执行，按执行去重合并；会话服务多个变更时消耗在各变更分别显示；已删除会话的执行仍计入；耗时为纯执行时长累加",
  quicklog: "统计关联会话内全部执行（快速修复经会话绑定关联）",
};

export interface ChangeUsageCardProps {
  /** 渲染维度：change=变更详情页 / quicklog=快速修复抽屉（决定取数端点与注脚）。 */
  kind: "change" | "quicklog";
  workspaceId: string;
  /** 变更 id 或快速修复 qlId（按 kind 分派 getChangeUsage/getQuicklogUsage）。 */
  refKey: string;
}

/** 紧凑时间 MM-DD HH:mm（本地时区，同 session-list-layout formatTime 口径）。 */
function formatCompactTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${mm}-${dd} ${hh}:${mi}`;
}

/**
 * 耗时紧凑中文格式化（task-07 裁定，原型「3.6 小时 / 34 分钟」形态）：
 * >= 1 小时 →「X.X 小时」（小时一位小数）；1 分钟~1 小时 →「N 分钟」（取整分钟）；
 * < 1 分钟 →「N 秒」。进行中时照常显示已累计值（「进行中」标记另渲染）。
 */
function formatDurationZh(ms: number): string {
  if (!Number.isFinite(ms)) return "0 秒";
  if (ms < 60_000) return `${Math.max(0, Math.round(ms / 1_000))} 秒`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} 分钟`;
  return `${(ms / 3_600_000).toFixed(1)} 小时`;
}

/**
 * token 数中文紧凑格式化——私有复制自 session-usage-bar formatTokensZh（口径锚定，
 * 抽公共库属另一变更范围）：>= 1 万 →「X.X 万」（一位小数）；万以下千分位（如 6,204）。
 */
function formatTokensZh(n: number): string {
  if (!Number.isFinite(n)) return "0";
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)} 万`;
  return n.toLocaleString("en-US");
}

/** 请求次数/轮次千分位直显（计数语义不做万缩写，同 session-usage-bar formatCount）。 */
function formatCount(n: number): string {
  return Number.isFinite(n) ? n.toLocaleString("en-US") : "0";
}

/**
 * cacheHitRate —— 缓存命中率单点实现（D-003@v1 口径，与会话页 session-usage-bar
 * 同公式：cache_read / (cache_read + input)；汇总级与模型行级同式）。分母 <= 0
 * （无输入/无缓存读取）→ null，展示层显示「—」。
 */
function cacheHitRate(
  item: Pick<ChangeUsageRead["by_model"][number], "input_tokens" | "cache_read_tokens">,
): number | null {
  const denominator = item.cache_read_tokens + item.input_tokens;
  if (denominator <= 0) return null;
  return item.cache_read_tokens / denominator;
}

/** 命中率百分比（一位小数）；null →「—」。 */
function formatHitRate(rate: number | null): string {
  if (rate === null) return "—";
  return `${(rate * 100).toFixed(1)}%`;
}

/** 无执行判定：时间三元组全 None + totals 全 0（后端空集合聚合的诚实值形态）。 */
function hasNoExecution(usage: ChangeUsageRead): boolean {
  const t = usage.totals;
  return (
    usage.started_at == null &&
    usage.finished_at == null &&
    usage.duration_ms == null &&
    t.input_tokens === 0 &&
    t.output_tokens === 0 &&
    t.cache_read_tokens === 0 &&
    t.cache_creation_tokens === 0 &&
    t.api_requests === 0 &&
    t.num_turns === 0
  );
}

/** 摘要行单项：muted 标签 + tabular-nums 数值（时间项 font-medium、命中率 brand 阶、无值灰）。 */
function UsageItem({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "time" | "brand" | "muted";
}) {
  const valueColor =
    tone === "brand"
      ? "text-brand-700"
      : tone === "muted"
        ? "text-slate-400"
        : "text-slate-900";
  return (
    <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap">
      <span className="text-[11.5px] text-slate-500">{label}</span>
      <span
        className={cn(
          "text-[13px] tabular-nums",
          tone === "time" ? "font-medium" : "font-bold",
          valueColor,
        )}
      >
        {value}
      </span>
    </span>
  );
}

export function ChangeUsageCard({ kind, workspaceId, refKey }: ChangeUsageCardProps) {
  const [expanded, setExpanded] = useState(false);

  // D-007@v1：useQuery 自取数（queryKey 三要素 kind+workspaceId+refKey，结构对齐
  // change-sessions-card 先例 [域, 组件, 参数…]）；queryFn 按 kind 分派两 lib 封装
  // （task-06 契约）；失败态在渲染层静默降级，不抛给全局错误处理。
  const usageQ = useQuery({
    queryKey: ["changeUsage", "changeUsageCard", kind, workspaceId, refKey],
    queryFn: () =>
      kind === "change"
        ? getChangeUsage(workspaceId, refKey)
        : getQuicklogUsage(workspaceId, refKey),
  });

  // 加载骨架（简单一行占位）。
  if (usageQ.isPending) {
    return (
      <section className="rounded-md border bg-card px-3 py-2.5" data-testid="usage-card-loading">
        <div className="flex items-center gap-2">
          <span className="inline-block h-3 w-44 animate-pulse rounded-sm bg-muted" />
          <span className="text-[11px] text-muted-foreground">用量加载中…</span>
        </div>
      </section>
    );
  }

  // 失败/404（含抽屉开着条目被删的竞态）→ 静默边界态文案，不弹错（辅助信息卡）。
  if (usageQ.isError) {
    return (
      <section className="rounded-md border bg-card px-3 py-2.5" data-testid="usage-card-error">
        <h2 className="text-xs font-medium">执行用量</h2>
        <p className="mt-1 px-0.5 text-[11px] text-muted-foreground">暂无用量数据</p>
      </section>
    );
  }

  const usage = usageQ.data;

  // 无执行边界态：三元组全 None + totals 全 0 → 引导文案（不回退 created_at，D-001）。
  if (hasNoExecution(usage)) {
    return (
      <section className="rounded-md border bg-card px-3 py-2.5" data-testid="usage-card-empty">
        <h2 className="text-xs font-medium">执行用量</h2>
        <p className="mt-1 px-0.5 text-[11px] text-muted-foreground">
          尚无关联执行——派发执行或在会话中绑定后，这里会出现统计
        </p>
      </section>
    );
  }

  // 「进行中」标记（R-05）：started_at 有值且 finished_at 缺；耗时照显示已累计值。
  const inProgress = usage.started_at != null && usage.finished_at == null;
  const hit = cacheHitRate(usage.totals);
  const hasDetail = usage.by_model.length > 0;

  return (
    <section className="rounded-md border bg-card px-3 py-2.5" data-testid="change-usage-card">
      <h2 className="text-xs font-medium">执行用量</h2>

      {/* ===== 摘要行（原型 .usage-summary）：时间三元组 + 轮次 + 四维 token + 请求 + 命中率 ===== */}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
        <UsageItem
          label="开始"
          tone={usage.started_at == null ? "muted" : "time"}
          value={usage.started_at == null ? "—" : formatCompactTime(usage.started_at)}
        />
        <UsageItem
          label="结束"
          tone={usage.finished_at == null ? "muted" : "time"}
          value={usage.finished_at == null ? "—" : formatCompactTime(usage.finished_at)}
        />
        <UsageItem
          label="耗时"
          tone={usage.duration_ms == null ? "muted" : "time"}
          value={usage.duration_ms == null ? "—" : formatDurationZh(usage.duration_ms)}
        />
        {inProgress ? (
          <span className="inline-flex items-center rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
            进行中
          </span>
        ) : null}
        <UsageItem label="轮次" value={formatCount(usage.totals.num_turns)} />
        <UsageItem label="输入" value={formatTokensZh(usage.totals.input_tokens)} />
        <UsageItem label="输出" value={formatTokensZh(usage.totals.output_tokens)} />
        <UsageItem
          label="缓存读取"
          value={formatTokensZh(usage.totals.cache_read_tokens)}
        />
        <UsageItem
          label="缓存写入"
          value={formatTokensZh(usage.totals.cache_creation_tokens)}
        />
        <UsageItem label="请求次数" value={formatCount(usage.totals.api_requests)} />
        <UsageItem
          label="缓存命中率"
          value={formatHitRate(hit)}
          tone={hit === null ? "muted" : "brand"}
        />
        {/* 折叠切换（原型 .usage-toggle）：by_model 非空才渲染 */}
        {hasDetail ? (
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
            className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-brand-700 hover:bg-brand-50"
          >
            按模型明细
            <span
              aria-hidden="true"
              className={cn(
                "inline-block transition-transform",
                expanded && "rotate-180",
              )}
            >
              ▾
            </span>
          </button>
        ) : null}
      </div>

      {/* ===== 折叠明细表（原型 .usage-detail / table.models）：行级命中率同公式；
           排序（input+output 降序、「未记录」恒末位）由后端 usage_service 保证 ===== */}
      {hasDetail && expanded ? (
        <div className="mt-2">
          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr className="text-[10px] font-medium text-slate-400">
                <th className="border-b border-slate-200 px-1.5 py-1 text-left font-medium">
                  模型
                </th>
                <th className="border-b border-slate-200 px-1.5 py-1 text-right font-medium">
                  输入
                </th>
                <th className="border-b border-slate-200 px-1.5 py-1 text-right font-medium">
                  输出
                </th>
                <th className="border-b border-slate-200 px-1.5 py-1 text-right font-medium">
                  缓存读取
                </th>
                <th className="border-b border-slate-200 px-1.5 py-1 text-right font-medium">
                  缓存写入
                </th>
                <th className="border-b border-slate-200 px-1.5 py-1 text-right font-medium">
                  请求
                </th>
                <th className="border-b border-slate-200 px-1.5 py-1 text-right font-medium">
                  命中率
                </th>
              </tr>
            </thead>
            <tbody>
              {usage.by_model.map((row, idx) => (
                <tr
                  key={`${row.model}-${idx}`}
                  className="border-b border-slate-100 last:border-b-0"
                >
                  <td className="px-1.5 py-1">
                    {/* 「未记录」兜底桶 → 灰阶 tag（无按模型明细的旧执行归并）；
                        正常模型 → brand 阶 tag（对齐 session-usage-bar 先例）。 */}
                    {row.model === UNRECORDED_MODEL ? (
                      <span
                        title="无按模型明细的历史执行归并，请求次数无来源按 0 计"
                        className="inline-flex items-center rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-400"
                      >
                        {UNRECORDED_MODEL}
                      </span>
                    ) : (
                      <span
                        title={row.model}
                        className="inline-flex items-center rounded border border-brand-200 bg-brand-50 px-1.5 py-0.5 font-mono text-[10px] font-medium text-brand-700"
                      >
                        {row.model}
                      </span>
                    )}
                  </td>
                  <td className="px-1.5 py-1 text-right tabular-nums text-slate-700">
                    {formatTokensZh(row.input_tokens)}
                  </td>
                  <td className="px-1.5 py-1 text-right tabular-nums text-slate-700">
                    {formatTokensZh(row.output_tokens)}
                  </td>
                  <td className="px-1.5 py-1 text-right tabular-nums text-slate-700">
                    {formatTokensZh(row.cache_read_tokens)}
                  </td>
                  <td className="px-1.5 py-1 text-right tabular-nums text-slate-700">
                    {formatTokensZh(row.cache_creation_tokens)}
                  </td>
                  <td className="px-1.5 py-1 text-right tabular-nums text-slate-700">
                    {formatCount(row.api_requests)}
                  </td>
                  <td className="px-1.5 py-1 text-right tabular-nums text-slate-700">
                    {formatHitRate(cacheHitRate(row))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {/* 口径注脚（原型 .usage-note）：按 kind 分叉（R-03/R-07 共享会话与软删口径声明）。 */}
          <p className="mt-1.5 text-[10px] leading-relaxed text-slate-400">
            口径：{USAGE_NOTE_TEXT[kind]}。
          </p>
        </div>
      ) : null}
    </section>
  );
}
