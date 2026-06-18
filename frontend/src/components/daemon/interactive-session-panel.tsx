"use client";

/**
 * task-11（FR-10 / D-006@v1 / D-002@v3）：交互式会话面板。
 *
 * 演进 /runtimes 的 quick-chat 为单一交互式会话窗口：
 *   - 首条消息 → createSession（建首个 session + run）
 *   - 后续追问 → injectSession（同一 session 下一个 turn / 新 run）
 *   - 单条 streamSession SSE 贯穿整个会话，事件含 run_id 区分 turn（task-06 envelope）
 *   - interrupt 只收敛 currentRun（session active 可继续）
 *   - end 才结束 session
 *
 * turn 级串行（D-002@v3 spike S1）：currentRun 运行中禁用发送。
 *
 * 状态不变量：
 *   - currentRunId 只指向 pending/running/interrupting turn；收到同 run 的
 *     turn_completed 后清空。
 *   - turn 以 run_id 为 identity（SSE 重连重复 boundary 更新已有项不新增）。
 *   - log 只追加到相同 run id；未知 run id 先建无 prompt turn 再追加。
 *
 * 会话列表 / 历史回看 / permission 审批弹窗 = task-12（本组件不做）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Ban,
  MessageSquareText,
  Plus,
  RefreshCw,
  Send,
  Square,
} from "lucide-react";

import { AgentModelInput } from "@/components/AgentModelInput";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import {
  createSession,
  injectSession,
  interruptSession,
  endSession,
  streamSession,
  PROVIDER_META,
  type InteractiveProvider,
  type SessionStreamConnection,
  type SessionStreamEnvelope,
} from "@/lib/daemon";
import { cn } from "@/lib/utils";

type SessionUiStatus = "idle" | "creating" | "active" | "ending" | "ended" | "failed";
type TurnUiStatus = "pending" | "running" | "interrupting" | "completed" | "failed" | "killed";

interface SessionTurnView {
  runId: string;
  turn: number | null;
  prompt: string;
  output: string;
  status: TurnUiStatus;
  seenLogIds: Set<string>;
}

interface InteractiveSessionView {
  sessionId: string | null;
  status: SessionUiStatus;
  currentRunId: string | null;
  turns: SessionTurnView[];
  errorMsg: string | null;
}

const INITIAL_VIEW: InteractiveSessionView = {
  sessionId: null,
  status: "idle",
  currentRunId: null,
  turns: [],
  errorMsg: null,
};

const MAX_PROMPT_LEN = 8000;

function getProviderLabel(provider: string): string {
  return PROVIDER_META[provider]?.label ?? provider;
}

/** turn_completed 的 status/exit_code → TurnUiStatus 终态。 */
function deriveTurnTerminalStatus(env: SessionStreamEnvelope): TurnUiStatus {
  const status = env.status;
  if (status === "failed") return "failed";
  if (status === "killed" || status === "cancelled") return "killed";
  if (env.exit_code !== null && env.exit_code !== 0 && env.status === null) {
    return env.exit_code === 130 || env.exit_code === 143 ? "killed" : "failed";
  }
  return "completed";
}

export interface InteractiveSessionPanelProps {
  providers: string[];
  defaultProvider: string;
  model: string | null;
  onModelChange: (next: string | null) => void;
  hasOnlineProvider: boolean;
}

export function InteractiveSessionPanel({
  providers,
  defaultProvider,
  model,
  onModelChange,
  hasOnlineProvider,
}: InteractiveSessionPanelProps) {
  const [provider, setProvider] = useState(defaultProvider);
  const [input, setInput] = useState("");
  const [view, setView] = useState<InteractiveSessionView>(INITIAL_VIEW);
  const scrollRef = useRef<HTMLDivElement>(null);
  const streamConnRef = useRef<SessionStreamConnection | null>(null);

  // 当在线 provider 变化且当前选中的不再可用，回退到默认。
  useEffect(() => {
    if (providers.length > 0 && !providers.includes(provider)) {
      setProvider(providers[0] ?? defaultProvider);
    }
  }, [providers, provider, defaultProvider]);

  // SSE 连接由 sessionId 驱动：createSession 成功后建立唯一 SSE，贯穿整个会话。
  const establishStream = useCallback((sessionId: string) => {
    // 防御：已有连接不重建（inject 不重建 EventSource）。
    if (streamConnRef.current) return;
    streamConnRef.current = streamSession(
      sessionId,
      {
        onTurnStarted: (env) => {
          setView((prev) => upsertTurn(prev, env, (turn) => ({
            ...turn,
            turn: env.turn ?? turn.turn,
            // pending → running（首 turn 从 createSession 占位转正）；
            // 已终态（completed/failed/killed）保持终态，不被 SSE 重连重发覆盖。
            status: turn.status === "pending" ? "running" : turn.status,
          }), { setCurrentRun: env.run_id! }));
        },
        onLog: (env, _cursor) => {
          setView((prev) => {
            // log 以 log_id 去重
            return upsertTurn(prev, env, (turn) => {
              if (env.log_id && turn.seenLogIds.has(env.log_id)) {
                return turn;
              }
              const nextSeen = new Set(turn.seenLogIds);
              if (env.log_id) nextSeen.add(env.log_id);
              const text = renderLogContent(env);
              if (!text) return turn;
              return {
                ...turn,
                seenLogIds: nextSeen,
                output: turn.output + (turn.output ? "\n" : "") + text,
              };
            }, {});
          });
        },
        onTurnCompleted: (env) => {
          const terminal = deriveTurnTerminalStatus(env);
          setView((prev) => upsertTurn(prev, env, (turn) => ({
            ...turn,
            // turn_completed 收敛到终态。无论 prior 是 running 还是 interrupting，
            // 都收敛到 deriveTurnTerminalStatus 推导的真实终态（completed/failed/killed）。
            status: terminal,
          }), { clearCurrentRun: env.run_id! }));
        },
        onSessionEnded: () => {
          // 收口 ended + close（streamSession 内部已 close）
          setView((prev) => ({
            ...prev,
            status: "ended",
            currentRunId: null,
          }));
          streamConnRef.current = null;
        },
        onError: () => {
          // 不伪造 session/run 终态；浏览器自动重连。可选记录但不阻塞 UI。
        },
      },
    );
  }, []);

  // unmount / session 切换：显式 close 旧 SSE
  useEffect(() => {
    return () => {
      if (streamConnRef.current) {
        streamConnRef.current.close();
        streamConnRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && typeof el.scrollTo === "function") {
      el.scrollTo(0, el.scrollHeight);
    }
  }, [view.turns]);

  const closeStream = useCallback(() => {
    if (streamConnRef.current) {
      streamConnRef.current.close();
      streamConnRef.current = null;
    }
  }, []);

  // 发送主入口
  const handleSend = useCallback(async () => {
    const prompt = input.trim();
    if (!prompt || prompt.length > MAX_PROMPT_LEN) return;
    if (!hasOnlineProvider) return;

    // turn 级串行：active 且有 currentRun → 禁止发送
    if (view.status === "active" && view.currentRunId) return;
    if (view.status === "creating" || view.status === "ending") return;
    // ended/failed 必须新建会话（不允许在终态 session 发送）
    if (view.status === "ended" || view.status === "failed") return;

    setInput("");

    // 首 turn：createSession
    if (view.status === "idle") {
      setView({
        ...INITIAL_VIEW,
        status: "creating",
        turns: [
          { runId: "__pending_create__", turn: null, prompt, output: "", status: "pending", seenLogIds: new Set() },
        ],
      });
      try {
        const resp = await createSession({
          provider: provider as InteractiveProvider,
          prompt,
          model,
        });
        // 用返回 run id 替换 pending 占位 + 启动唯一 SSE
        setView((prev) => ({
          ...prev,
          sessionId: resp.session_id,
          status: "active",
          currentRunId: resp.run_id,
          errorMsg: null,
          turns: prev.turns.map((t) =>
            t.runId === "__pending_create__"
              ? { ...t, runId: resp.run_id, status: "running" }
              : t,
          ),
        }));
        establishStream(resp.session_id);
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : "创建会话失败";
        setView({
          ...INITIAL_VIEW,
          status: "idle",
          errorMsg: msg,
        });
      }
      return;
    }

    // 后续 turn：injectSession（同一 session 下一 turn）
    if (view.status === "active" && view.sessionId) {
      const sessionId = view.sessionId;
      const placeholderId = `__pending_inject_${Date.now()}__`;
      setView((prev) => ({
        ...prev,
        currentRunId: placeholderId,
        turns: [
          ...prev.turns,
          { runId: placeholderId, turn: null, prompt, output: "", status: "pending", seenLogIds: new Set() },
        ],
      }));
      try {
        const resp = await injectSession(sessionId, prompt);
        setView((prev) => ({
          ...prev,
          currentRunId: resp.run_id,
          turns: prev.turns.map((t) =>
            t.runId === placeholderId
              ? { ...t, runId: resp.run_id, status: "running" }
              : t,
          ),
          errorMsg: null,
        }));
        // 不重建 SSE（贯穿多 turn）
      } catch (err) {
        const apiErr = err as ApiError;
        const isTurnConflict =
          apiErr instanceof ApiError &&
          apiErr.status === 409 &&
          apiErr.code === "DAEMON_SESSION_TURN_CONFLICT";
        // 移除未被接受的占位 turn；currentRunId 清空（inject 失败，无运行中 turn）
        setView((prev) => ({
          ...prev,
          currentRunId: null,
          turns: prev.turns.filter((t) => t.runId !== placeholderId),
          errorMsg: apiErr instanceof ApiError ? apiErr.message : "追问失败",
        }));
        if (isTurnConflict) {
          setInput(prompt); // turn conflict：保留 prompt 供重试
        }
      }
    }
  }, [input, hasOnlineProvider, view, provider, model, establishStream]);

  // interrupt：只收敛 currentRun
  const handleInterrupt = useCallback(async () => {
    if (!view.sessionId || !view.currentRunId || view.status !== "active") return;
    const localRunId = view.currentRunId;
    setView((prev) => ({
      ...prev,
      turns: prev.turns.map((t) =>
        t.runId === localRunId ? { ...t, status: "interrupting" } : t,
      ),
    }));
    try {
      const resp = await interruptSession(view.sessionId);
      // REST 返回 current_run_id 不一致 → 提示，等待 SSE
      if (resp.current_run_id && resp.current_run_id !== localRunId) {
        setView((prev) => ({
          ...prev,
          errorMsg: "运行状态已变化，等待 SSE 同步",
        }));
      }
      // session 仍 active；turn 终态由 turn_completed 决定
    } catch (err) {
      const apiErr = err as ApiError;
      const isNoCurrentRun =
        apiErr instanceof ApiError &&
        apiErr.status === 409 &&
        apiErr.code === "DAEMON_SESSION_NO_CURRENT_RUN";
      if (isNoCurrentRun) {
        // 清过期 currentRun，session 仍 active
        setView((prev) => ({
          ...prev,
          currentRunId: null,
          turns: prev.turns.map((t) =>
            t.runId === localRunId && (t.status === "interrupting" || t.status === "running")
              ? { ...t, status: "killed" }
              : t,
          ),
        }));
      } else {
        // 其它错误：恢复 turn 状态为 running，显示错误，session 仍 active
        setView((prev) => ({
          ...prev,
          turns: prev.turns.map((t) =>
            t.runId === localRunId && t.status === "interrupting"
              ? { ...t, status: "running" }
              : t,
          ),
          errorMsg: apiErr instanceof ApiError ? apiErr.message : "打断失败",
        }));
      }
    }
  }, [view.sessionId, view.currentRunId, view.status, view.turns]);

  // end：结束整个 session
  const handleEnd = useCallback(async () => {
    if (!view.sessionId || view.status !== "active") return;
    setView((prev) => ({ ...prev, status: "ending" }));
    try {
      const resp = await endSession(view.sessionId);
      closeStream();
      setView((prev) => ({
        ...prev,
        status: "ended",
        currentRunId: null,
        errorMsg: null,
      }));
      void resp;
    } catch (err) {
      // 网络错误：不假定 ended，恢复 active，允许重试
      const apiErr = err as ApiError;
      setView((prev) => ({
        ...prev,
        status: "active",
        errorMsg: apiErr instanceof ApiError ? apiErr.message : "结束会话失败，请重试",
      }));
    }
  }, [view.sessionId, view.status, closeStream]);

  // 新建会话
  const handleNewSession = useCallback(() => {
    // active session 必须先 end 成功（简化：直接清空，由 end 路径负责收口；
    // 实际生产建议先 end。本任务 ended/failed/idle 时直接新建。）
    if (view.status === "active") {
      void handleEnd();
      return;
    }
    closeStream();
    setView(INITIAL_VIEW);
    setInput("");
  }, [view.status, closeStream, handleEnd]);

  // 输入框 / 发送按钮状态
  const sendingDisabled =
    view.status === "creating" ||
    view.status === "ending" ||
    (view.status === "active" && view.currentRunId !== null) || // turn 级串行
    view.status === "ended" ||
    view.status === "failed" ||
    !hasOnlineProvider;

  const interruptDisabled =
    view.status !== "active" || !view.currentRunId ||
    view.turns.some((t) => t.runId === view.currentRunId && t.status === "interrupting");
  const endDisabled = view.status !== "active";

  const placeholder = useMemo(() => {
    if (view.status === "ended" || view.status === "failed") return "会话已结束，请新建会话";
    if (view.status === "creating") return "正在创建会话...";
    if (view.status === "ending") return "正在结束会话...";
    if (view.status === "active" && view.currentRunId) return "等待本轮完成...";
    if (view.status === "active") return "继续追问...";
    return "输入首条消息创建会话";
  }, [view.status, view.currentRunId]);

  return (
    <section className="flex min-h-[520px] flex-col overflow-hidden rounded-md border bg-card">
      <header className="border-b px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <MessageSquareText className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold">交互式会话</h2>
              <p className="text-[11px] text-muted-foreground">
                {view.sessionId
                  ? `会话 ${view.sessionId.slice(0, 8)}…`
                  : "单一 SSE 贯穿多轮会话"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleNewSession}
              disabled={view.status === "creating" || view.status === "ending"}
              className="h-7 gap-1 px-2 text-[11px]"
              title="新建会话"
            >
              <Plus className="h-3 w-3" />
              新建会话
            </Button>
            <Badge variant="outline">
              {hasOnlineProvider ? `${providers.length} 个提供方` : "未连接"}
            </Badge>
          </div>
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-muted-foreground">Agent provider</label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              disabled={!hasOnlineProvider || view.status === "active" || view.status === "ending" || view.status === "creating"}
              className="h-8 w-full min-w-0 rounded border border-input bg-background px-2 text-xs focus:border-ring focus:outline-none disabled:cursor-not-allowed disabled:bg-muted"
            >
              {(hasOnlineProvider ? providers : [provider]).map((item) => (
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
              onChange={onModelChange}
              placeholder="model override"
              className="w-full"
              disabled={view.status === "active" || view.status === "ending" || view.status === "creating"}
            />
          </div>
          <div className="flex items-end gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={handleInterrupt}
              disabled={interruptDisabled}
              className="h-8 gap-1 px-2.5 text-[11px]"
              title="打断本轮（session 保持 active）"
            >
              <Ban className="h-3.5 w-3.5" />
              打断本轮
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleEnd}
              disabled={endDisabled}
              className="h-8 gap-1 px-2.5 text-[11px]"
              title="结束整个会话"
            >
              <Square className="h-3 w-3" />
              结束会话
            </Button>
          </div>
        </div>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto bg-muted/20 px-4 py-4">
        {view.errorMsg && (
          <div className="mb-3 rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
            {view.errorMsg}
          </div>
        )}
        {view.turns.length === 0 ? (
          <div className="flex h-full min-h-[260px] flex-col items-center justify-center text-center">
            <p className="text-xs font-medium text-foreground">
              {hasOnlineProvider
                ? `${getProviderLabel(provider)} 已就绪`
                : "没有在线 Daemon"}
            </p>
            <p className="mt-1 max-w-[260px] text-[11px] text-muted-foreground">
              {hasOnlineProvider
                ? "首条消息将创建会话；单条 SSE 贯穿整段对话，可中途追问、打断本轮或结束会话。"
                : "启动 daemon 后即可发送。"}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {view.turns.map((turn) => (
              <div key={turn.runId} className="space-y-1.5">
                <div className="flex justify-end">
                  <div className="max-w-[86%] rounded-md bg-primary px-3 py-2 text-xs leading-relaxed text-primary-foreground shadow-sm">
                    <div className="whitespace-pre-wrap break-words">{turn.prompt}</div>
                  </div>
                </div>
                {turn.output && (
                  <div className="flex justify-start">
                    <div className="max-w-[86%] rounded-md border bg-card px-3 py-2 text-xs leading-relaxed text-foreground shadow-sm">
                      <div className="whitespace-pre-wrap break-words">{turn.output}</div>
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  <TurnStatusBadge status={turn.status} turn={turn.turn} />
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
            placeholder={placeholder}
            className="min-h-10 flex-1 resize-none rounded border border-input bg-background px-3 py-2 text-sm leading-5 focus:border-ring focus:outline-none disabled:cursor-not-allowed disabled:bg-muted"
            rows={2}
            disabled={sendingDisabled}
          />
          <Button
            onClick={handleSend}
            disabled={sendingDisabled || !input.trim()}
            className="h-10 w-10 shrink-0 p-0"
            title="发送"
          >
            {view.status === "creating" ? (
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

/* ---------- helpers ---------- */

function TurnStatusBadge({
  status,
  turn,
}: {
  status: TurnUiStatus;
  turn: number | null;
}) {
  const label =
    turn != null ? `Turn ${turn}` : "Turn";
  const statusLabel: Record<TurnUiStatus, string> = {
    pending: "排队中",
    running: "运行中",
    interrupting: "打断中",
    completed: "已完成",
    failed: "失败",
    killed: "已中止",
  };
  const tone: Record<TurnUiStatus, string> = {
    pending: "text-muted-foreground",
    running: "text-blue-600",
    interrupting: "text-amber-600",
    completed: "text-emerald-600",
    failed: "text-destructive",
    killed: "text-amber-600",
  };
  return (
    <span className={cn("font-mono", tone[status])}>
      {label} · {statusLabel[status]}
    </span>
  );
}

/** 把 log envelope 渲染成纯文本片段（保留 [SYSTEM]/[RESULT] 过滤）。 */
function renderLogContent(env: SessionStreamEnvelope): string {
  const content = (env.content ?? "").trim();
  if (!content) return "";
  // 过滤技术日志
  if (/^\[(SYSTEM|RESULT)[^\]]*\]/.test(content)) return "";
  const channel = env.channel;
  if (channel === "stderr") return `⚠️ ${content}`;
  if (channel === "tool_call") return `🔧 ${content}`;
  // 剥前缀
  return content.replace(/^\[(ASSISTANT|THINKING|LOG:\w+)\]\s?/, "");
}

interface UpsertOpts {
  setCurrentRun?: string;
  clearCurrentRun?: string;
  requireRunId?: boolean;
}

/**
 * 按 env.run_id upsert turn。unknown run id 先建无 prompt turn。
 * 返回新 view（不可变）。
 *
 * P1-3 终态幂等：turn 已处于 completed/failed/killed 时，不再被后续事件（SSE
 * 重连重发的 turn_started/log/turn_completed）覆盖 —— 直接返回原 turn。
 * 这防止「SSE 断线重连后旧 turn_completed 把已 killed 的 turn 改回 completed」。
 */
const TERMINAL_TURN_STATUSES: ReadonlySet<TurnUiStatus> = new Set([
  "completed",
  "failed",
  "killed",
]);

function upsertTurn(
  prev: InteractiveSessionView,
  env: SessionStreamEnvelope,
  apply: (turn: SessionTurnView) => SessionTurnView,
  opts: UpsertOpts,
): InteractiveSessionView {
  const runId = env.run_id;
  if (!runId) {
    // log/turn_started 缺 run_id 已在 streamSession 拦截，这里兜底不写
    return prev;
  }
  const idx = prev.turns.findIndex((t) => t.runId === runId);
  let turns: SessionTurnView[];
  if (idx === -1) {
    // unknown run：先建无 prompt turn
    const newTurn: SessionTurnView = {
      runId,
      turn: env.turn ?? null,
      prompt: "",
      output: "",
      status: "running",
      seenLogIds: new Set(),
    };
    turns = [...prev.turns, apply(newTurn)];
  } else {
    turns = prev.turns.map((t, i) => {
      if (i !== idx) return t;
      // P1-3 终态幂等：已终态的 turn 不被后续事件覆盖。
      if (TERMINAL_TURN_STATUSES.has(t.status)) return t;
      return apply(t);
    });
  }
  let currentRunId = prev.currentRunId;
  if (opts.setCurrentRun) currentRunId = opts.setCurrentRun;
  if (opts.clearCurrentRun && currentRunId === opts.clearCurrentRun) {
    currentRunId = null;
  }
  return { ...prev, turns, currentRunId };
}
