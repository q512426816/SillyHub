"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  Ban,
  Check,
  CheckCircle2,
  CircleDashed,
  Copy,
  Cpu,
  MessageSquare,
  Power,
  RefreshCw,
  Server,
  Terminal,
  Trash2,
  Wifi,
  WifiOff,
  Wrench,
  type LucideIcon,
} from "lucide-react";

import {
  isActiveSession,
  shortId,
} from "@/components/daemon/runtime-session-helpers";
import { RuntimeSessionDialog } from "@/components/daemon/runtime-session-dialog";
import { RuntimeUsageLineChart } from "@/components/charts"; // task-13 桶导出(dynamic ssr:false),非原始组件
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import {
  deleteDaemonRuntime,
  disableDaemonRuntime,
  enableDaemonRuntime,
  getAgentSession,
  getRuntimesUsage,
  isVersionBelow,
  listAgentSessions,
  listDaemonRuntimes,
  MIN_VERSIONS,
  PROVIDER_META,
  type AgentSessionRead,
  type DaemonRuntimeRead,
  type RuntimeUsageItem,
  type RuntimeUsageWindow,
} from "@/lib/daemon";
import { cn } from "@/lib/utils";
import { useSession } from "@/stores/session";
// task-06 / FR-03 / D-003@v1：antd Modal.confirm（删除二次确认）+ useNotify（成功/失败 toast）。
// Modal 走 App.useApp().modal 拿到主题上下文实例（非静态 Modal），由 antd-providers.tsx 的 <AntApp> 注入。
import { App } from "antd";
import { useNotify } from "@/lib/errors";

type BadgeVariant = "default" | "success" | "outline" | "warning" | "destructive";
type StatusMeta = {
  label: string;
  badge: BadgeVariant;
  dot: string;
  iconBg: string;
  icon: LucideIcon;
};

const PROVIDER_TONES: Record<string, { dot: string; badge: string; panel: string }> = {
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

function getStatusMeta(status: string | null): StatusMeta {
  switch (status) {
    case "online":
      return {
        label: "在线",
        badge: "success",
        dot: "bg-emerald-500",
        iconBg: "bg-emerald-50 text-emerald-700",
        icon: Wifi,
      };
    case "maintenance":
      return {
        label: "维护中",
        badge: "warning",
        dot: "bg-amber-500",
        iconBg: "bg-amber-50 text-amber-700",
        icon: Wrench,
      };
    case "offline":
      return {
        label: "离线",
        badge: "outline",
        dot: "bg-slate-400",
        iconBg: "bg-slate-100 text-slate-600",
        icon: WifiOff,
      };
    case "disabled":
      return {
        label: "禁用",
        badge: "destructive",
        dot: "bg-rose-500",
        iconBg: "bg-rose-50 text-rose-700",
        icon: Ban,
      };
    default:
      return {
        label: status ?? "未知",
        badge: "outline",
        dot: "bg-slate-400",
        iconBg: "bg-slate-100 text-slate-600",
        icon: CircleDashed,
      };
  }
}

function getProviderLabel(provider: string | null): string {
  if (!provider) return "未知";
  return PROVIDER_META[provider]?.label ?? provider;
}

function getProviderTone(provider: string | null) {
  return provider ? PROVIDER_TONES[provider] : undefined;
}

function getAgents(runtime: DaemonRuntimeRead): string[] {
  const agents = runtime.capabilities?.agents;
  return Array.isArray(agents) ? agents.filter((agent): agent is string => typeof agent === "string") : [];
}

function getCapabilityChips(runtime: DaemonRuntimeRead): string[] {
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

function getProtocol(runtime: DaemonRuntimeRead): string {
  const protocol = runtime.capabilities?.protocol;
  return typeof protocol === "string" && protocol ? protocol : "-";
}

function isKnownBadVersion(runtime: DaemonRuntimeRead, version: string): boolean {
  if (version.toLowerCase() === "unknown") return true;
  const binPath = runtime.capabilities?.bin_path;
  if (typeof binPath !== "string") return false;
  return binPath.toLowerCase().endsWith("node.exe") && version === "24.15.0";
}

function getDisplayVersion(runtime: DaemonRuntimeRead): string | null {
  const version = runtime.version || runtime.capabilities?.version;
  if (typeof version !== "string" || !version.trim()) return null;
  if (isKnownBadVersion(runtime, version.trim())) return null;
  return version.trim();
}

function formatRelativeTime(iso: string | null): string {
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

// ===== task-14 / FR-01 / FR-04：用量统计格式化 helper（文件内私有，照搬 formatRelativeTime 的位置风格） =====

/** token 数值 k/M 格式化（FR-01）。< 1000 原值；>= 1e6 用 M；>= 1e3 用 k。 */
function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/** 费用 USD 格式化（FR-01）。$xx.xx，0 显示 $0.00。 */
function formatCost(n: number): string {
  return `$${(Number.isFinite(n) ? n : 0).toFixed(2)}`;
}

/** 缓存合并显示（D-001@v1）：read + creation，> 0 时 formatTokens，否则「—」（codex / 无 cache 数据）。 */
function formatCache(item: RuntimeUsageItem | undefined): string {
  if (!item) return "—";
  const sum = item.summary.cache_read_tokens + item.summary.cache_creation_tokens;
  return sum > 0 ? formatTokens(sum) : "—";
}

/** 时间窗中文 label（FR-04，CLAUDE.md 规则 11 中文 UI）。 */
const WINDOW_LABELS: Record<RuntimeUsageWindow, string> = {
  "1d": "当日",
  "7d": "7 天",
  "30d": "30 天",
};

function ProviderBadge({ provider }: { provider: string | null }) {
  const tone = getProviderTone(provider);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-[11px] font-medium",
        tone?.badge ?? "border-slate-200 bg-slate-50 text-slate-600",
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", tone?.dot ?? "bg-slate-400")} />
      {getProviderLabel(provider)}
    </span>
  );
}

function AgentsList({ agents, compact = false }: { agents: string[]; compact?: boolean }) {
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

function VersionCell({ provider, version }: { provider: string | null; version: string | null }) {
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

function CopyDaemonCommand({ compact = false }: { compact?: boolean }) {
  const accessToken = useSession((s) => s.accessToken);
  const [copied, setCopied] = useState(false);
  const [apiKey, setApiKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { getLatestActiveApiKey } = await import("@/lib/api-keys");
        const latest = await getLatestActiveApiKey();
        if (!cancelled) setApiKey(latest ? latest.key_prefix + "…" : null);
      } catch {
        // 非 admin 或尚未签发：fallback 到 access_token
        if (!cancelled) setApiKey(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 渲染所需：apiKey（优先）或 accessToken（fallback）
  if (!apiKey && !accessToken) return null;

  const frontendUrl =
    typeof window !== "undefined" ? window.location.origin : "http://localhost:3001";
  const serverUrl = frontendUrl.replace(/:3001$/, ":8001");
  // 优先用长期 API Key；fallback 到浏览器短期 access_token（TTL 15min，不适合长期运行）。
  const useApiKey = !!apiKey;
  const placeholderCred = useApiKey ? (apiKey as string) : "<access_token>";
  const cmd = useApiKey
    ? `sillyhub-daemon start --server ${serverUrl} --api-key <粘贴你的 API Key>`
    : `sillyhub-daemon start --server ${serverUrl} --token ${accessToken}`;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(cmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", compact && "w-full")}>
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border bg-card px-2.5 py-1.5 shadow-sm">
          <Terminal className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <code className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">
            sillyhub-daemon start --server {serverUrl}{" "}
            {useApiKey ? "--api-key" : "--token"} {placeholderCred}
          </code>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-8 shrink-0 gap-1.5 px-2.5"
          onClick={handleCopy}
          title={copied ? "已复制" : "复制完整命令"}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          <span className="hidden sm:inline">{copied ? "已复制" : "复制命令"}</span>
        </Button>
      </div>
      {!useApiKey && (
        <p className="text-[10px] text-amber-600">
          ⚠️ 当前显示的 --token 是浏览器 access_token（15 分钟过期），守护进程长期运行建议{" "}
          <a href="/settings/api-keys" className="underline">
            签发 API Key
          </a>{" "}
          后用 --api-key。
        </p>
      )}
    </div>
  );
}

/**
 * InstallDaemonBlock —— 「首次安装 daemon」折叠区块。
 *
 * 显示一键安装命令 `curl -fsSL <server>/daemon/install.sh | bash`，由 nginx 托管
 * 的 install.sh 执行（下载 ncc 单文件 bundle + 写 wrapper + 加 PATH）。
 *
 * serverUrl 从 window.location.origin 推导（:3001 前端 → :8001 后端/nginx），
 * 不硬编码 IP。用 mounted state 避免服务端/客户端 hydration 不一致。
 */
function InstallDaemonBlock() {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [serverUrl, setServerUrl] = useState<string | null>(null);

  useEffect(() => {
    const frontendUrl = window.location.origin;
    // 前端 :3001 → 后端/nginx :8001，与 CopyDaemonCommand 的 serverUrl 推导一致。
    setServerUrl(frontendUrl.replace(/:3001$/, ":8001"));
  }, []);

  const cmd = serverUrl
    ? `curl -fsSL ${serverUrl}/daemon/install.sh | bash -s -- --server-url ${serverUrl}`
    : "";

  const handleCopy = async () => {
    if (!cmd) return;
    await navigator.clipboard.writeText(cmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-md border border-dashed border-border/70 bg-muted/30">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
      >
        <Terminal className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="text-[11px] font-medium text-foreground">首次安装 daemon（新机器）</span>
        <span className="ml-auto text-[10px] text-muted-foreground">
          {open ? "收起" : "展开"}
        </span>
      </button>
      {open && (
        <div className="flex min-w-0 items-center gap-2 border-t border-border/70 px-2.5 py-1.5">
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border bg-card px-2.5 py-1.5 shadow-sm">
            <Terminal className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <code className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">
              {cmd || "curl -fsSL <server>/daemon/install.sh | bash"}
            </code>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-8 shrink-0 gap-1.5 px-2.5"
            onClick={handleCopy}
            disabled={!cmd}
            title={copied ? "已复制" : "复制安装命令"}
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">{copied ? "已复制" : "复制"}</span>
          </Button>
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  icon: Icon,
  meta,
  tone = "neutral",
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  meta?: string;
  tone?: "neutral" | "online" | "warning" | "offline" | "disabled";
}) {
  const toneClass = {
    neutral: "border-slate-200 bg-white text-slate-700",
    online: "border-emerald-200 bg-emerald-50 text-emerald-700",
    warning: "border-amber-200 bg-amber-50 text-amber-700",
    offline: "border-slate-200 bg-slate-50 text-slate-600",
    disabled: "border-rose-200 bg-rose-50 text-rose-700",
  }[tone];

  return (
    <div className={cn("flex min-h-[92px] items-center justify-between rounded-md border px-4 py-3", toneClass)}>
      <div className="min-w-0">
        <p className="text-[11px] font-medium uppercase text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold leading-none text-foreground">{value}</p>
        {meta && <p className="mt-1 truncate text-[11px] text-muted-foreground">{meta}</p>}
      </div>
      <Icon className="h-5 w-5 shrink-0 opacity-80" />
    </div>
  );
}

function formatRefreshTime(date: Date): string {
  return date.toLocaleTimeString("zh-CN", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function RuntimeMeta({ label, children }: { label: string; children: ReactNode }) {
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
function UsageStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-medium uppercase text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate text-sm font-semibold text-foreground">{value}</p>
    </div>
  );
}

function RuntimeCard({
  runtime,
  actioning,
  sessionStats,
  usage,
  usageWindow,
  usageLoading,
  onToggleEnabled,
  onOpenSession,
  onDelete,
}: {
  runtime: DaemonRuntimeRead;
  actioning: boolean;
  sessionStats: { total: number; active: number };
  usage?: RuntimeUsageItem;
  usageWindow: RuntimeUsageWindow;
  usageLoading?: boolean;
  onToggleEnabled: (runtime: DaemonRuntimeRead) => Promise<void>;
  onOpenSession: (runtime: DaemonRuntimeRead) => void;
  // task-06：签名从 Promise<void> 改 void —— modal.confirm 同步触发，删除在 onOk 异步回调里。
  onDelete: (runtime: DaemonRuntimeRead) => void;
}) {
  const status = getStatusMeta(runtime.status);
  const StatusIcon = status.icon;
  const capabilityChips = getCapabilityChips(runtime);
  const heartbeat = formatRelativeTime(runtime.last_heartbeat_at);
  const displayVersion = getDisplayVersion(runtime);
  const protocol = getProtocol(runtime);
  const isDisabled = runtime.status === "disabled";
  const ActionIcon = isDisabled ? Power : Ban;
  const binPath =
    typeof runtime.capabilities?.bin_path === "string" && runtime.capabilities.bin_path
      ? runtime.capabilities.bin_path
      : null;
  const envLabel = [runtime.os, runtime.arch].filter(Boolean).join(" · ") || null;
  const createdLabel = formatRelativeTime(runtime.created_at);
  const canOpenSession =
    runtime.status === "online" &&
    (runtime.provider === "claude" || runtime.provider === "codex");

  // task-14 / FR-01：用量区数字（summary 缺失 → 「—」，费用恒 $xx.xx）。
  const summary = usage?.summary;
  const inputLabel = summary ? formatTokens(summary.input_tokens) : "—";
  const outputLabel = summary ? formatTokens(summary.output_tokens) : "—";
  const cacheLabel = formatCache(usage);
  const costLabel = summary ? formatCost(summary.total_cost_usd) : "$0.00";

  return (
    <article className="overflow-hidden rounded-md border bg-card transition-colors hover:border-primary/30">
      <header className="flex items-start justify-between gap-3 border-b bg-muted/20 px-4 py-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-md", status.iconBg)}>
            <StatusIcon className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <ProviderBadge provider={runtime.provider} />
              <Badge variant={status.badge}>{status.label}</Badge>
            </div>
            <h3 className="mt-2 truncate font-mono text-sm font-semibold">
              {runtime.name ?? "未命名运行时"}
            </h3>
            <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
              {shortId(runtime.id)} · 注册 {createdLabel}
            </p>
          </div>
        </div>
        <span className={cn("mt-1 h-2.5 w-2.5 shrink-0 rounded-full", status.dot)} />
      </header>

      <div className="grid grid-cols-2 gap-4 px-4 py-3">
        <RuntimeMeta label="运行环境">
          {envLabel ? (
            <span className="inline-flex items-center gap-1.5">
              <Cpu className="h-3 w-3 shrink-0 text-muted-foreground" />
              {envLabel}
            </span>
          ) : (
            <span className="text-muted-foreground">未上报</span>
          )}
        </RuntimeMeta>
        <RuntimeMeta label="心跳">{heartbeat}</RuntimeMeta>
        <RuntimeMeta label="版本">
          {displayVersion ? (
            <VersionCell provider={runtime.provider} version={displayVersion} />
          ) : (
            <span className="text-muted-foreground">待识别</span>
          )}
        </RuntimeMeta>
        <RuntimeMeta label="协议">{protocol}</RuntimeMeta>
        {binPath && (
          <RuntimeMeta label="可执行路径">
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <Terminal className="h-3 w-3 shrink-0 text-muted-foreground" />
              <span className="truncate font-mono">{binPath}</span>
            </span>
          </RuntimeMeta>
        )}
        <RuntimeMeta label="会话">
          <span className="inline-flex items-center gap-1">
            {sessionStats.total}
            {sessionStats.active > 0 && (
              <span className="text-emerald-600">（{sessionStats.active} 活跃）</span>
            )}
          </span>
        </RuntimeMeta>
      </div>

      {/*
        task-14 / FR-01 / FR-04：用量区（4 数字 + sparkline）。
        - 数字:输入 / 输出 / 缓存(合并 read+creation,D-001@v1 无数据显示「—」) / 费用(USD)。
        - sparkline:task-13 桶导出的 RuntimeUsageLineChart,传该 runtime 的 daily 序列(输入/输出双线)。
        - usage=undefined(新 runtime / 窗口内无 run / 拉取失败)→ 数字全「—」、费用 $0.00、sparkline「暂无数据」。
      */}
      <div className="border-t px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-medium uppercase text-muted-foreground">
            用量统计（{WINDOW_LABELS[usageWindow]}）
          </p>
          <span className="text-[11px] text-muted-foreground">
            {usageLoading ? "加载中" : ""}
          </span>
        </div>
        <div className="mt-2 grid grid-cols-4 gap-2">
          <UsageStat label="输入" value={inputLabel} />
          <UsageStat label="输出" value={outputLabel} />
          <UsageStat label="缓存" value={cacheLabel} />
          <UsageStat label="费用" value={costLabel} />
        </div>
        <div className="mt-2">
          <RuntimeUsageLineChart
            points={usage?.daily ?? []}
            loading={usageLoading}
          />
        </div>
      </div>

      <div className="border-t px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-medium uppercase text-muted-foreground">运行能力</p>
          <span className="text-[11px] text-muted-foreground">{capabilityChips.length}</span>
        </div>
        <div className="mt-2">
          <AgentsList agents={capabilityChips} compact />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t px-4 py-3">
        {canOpenSession && (
          <Button
            size="sm"
            className="gap-1.5"
            onClick={() => onOpenSession(runtime)}
            title="打开该运行时的会话窗口"
          >
            <MessageSquare className="h-3.5 w-3.5" />
            会话
          </Button>
        )}
        <Button
          size="sm"
          variant={isDisabled ? "outline" : "destructive"}
          className="gap-1.5"
          disabled={actioning}
          onClick={() => void onToggleEnabled(runtime)}
          title={isDisabled ? "启用此智能体运行时" : "禁用此智能体运行时"}
        >
          {actioning ? (
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ActionIcon className="h-3.5 w-3.5" />
          )}
          {actioning ? "处理中" : isDisabled ? "启用" : "禁用"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
          disabled={actioning}
          onClick={() => onDelete(runtime)}
          title="移除此运行时记录（连带清除其下会话与任务记录）"
        >
          <Trash2 className="h-3.5 w-3.5" />
          移除
        </Button>
      </div>
    </article>
  );
}

function LoadingState() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {["a", "b", "c", "d"].map((key) => (
        <div key={key} className="min-h-[92px] animate-pulse rounded-md border bg-card p-4">
          <div className="h-3 w-20 rounded bg-muted" />
          <div className="mt-4 h-6 w-12 rounded bg-muted" />
          <div className="mt-3 h-3 w-28 rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="rounded-md border border-dashed bg-card px-6 py-10">
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Server className="h-5 w-5" />
        </div>
        <h2 className="mt-4 text-base font-semibold">尚未注册任何守护进程运行时</h2>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          启动本地守护进程后，平台会在这里显示提供方、版本、心跳和可用代理。runtime 上线后，进入 workspace 详情页可在「默认 Agent」下拉里选择本次启动的提供方。
        </p>
      </div>
      <div className="rounded-md border bg-card p-4">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">启动入口</h2>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          守护进程是 Node.js/TypeScript 实现，需要 Node ≥ 20。如果之前装过 Python 旧版的 <code className="font-mono">sillyhub-daemon</code>（脚本目录里残留 <code className="font-mono">sillyhub-daemon.exe</code>），先用 <code className="font-mono">pip uninstall sillyhub-daemon</code> 卸载，否则会冲突报 <code className="font-mono">ModuleNotFoundError: No module named &#39;sillyhub_daemon.__main__&#39;</code>。
        </p>
        <ol className="mt-4 space-y-3 text-xs text-muted-foreground">
          <li className="rounded border bg-muted/30 px-3 py-2 font-mono">
            <span className="mr-2 font-sans font-medium text-foreground">1.</span> cd sillyhub-daemon
          </li>
          <li className="rounded border bg-muted/30 px-3 py-2 font-mono">
            <span className="mr-2 font-sans font-medium text-foreground">2.</span> pnpm install &amp;&amp; pnpm build
            <span className="ml-2 block font-sans text-[10px] text-muted-foreground/80">没有 pnpm 时改用：npm install &amp;&amp; npx tsc</span>
          </li>
          <li className="rounded border bg-muted/30 px-3 py-2 font-mono">
            <span className="mr-2 font-sans font-medium text-foreground">3.</span> npm link
            <span className="ml-2 block font-sans text-[10px] text-muted-foreground/80">让本机 <code className="font-mono">sillyhub-daemon</code> 命令指向此项目；验证：<code className="font-mono">sillyhub-daemon --version</code></span>
          </li>
          <li className="rounded border bg-muted/30 px-3 py-2">
            <span className="font-medium text-foreground">4.</span> 复制右上角守护进程启动命令，在本机终端运行
          </li>
        </ol>
        <p className="mt-3 text-[11px] text-muted-foreground">
          详细说明见仓库 <code className="font-mono">sillyhub-daemon/README.md</code>。
        </p>
      </div>
    </section>
  );
}

export default function RuntimesPage() {
  const [items, setItems] = useState<DaemonRuntimeRead[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [runtimeActionId, setRuntimeActionId] = useState<string | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const [sessions, setSessions] = useState<AgentSessionRead[]>([]);
  // task-04 / D-001：单例弹窗 runtime（null=关闭）。切换 runtime 即替换 dialogRuntime，
  // RuntimeSessionDialog 内部 key 随 runtime.id 重 mount 清旧状态。
  const [dialogRuntime, setDialogRuntime] = useState<DaemonRuntimeRead | null>(null);
  // task-04 / D-003：URL ?session= 恢复点，仅 URL 恢复时传入弹窗默认态 attach。
  const [initialSessionId, setInitialSessionId] = useState<string | null>(null);

  // task-14 / FR-04 / D-004@v1：用量统计页面级状态。
  // usageWindow:时间窗(默认 7d);usageByRuntime:按 runtime_id 聚合的用量 Map(照搬 sessionStatsByRuntime 模式)。
  // 非实时刷新(D-004@v1):仅进页面 + 切窗时调 getRuntimesUsage,不订阅 SSE、不轮询。
  const [usageWindow, setUsageWindow] = useState<RuntimeUsageWindow>("7d");
  const [usageByRuntime, setUsageByRuntime] = useState<Map<string, RuntimeUsageItem>>(new Map());
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageError, setUsageError] = useState<string | null>(null);

  // task-06 / FR-03 / D-003@v1 / D-007@v1：notify（操作类 toast，封装 errMessage）
  // 与 modal（antd Modal.confirm 二次确认，走 <AntApp> 主题实例）。
  // 仅删除流程消费；reload/handleToggleRuntime 仍用顶部 inline 红条（design §5）。
  const notify = useNotify();
  const { modal } = App.useApp();

  // task-04 / D-003：URL 恢复编排（从原 SessionListSection 上移到 page）
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlRestoreDoneRef = useRef(false);

  // task-04 / D-003：清 URL ?session= param（onClose 时序 C-3 + 降级共用）
  const clearSessionParam = useCallback(() => {
    const next = new URLSearchParams(searchParams.toString());
    next.delete("session");
    const qs = next.toString();
    const target = qs ? `?${qs}` : window.location.pathname;
    router.replace(target, { scroll: false });
  }, [router, searchParams]);

  // task-04 / D-003 C-3：用户主动关闭 = 放弃恢复点。先清 state（关弹窗触发 dialog
  // 内部 SSE/轮询 cleanup，FR-05 / R-02），再清 param（刷新不再自动弹出）。
  const handleCloseDialog = useCallback(() => {
    setDialogRuntime(null);
    setInitialSessionId(null);
    clearSessionParam();
  }, [clearSessionParam]);

  const reload = useCallback(async (options: { showFeedback?: boolean } = {}) => {
    setError(null);
    const showFeedback = options.showFeedback ?? false;
    if (showFeedback) setRefreshing(true);
    const startedAt = Date.now();
    try {
      const [list, sessionsResp] = await Promise.all([
        listDaemonRuntimes(),
        listAgentSessions({ limit: 100 }).catch(() => null),
        showFeedback
          ? new Promise((resolve) => setTimeout(resolve, Math.max(0, 500 - (Date.now() - startedAt))))
          : Promise.resolve(),
      ]);
      setItems(list);
      setSessions(sessionsResp?.items ?? []);
      setLastRefreshedAt(new Date());
    } catch (err) {
      setItems([]);
      setError(err instanceof ApiError ? err.message : "加载列表失败");
    } finally {
      if (showFeedback) setRefreshing(false);
    }
  }, []);

  const handleToggleRuntime = useCallback(async (runtime: DaemonRuntimeRead) => {
    setError(null);
    setRuntimeActionId(runtime.id);
    try {
      const updated = runtime.status === "disabled"
        ? await enableDaemonRuntime(runtime.id)
        : await disableDaemonRuntime(runtime.id);
      setItems((prev) =>
        prev ? prev.map((item) => (item.id === updated.id ? updated : item)) : prev,
      );
      setLastRefreshedAt(new Date());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "运行时状态操作失败");
    } finally {
      setRuntimeActionId(null);
    }
  }, []);

  // ql-012 / task-06 / FR-03 / D-003@v1 / D-007@v1：移除运行时（物理删除，级联清会话/lease）。
  // 二次确认改 antd Modal.confirm（走主题 + destructive 红按钮），替代浏览器原生 window.confirm。
  // 失败走 notify.error toast（409 后端中文 / network 中文兜底），成功补 notify.success（D-003@v1 范例）。
  // 顶部 inline error state 仅 reload/toggle 用，删除流程不再触碰 setError（design §5：操作类 toast）。
  const handleDeleteRuntime = useCallback(
    (runtime: DaemonRuntimeRead) => {
      modal.confirm({
        title: "移除运行时",
        content: `确定移除运行时「${
          runtime.name ?? getProviderLabel(runtime.provider)
        }」？将同时清除该运行时下的会话与任务记录，且不可恢复。daemon 下次心跳会重新注册。`,
        okText: "移除",
        okType: "danger",
        cancelText: "取消",
        onOk: async () => {
          setRuntimeActionId(runtime.id);
          try {
            await deleteDaemonRuntime(runtime.id);
            setItems((prev) => (prev ? prev.filter((item) => item.id !== runtime.id) : prev));
            setSessions((prev) => prev.filter((s) => s.runtime_id !== runtime.id));
            if (dialogRuntime?.id === runtime.id) setDialogRuntime(null);
            setLastRefreshedAt(new Date());
            notify.success("运行时已移除");
          } catch (err) {
            notify.error(err, "移除运行时失败");
          } finally {
            setRuntimeActionId(null);
          }
        },
      });
    },
    [dialogRuntime?.id, modal, notify],
  );

  // task-04 / D-001：卡片「会话」→ 打开单例弹窗。不再 scrollIntoView（无底部常驻会话区）。
  const handleOpenSession = useCallback((runtime: DaemonRuntimeRead) => {
    setInitialSessionId(null);
    setDialogRuntime(runtime);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void reload();
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [reload]);

  // task-14 / FR-04 / D-004@v1：拉取所有 runtime 的用量(进页面 + 切窗时触发,非实时)。
  // cancelled 守卫防竞态(快速切窗时旧请求 resolve 跳过 set,只采最新窗)。
  // 失败降级:usageByRuntime 清空(卡片显示空用量,不崩)、setUsageError 供顶部提示。
  const reloadUsage = useCallback((window: RuntimeUsageWindow) => {
    setUsageLoading(true);
    setUsageError(null);
    let cancelled = false;
    getRuntimesUsage(window)
      .then((resp) => {
        if (cancelled) return;
        // 按 runtime_id 聚合成 Map(照搬 sessionStatsByRuntime ~885-895 的模式)。
        const map = new Map<string, RuntimeUsageItem>();
        for (const item of resp.runtimes) map.set(item.runtime_id, item);
        setUsageByRuntime(map);
      })
      .catch((err) => {
        if (cancelled) return;
        setUsageByRuntime(new Map()); // 失败:空 Map,卡片 usage=undefined → 数字全「—」、sparkline「暂无数据」
        setUsageError(err instanceof ApiError ? err.message : "加载用量统计失败");
      })
      .finally(() => {
        if (!cancelled) setUsageLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return reloadUsage(usageWindow);
  }, [usageWindow, reloadUsage]);

  // task-04 / FR-06 / D-003：mount 读 ?session=<id> → 查 status，活跃 → 开对应 runtime
  // 弹窗（initialSessionId 接弹窗默认态 attach）；ended/failed/不存在/已删 → 清 param
  // 降级不开。urlRestoreDoneRef 保证只执行一次（避免 items/sessions 重载重复触发）。
  // page 不直接 attach，attach 由 RuntimeSessionDialog D-002 默认态接管。
  useEffect(() => {
    if (urlRestoreDoneRef.current) return;
    const sessionId = searchParams.get("session");
    if (!sessionId) return;
    // 等 items 加载完成（reload 的 finally setItems）
    if (items === null) return;
    urlRestoreDoneRef.current = true;
    void (async () => {
      let session: AgentSessionRead | null =
        sessions.find((s) => s.id === sessionId) ?? null;
      if (!session) {
        try {
          session = await getAgentSession(sessionId);
        } catch {
          // 不属于本用户 / 已删 / 网络错误 → 降级
          session = null;
        }
      }
      if (session && isActiveSession(session)) {
        const matched = (items ?? []).find((r) => r.id === session!.runtime_id) ?? null;
        if (matched) {
          // 活跃 + runtime 在列 → 开弹窗，initialSessionId 接弹窗默认态 attach
          setInitialSessionId(session.id);
          setDialogRuntime(matched);
        } else {
          // runtime 已离线/删除 → 降级清 param（R-03 兜底）
          clearSessionParam();
        }
      } else {
        // ended / failed / 不存在 → 降级清 param
        clearSessionParam();
      }
    })();
  }, [searchParams, items, sessions, clearSessionParam]);

  const displayItems = useMemo(() => {
    const statusRank: Record<string, number> = {
      online: 0,
      maintenance: 1,
      disabled: 2,
      offline: 3,
    };
    return [...(items ?? [])].sort((a, b) => {
      const aRank = statusRank[a.status ?? ""] ?? 3;
      const bRank = statusRank[b.status ?? ""] ?? 3;
      if (aRank !== bRank) return aRank - bRank;
      const aHeartbeat = a.last_heartbeat_at ? new Date(a.last_heartbeat_at).getTime() : 0;
      const bHeartbeat = b.last_heartbeat_at ? new Date(b.last_heartbeat_at).getTime() : 0;
      if (aHeartbeat !== bHeartbeat) return bHeartbeat - aHeartbeat;
      return getProviderLabel(a.provider).localeCompare(getProviderLabel(b.provider), "zh-CN");
    });
  }, [items]);

  const stats = useMemo(() => {
    const list = items ?? [];
    const online = list.filter((runtime) => runtime.status === "online").length;
    const maintenance = list.filter((runtime) => runtime.status === "maintenance").length;
    const disabled = list.filter((runtime) => runtime.status === "disabled").length;
    const offline = list.filter((runtime) => runtime.status === "offline").length;
    const providers = new Set(list.map((runtime) => runtime.provider).filter(Boolean));
    const latestHeartbeat = list
      .map((runtime) => runtime.last_heartbeat_at)
      .filter((value): value is string => Boolean(value))
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];

    return {
      total: list.length,
      online,
      maintenance,
      disabled,
      offline,
      providers: providers.size,
      latestHeartbeat: latestHeartbeat ? formatRelativeTime(latestHeartbeat) : "无心跳",
    };
  }, [items]);

  // ql-012：按 runtime_id 聚合会话数（卡片展示）。
  const sessionStatsByRuntime = useMemo(() => {
    const map = new Map<string, { total: number; active: number }>();
    for (const s of sessions) {
      if (!s.runtime_id) continue;
      const cur = map.get(s.runtime_id) ?? { total: 0, active: 0 };
      cur.total += 1;
      if (isActiveSession(s)) cur.active += 1;
      map.set(s.runtime_id, cur);
    }
    return map;
  }, [sessions]);

  return (
    <main className="mx-auto flex w-full max-w-[1600px] flex-col gap-5 px-6 py-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase text-muted-foreground">系统</p>
          <h1 className="mt-1">守护进程运行时</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            本地代理运行时、心跳状态和快速会话控制台。
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 lg:max-w-xl">
          <InstallDaemonBlock />
          <CopyDaemonCommand compact />
        </div>
      </header>

      {error && (
        <div className="flex items-start gap-2 rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {items === null ? (
        <LoadingState />
      ) : (
        <>
          {items.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <SummaryCard label="总数" value={String(stats.total)} icon={Server} meta={`${stats.providers} 个提供方`} />
              <SummaryCard label="在线" value={String(stats.online)} icon={CheckCircle2} tone="online" meta={stats.latestHeartbeat} />
              <SummaryCard label="维护中" value={String(stats.maintenance)} icon={Wrench} tone="warning" />
              <SummaryCard label="禁用" value={String(stats.disabled)} icon={Ban} tone="disabled" />
              <SummaryCard label="离线" value={String(stats.offline)} icon={WifiOff} tone="offline" />
            </div>
          )}

          <div className="space-y-5">
            {items.length === 0 ? (
              <EmptyState />
            ) : (
              <section className="min-w-0 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Activity className="h-4 w-4 text-muted-foreground" />
                      <h2 className="text-sm font-semibold">运行时列表</h2>
                      <span className="text-[11px] text-muted-foreground">
                        {stats.online} 个在线 / {stats.total} 条记录
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {lastRefreshedAt ? `上次刷新：${formatRefreshTime(lastRefreshedAt)}` : "等待刷新"}
                    </p>
                  </div>
                  {/*
                    task-14 / FR-04：时间窗切换器(3 tab)。切窗触发页面级 usageWindow 变化 →
                    useEffect 重发 getRuntimesUsage(新窗) → 所有卡片用量区同步刷新。
                    active 态 variant="default" / inactive variant="outline",照搬项目现有 tab 风格。
                  */}
                  <div className="flex items-center gap-1.5">
                    <div className="flex items-center gap-1 rounded-md border bg-card p-0.5">
                      {(Object.keys(WINDOW_LABELS) as RuntimeUsageWindow[]).map((w) => (
                        <Button
                          key={w}
                          size="sm"
                          variant={usageWindow === w ? "default" : "outline"}
                          className="h-7 px-2.5 text-xs"
                          onClick={() => setUsageWindow(w)}
                          // aria-label 优先于可见文本「当日/7天/30天」作为 accessible name,
                          // 供 findByRole({ name: /切换用量统计时间窗为.../ }) 定位 + 屏幕阅读器朗读完整语义(FR-04 可访问性)。
                          aria-label={`切换用量统计时间窗为${WINDOW_LABELS[w]}`}
                          title={`切换用量统计时间窗为${WINDOW_LABELS[w]}`}
                        >
                          {WINDOW_LABELS[w]}
                        </Button>
                      ))}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => void reload({ showFeedback: true })}
                      disabled={refreshing}
                    >
                      <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
                      {refreshing ? "刷新中" : "刷新"}
                    </Button>
                  </div>
                </div>
                {usageError && (
                  <p className="text-[11px] text-amber-600">
                    用量统计加载失败：{usageError}（卡片用量区显示空）
                  </p>
                )}
                <div
                  data-testid="runtime-list-scroll"
                  className="pr-1"
                >
                  <div className="grid gap-4 xl:grid-cols-2">
                    {displayItems.map((runtime) => (
                      <RuntimeCard
                        key={runtime.id}
                        runtime={runtime}
                        actioning={runtimeActionId === runtime.id}
                        sessionStats={sessionStatsByRuntime.get(runtime.id) ?? { total: 0, active: 0 }}
                        usage={usageByRuntime.get(runtime.id)}
                        usageWindow={usageWindow}
                        usageLoading={usageLoading}
                        onToggleEnabled={handleToggleRuntime}
                        onOpenSession={handleOpenSession}
                        onDelete={handleDeleteRuntime}
                      />
                    ))}
                  </div>
                </div>
              </section>
            )}
          </div>
        </>
      )}

      <RuntimeSessionDialog
        key={dialogRuntime?.id ?? "closed"}
        runtime={dialogRuntime}
        open={dialogRuntime !== null}
        onClose={handleCloseDialog}
        runtimes={items ?? []}
        initialSessionId={initialSessionId ?? undefined}
      />
    </main>
  );
}
