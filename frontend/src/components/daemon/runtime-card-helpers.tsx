/**
 * runtime-card-helpers.ts —— RuntimeCard 专属 helper 集合（task-07 / D-006）。
 *
 * 2026-07-07-daemon-machine-runtime-hierarchy task-07：从 app/(dashboard)/runtimes/page.tsx
 * 抽出内联 RuntimeCard 时，随组件迁出的私有 helper 统一收口于此，供 runtime-card.tsx
 * 与 page.tsx（task-08 机器头 / task-09 手风琴复用）共享。
 *
 * 迁移规则：仅 RuntimeCard 用的 helper → 随组件迁入；page 其它地方（如顶部 SummaryCard
 * 的 latestHeartbeat、排序 localeCompare）也用的 helper（如 formatRelativeTime /
 * getProviderLabel）→ 同样放这里，page 改 import。逐字迁移，不改逻辑/className/文案。
 */
import type { ReactNode } from "react";
import {
  AlertTriangle,
  Ban,
  CircleDashed,
  Wifi,
  WifiOff,
  Wrench,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  isVersionBelow,
  MIN_VERSIONS,
  PROVIDER_META,
  type DaemonRuntimeRead,
  type DaemonVersionInfo,
  type RuntimeUsageItem,
  type RuntimeUsagePoint,
  type RuntimeUsageWindow,
} from "@/lib/daemon";

export type BadgeVariant = "default" | "success" | "outline" | "warning" | "destructive";

export type StatusMeta = {
  label: string;
  badge: BadgeVariant;
  /** 精确 Tailwind 色阶 badge className（对齐 prototype .badge.*，不依赖 shadcn variant）。 */
  badgeClass: string;
  dot: string;
  iconBg: string;
  icon: LucideIcon;
};

export const PROVIDER_TONES: Record<string, { dot: string; badge: string; panel: string }> = {
  claude: {
    dot: "bg-violet-500",
    badge: "border-violet-200 bg-violet-50 text-violet-700",
    panel: "bg-violet-50 text-violet-700",
  },
  codex: {
    dot: "bg-emerald-500",
    badge: "border-emerald-200 bg-emerald-50 text-emerald-700",
    panel: "bg-emerald-50 text-emerald-700",
  },
  copilot: {
    dot: "bg-sky-500",
    badge: "border-sky-200 bg-sky-50 text-sky-700",
    panel: "bg-sky-50 text-sky-700",
  },
  opencode: {
    dot: "bg-teal-500",
    badge: "border-teal-200 bg-teal-50 text-teal-700",
    panel: "bg-teal-50 text-teal-700",
  },
  openclaw: {
    dot: "bg-orange-500",
    badge: "border-orange-200 bg-orange-50 text-orange-700",
    panel: "bg-orange-50 text-orange-700",
  },
  hermes: {
    dot: "bg-indigo-500",
    badge: "border-indigo-200 bg-indigo-50 text-indigo-700",
    panel: "bg-indigo-50 text-indigo-700",
  },
  gemini: {
    dot: "bg-cyan-500",
    badge: "border-cyan-200 bg-cyan-50 text-cyan-700",
    panel: "bg-cyan-50 text-cyan-700",
  },
  pi: {
    dot: "bg-pink-500",
    badge: "border-pink-200 bg-pink-50 text-pink-700",
    panel: "bg-pink-50 text-pink-700",
  },
  cursor: {
    dot: "bg-amber-500",
    badge: "border-amber-200 bg-amber-50 text-amber-700",
    panel: "bg-amber-50 text-amber-700",
  },
  kimi: {
    dot: "bg-red-500",
    badge: "border-red-200 bg-red-50 text-red-700",
    panel: "bg-red-50 text-red-700",
  },
  kiro: {
    dot: "bg-lime-500",
    badge: "border-lime-200 bg-lime-50 text-lime-700",
    panel: "bg-lime-50 text-lime-700",
  },
  antigravity: {
    dot: "bg-slate-500",
    badge: "border-slate-200 bg-slate-50 text-slate-700",
    panel: "bg-slate-50 text-slate-700",
  },
};

export function getStatusMeta(status: string | null): StatusMeta {
  switch (status) {
    case "online":
      return {
        label: "在线",
        badge: "success",
        badgeClass: "bg-emerald-50 text-emerald-700",
        dot: "bg-emerald-600",
        iconBg: "bg-emerald-50 text-emerald-700",
        icon: Wifi,
      };
    case "maintenance":
      return {
        label: "维护中",
        badge: "warning",
        badgeClass: "bg-amber-50 text-amber-700",
        dot: "bg-amber-500",
        iconBg: "bg-amber-50 text-amber-700",
        icon: Wrench,
      };
    case "offline":
      return {
        label: "离线",
        badge: "outline",
        badgeClass: "bg-slate-100 text-slate-600",
        dot: "bg-slate-400",
        iconBg: "bg-slate-100 text-slate-500",
        icon: WifiOff,
      };
    case "disabled":
      return {
        label: "禁用",
        badge: "destructive",
        badgeClass: "bg-rose-50 text-rose-700",
        dot: "bg-rose-500",
        iconBg: "bg-rose-50 text-rose-700",
        icon: Ban,
      };
    default:
      return {
        label: status ?? "未知",
        badge: "outline",
        badgeClass: "bg-slate-100 text-slate-600",
        dot: "bg-slate-400",
        iconBg: "bg-slate-100 text-slate-500",
        icon: CircleDashed,
      };
  }
}

export function getProviderLabel(provider: string | null): string {
  if (!provider) return "未知";
  return PROVIDER_META[provider]?.label ?? provider;
}

export function getProviderTone(provider: string | null) {
  return provider ? PROVIDER_TONES[provider] : undefined;
}

function getAgents(runtime: DaemonRuntimeRead): string[] {
  const agents = runtime.capabilities?.agents;
  return Array.isArray(agents) ? agents.filter((agent): agent is string => typeof agent === "string") : [];
}

export function getCapabilityChips(runtime: DaemonRuntimeRead): string[] {
  const capabilities = runtime.capabilities ?? {};
  const agents = getAgents(runtime);
  if (agents.length > 0) return agents.map((agent) => `代理: ${agent}`);

  const chips: string[] = [];
  if (runtime.provider) chips.push(`代理: ${getProviderLabel(runtime.provider)}`);
  if (typeof capabilities.protocol === "string" && capabilities.protocol) {
    chips.push(`协议: ${capabilities.protocol}`);
  }
  return chips;
}

export function getProtocol(runtime: DaemonRuntimeRead): string {
  const protocol = runtime.capabilities?.protocol;
  return typeof protocol === "string" && protocol ? protocol : "-";
}

function isKnownBadVersion(runtime: DaemonRuntimeRead, version: string): boolean {
  if (version.toLowerCase() === "unknown") return true;
  const binPath = runtime.capabilities?.bin_path;
  if (typeof binPath !== "string") return false;
  return binPath.toLowerCase().endsWith("node.exe") && version === "24.15.0";
}

export function getDisplayVersion(runtime: DaemonRuntimeRead): string | null {
  const version = runtime.version || runtime.capabilities?.version;
  if (typeof version !== "string" || !version.trim()) return null;
  if (isKnownBadVersion(runtime, version.trim())) return null;
  return version.trim();
}

export function formatRelativeTime(iso: string | null): string {
  if (!iso) return "无心跳";
  const timestamp = new Date(iso).getTime();
  if (Number.isNaN(timestamp)) return "时间无效";
  const diff = Date.now() - timestamp;
  if (diff < 30_000) return "刚刚";
  if (diff < 60_000) return `${Math.floor(diff / 1000)} 秒前`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return `${Math.floor(diff / 86_400_000)} 天前`;
}

// ===== task-14 / FR-01 / FR-04：用量统计格式化 helper（照搬 formatRelativeTime 的位置风格） =====

/** token 数值 k/M 格式化（FR-01）。< 1000 原值；>= 1e6 用 M；>= 1e3 用 k。 */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/** 费用 USD 格式化（FR-01）。$xx.xx，0 显示 $0.00。 */
export function formatCost(n: number): string {
  return `$${(Number.isFinite(n) ? n : 0).toFixed(2)}`;
}

/** 缓存合并显示（D-001@v1）：read + creation，> 0 时 formatTokens，否则「—」（codex / 无 cache 数据）。 */
export function formatCache(item: RuntimeUsageItem | undefined): string {
  if (!item) return "—";
  const sum = item.summary.cache_read_tokens + item.summary.cache_creation_tokens;
  return sum > 0 ? formatTokens(sum) : "—";
}

export function ProviderBadge({ provider }: { provider: string | null }) {
  const tone = getProviderTone(provider);
  // 对齐 prototype .pbadge：无 dot，仅 provider 名 + 精确色阶边框/底/字。
  return (
    <span
      className={cn(
        "inline-flex items-center rounded border px-2 py-0.5 text-[11px] font-semibold",
        tone?.badge ?? "border-slate-200 bg-slate-50 text-slate-600",
      )}
    >
      {getProviderLabel(provider)}
    </span>
  );
}

export function AgentsList({ agents, compact = false }: { agents: string[]; compact?: boolean }) {
  if (agents.length === 0) {
    return <span className="text-xs text-muted-foreground">未上报能力</span>;
  }

  const visible = compact ? agents.slice(0, 4) : agents;
  const overflow = agents.length - visible.length;

  return (
    <span className="inline-flex flex-wrap gap-1.5">
      {visible.map((agent) => (
        <span
          key={agent}
          className="rounded border border-border/70 bg-muted/50 px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
        >
          {agent}
        </span>
      ))}
      {overflow > 0 && (
        <span className="rounded border border-border/70 bg-card px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
          +{overflow}
        </span>
      )}
    </span>
  );
}

export function VersionCell({ provider, version }: { provider: string | null; version: string | null }) {
  if (!version) return <span className="text-muted-foreground">未上报</span>;

  const minVersion = provider ? MIN_VERSIONS[provider] : undefined;
  const showWarning = minVersion ? isVersionBelow(version, minVersion) : false;

  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span className="truncate font-mono">{version}</span>
      {showWarning && (
        <span
          title={`版本低于最低要求 ${minVersion}`}
          className="inline-flex h-4 w-4 items-center justify-center rounded bg-amber-50 text-amber-700"
        >
          <AlertTriangle className="h-3 w-3" />
        </span>
      )}
    </span>
  );
}

export function RuntimeMeta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium uppercase text-muted-foreground">{label}</p>
      <div className="mt-1 truncate text-xs font-medium text-foreground">{children}</div>
    </div>
  );
}

/**
 * UsageStat —— 用量数字小格子（task-14 / FR-01）。
 * 类 RuntimeMeta 但更紧凑(4 列网格内):label 10px + value 14px 加粗 + truncate 防溢出。
 * 借鉴 SummaryCard 的 label/value 排版风格。
 */
export function UsageStat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  /** tone 对齐 prototype .ustat .uv：cost=蓝、muted=灰（无数据）、default=深字。 */
  tone?: "default" | "cost" | "muted";
}) {
  const valueColor = {
    default: "text-slate-900",
    cost: "text-blue-700",
    muted: "text-slate-400 font-medium",
  }[tone];
  return (
    <div className="min-w-0">
      <p className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={cn("mt-0.5 truncate text-[13px] font-bold tabular-nums", valueColor)}>{value}</p>
    </div>
  );
}

/**
 * 2026-07-04-daemon-version-management task-09：daemon 进程版本徽标。
 *
 * 比对逻辑（design §版本徽标）：
 *   - build_id 为 null/undefined（daemon 旧版未上报）→ 「未知」灰
 *   - build_id === "dev"（本地开发 daemon）→ 「dev」灰
 *   - latest 非空非 unknown 且 build_id === latest.latest_build_id → 「最新」绿
 *   - 两者都有效且不等 → 「可升级」橙
 *
 * latest 可能未拉到（getDaemonVersion 失败/未登录）或为 "unknown"
 *（install.sh fallback），此时无法判定「最新」/「可升级」，统一降级为「未知」灰。
 *
 * task-07：该徽标从 page 迁到此处，单独保留导出 —— task-08 机器头要复用渲染
 * daemon 版本短码 + 徽标（C-002 Daemon 版本信息上提机器头）。
 */
type DaemonVersionBadgeState = {
  label: string;
  variant: BadgeVariant;
};

export function getDaemonVersionBadgeState(
  buildId: string | null | undefined,
  latest: DaemonVersionInfo | undefined,
): DaemonVersionBadgeState {
  if (!buildId) {
    return { label: "未知", variant: "outline" };
  }
  if (buildId === "dev") {
    return { label: "dev", variant: "outline" };
  }
  const latestBuildId = latest?.latest_build_id;
  if (
    latestBuildId &&
    latestBuildId !== "unknown" &&
    latest?.latest_version &&
    latest.latest_version !== "unknown"
  ) {
    if (buildId === latestBuildId) {
      return { label: "最新", variant: "success" };
    }
    return { label: "可升级", variant: "warning" };
  }
  // latest 未拉到 / unknown：无法判定，保守显示「未知」。
  return { label: "未知", variant: "outline" };
}

export function DaemonVersionBadge({
  buildId,
  latest,
}: {
  buildId: string | null | undefined;
  latest: DaemonVersionInfo | undefined;
}) {
  const state = getDaemonVersionBadgeState(buildId, latest);
  return <Badge variant={state.variant}>{state.label}</Badge>;
}

/**
 * buildSparkSeries —— 把 getRuntimesUsage 的 daily（只含有 run 的桶）补全成完整
 * 时间序列，供 sparkline 渲染连续 N 天趋势（ql-20260708-001）。
 *
 * backend _build_daily_sql GROUP BY bucket 只返有数据的桶，无数据桶不返；
 * 7d/30d 前端降采样到日桶（按 UTC date sum 同日所有桶）+ 补全最近 N 天（缺失天 0 值），
 * 让 sparkline 显示完整趋势而非零星几点。1d 保持原桶（20min，点数已密）。
 */
export function buildSparkSeries(
  daily: RuntimeUsagePoint[],
  window: RuntimeUsageWindow,
): RuntimeUsagePoint[] {
  if (window === "1d") return daily;
  const days = window === "7d" ? 7 : 30;
  // 降采样：按 UTC date（YYYY-MM-DD）sum 到日桶。
  const byDay = new Map<string, RuntimeUsagePoint>();
  for (const p of daily) {
    const dayKey = p.ts.slice(0, 10);
    const existing = byDay.get(dayKey);
    if (existing) {
      existing.input_tokens += p.input_tokens;
      existing.output_tokens += p.output_tokens;
      existing.cache_read_tokens = (existing.cache_read_tokens ?? 0) + (p.cache_read_tokens ?? 0);
      existing.cache_creation_tokens =
        (existing.cache_creation_tokens ?? 0) + (p.cache_creation_tokens ?? 0);
      existing.total_cost_usd = (existing.total_cost_usd ?? 0) + (p.total_cost_usd ?? 0);
    } else {
      byDay.set(dayKey, {
        ts: `${dayKey}T00:00:00Z`,
        input_tokens: p.input_tokens,
        output_tokens: p.output_tokens,
        cache_read_tokens: p.cache_read_tokens ?? 0,
        cache_creation_tokens: p.cache_creation_tokens ?? 0,
        total_cost_usd: p.total_cost_usd ?? 0,
      });
    }
  }
  // 补全：最近 N 天（UTC 自然日，缺失天 0 值）。
  const now = new Date();
  const result: RuntimeUsagePoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
    const dayKey = d.toISOString().slice(0, 10);
    result.push(
      byDay.get(dayKey) ?? {
        ts: `${dayKey}T00:00:00Z`,
        input_tokens: 0,
        output_tokens: 0,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
        total_cost_usd: 0,
      },
    );
  }
  return result;
}
