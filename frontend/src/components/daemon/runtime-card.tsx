/**
 * RuntimeCard —— 单个智能体运行时卡片。
 *
 * 2026-07-07-daemon-machine-runtime-hierarchy：视觉 1:1 对齐
 * prototype-machine-runtime.html 方案 A 的 .rt-card
 *（rh 一行 + rt-meta 3 列 + rt-usage + 运行能力区 + rt-roots + rt-actions）。
 *
 * 决策 B：主结构对齐 prototype，但保留「运行能力」区（agents 列表，选 agent 时有用）。
 * C-002：不渲染 Daemon 版本行（daemon_version/build_id 上提机器头 task-08）。
 * 保留全部 props/回调，仅视觉重写。
 */
import {
  Ban,
  MessageSquare,
  Power,
  RefreshCw,
  Trash2,
} from "lucide-react";

import { RuntimeUsageLineChart } from "@/components/charts"; // 桶导出(dynamic ssr:false)
import Link from "next/link";
import {
  type DaemonRuntimeRead,
  type DaemonVersionInfo,
  type RuntimeUsageItem,
  type RuntimeUsageWindow,
} from "@/lib/daemon";
import { cn } from "@/lib/utils";

import {
  AgentsList,
  buildSparkSeries,
  formatCache,
  formatCost,
  formatTokens,
  getCapabilityChips,
  getDisplayVersion,
  getProtocol,
  getStatusMeta,
  ProviderBadge,
  UsageStat,
  VersionCell,
} from "./runtime-card-helpers";

// page 持有 WINDOW_LABELS；此处复声明类型契约，渲染用量统计区标题需要。
const WINDOW_LABELS: Record<RuntimeUsageWindow, string> = {
  "1d": "当日",
  "7d": "7 天",
  "30d": "30 天",
};

export type RuntimeCardProps = {
  runtime: DaemonRuntimeRead;
  actioning: boolean;
  sessionStats: { total: number; active: number };
  usage?: RuntimeUsageItem;
  usageWindow: RuntimeUsageWindow;
  usageLoading?: boolean;
  latestVersion?: DaemonVersionInfo;
  upgrading?: boolean;
  onToggleEnabled: (runtime: DaemonRuntimeRead) => Promise<void>;
  onOpenSession: (runtime: DaemonRuntimeRead) => void;
  onDelete: (runtime: DaemonRuntimeRead) => void;
  onEditAlias: (runtime: DaemonRuntimeRead) => void;
  onEditAllowedRoots: (runtime: DaemonRuntimeRead) => void;
  onUpgrade: (runtime: DaemonRuntimeRead) => void;
  isPlatformAdmin: boolean;
};

export function RuntimeCard({
  runtime,
  actioning,
  sessionStats,
  usage,
  usageWindow,
  usageLoading,
  upgrading,
  onToggleEnabled,
  onOpenSession,
  onDelete,
  onEditAlias,
  onEditAllowedRoots,
  onUpgrade,
  isPlatformAdmin,
}: RuntimeCardProps) {
  const status = getStatusMeta(runtime.status);
  const capabilityChips = getCapabilityChips(runtime);
  const displayVersion = getDisplayVersion(runtime);
  const protocol = getProtocol(runtime);
  const isDisabled = runtime.status === "disabled";
  const ActionIcon = isDisabled ? Power : Ban;
  const canOpenSession =
    runtime.status === "online" &&
    (runtime.provider === "claude" || runtime.provider === "codex");

  const summary = usage?.summary;
  const inputLabel = summary ? formatTokens(summary.input_tokens) : "—";
  const outputLabel = summary ? formatTokens(summary.output_tokens) : "—";
  const cacheLabel = formatCache(usage);
  const costLabel = summary ? formatCost(summary.total_cost_usd) : "$0.00";
  const hasUsage = !!summary;

  // prototype .btn 系列 className（btn-ghost btn-tiny / btn-primary btn-tiny / btn-danger btn-tiny）。
  const btnGhost =
    "inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-[11.5px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:hover:bg-white";
  const btnDanger =
    "inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-[11.5px] font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50 disabled:hover:bg-white";
  const btnPrimary =
    "inline-flex items-center gap-1 rounded bg-blue-600 px-2 py-1 text-[11.5px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50 disabled:hover:bg-blue-600";

  const roots = runtime.allowed_roots ?? [];

  return (
    <article className="overflow-hidden rounded-md border border-slate-200 bg-white">
      {/* ===== rh：provider 徽章 + 状态徽章 + runtime 名（右对齐 mono）===== */}
      <header className="flex items-center gap-2 border-b border-slate-100 px-3 py-2.5">
        <ProviderBadge provider={runtime.provider} />
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] font-semibold",
            status.badgeClass,
          )}
        >
          <span className={cn("h-1.5 w-1.5 rounded-full", status.dot)} />
          {status.label}
        </span>
        <span className="ml-auto truncate font-mono text-[13px] font-bold text-slate-900">
          {runtime.display_alias ?? runtime.name ?? "未命名运行时"}
        </span>
      </header>

      {/* ===== rt-meta：版本 / 会话 / 协议（3 列，对齐 prototype） ===== */}
      <div className="grid grid-cols-3 gap-2 px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-[9.5px] font-semibold uppercase tracking-wide text-slate-400">版本</p>
          <div className="mt-0.5 text-[11.5px] font-semibold text-slate-700">
            {displayVersion ? (
              <VersionCell provider={runtime.provider} version={displayVersion} />
            ) : (
              <span className="text-slate-400">待识别</span>
            )}
          </div>
        </div>
        <div className="min-w-0">
          <p className="text-[9.5px] font-semibold uppercase tracking-wide text-slate-400">会话</p>
          <p className="mt-0.5 text-[11.5px] font-semibold text-slate-700">
            {sessionStats.total}
            {sessionStats.active > 0 ? (
              <span className="text-emerald-600">（{sessionStats.active} 活跃）</span>
            ) : null}
          </p>
        </div>
        <div className="min-w-0">
          <p className="text-[9.5px] font-semibold uppercase tracking-wide text-slate-400">协议</p>
          <p className="mt-0.5 truncate font-mono text-[11.5px] font-semibold text-slate-700">
            {protocol}
          </p>
        </div>
      </div>

      {/* ===== rt-usage：用量统计区（4 数字 + sparkline） ===== */}
      <div className="border-t border-slate-100 bg-slate-50 px-3 py-2.5">
        <div className="mb-1.5 flex items-center justify-between">
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
            用量统计（{WINDOW_LABELS[usageWindow]}）
          </p>
          <span className="text-[9.5px] text-slate-400">
            {usageLoading ? "加载中" : hasUsage ? (runtime.provider ?? "") : "暂无数据"}
          </span>
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          <UsageStat label="输入" value={inputLabel} tone={hasUsage ? "default" : "muted"} />
          <UsageStat label="输出" value={outputLabel} tone={hasUsage ? "default" : "muted"} />
          <UsageStat label="缓存" value={cacheLabel} tone={cacheLabel === "—" ? "muted" : "default"} />
          <UsageStat label="费用" value={costLabel} tone="cost" />
        </div>
        <div className="mt-1.5">
          <RuntimeUsageLineChart
            points={buildSparkSeries(usage?.daily ?? [], usageWindow)}
            loading={usageLoading}
          />
        </div>
      </div>

      {/* ===== 运行能力区（决策 B 保留，prototype 无此项） ===== */}
      <div className="border-t border-slate-100 px-3 py-2.5">
        <div className="mb-1.5 flex items-center justify-between">
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">运行能力</p>
          <span className="text-[9.5px] text-slate-400">{capabilityChips.length}</span>
        </div>
        <AgentsList agents={capabilityChips} compact />
      </div>

      {/* ===== rt-roots：可写目录（allowed_roots 沙箱） ===== */}
      <div className="border-t border-slate-100 bg-white px-3 py-1.5 text-[10.5px] text-slate-500">
        <span>可写目录：</span>
        {roots.length > 0 ? (
          <span className="ml-0.5 inline-flex flex-wrap gap-1 align-middle">
            {roots.map((root, idx) => (
              <span
                key={`${root}-${idx}`}
                className="inline-flex items-center rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] text-slate-600"
                title={root}
              >
                {root}
              </span>
            ))}
          </span>
        ) : (
          <span className="text-slate-400">未配置（任意目录可写）</span>
        )}
      </div>

      {/* ===== rt-actions：操作按钮组 ===== */}
      <div className="flex flex-wrap gap-1.5 border-t border-slate-100 px-3 py-2">
        <button type="button" className={btnGhost} onClick={() => onEditAlias(runtime)} title="编辑展示别名">
          别名
        </button>
        {isPlatformAdmin ? (
          <button
            type="button"
            className={btnGhost}
            onClick={() => onEditAllowedRoots(runtime)}
            title="配置该运行时可写的目录沙箱（读取不受限）"
          >
            可写目录
          </button>
        ) : null}
        <button
          type="button"
          className={btnGhost}
          disabled={runtime.status !== "online" || upgrading}
          onClick={() => onUpgrade(runtime)}
          title={runtime.status !== "online" ? "离线，无法升级" : "下发 daemon 自更新指令"}
        >
          <RefreshCw className={cn("h-3 w-3", upgrading && "animate-spin")} />
          {upgrading ? "下发中" : "升级"}
        </button>
        <Link
          href={`/runtimes/${runtime.id}/audit`}
          className={btnGhost}
          title="查看该运行时的审计日志"
        >
          审计日志
        </Link>
        {canOpenSession ? (
          <button
            type="button"
            className={btnPrimary}
            onClick={() => onOpenSession(runtime)}
            title="打开该运行时的会话窗口"
          >
            <MessageSquare className="h-3 w-3" />
            会话
          </button>
        ) : null}
        <button
          type="button"
          className={btnGhost}
          disabled={actioning}
          onClick={() => void onToggleEnabled(runtime)}
          title={isDisabled ? "启用此智能体运行时" : "禁用此智能体运行时"}
        >
          {actioning ? <RefreshCw className="h-3 w-3 animate-spin" /> : <ActionIcon className="h-3 w-3" />}
          {actioning ? "处理中" : isDisabled ? "启用" : "禁用"}
        </button>
        <button
          type="button"
          className={btnDanger}
          disabled={actioning}
          onClick={() => onDelete(runtime)}
          title="移除此运行时记录（连带清除其下会话与任务记录）"
        >
          <Trash2 className="h-3 w-3" />
          移除
        </button>
      </div>
    </article>
  );
}
