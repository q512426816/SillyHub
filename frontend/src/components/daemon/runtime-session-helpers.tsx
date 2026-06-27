// runtime-session-helpers.tsx: 从 page.tsx 提取的会话列表/历史回看/attach 续聊 helper（task-01）
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { MessageSquarePlus, Plus, RefreshCw, Send, Trash2 } from "lucide-react";

import { AgentModelInput } from "@/components/AgentModelInput";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MarkdownText } from "@/components/ui/markdown-text";
import { InteractiveSessionPanel, type SessionTurnView } from "@/components/daemon/interactive-session-panel";
import { type AgentRunLogEntry } from "@/lib/agent";
import {
  PROVIDER_META,
  getQuickChatResult,
  quickChat,
  streamQuickChat,
  type AgentSessionRead,
  type AgentSessionStatus,
  type DaemonRuntimeRead,
  type QuickChatStreamMessage,
} from "@/lib/daemon";
import { cn } from "@/lib/utils";

export function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}...${id.slice(-4)}` : id;
}

/**
 * task-11：交互式会话面板包装（演进自 quick-chat）。
 *
 * 保留 provider/model 选择 + runtime 卡片布局，会话核心替换为
 * InteractiveSessionPanel（单一 SSE 贯穿多 turn / inject / interrupt / end）。
 * 旧 QuickChatPanel / quickChat / streamQuickChat / getQuickChatResult / getQuickChatLogs
 * 保留用于 brownfield 回归，不再被页面使用。
 */
export function InteractiveSessionChatSection({
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
  // ql-20260623（改动一）：用 ?session=<id> 在 URL 中承载当前活跃会话 id，
  // 刷新后从 URL 恢复。router.replace 不进历史栈。
  const router = useRouter();
  const searchParams = useSearchParams();

  // task-08 / D-005@v1：Codex 与 Claude 均走 interactive SessionManager（撤销 quick-chat 分流）。
  // daemon SessionManager（task-06）与 backend reopen（task-07）已放开 codex，二者都是
  // 在线 interactive provider。
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

  // ql-20260623（改动一）：createSession 成功 → 写 ?session=<id>（保留其它 query param）
  const handleSessionCreated = useCallback((sessionId: string) => {
    const next = new URLSearchParams(searchParams.toString());
    next.set("session", sessionId);
    router.replace(`?${next.toString()}`, { scroll: false });
  }, [router, searchParams]);

  // ql-20260623（改动一）：新建会话（重置回 idle）→ 清除 ?session= param
  const handleSessionReset = useCallback(() => {
    const next = new URLSearchParams(searchParams.toString());
    next.delete("session");
    const qs = next.toString();
    const target = qs ? `?${qs}` : window.location.pathname;
    router.replace(target, { scroll: false });
  }, [router, searchParams]);

  return (
    <div className="flex h-full min-w-0 flex-col">
      {attachSession && onCloseAttach && (
        <div className="flex h-10 shrink-0 items-center justify-end border-b bg-muted/20 px-5">
          <Button
            size="sm"
            variant="ghost"
            onClick={onCloseAttach}
            className="h-7 text-xs"
          >
            返回历史
          </Button>
        </div>
      )}
      {/* key 强制 attach 切换时重 mount（清旧 SSE/轮询，task-10 unmount close）。
          外层 min-h-0 flex-1 overflow-hidden 容器为 panel 提供确定高度：
          弹窗 grid 行高已由 grid-rows-[minmax(0,1fr)] 约束，此处再保证 attach
          返回栏与 panel 在 flex-col 下正确分配，panel h-full 填满剩余空间，
          否则消息变多会撑破容器被上层 overflow-hidden 裁掉（底部输入框/最新消息看不到）。 */}
      <div className="min-h-0 flex-1 overflow-hidden">
        <InteractiveSessionPanel
          key={attachSession?.id ?? "live"}
          providers={providers}
          defaultProvider={defaultProvider}
          model={model}
          onModelChange={setModel}
          hasOnlineProvider={hasOnlineProvider}
          attachSessionId={attachSession?.id}
          initialTurns={initialTurns}
          onSessionCreated={handleSessionCreated}
          onSessionReset={handleSessionReset}
        />
      </div>
    </div>
  );
}

type QuickChatTurnStatus = "running" | "completed" | "failed";

interface QuickChatTurnView {
  id: string;
  runId: string | null;
  prompt: string;
  output: string;
  status: QuickChatTurnStatus;
}

function quickTurnId(): string {
  return `quick-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function quickChatMessageText(msg: QuickChatStreamMessage): string {
  return msg.messages
    .map((item) => {
      const content = typeof item.content === "string" ? item.content : "";
      if (content) return content;
      if (item.event_type === "tool_use" && item.tool_name) {
        return `[TOOL_USE] ${item.tool_name}`;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function appendQuickChatOutput(current: string, chunk: string): string {
  if (!chunk) return current;
  if (!current) return chunk;
  const trimmed = chunk.trimStart();
  const inline = trimmed.length > 0 && !trimmed.startsWith("[") && chunk.length < 120;
  if (inline) return current + chunk;
  return `${current}${current.endsWith("\n") ? "" : "\n"}${chunk}`;
}

function quickStatusLabel(status: QuickChatTurnStatus): string {
  switch (status) {
    case "running":
      return "运行中";
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
  }
}

/**
 * Codex 当前不支持 daemon interactive SessionManager；使用 quick-chat batch
 * JSON-RPC 路径，并用 prev_run_id 续接上一轮 Codex session_id。
 */
export function QuickChatSessionSection({
  provider,
}: {
  provider: "codex";
}) {
  const [model, setModel] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<QuickChatTurnView[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastCompletedRunId, setLastCompletedRunId] = useState<string | null>(null);
  const streamRef = useRef<EventSource | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return () => {
      streamRef.current?.close();
      streamRef.current = null;
    };
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && typeof el.scrollTo === "function") {
      el.scrollTo(0, el.scrollHeight);
    }
  }, [turns]);

  const reset = useCallback(() => {
    streamRef.current?.close();
    streamRef.current = null;
    setTurns([]);
    setInput("");
    setError(null);
    setRunning(false);
    setLastCompletedRunId(null);
  }, []);

  const handleSend = useCallback(async () => {
    const prompt = input.trim();
    if (!prompt || running) return;

    const turnId = quickTurnId();
    setInput("");
    setRunning(true);
    setError(null);
    setTurns((prev) => [
      ...prev,
      { id: turnId, runId: null, prompt, output: "", status: "running" },
    ]);

    try {
      const resp = await quickChat(
        prompt,
        provider,
        lastCompletedRunId ?? undefined,
        model,
      );
      const runId = resp.id;
      setTurns((prev) =>
        prev.map((turn) =>
          turn.id === turnId ? { ...turn, runId, status: "running" } : turn,
        ),
      );

      let finished = false;
      // task-09 附带 typecheck 修复：浏览器 window.setTimeout 返回 number，
      // 显式标注避免 @types/node 的 setTimeout 重载（返回 Timeout）干扰 tsc。
      let fallbackTimer: number | null = null;
      const finish = async (fallbackStatus?: string) => {
        if (finished) return;
        finished = true;
        if (fallbackTimer) window.clearTimeout(fallbackTimer);
        streamRef.current?.close();
        streamRef.current = null;
        try {
          const result = await getQuickChatResult(runId);
          const finalStatus = result.status === "completed" ? "completed" : "failed";
          setError(null);
          setTurns((prev) =>
            prev.map((turn) => {
              if (turn.id !== turnId) return turn;
              const finalOutput = result.output_redacted ?? "";
              return {
                ...turn,
                output: turn.output || finalOutput,
                status: finalStatus,
              };
            }),
          );
          if (finalStatus === "completed") {
            setLastCompletedRunId(runId);
          }
        } catch {
          const finalStatus = fallbackStatus === "completed" ? "completed" : "failed";
          setTurns((prev) =>
            prev.map((turn) =>
              turn.id === turnId ? { ...turn, status: finalStatus } : turn,
            ),
          );
          if (finalStatus === "completed") {
            setLastCompletedRunId(runId);
          }
        } finally {
          setRunning(false);
        }
      };

      fallbackTimer = window.setTimeout(() => {
        void finish();
      }, 60_000);

      streamRef.current = streamQuickChat(
        runId,
        (msg) => {
          const chunk = quickChatMessageText(msg);
          if (!chunk) return;
          setTurns((prev) =>
            prev.map((turn) =>
              turn.id === turnId
                ? { ...turn, output: appendQuickChatOutput(turn.output, chunk) }
                : turn,
            ),
          );
        },
        (done) => {
          void finish(done.status);
        },
        () => {
          setError("实时连接异常，正在等待运行结果回收");
        },
      );
    } catch (err) {
      setTurns((prev) =>
        prev.map((turn) =>
          turn.id === turnId ? { ...turn, status: "failed" } : turn,
        ),
      );
      setError(err instanceof Error ? err.message : "创建 Codex 对话失败");
      setRunning(false);
    }
  }, [input, lastCompletedRunId, model, provider, running]);

  const providerLabel = PROVIDER_META[provider]?.label ?? provider;

  return (
    <section className="flex h-full min-h-[520px] flex-col overflow-hidden rounded-md border bg-card">
      <header className="border-b px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">{providerLabel} 快速对话</h2>
            <p className="text-[11px] text-muted-foreground">
              使用 quick-chat 运行路径，上一轮完成后会自动接续上下文
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={reset}
              disabled={running}
              className="h-7 gap-1 px-2 text-[11px]"
              title="新建会话"
            >
              <Plus className="h-3 w-3" />
              新建会话
            </Button>
            <Badge variant="outline">quick-chat</Badge>
          </div>
        </div>
        <div className="mt-3 max-w-md space-y-1">
          <label className="text-[11px] font-medium text-muted-foreground">智能体模型</label>
          <AgentModelInput
            value={model}
            onChange={setModel}
            placeholder="模型覆盖"
            className="w-full"
            disabled={running}
          />
        </div>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto bg-muted/20 px-4 py-4">
        {error && (
          <div className="mb-3 rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}
        {turns.length === 0 ? (
          <div className="flex h-full min-h-[260px] flex-col items-center justify-center text-center">
            <p className="text-xs font-medium text-foreground">{providerLabel} 已就绪</p>
            <p className="mt-1 max-w-[300px] text-[11px] text-muted-foreground">
              首条消息会创建 quick-chat run；后续消息在上一轮完成后接续。
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {turns.map((turn) => (
              <div key={turn.id} className="space-y-1.5">
                <div className="flex justify-end">
                  <div className="max-w-[86%] rounded-md bg-primary px-3 py-2 text-xs leading-relaxed text-primary-foreground shadow-sm">
                    <div className="whitespace-pre-wrap break-words">{turn.prompt}</div>
                  </div>
                </div>
                {turn.output && (
                  <div className="flex justify-start">
                    <div className="max-w-[86%] rounded-md border bg-card px-3 py-2 text-xs leading-relaxed text-foreground shadow-sm">
                      <MarkdownText content={turn.output} />
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  <Badge
                    variant={
                      turn.status === "failed"
                        ? "destructive"
                        : turn.status === "completed"
                          ? "success"
                          : "outline"
                    }
                    className="text-[10px]"
                  >
                    {quickStatusLabel(turn.status)}
                  </Badge>
                  {turn.runId && <span className="font-mono">{shortId(turn.runId)}</span>}
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
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
            placeholder={running ? "等待本轮完成..." : `向 ${providerLabel} 发送消息`}
            className="min-h-10 flex-1 resize-none rounded border border-input bg-background px-3 py-2 text-sm leading-5 focus:border-ring focus:outline-none disabled:cursor-not-allowed disabled:bg-muted"
            rows={2}
            disabled={running}
          />
          <Button
            onClick={handleSend}
            disabled={running || !input.trim()}
            className="h-10 w-10 shrink-0 p-0"
            title="发送"
          >
            {running ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </footer>
    </section>
  );
}

// ── 会话列表 + 历史回看（task-12 / FR-10 / D-005@v1） ───────────────────────

export const ACTIVE_SESSION_VIEW_STATUSES: ReadonlySet<AgentSessionStatus> = new Set([
  "pending",
  "active",
  "reconnecting",
]);

export function isActiveSession(s: AgentSessionRead): boolean {
  return ACTIVE_SESSION_VIEW_STATUSES.has(s.status);
}

/**
 * 受控会话列表 sidebar。active/pending/reconnecting → live（task-11 面板）；
 * ended/failed → history 只读回看。selection 由父级持有，不创建第二套 SSE。
 */
export function SessionsSidebar({
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
  onSelect: (_session: AgentSessionRead) => void;
  onDelete: (_session: AgentSessionRead) => void;
  onRetry: () => void;
}) {
  return (
    <section
      data-testid="session-list-scroll"
      className="flex h-full min-h-0 flex-col overflow-hidden border-r bg-card"
    >
      <header className="border-b bg-muted/20 px-5 py-4">
        <h2 className="text-sm font-semibold">会话列表</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
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
                      "flex min-w-0 flex-1 flex-col items-start gap-1 px-4 py-3 text-left hover:bg-muted/40",
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
                    className="flex w-10 shrink-0 items-center justify-center border-l text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
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
 * task-11 / task-08 续聊可用性（D-004@v1 / D-007@v1）：
 * claude 或 codex + 有 agent_session_id + 终态（ended/failed）可恢复。
 * active 本就活跃（不显示按钮，走只读回看 ql-007）；
 * 无 agent_session_id（create 失败的 failed）无法恢复（D-007：缺 threadId 不得伪造恢复）。
 */
export function canResumeSession(session: AgentSessionRead | null): boolean {
  if (!session) return false;
  return (
    (session.provider === "claude" || session.provider === "codex") &&
    !!session.agent_session_id &&
    (session.status === "ended" || session.status === "failed")
  );
}

/** 续聊按钮不可用时的 title 提示文案。 */
export function resumeDisabledTitle(session: AgentSessionRead): string {
  if (session.provider !== "claude" && session.provider !== "codex") {
    return "当前会话不支持续聊";
  }
  if (!session.agent_session_id) return "会话未建立，无法续聊";
  return "当前会话不支持续聊";
}

/**
 * task-11 logsToTurns：把历史日志按 run_id 分组，转成 attach 面板预填的 SessionTurnView。
 * channel==="user" 的 log → prompt；其余 log → output（拼接，保留换行）。
 */
export function logsToTurns(logs: AgentRunLogEntry[]): SessionTurnView[] {
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
export function SessionHistoryView({
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
  onContinue?: (_session: AgentSessionRead) => void;
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
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-card">
      <header className="flex items-center justify-between gap-3 border-b bg-muted/20 px-5 py-4">
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
      <div className="min-h-0 flex-1 overflow-y-auto bg-background px-5 py-5">
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
                            : "max-w-[86%] rounded-md border bg-card px-3 py-2 text-xs leading-relaxed text-foreground shadow-sm"
                        }
                      >
                        {isUser ? (
                          log.content_redacted ?? ""
                        ) : (
                          <MarkdownText content={log.content_redacted ?? ""} />
                        )}
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
