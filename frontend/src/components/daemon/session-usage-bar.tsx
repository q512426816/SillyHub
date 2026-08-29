"use client";

/**
 * SessionUsageBar —— 会话累计用量条（2026-08-29-session-usage-stats task-03）。
 *
 * 视觉基准：prototype-session-usage.html（摘要行「muted 标签 + 粗体数值」六项 +
 * 命中率 brand 阶强调 + 可折叠按模型明细表 + 口径脚注）。双模式同构复用
 * （D-001@v1）：page 会话详情页（头部下方）与 dialog 浮窗（输入框上方）两处
 * 渲染点接线归 task-04，本组件不感知模式差异。
 *
 * 自取数（design 衍生技术裁定 / R-04）：useEffect 调 lib/daemon.getSessionUsage
 * 存本地 state，不依赖 react-query——dialog 渲染路径是零 QueryClientProvider
 * 约定（session-panel 文件头明言），不能为其引入 Provider。刷新经 refreshSignal
 * prop：父层在轮次终态处理点递增该计数触发重取（数据本身轮次终态才落库）。
 *
 * 静默策略：首载 loading / 拉取失败均不渲染（用量条是辅助信息，不阻断会话主
 * 流程）；已有数据时刷新失败保持旧值。
 */

import { useEffect, useState } from "react";

import {
  getSessionUsage,
  type SessionUsageModelItem,
  type SessionUsageRead,
} from "@/lib/daemon";
import { cn } from "@/lib/utils";

/** 「未记录」兜底桶名（backend service 对 run.model NULL 的统一填充值）。 */
const UNRECORDED_MODEL = "未记录";

export interface SessionUsageBarProps {
  sessionId: string;
  /** 重取信号：父层每次递增触发一次重拉（挂轮次终态处理点）。 */
  refreshSignal?: number;
}

/**
 * cacheHitRate —— 缓存命中率单点实现（D-003@v1 口径，会话级与模型级同公式，
 * R-02 防双处漂移）：cache_read / (cache_read + input)。分母 <= 0（空会话 /
 * codex 无缓存）→ null，展示层显示「—」。
 */
function cacheHitRate(
  item: Pick<SessionUsageModelItem, "input_tokens" | "cache_read_tokens">,
): number | null {
  const denominator = item.cache_read_tokens + item.input_tokens;
  if (denominator <= 0) return null;
  return item.cache_read_tokens / denominator;
}

/** 命中率百分比（一位小数，对齐原型 97.7% / 96.8% 形态）；null →「—」。 */
function formatHitRate(rate: number | null): string {
  if (rate === null) return "—";
  return `${(rate * 100).toFixed(1)}%`;
}

/**
 * token 数中文紧凑格式化（仿 runtime-card-helpers formatTokens 的 helper 先例，
 * 改万级口径对齐原型「1.5 万 / 64.3 万 / 9,800 / 128」）：
 * >= 1 万 →「X.X 万」（一位小数）；万以下原数千分位（如 9,800）。
 */
function formatTokensZh(n: number): string {
  if (!Number.isFinite(n)) return "0";
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)} 万`;
  return n.toLocaleString("en-US");
}

/** 请求次数千分位（计数语义不做万缩写，对齐原型 128 / 102 / 0 直显）。 */
function formatCount(n: number): string {
  return Number.isFinite(n) ? n.toLocaleString("en-US") : "0";
}

/** 摘要行单项：muted 标签 + 粗体 tabular-nums 数值（命中率 brand 阶、无值灰）。 */
function UsageItem({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "brand" | "muted";
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
      <span className={cn("text-[13px] font-bold tabular-nums", valueColor)}>
        {value}
      </span>
    </span>
  );
}

export function SessionUsageBar({ sessionId, refreshSignal }: SessionUsageBarProps) {
  const [usage, setUsage] = useState<SessionUsageRead | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // 错误静默（catch 兜底）：用量条是辅助信息，拉取失败不渲染/保持旧值，
    // 不阻断会话主流程。卸载/依赖变更后 cancelled 置位，防 unmounted setState。
    getSessionUsage(sessionId)
      .then((data) => {
        if (!cancelled) setUsage(data);
      })
      .catch(() => {
        /* 静默 */
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, refreshSignal]);

  // 首载 loading / 出错（无数据）→ 整体不渲染。
  if (!usage) return null;

  const hit = cacheHitRate(usage.totals);
  const hasDetail = usage.by_model.length > 0;

  return (
    <div className="border-t border-slate-100 bg-card px-3.5 py-2.5">
      {/* ===== 摘要行：五指标 + 命中率（原型 .usage-summary） ===== */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
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

      {/* ===== 折叠明细表（原型 .usage-detail / table.models） ===== */}
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
                    {/* 「未记录」兜底桶 → 灰阶 ghost tag +「（旧轮次）」后缀；
                        正常模型 → brand 阶 tag（对齐 ProviderUsageTag 先例）。 */}
                    {row.model === UNRECORDED_MODEL ? (
                      <span className="inline-flex items-center rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">
                        未记录（旧轮次）
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
          {/* 口径脚注（原型 .usage-note）：命中率公式 + 兜底桶请求按 0 计 + 随轮次结束刷新 */}
          <p className="mt-1.5 text-[10px] leading-relaxed text-slate-400">
            口径：命中率 = 缓存读取 ÷（缓存读取 + 输入）；「未记录」为升级前无按模型明细的旧轮次，其四维
            token 并入上方汇总，请求次数无来源按 0 计。数据随每轮结束刷新。
          </p>
        </div>
      ) : null}
    </div>
  );
}
