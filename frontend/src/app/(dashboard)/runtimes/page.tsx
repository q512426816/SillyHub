"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  MessageSquarePlus,
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

import { InteractiveSessionPanel, type SessionTurnView } from "@/components/daemon/interactive-session-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { type AgentRunLogEntry } from "@/lib/agent";
import {
  deleteAgentSession,
  deleteDaemonRuntime,
  disableDaemonRuntime,
  enableDaemonRuntime,
  getAgentSessionLogs,
  isVersionBelow,
  listAgentSessions,
  listDaemonRuntimes,
  MIN_VERSIONS,
  PROVIDER_META,
  reopenSession,
  type AgentSessionRead,
  type AgentSessionStatus,
  type DaemonRuntimeRead,
} from "@/lib/daemon";
import { cn } from "@/lib/utils";
import { useSession } from "@/stores/session";

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

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}...${id.slice(-4)}` : id;
}

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
 * task-11：交互式会话面板包装（演进自 quick-chat）。
 *
 * 保留 provider/model 选择 + runtime 卡片布局，会话核心替换为
 * InteractiveSessionPanel（单一 SSE 贯穿多 turn / inject / interrupt / end）。
 * 旧 QuickChatPanel / quickChat / streamQuickChat / getQuickChatResult / getQuickChatLogs
 * 保留用于 brownfield 回归，不再被页面使用。
 */
function InteractiveSessionChatSection({
  runtimes,
  attachSession,
  initialTurns,
  onCloseAttach,
  focusProvider,
}: {
  runtimes: DaemonRuntimeRead[];
  attachSession?: AgentSessionRead;
  initialTurns?: SessionTurnView[];
  onCloseAttach?: () => void;
  /** ql-012：runtime 卡片「会话」聚焦时钦定的 provider（覆盖默认 claude 优先）。 */
  focusProvider?: string;
}) {
  // D-002@v3 非目标：交互式会话仅支持 claude（codex 后续），不支持 cursor/openclaw 等。
  // 过滤 online runtime 的 provider，只保留 claude/codex，避免 createSession 触发
  // backend SessionCreateRequest.provider Literal["claude","codex"] 422。
  const onlineProviders = useMemo(() => {
    const SUPPORTED_SESSION_PROVIDERS = ["claude", "codex"];
    const list = runtimes
      .filter(
        (r) =>
          r.status === "online" &&
          r.provider &&
          SUPPORTED_SESSION_PROVIDERS.includes(r.provider),
      )
      .map((r) => r.provider!);
    return [...new Set(list)];
  }, [runtimes]);
  const [model, setModel] = useState<string | null>(null);
  const hasOnlineProvider = onlineProviders.length > 0;
  // ql-012：runtime 卡片聚焦时用 focusProvider 钦定；否则优先 claude，再退首个在线 provider。
  const defaultProvider = focusProvider
    ?? attachSession?.provider
    ?? (onlineProviders.includes("claude") ? "claude" : (onlineProviders[0] ?? "claude"));
  // providers 列表：有在线时用在线列表，无在线时给占位让组件能渲染
  const providers = hasOnlineProvider ? onlineProviders : [defaultProvider];

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {attachSession && onCloseAttach && (
        <div className="flex items-center justify-end">
          <Button
            size="sm"
            variant="ghost"
            onClick={onCloseAttach}
            className="h-7 text-[11px]"
          >
            返回历史
          </Button>
        </div>
      )}
      {/* key 强制 attach 切换时重 mount（清旧 SSE/轮询，task-10 unmount close） */}
      <InteractiveSessionPanel
        key={attachSession?.id ?? "live"}
        providers={providers}
        defaultProvider={defaultProvider}
        model={model}
        onModelChange={setModel}
        hasOnlineProvider={hasOnlineProvider}
        attachSessionId={attachSession?.id}
        initialTurns={initialTurns}
      />
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

function RuntimeCard({
  runtime,
  actioning,
  sessionStats,
  onToggleEnabled,
  onOpenSession,
  onDelete,
}: {
  runtime: DaemonRuntimeRead;
  actioning: boolean;
  sessionStats: { total: number; active: number };
  onToggleEnabled: (runtime: DaemonRuntimeRead) => Promise<void>;
  onOpenSession: (runtime: DaemonRuntimeRead) => void;
  onDelete: (runtime: DaemonRuntimeRead) => Promise<void>;
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
          onClick={() => void onDelete(runtime)}
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

// ── 会话列表 + 历史回看（task-12 / FR-10 / D-005@v1） ───────────────────────

const ACTIVE_SESSION_VIEW_STATUSES: ReadonlySet<AgentSessionStatus> = new Set([
  "pending",
  "active",
  "reconnecting",
]);

function isActiveSession(s: AgentSessionRead): boolean {
  return ACTIVE_SESSION_VIEW_STATUSES.has(s.status);
}

/**
 * 受控会话列表 sidebar。active/pending/reconnecting → live（task-11 面板）；
 * ended/failed → history 只读回看。selection 由父级持有，不创建第二套 SSE。
 */
function SessionsSidebar({
  sessions,
  loading,
  error,
  selectedSessionId,
  deletingSessionId,
  onSelect,
  onDelete,
  onRetry,
}: {
  sessions: AgentSessionRead[];
  loading: boolean;
  error: string | null;
  selectedSessionId: string | null;
  deletingSessionId: string | null;
  onSelect: (session: AgentSessionRead) => void;
  onDelete: (session: AgentSessionRead) => void;
  onRetry: () => void;
}) {
  return (
    <section
      data-testid="session-list-scroll"
      className="flex max-h-[520px] min-h-0 flex-col overflow-hidden rounded-md border bg-card"
    >
      <header className="border-b px-3 py-2">
        <h2 className="text-sm font-semibold">会话列表</h2>
        <p className="text-[11px] text-muted-foreground">
          {loading ? "加载中…" : `${sessions.length} 个会话`}
        </p>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {error ? (
          <div className="space-y-2 px-3 py-3">
            <p className="text-[11px] text-destructive">{error}</p>
            <Button size="sm" variant="outline" onClick={onRetry} className="h-7 text-[11px]">
              重试
            </Button>
          </div>
        ) : sessions.length === 0 ? (
          <p className="py-6 text-center text-[11px] text-muted-foreground">没有会话</p>
        ) : (
          <ul className="divide-y">
            {sessions.map((s) => {
              const active = isActiveSession(s);
              return (
                <li key={s.id} className="flex items-stretch">
                  <button
                    type="button"
                    onClick={() => onSelect(s)}
                    className={cn(
                      "flex min-w-0 flex-1 flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-muted/40",
                      selectedSessionId === s.id && "bg-muted/60",
                    )}
                  >
                    <span className="flex w-full items-center justify-between gap-2">
                      <span className="font-mono text-[11px]">{shortId(s.id)}</span>
                      <Badge variant={active ? "success" : "outline"} className="text-[10px]">
                        {s.status}
                      </Badge>
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {PROVIDER_META[s.provider]?.label ?? s.provider} · {s.turn_count} turn
                      {s.turn_count === 1 ? "" : "s"}
                    </span>
                  </button>
                  {/* task-04 / FR-3：去掉 {!active} 限制，所有状态都渲染删除按钮。
                      active 会话删除的后台 end 收口由后端 task-03 处理，前端透明。 */}
                  <button
                    type="button"
                    aria-label={`删除会话 ${s.id}`}
                    title="删除会话"
                    disabled={deletingSessionId === s.id}
                    onClick={() => onDelete(s)}
                    className="flex w-9 shrink-0 items-center justify-center border-l text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                  >
                    {deletingSessionId === s.id ? (
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

/**
 * task-11 续聊可用性（D-004@v1）：
 * 仅 claude + 有 agent_session_id + 终态（ended/failed）可恢复。
 * codex 暂不支持；active 本就活跃（不显示按钮，走只读回看 ql-007）；
 * 无 agent_session_id（create 失败的 failed）无法恢复。
 */
function canResumeSession(session: AgentSessionRead | null): boolean {
  if (!session) return false;
  return (
    session.provider === "claude" &&
    !!session.agent_session_id &&
    (session.status === "ended" || session.status === "failed")
  );
}

/** 续聊按钮不可用时的 title 提示文案。 */
function resumeDisabledTitle(session: AgentSessionRead): string {
  if (session.provider !== "claude") return "codex 暂不支持续聊";
  if (!session.agent_session_id) return "会话未建立，无法续聊";
  return "当前会话不支持续聊";
}

/**
 * task-11 logsToTurns：把历史日志按 run_id 分组，转成 attach 面板预填的 SessionTurnView。
 * channel==="user" 的 log → prompt；其余 log → output（拼接，保留换行）。
 */
function logsToTurns(logs: AgentRunLogEntry[]): SessionTurnView[] {
  const map = new Map<string, AgentRunLogEntry[]>();
  for (const log of logs) {
    const list = map.get(log.run_id) ?? [];
    list.push(log);
    map.set(log.run_id, list);
  }
  const turns: SessionTurnView[] = [];
  let turnIndex = 0;
  for (const [, entries] of Array.from(map.entries())) {
    turnIndex += 1;
    const prompts: string[] = [];
    const outputs: string[] = [];
    for (const entry of entries) {
      const text = entry.content_redacted ?? "";
      if (!text) continue;
      if (entry.channel === "user_input") {
        prompts.push(text);
      } else {
        outputs.push(text);
      }
    }
    turns.push({
      runId: `__attach_history_${turnIndex}__`,
      turn: turnIndex,
      prompt: prompts.join("\n"),
      output: outputs.join("\n"),
      status: "completed",
      seenLogIds: new Set(entries.map((e) => e.id)),
      // ql-20260621：历史回看无实时 token（logs 接口不含 token），置 null。
      // 若后续 logs 接口补 token 字段可在此填充。
      inputTokens: null,
      outputTokens: null,
    });
  }
  return turns;
}

/**
 * 只读历史回看：跨 AgentRun 的日志按 run_id 分组渲染（D-005@v1）。
 * 不渲染发送 / interrupt / end 控件（只读）。
 */
function SessionHistoryView({
  session,
  logs,
  loading,
  error,
  onClose,
  onContinue,
}: {
  session: AgentSessionRead | null;
  logs: AgentRunLogEntry[];
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onContinue?: (session: AgentSessionRead) => void;
}) {
  // 跨 run 分组（保持后端返回顺序：run 顺序内 timestamp 升序）
  const groups = useMemo(() => {
    const map = new Map<string, AgentRunLogEntry[]>();
    for (const log of logs) {
      const list = map.get(log.run_id) ?? [];
      list.push(log);
      map.set(log.run_id, list);
    }
    return Array.from(map.entries());
  }, [logs]);

  // task-11 D-004：active 不显示续聊按钮（本就活跃走只读回看 ql-007）；
  // 其余状态显示按钮，canResume 决定是否可点。
  const showResumeBtn = session != null && session.status !== "active";
  const resumeEnabled = canResumeSession(session);

  return (
    <section className="flex min-h-[520px] flex-col overflow-hidden rounded-md border bg-card">
      <header className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">
            历史回看{session ? ` · ${shortId(session.id)}` : ""}
          </h2>
          <p className="text-[11px] text-muted-foreground">
            只读视图（{groups.length} 个 turn）
          </p>
        </div>
        <div className="flex items-center gap-2">
          {showResumeBtn && session && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1 text-[11px]"
              disabled={!resumeEnabled || !onContinue}
              title={resumeEnabled ? "恢复会话并续聊" : resumeDisabledTitle(session)}
              onClick={() => {
                if (resumeEnabled && onContinue && session) onContinue(session);
              }}
            >
              <MessageSquarePlus className="h-3.5 w-3.5" />
              继续对话
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onClose} className="h-7 text-[11px]">
            关闭
          </Button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto bg-muted/20 px-4 py-4">
        {loading ? (
          <p className="text-center text-[11px] text-muted-foreground">加载历史日志…</p>
        ) : error ? (
          <p className="text-center text-[11px] text-destructive">{error}</p>
        ) : groups.length === 0 ? (
          <p className="py-8 text-center text-[11px] text-muted-foreground">暂无历史日志</p>
        ) : (
          <div className="space-y-4">
            {groups.map(([runId, entries]) => (
              <div key={runId} className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
                  <span className="font-mono">run {shortId(runId)}</span>
                </div>
                {entries.map((log) => {
                  // task-02 / FR-1：按 channel 区分 user / agent 气泡。
                  // channel === "user_input" → 右对齐 primary 气泡；其余（含缺失）→ 左对齐白底。
                  const isUser = log.channel === "user_input";
                  return (
                    <div
                      key={log.id}
                      className={isUser ? "flex justify-end" : "flex justify-start"}
                    >
                      <div
                        className={
                          isUser
                            ? "max-w-[86%] whitespace-pre-wrap break-words rounded-md bg-primary px-3 py-2 text-xs leading-relaxed text-primary-foreground shadow-sm"
                            : "max-w-[86%] whitespace-pre-wrap break-words rounded-md border bg-card px-3 py-2 text-xs leading-relaxed text-foreground shadow-sm"
                        }
                      >
                        {log.content_redacted ?? ""}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * 会话列表 + 历史回看容器：持有 selection / loading / logs 状态，
 * 包裹 task-11 的 InteractiveSessionPanel（live，不重建其内部 SSE）。
 */
function SessionListSection({
  runtimes,
  focusRuntime,
  onClearFocus,
}: {
  runtimes: DaemonRuntimeRead[];
  /** ql-012：从 runtime 卡片「会话」聚焦的运行时；null/undefined 走全局会话视图。 */
  focusRuntime?: DaemonRuntimeRead | null;
  onClearFocus?: () => void;
}) {
  const [sessions, setSessions] = useState<AgentSessionRead[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AgentSessionRead | null>(null);
  const [logs, setLogs] = useState<AgentRunLogEntry[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  // task-11：reopen 成功的会话进入 attach 续聊面板（历史回看↔attach 切换）
  const [attachSession, setAttachSession] = useState<AgentSessionRead | null>(null);
  // ql-012：聚焦 runtime 时，sidebar 仅显示该 runtime 的历史会话。
  const visibleSessions = useMemo(
    () => (focusRuntime ? sessions.filter((s) => s.runtime_id === focusRuntime.id) : sessions),
    [sessions, focusRuntime],
  );

  const reloadSessions = useCallback(async () => {
    setLoading(true);
    setListError(null);
    try {
      const resp = await listAgentSessions({ limit: 50 });
      setSessions(resp.items);
    } catch (err) {
      setListError(err instanceof ApiError ? err.message : "加载会话失败");
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reloadSessions();
  }, [reloadSessions]);

  const handleSelect = useCallback(async (session: AgentSessionRead) => {
    setSelected(session);
    // 所有会话（含 active）统一只读历史回看：拉跨 run 日志（D-005 聚合在后端）。
    // ql-20260619-007：之前 active 走 live 空白分支不回显（setLogs([])+return），
    // 而 InteractiveSessionChatSection 不接收选中 session、InteractiveSessionPanel
    // 又无「打开已有会话」入口 → 点 active 会话右侧空白。active 的 live 续看/追问
    // 需 LivePanel 支持 resume，属更大重构，单独 task；当前所有选中会话均进只读视图。
    setLogsLoading(true);
    setLogsError(null);
    try {
      const fetched = await getAgentSessionLogs(session.id);
      setLogs(fetched);
    } catch (err) {
      setLogsError(err instanceof ApiError ? err.message : "加载历史失败");
      setLogs([]);
    } finally {
      setLogsLoading(false);
    }
  }, []);

  const handleDelete = useCallback(async (session: AgentSessionRead) => {
    const confirmed = window.confirm(
      `确定删除会话 ${shortId(session.id)}？运行记录和日志仍会保留。`,
    );
    if (!confirmed) return;

    setDeletingSessionId(session.id);
    setListError(null);
    try {
      await deleteAgentSession(session.id);
      setSessions((current) => current.filter((item) => item.id !== session.id));
      if (selected?.id === session.id) {
        setSelected(null);
        setLogs([]);
        setLogsError(null);
      }
    } catch (err) {
      setListError(err instanceof ApiError ? err.message : "删除会话失败");
    } finally {
      setDeletingSessionId(null);
    }
  }, [selected?.id]);

  // task-11：续聊 → reopen 恢复会话，成功后右侧切 attach InteractiveSessionPanel。
  // 失败（409 OFFLINE 等）→ setListError 提示，不切 attach。
  const handleContinue = useCallback(async (session: AgentSessionRead) => {
    setListError(null);
    try {
      await reopenSession(session.id);
      // 用当前已加载的 logs 预填 attach panel（handleSelect 已拉取）
      setAttachSession(session);
    } catch (err) {
      setListError(err instanceof ApiError ? err.message : "恢复会话失败");
    }
  }, []);

  return (
    <section className="flex min-w-0 flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">
            会话{focusRuntime ? ` · ${focusRuntime.name ?? getProviderLabel(focusRuntime.provider)}` : ""}
          </h2>
          <p className="text-[11px] text-muted-foreground">
            {focusRuntime
              ? "已聚焦该运行时：历史仅显示其会话，新建会话使用此提供方"
              : "选择历史会话回看，或进入 live 面板新建会话"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {focusRuntime && onClearFocus && (
            <Button
              size="sm"
              variant="ghost"
              onClick={onClearFocus}
              className="h-7 text-[11px]"
            >
              显示全部
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => void reloadSessions()}
            disabled={loading}
            className="h-7 text-[11px]"
          >
            刷新会话
          </Button>
        </div>
      </div>
      <div className="grid gap-3 lg:grid-cols-[260px_minmax(0,1fr)]">
        <SessionsSidebar
          sessions={visibleSessions}
          loading={loading}
          error={listError}
          selectedSessionId={selected?.id ?? null}
          deletingSessionId={deletingSessionId}
          onSelect={(s) => void handleSelect(s)}
          onDelete={(s) => void handleDelete(s)}
          onRetry={() => void reloadSessions()}
        />
        {attachSession ? (
          // task-11：reopen 成功 → attach 续聊面板（预填历史 turn + SSE + 轮询）
          <InteractiveSessionChatSection
            runtimes={runtimes}
            attachSession={attachSession}
            initialTurns={logsToTurns(logs)}
            onCloseAttach={() => setAttachSession(null)}
          />
        ) : selected ? (
          <SessionHistoryView
            session={selected}
            logs={logs}
            loading={logsLoading}
            error={logsError}
            onClose={() => setSelected(null)}
            onContinue={(s) => void handleContinue(s)}
          />
        ) : (
          <InteractiveSessionChatSection
            key={focusRuntime?.id ?? "global"}
            runtimes={runtimes}
            focusProvider={focusRuntime?.provider ?? undefined}
          />
        )}
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
  const [focusedRuntime, setFocusedRuntime] = useState<DaemonRuntimeRead | null>(null);
  const sessionSectionRef = useRef<HTMLDivElement>(null);

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

  // ql-012：移除运行时（物理删除，级联清会话/lease）。
  const handleDeleteRuntime = useCallback(async (runtime: DaemonRuntimeRead) => {
    const confirmed = window.confirm(
      `确定移除运行时「${runtime.name ?? getProviderLabel(runtime.provider)}」？\n将同时清除该运行时下的会话与任务记录，且不可恢复。daemon 下次心跳会重新注册。`,
    );
    if (!confirmed) return;
    setError(null);
    setRuntimeActionId(runtime.id);
    try {
      await deleteDaemonRuntime(runtime.id);
      setItems((prev) => (prev ? prev.filter((item) => item.id !== runtime.id) : prev));
      setSessions((prev) => prev.filter((s) => s.runtime_id !== runtime.id));
      if (focusedRuntime?.id === runtime.id) setFocusedRuntime(null);
      setLastRefreshedAt(new Date());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "移除运行时失败");
    } finally {
      setRuntimeActionId(null);
    }
  }, [focusedRuntime?.id]);

  // ql-012：卡片「会话」→ 聚焦该 runtime + 滚动到会话区。
  const handleOpenSession = useCallback((runtime: DaemonRuntimeRead) => {
    setFocusedRuntime(runtime);
    setTimeout(() => {
      sessionSectionRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    }, 0);
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
        <div className="w-full lg:max-w-xl">
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
                <div
                  data-testid="runtime-list-scroll"
                  className="max-h-[680px] overflow-y-auto pr-1"
                >
                  <div className="grid gap-3 xl:grid-cols-2">
                    {displayItems.map((runtime) => (
                      <RuntimeCard
                        key={runtime.id}
                        runtime={runtime}
                        actioning={runtimeActionId === runtime.id}
                        sessionStats={sessionStatsByRuntime.get(runtime.id) ?? { total: 0, active: 0 }}
                        onToggleEnabled={handleToggleRuntime}
                        onOpenSession={handleOpenSession}
                        onDelete={handleDeleteRuntime}
                      />
                    ))}
                  </div>
                </div>
              </section>
            )}

            <div ref={sessionSectionRef} className="scroll-mt-6">
              <SessionListSection
                runtimes={items}
                focusRuntime={focusedRuntime}
                onClearFocus={() => setFocusedRuntime(null)}
              />
            </div>
          </div>
        </>
      )}
    </main>
  );
}
