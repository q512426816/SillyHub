"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Ban,
  Bot,
  Check,
  CheckCircle2,
  CircleDashed,
  Copy,
  MessageSquareText,
  Plus,
  Power,
  RefreshCw,
  Send,
  Server,
  Terminal,
  Wifi,
  WifiOff,
  Wrench,
  type LucideIcon,
} from "lucide-react";

import { AgentModelInput } from "@/components/AgentModelInput";
import { AgentLogViewer } from "@/components/agent-log-viewer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  disableDaemonRuntime,
  enableDaemonRuntime,
  getQuickChatLogs,
  getQuickChatResult,
  isVersionBelow,
  listDaemonRuntimes,
  MIN_VERSIONS,
  PROVIDER_META,
  quickChat,
  streamQuickChat,
  type DaemonRuntimeRead,
  type QuickChatStreamMessage,
} from "@/lib/daemon";
import type { AgentRunLogEntry } from "@/lib/agent";
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
          ⚠️ 当前显示的 --token 是浏览器 access_token（15 分钟过期），daemon 长期运行建议{" "}
          <a href="/settings/api-keys" className="underline">
            签发 API Key
          </a>{" "}
          后用 --api-key。
        </p>
      )}
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
  const [model, setModel] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [lastRunId, setLastRunId] = useState<string | null>(null);
  // ql-20260618-001：quick-chat 也展示 agent 日志（与 workspace agent console 同源 AgentLogViewer）
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [runLogs, setRunLogs] = useState<AgentRunLogEntry[] | null>(null);
  const [logsLoading, setLogsLoading] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const logsPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasOnlineProvider = uniqueProviders.length > 0;
  const providerOptions = hasOnlineProvider ? uniqueProviders : [provider];

  // 组件卸载时关闭 SSE + 清理兜底 timer
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (fallbackTimerRef.current) {
        clearTimeout(fallbackTimerRef.current);
        fallbackTimerRef.current = null;
      }
      if (logsPollRef.current) {
        clearInterval(logsPollRef.current);
        logsPollRef.current = null;
      }
    };
  }, []);

  // ql-20260618-001：activeRunId 变化时拉一次日志，运行中则轮询；终态停轮询。
  useEffect(() => {
    if (logsPollRef.current) {
      clearInterval(logsPollRef.current);
      logsPollRef.current = null;
    }
    if (!activeRunId) {
      setRunLogs(null);
      return;
    }

    let cancelled = false;
    const fetchLogs = async () => {
      try {
        const logs = await getQuickChatLogs(activeRunId);
        if (!cancelled) {
          setRunLogs(logs);
          setLogsLoading(false);
          // 终态：停止轮询
          const last = logs[logs.length - 1];
          const isTerminal = last?.channel === "stdout" &&
            /^\[SYSTEM:done\]/.test(last.content_redacted ?? "");
          if (isTerminal && logsPollRef.current) {
            clearInterval(logsPollRef.current);
            logsPollRef.current = null;
          }
        }
      } catch {
        if (!cancelled) setLogsLoading(false);
      }
    };

    setLogsLoading(true);
    void fetchLogs();
    logsPollRef.current = setInterval(() => void fetchLogs(), 1500);

    return () => {
      cancelled = true;
      if (logsPollRef.current) {
        clearInterval(logsPollRef.current);
        logsPollRef.current = null;
      }
    };
  }, [activeRunId]);

  useEffect(() => {
    if (uniqueProviders.length > 0 && !uniqueProviders.includes(provider)) {
      setProvider(uniqueProviders[0] ?? "claude");
      setLastRunId(null);
    }
  }, [uniqueProviders, provider]);

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [messages]);

  /**
   * 把 SSE 收到的 QuickChatStreamMessage 渲染成追加到聊天框的纯文本片段。
   * 内含多条 agent event，按 event_type 分类格式化：
   *   - text         → 直接 append content
   *   - tool_use     → \n🔧 <tool_name>: <input>
   *   - tool_result  → \n📥 <tool_name>: <output>（截断长输出）
   *   - error        → \n⚠️ <content>
   *   - 其他         → 忽略（complete 等无文本事件）
   */
  const renderStreamMessage = (msg: QuickChatStreamMessage): string => {
    const parts: string[] = [];
    for (const ev of msg.messages ?? []) {
      const content = (ev.content ?? "").trim();
      switch (ev.event_type) {
        case "text": {
          if (!content) break;
          // ql-20260618-005：跳过 SYSTEM/RESULT 系统消息，避免 chat 面板出现
          // [SYSTEM:thread_started] / [RESULT:success] 等技术日志。
          if (/^\[(SYSTEM|RESULT)[^\]]*\]/.test(content)) break;
          // 剥掉 [ASSISTANT] / [THINKING] 前缀（非流式 message 兜底；
          // 流式 delta 已在 daemon 端不加前缀）。
          const stripped = content.replace(
            /^\[(ASSISTANT|THINKING|LOG:\w+)\]\s?/,
            "",
          );
          if (stripped) parts.push(stripped);
          break;
        }
        case "tool_use":
          parts.push(`\n🔧 ${ev.tool_name ?? "tool"}: ${content}`);
          break;
        case "tool_result": {
          const truncated = content.length > 200 ? `${content.slice(0, 200)}…` : content;
          parts.push(`\n📥 ${ev.tool_name ?? "tool"}: ${truncated}`);
          break;
        }
        case "error":
          if (content) parts.push(`\n⚠️ ${content}`);
          break;
        default:
          // complete / status 等无文本事件忽略
          break;
      }
    }
    return parts.join("");
  };

  /**
   * 启动 SSE 订阅，逐条把 agent 输出 append 到最后一条 agent 消息。
   * 兜底机制：
   *   - onDone 触发：写入 lastRunId（若 completed），关闭 SSE
   *   - 60 秒内没收到任何 message/done → 视为连接异常，回退到 GET 拿最终结果
   *   - onError 触发：也回退到 GET 拿最终结果（避免连不上时面板卡死）
   */
  const streamRun = (runId: string): Promise<void> => {
    return new Promise((resolve) => {
      let receivedAny = false;
      let settled = false;

      const cleanup = () => {
        if (eventSourceRef.current) {
          eventSourceRef.current.close();
          eventSourceRef.current = null;
        }
        if (fallbackTimerRef.current) {
          clearTimeout(fallbackTimerRef.current);
          fallbackTimerRef.current = null;
        }
      };

      const fallbackToGet = async () => {
        if (settled) return;
        settled = true;
        cleanup();
        // 轮询 GET 最终结果（最多 60 次 × 2s = 2 分钟）
        for (let i = 0; i < 60; i++) {
          await new Promise((r) => setTimeout(r, 2000));
          try {
            const res = await getQuickChatResult(runId);
            if (res.status === "completed" || res.status === "failed") {
              const output = res.output_redacted?.trim();
              const finalText =
                output || (res.status === "failed" ? "执行失败" : "(无输出)");
              setMessages((prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = { role: "agent", content: finalText };
                return updated;
              });
              if (res.status === "completed") setLastRunId(runId);
              resolve();
              return;
            }
          } catch {
            // continue polling
          }
        }
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            role: "agent",
            content:
              (updated[updated.length - 1]?.content ?? "") + "\n\n(等待超时)",
          };
          return updated;
        });
        resolve();
      };

      // 60s 内没有任何消息/done → 触发回退
      fallbackTimerRef.current = setTimeout(() => {
        if (!receivedAny) fallbackToGet();
      }, 60_000);

      const es = streamQuickChat(
        runId,
        (msg) => {
          receivedAny = true;
          const text = renderStreamMessage(msg);
          if (!text) return;
          setMessages((prev) => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            const prevContent = last?.role === "agent" ? last.content : "";
            updated[updated.length - 1] = {
              role: "agent",
              content: prevContent + (prevContent && !prevContent.endsWith("\n") ? "" : "") + text,
            };
            return updated;
          });
        },
        async (data) => {
          if (settled) return;
          settled = true;
          cleanup();
          if (data.status === "completed") {
            setLastRunId(runId);
          } else if (data.status === "failed") {
            // 如果 agent 一字未吐就 failed，补一句提示
            setMessages((prev) => {
              const updated = [...prev];
              const last = updated[updated.length - 1];
              if (last?.role === "agent" && (!last.content || last.content === "...")) {
                updated[updated.length - 1] = { role: "agent", content: "执行失败" };
              }
              return updated;
            });
          }
          resolve();
        },
        () => {
          // onError：SSE 连不上 / 401 / 网络中断。给个回退机会拿最终结果。
          if (!settled && !receivedAny) {
            fallbackToGet();
          }
        },
      );
      eventSourceRef.current = es;
    });
  };

  const handleSend = async () => {
    const prompt = input.trim();
    if (!prompt || sending || !hasOnlineProvider) return;

    setMessages((prev) => [...prev, { role: "user", content: prompt }]);
    setInput("");
    setSending(true);

    try {
      const resp = await quickChat(prompt, provider, lastRunId ?? undefined, model);
      // ql-20260618-001：每次发送都激活新的 run，触发日志拉取
      setActiveRunId(resp.id);
      setShowLogs(true);
      setRunLogs(null);
      if (resp.status === "completed" || resp.status === "failed") {
        // daemon 同步完成（极少见，prompt 极短或 daemon 拒绝）：直接读 DB
        const result = await getQuickChatResult(resp.id);
        const output =
          result.output_redacted?.trim() || (resp.status === "failed" ? "执行失败" : "(无输出)");
        setMessages((prev) => [...prev, { role: "agent", content: output }]);
        if (result.status === "completed") setLastRunId(resp.id);
      } else if (resp.status === "pending") {
        // 占位 agent 消息，streamRun 期间逐步填充
        setMessages((prev) => [...prev, { role: "agent", content: "..." }]);
        await streamRun(resp.id);
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
          <div className="flex items-center gap-2">
            {lastRunId && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setLastRunId(null);
                  setActiveRunId(null);
                  setMessages([]);
                  setShowLogs(false);
                }}
                className="h-7 gap-1 px-2 text-[11px]"
                title="清空当前会话，开启新对话"
              >
                <Plus className="h-3 w-3" />
                新建会话
              </Button>
            )}
            <Button
              variant={showLogs ? "default" : "outline"}
              size="sm"
              onClick={() => setShowLogs((v) => !v)}
              disabled={!activeRunId}
              className="h-7 gap-1 px-2 text-[11px]"
              title={showLogs ? "隐藏 Agent 控制台日志" : "显示 Agent 控制台日志"}
            >
              <Terminal className="h-3 w-3" />
              {showLogs ? "隐藏日志" : "查看日志"}
            </Button>
            <Badge variant="outline">{hasOnlineProvider ? `${uniqueProviders.length} 个提供方` : "未连接"}</Badge>
          </div>
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-muted-foreground">Agent provider</label>
            <select
              value={provider}
              onChange={(event) => {
                setProvider(event.target.value);
                setLastRunId(null);
              }}
              disabled={!hasOnlineProvider}
              className="h-8 w-full min-w-0 rounded border border-input bg-background px-2 text-xs focus:border-ring focus:outline-none disabled:cursor-not-allowed disabled:bg-muted"
            >
              {providerOptions.map((item) => (
                <option key={item} value={item}>
                  {getProviderLabel(item)}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-muted-foreground">Agent model</label>
            <AgentModelInput
              value={model}
              onChange={(next) => {
                setModel(next);
                setLastRunId(null);
              }}
              placeholder="model override"
              className="w-full"
            />
          </div>
          <ProviderBadge provider={provider} />
        </div>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto bg-muted/20 px-4 py-4">
        {!hasOnlineProvider ? (
          <div className="flex h-full min-h-[260px] flex-col items-center justify-center text-center">
            <Bot className="h-8 w-8 text-muted-foreground/70" />
            <p className="mt-3 text-xs font-medium text-foreground">
              没有在线 Daemon
            </p>
            <p className="mt-1 max-w-[280px] text-[11px] text-muted-foreground">
              这里可以先配置本次快速对话的 model；启动 daemon 后即可发送。
            </p>
          </div>
        ) : messages.length === 0 ? (
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

      {showLogs && activeRunId && (
        <div className="border-t bg-card">
          <AgentLogViewer
            title="快速对话 Agent 控制台"
            runId={activeRunId}
            logs={runLogs}
            loading={logsLoading}
            emptyText="等待 Agent 日志输出..."
            isLive={sending}
            maxHeightClass="max-h-[360px]"
            compact
          />
        </div>
      )}

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
            disabled={sending || !hasOnlineProvider}
          />
          <Button
            onClick={handleSend}
            disabled={sending || !input.trim() || !hasOnlineProvider}
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
  onToggleEnabled,
}: {
  runtime: DaemonRuntimeRead;
  actioning: boolean;
  onToggleEnabled: (runtime: DaemonRuntimeRead) => Promise<void>;
}) {
  const status = getStatusMeta(runtime.status);
  const StatusIcon = status.icon;
  const capabilityChips = getCapabilityChips(runtime);
  const heartbeat = formatRelativeTime(runtime.last_heartbeat_at);
  const displayVersion = getDisplayVersion(runtime);
  const protocol = getProtocol(runtime);
  const isDisabled = runtime.status === "disabled";
  const ActionIcon = isDisabled ? Power : Ban;

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

      <div className="flex justify-end border-t px-4 py-3">
        <Button
          size="sm"
          variant={isDisabled ? "outline" : "destructive"}
          className="gap-1.5"
          disabled={actioning}
          onClick={() => void onToggleEnabled(runtime)}
          title={isDisabled ? "启用此 Agent runtime" : "禁用此 Agent runtime"}
        >
          {actioning ? (
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ActionIcon className="h-3.5 w-3.5" />
          )}
          {actioning ? "处理中" : isDisabled ? "启用" : "禁用"}
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
        <h2 className="mt-4 text-base font-semibold">尚未注册任何 Daemon 运行时</h2>
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
          Daemon 是 Node.js/TypeScript 实现，需要 Node ≥ 20。如果之前装过 Python 旧版的 <code className="font-mono">sillyhub-daemon</code>（脚本目录里残留 <code className="font-mono">sillyhub-daemon.exe</code>），先用 <code className="font-mono">pip uninstall sillyhub-daemon</code> 卸载，否则会冲突报 <code className="font-mono">ModuleNotFoundError: No module named &#39;sillyhub_daemon.__main__&#39;</code>。
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

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_430px]">
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
                <div className="grid gap-3 lg:grid-cols-2">
                  {displayItems.map((runtime) => (
                    <RuntimeCard
                      key={runtime.id}
                      runtime={runtime}
                      actioning={runtimeActionId === runtime.id}
                      onToggleEnabled={handleToggleRuntime}
                    />
                  ))}
                </div>
              </section>
            )}

            <QuickChatPanel runtimes={items} />
          </div>
        </>
      )}
    </main>
  );
}
