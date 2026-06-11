"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Bot,
  Check,
  CheckCircle2,
  CircleDashed,
  Copy,
  MessageSquareText,
  RefreshCw,
  Send,
  Server,
  Terminal,
  Wifi,
  WifiOff,
  Wrench,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  getQuickChatResult,
  isVersionBelow,
  listDaemonRuntimes,
  MIN_VERSIONS,
  PROVIDER_META,
  quickChat,
  type DaemonRuntimeRead,
} from "@/lib/daemon";
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

  if (!accessToken) return null;

  const frontendUrl =
    typeof window !== "undefined" ? window.location.origin : "http://localhost:3001";
  const serverUrl = frontendUrl.replace(/:3001$/, ":8001");
  const cmd = `sillyhub-daemon start --server ${serverUrl} --token ${accessToken}`;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(cmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={cn("flex min-w-0 items-center gap-2", compact && "w-full")}>
      <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border bg-card px-2.5 py-1.5 shadow-sm">
        <Terminal className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <code className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">
          sillyhub-daemon start --server {serverUrl} --token ...
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
  );
}

interface ChatMessage {
  role: "user" | "agent";
  content: string;
}

function QuickChatPanel({ runtimes }: { runtimes: DaemonRuntimeRead[] }) {
  const uniqueProviders = useMemo(() => {
    const onlineProviders = runtimes
      .filter((runtime) => runtime.status === "online" && runtime.provider)
      .map((runtime) => runtime.provider!);
    return [...new Set(onlineProviders)];
  }, [runtimes]);

  const [provider, setProvider] = useState(() => uniqueProviders[0] ?? "claude");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [lastRunId, setLastRunId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (uniqueProviders.length > 0 && !uniqueProviders.includes(provider)) {
      setProvider(uniqueProviders[0] ?? "claude");
      setLastRunId(null);
    }
  }, [uniqueProviders, provider]);

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [messages]);

  const pollResult = async (runId: string) => {
    const maxAttempts = 60;
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      try {
        const res = await getQuickChatResult(runId);
        if (res.status === "completed" || res.status === "failed") {
          const output = res.output_redacted?.trim();
          return output || (res.status === "failed" ? "执行失败" : "(无输出)");
        }
      } catch {
        // Keep polling while the daemon result is still settling.
      }
    }
    return "等待超时";
  };

  const handleSend = async () => {
    const prompt = input.trim();
    if (!prompt || sending) return;

    setMessages((prev) => [...prev, { role: "user", content: prompt }]);
    setInput("");
    setSending(true);

    try {
      const resp = await quickChat(prompt, provider, lastRunId ?? undefined);
      if (resp.status === "completed" || resp.status === "failed") {
        const result = await getQuickChatResult(resp.id);
        const output =
          result.output_redacted?.trim() || (resp.status === "failed" ? "执行失败" : "(无输出)");
        setMessages((prev) => [...prev, { role: "agent", content: output }]);
        if (result.status === "completed") setLastRunId(resp.id);
      } else if (resp.status === "pending") {
        setMessages((prev) => [...prev, { role: "agent", content: "..." }]);
        const output = await pollResult(resp.id);
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: "agent", content: output };
          return updated;
        });
        setLastRunId(resp.id);
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: "agent",
          content: `错误：${err instanceof ApiError ? err.message : "发送失败"}`,
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  if (uniqueProviders.length === 0) {
    return (
      <section className="flex min-h-[360px] flex-col items-center justify-center rounded-md border border-dashed bg-card px-6 text-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <MessageSquareText className="h-5 w-5" />
        </div>
        <h2 className="mt-4 text-sm font-semibold">快速对话</h2>
        <p className="mt-1 max-w-xs text-xs text-muted-foreground">
          没有在线运行时，启动守护进程后即可发送给本地代理。
        </p>
      </section>
    );
  }

  const tone = getProviderTone(provider);

  return (
    <section className="flex min-h-[520px] flex-col overflow-hidden rounded-md border bg-card">
      <header className="border-b px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-md", tone?.panel ?? "bg-muted text-muted-foreground")}>
              <MessageSquareText className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold">快速对话</h2>
              <p className="text-[11px] text-muted-foreground">
                {lastRunId ? `会话 ${shortId(lastRunId)}` : "新的本地会话"}
              </p>
            </div>
          </div>
          <Badge variant="outline">{uniqueProviders.length} 个提供方</Badge>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <select
            value={provider}
            onChange={(event) => {
              setProvider(event.target.value);
              setLastRunId(null);
            }}
            className="h-8 min-w-0 flex-1 rounded border border-input bg-background px-2 text-xs focus:border-ring focus:outline-none"
          >
            {uniqueProviders.map((item) => (
              <option key={item} value={item}>
                {getProviderLabel(item)}
              </option>
            ))}
          </select>
          <ProviderBadge provider={provider} />
        </div>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto bg-muted/20 px-4 py-4">
        {messages.length === 0 ? (
          <div className="flex h-full min-h-[260px] flex-col items-center justify-center text-center">
            <Bot className="h-8 w-8 text-muted-foreground/70" />
            <p className="mt-3 text-xs font-medium text-foreground">
              {getProviderLabel(provider)} 已就绪
            </p>
            <p className="mt-1 max-w-[260px] text-[11px] text-muted-foreground">
              提示词会发送到当前在线提供方，并延续最近一次完成的会话。
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}
              >
                <div
                  className={cn(
                    "max-w-[86%] rounded-md px-3 py-2 text-xs leading-relaxed shadow-sm",
                    message.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "border bg-card text-foreground",
                  )}
                >
                  <div className="whitespace-pre-wrap break-words">{message.content}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <footer className="border-t bg-card px-3 py-3">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void handleSend();
              }
            }}
            placeholder="输入提示词..."
            className="min-h-10 flex-1 resize-none rounded border border-input bg-background px-3 py-2 text-sm leading-5 focus:border-ring focus:outline-none"
            rows={2}
            disabled={sending}
          />
          <Button
            onClick={handleSend}
            disabled={sending || !input.trim()}
            className="h-10 w-10 shrink-0 p-0"
            title={sending ? "发送中" : "发送"}
          >
            {sending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </footer>
    </section>
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
  tone?: "neutral" | "online" | "warning" | "offline";
}) {
  const toneClass = {
    neutral: "border-slate-200 bg-white text-slate-700",
    online: "border-emerald-200 bg-emerald-50 text-emerald-700",
    warning: "border-amber-200 bg-amber-50 text-amber-700",
    offline: "border-slate-200 bg-slate-50 text-slate-600",
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

function RuntimeCard({ runtime }: { runtime: DaemonRuntimeRead }) {
  const status = getStatusMeta(runtime.status);
  const StatusIcon = status.icon;
  const capabilityChips = getCapabilityChips(runtime);
  const heartbeat = formatRelativeTime(runtime.last_heartbeat_at);
  const displayVersion = getDisplayVersion(runtime);
  const protocol = getProtocol(runtime);

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
              {shortId(runtime.id)}
            </p>
          </div>
        </div>
        <span className={cn("mt-1 h-2.5 w-2.5 shrink-0 rounded-full", status.dot)} />
      </header>

      <div className="grid grid-cols-2 gap-4 px-4 py-3">
        <RuntimeMeta label="代理">{getProviderLabel(runtime.provider)}</RuntimeMeta>
        <RuntimeMeta label="协议">{protocol}</RuntimeMeta>
        <RuntimeMeta label="心跳">{heartbeat}</RuntimeMeta>
        <RuntimeMeta label="版本">
          {displayVersion ? (
            <VersionCell provider={runtime.provider} version={displayVersion} />
          ) : (
            <span className="text-muted-foreground">待识别</span>
          )}
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
        <h2 className="mt-4 text-base font-semibold">尚未注册任何 Daemon 运行时</h2>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          启动本地守护进程后，平台会在这里显示提供方、版本、心跳和可用代理。
        </p>
      </div>
      <div className="rounded-md border bg-card p-4">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">启动入口</h2>
        </div>
        <ol className="mt-4 space-y-3 text-xs text-muted-foreground">
          <li className="rounded border bg-muted/30 px-3 py-2">
            <span className="font-medium text-foreground">1.</span> cd sillyhub-daemon && pip install -e .
          </li>
          <li className="rounded border bg-muted/30 px-3 py-2">
            <span className="font-medium text-foreground">2.</span> 复制页面右上角守护进程启动命令
          </li>
        </ol>
      </div>
    </section>
  );
}

export default function RuntimesPage() {
  const [items, setItems] = useState<DaemonRuntimeRead[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);

  const reload = useCallback(async (options: { showFeedback?: boolean } = {}) => {
    setError(null);
    const showFeedback = options.showFeedback ?? false;
    if (showFeedback) setRefreshing(true);
    const startedAt = Date.now();
    try {
      const [list] = await Promise.all([
        listDaemonRuntimes(),
        showFeedback
          ? new Promise((resolve) => setTimeout(resolve, Math.max(0, 500 - (Date.now() - startedAt))))
          : Promise.resolve(),
      ]);
      setItems(list);
      setLastRefreshedAt(new Date());
    } catch (err) {
      setItems([]);
      setError(err instanceof ApiError ? err.message : "加载列表失败");
    } finally {
      if (showFeedback) setRefreshing(false);
    }
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
      offline: 2,
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
      offline,
      providers: providers.size,
      latestHeartbeat: latestHeartbeat ? formatRelativeTime(latestHeartbeat) : "无心跳",
    };
  }, [items]);

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-6 py-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase text-muted-foreground">系统</p>
          <h1 className="mt-1">Daemon 运行时</h1>
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
      ) : items.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryCard label="总数" value={String(stats.total)} icon={Server} meta={`${stats.providers} 个提供方`} />
            <SummaryCard label="在线" value={String(stats.online)} icon={CheckCircle2} tone="online" meta={stats.latestHeartbeat} />
            <SummaryCard label="维护中" value={String(stats.maintenance)} icon={Wrench} tone="warning" />
            <SummaryCard label="离线" value={String(stats.offline)} icon={WifiOff} tone="offline" />
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_430px]">
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
              <div className="grid gap-3 lg:grid-cols-2">
                {displayItems.map((runtime) => (
                  <RuntimeCard key={runtime.id} runtime={runtime} />
                ))}
              </div>
            </section>

            <QuickChatPanel runtimes={items} />
          </div>
        </>
      )}
    </main>
  );
}
