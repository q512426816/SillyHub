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
  Users,
} from "lucide-react";

import { AgentModelInput } from "@/components/AgentModelInput";
import { AskUserDialogCard } from "@/components/ask-user-dialog-card";
import { RunErrorItem } from "@/components/agent-log/run-error-item";
import { buildErrorLogItem, type ErrorLogItem } from "@/components/agent-log/normalize";
import { ErrorBoundary } from "@/components/error-boundary";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MarkdownText } from "@/components/ui/markdown-text";
import { ApiError } from "@/lib/api";
import { createMission } from "@/lib/agent";
import {
  createSession,
  fetchPendingDialogs,
  injectSession,
  interruptSession,
  endSession,
  streamSession,
  getAgentSession,
  listSessionRuns,
  PROVIDER_META,
  type InteractiveProvider,
  type SessionPermissionRequest,
  type SessionPermissionResolved,
  type SessionStreamConnection,
  type SessionStreamEnvelope,
} from "@/lib/daemon";
import { cn } from "@/lib/utils";
import { sanitizeSessionLogContent, classifySessionLog } from "@/components/daemon/session-log-sanitize";

type SessionUiStatus = "idle" | "creating" | "active" | "ending" | "ended" | "failed" | "reconnecting";
type TurnUiStatus = "pending" | "running" | "interrupting" | "completed" | "failed" | "killed";

/**
 * ql-20260730-001：agent 回合内的工具调用事件（折叠卡片用）。
 * - raw：[TOOL_USE] 内容（命令/args，已剥前缀）
 * - result：配对的 [TOOL_RESULT] 内容（已剥前缀，可能缺失=进行中）
 * - status：running（未配对 result）/ ok（成功）/ deny（被拒/失败）
 */
export interface SessionToolEvent {
  raw: string;
  result?: string;
  status: "running" | "ok" | "deny";
}

export interface SessionTurnView {
  runId: string;
  turn: number | null;
  prompt: string;
  output: string;
  /** ql-20260730-001：思考过程（[THINKING] 累积，折叠展示） */
  thinking: string;
  /** ql-20260730-001：工具调用事件列表（[TOOL_USE]/[TOOL_RESULT] 配对，折叠卡片） */
  toolEvents: SessionToolEvent[];
  status: TurnUiStatus;
  seenLogIds: Set<string>;
  /**
   * ql-20260621：实时累积 token。由 SSE `tokens` 事件（执行中）与
   * `turn_completed` 事件（终态）写入；null 表示尚未收到。
   */
  inputTokens: number | null;
  outputTokens: number | null;
  /**
   * 2026-07-29-model-error-visibility / FR-04：turn 终态=failed 时拉取的结构化错误
   * 详情（GET /sessions/{id}/runs 的 error_detail 经 buildErrorLogItem 映射）。
   * null/undefined（成功 turn / brownfield / attach 历史 turn）→ 不渲染 RunErrorItem。
   * 可选：外部 logsToTurns 构造的历史 turn 不带此字段（只读 import，不改其构造）。
   */
  errorDetail?: ErrorLogItem | null;
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

// task-10 attach 模式轮询常量
const ATTACH_POLL_MS = 1500;
const ATTACH_POLL_TIMEOUT_MS = 15000;
const ATTACH_POLL_MAX_ATTEMPTS = Math.ceil(ATTACH_POLL_TIMEOUT_MS / ATTACH_POLL_MS); // 10

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
  /**
   * task-10 attach 模式：给定 attachSessionId 时不走 idle→create 新建，
   * 而是建 SSE 订阅 + 预填 initialTurns + 轮询 getAgentSession 直到 active。
   * 成功 active 后续发送走 active 分支（inject）。
   */
  attachSessionId?: string;
  initialTurns?: SessionTurnView[];
  /**
   * ql-20260623：createSession 成功后上报新建 session_id 给父级，
   * 父级可据此把 `?session=<id>` 写入 URL（刷新恢复用）。
   */
  onSessionCreated?: (sessionId: string) => void;
  /**
   * ql-20260623：面板重置回 idle（新建会话）时通知父级，
   * 父级据此清除 URL `?session=` param。
   */
  onSessionReset?: () => void;
  /** 2026-07-09-change-detail-session：变更会话绑定透传（D-001）。可选，runtimes 页不传。 */
  changeId?: string;
  /** 工作空间绑定透传（D-003）。可选。 */
  workspaceId?: string;
  /**
   * task-08（FR-08 / D-001@v2）：「用团队分析」成功创建 mission 后上报 missionId。
   * 父级可据此挂 TeamProgress 组件展示主 agent 决策 + worker 进度。
   * mode=team + session_id 绑当前会话，主 agent 接管上下文。
   */
  onTeamMissionCreated?: (missionId: string) => void;
}

export function InteractiveSessionPanel({
  providers,
  defaultProvider,
  model,
  onModelChange,
  hasOnlineProvider,
  attachSessionId,
  initialTurns,
  onSessionCreated,
  onSessionReset,
  changeId,
  workspaceId,
  onTeamMissionCreated,
}: InteractiveSessionPanelProps) {
  const [provider, setProvider] = useState(defaultProvider);
  const [input, setInput] = useState("");
  const [view, setView] = useState<InteractiveSessionView>(INITIAL_VIEW);
  // task-08：「用团队分析」按钮状态。teamAnalyzing=建 mission 进行中（按钮置灰）；
  // teamMissionId=已为当前 session 建过 mission（按钮转「已建团队」只读态，避免重复建）。
  const [teamAnalyzing, setTeamAnalyzing] = useState(false);
  const [teamMissionId, setTeamMissionId] = useState<string | null>(null);
  // ql-20260621：AskUserQuestion / 普通 permission_request 待答卡片队列。
  // 仅渲染 dialog_kind 存在的（AskUserDialogCard）；普通工具审批卡在本面板不展示
  //（/runtimes 页的 PermissionApprovalsPanel 负责普通 allow/deny）。
  const [pendingRequests, setPendingRequests] = useState<SessionPermissionRequest[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const streamConnRef = useRef<SessionStreamConnection | null>(null);
  // task-10 attach 模式轮询句柄（unmount / 转出 attach 模式时清理）
  const attachPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 2026-07-29-model-error-visibility：已拉取过 error_detail 的 failed run_id 集合，
  // 防 SSE 重连重发 turn_completed 触发重复 listSessionRuns（同一 failed run 只拉一次）。
  const fetchedErrorRunIdsRef = useRef<Set<string>>(new Set());

  // 当在线 provider 变化且当前选中的不再可用，回退到默认。
  useEffect(() => {
    if (providers.length > 0 && !providers.includes(provider)) {
      setProvider(providers[0] ?? defaultProvider);
    }
  }, [providers, provider, defaultProvider]);

  // task-08：session 切换 / 重置时清掉 teamMissionId（新会话可重新建 team）。
  // idle（无 sessionId）也清，确保按钮回到「用团队分析」可点状态。
  useEffect(() => {
    setTeamMissionId(null);
  }, [view.sessionId]);

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
          // 2026-07-11-unify-runtime-session-dialog task-12: channel=user_input 是
          // 用户消息（attach 时 initialTurns 已作 prompt），不追加到 agent output，
          // 避免 attach 时 user_input 同时出现在 prompt 气泡和 output 气泡（重复）。
          if (env.channel === "user_input") return;
          setView((prev) => {
            // log 以 log_id 去重
            return upsertTurn(prev, env, (turn) => {
              if (env.log_id && turn.seenLogIds.has(env.log_id)) {
                return turn;
              }
              const nextSeen = new Set(turn.seenLogIds);
              if (env.log_id) nextSeen.add(env.log_id);
              // ql-20260730-001：按 log 类型分流到 thinking / toolEvents / output 三层
              const kind = classifySessionLog(env.content ?? "", env.channel);
              if (kind === "skip") return turn;
              const text = sanitizeSessionLogContent(env.content ?? "", env.channel);
              if (!text) return turn;
              if (kind === "thinking") {
                return {
                  ...turn,
                  seenLogIds: nextSeen,
                  thinking: turn.thinking + (turn.thinking ? "\n" : "") + text,
                };
              }
              if (kind === "tool_use") {
                return {
                  ...turn,
                  seenLogIds: nextSeen,
                  toolEvents: [...turn.toolEvents, { raw: text, status: "running" }],
                };
              }
              if (kind === "tool_result") {
                // 配对最近一个 running 的 tool_use
                const toolEvents = [...turn.toolEvents];
                for (let i = toolEvents.length - 1; i >= 0; i--) {
                  const evt = toolEvents[i];
                  if (evt && evt.status === "running") {
                    const isDeny = /拒绝|denied|error|失败/i.test(text);
                    toolEvents[i] = { raw: evt.raw, result: text, status: isDeny ? "deny" : "ok" };
                    break;
                  }
                }
                return { ...turn, seenLogIds: nextSeen, toolEvents };
              }
              // assistant（含 stderr ⚠️）
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
            // ql-20260621：终态 token 同步写入（backend turn_completed payload 带
            // input_tokens/output_tokens）。null 不覆盖执行中已收到的累积值。
            inputTokens: env.input_tokens ?? turn.inputTokens,
            outputTokens: env.output_tokens ?? turn.outputTokens,
          }), { clearCurrentRun: env.run_id! }));

          // 2026-07-29-model-error-visibility / FR-04：turn 终态=failed 时拉取该 run 的
          // 结构化错误详情（AgentRun.error_detail，GET /sessions/{id}/runs），用
          // buildErrorLogItem 安全映射成 ErrorLogItem 写入对应 turn，供 RunErrorItem
          // 渲染（原因 + 针对性建议 + 操作）。
          // - 同 run_id 只拉一次：fetchedErrorRunIdsRef 去重，防 SSE 重连重发触发重复请求。
          // - 拉取失败 / error_detail 缺失 → 静默不崩（brownfield 守护），失败 turn 仍显示
          //   状态徽标（失败）+ 通用 errorMsg。
          if (
            terminal === "failed" &&
            env.run_id &&
            !fetchedErrorRunIdsRef.current.has(env.run_id)
          ) {
            const failedRunId = env.run_id;
            fetchedErrorRunIdsRef.current.add(failedRunId);
            void (async () => {
              try {
                const runs = await listSessionRuns(sessionId);
                const matched = runs.find((r) => r.id === failedRunId);
                const item = buildErrorLogItem(matched?.error_detail ?? null);
                if (!item) return;
                setView((prev) => ({
                  ...prev,
                  turns: prev.turns.map((t) =>
                    t.runId === failedRunId && !t.errorDetail
                      ? { ...t, errorDetail: item }
                      : t,
                  ),
                }));
              } catch {
                // 拉取失败不阻塞：失败 turn 仍有状态徽标 + 通用 errorMsg
              }
            })();
          }
        },
        onTokens: (env) => {
          // ql-20260621：执行中实时累积 token。每次 submit_messages 都推一条，
          // 前端按 run_id upsert 到对应 turn，UI 立刻刷新输入/输出词元计数。
          setView((prev) => upsertTurn(prev, env, (turn) => ({
            ...turn,
            inputTokens: env.input_tokens ?? turn.inputTokens,
            outputTokens: env.output_tokens ?? turn.outputTokens,
          }), {}));
        },
        onSessionEnded: () => {
          // 收口 ended + close（streamSession 内部已 close）
          setView((prev) => ({
            ...prev,
            status: "ended",
            currentRunId: null,
          }));
          // session 结束 → 清空待答卡片（AskUserQuestion 不会再有回答机会）
          setPendingRequests([]);
          streamConnRef.current = null;
        },
        onError: () => {
          // 不伪造 session/run 终态；浏览器自动重连。可选记录但不阻塞 UI。
        },
        // ql-20260621：同 SSE channel 的 permission 事件分发（见 daemon.ts
        // streamSession 的 default 分支）。AskUserQuestion 卡片渲染 + 用户提交
        // 后由 backend 回 permission_resolved，或 5min 超时 backend 自收口。
        //
        // task-09（FR-09 / D-006@v1 / D-010@v1）：收卡只按 dialog_kind 存在性
        //（if (!req.dialog_kind) return），不区分具体 kind 值，天然支持
        // Claude ask_user / Codex codex_request_user_input / mcp_elicitation。
        // 三者 payload 经 daemon 归一化后同构，AskUserDialogCard 零分支复用。
        onPermissionRequest: (req) => {
          // 按 request_id 去重；只保留 dialog_kind（AskUserDialogCard）类型的卡，
          // 普通工具审批（无 dialog_kind）交给 /runtimes 审批面板。
          if (!req.dialog_kind) return;
          setPendingRequests((prev) =>
            prev.some((r) => r.request_id === req.request_id)
              ? prev
              : [...prev, req],
          );
        },
        onPermissionResolved: (resolved) => {
          setPendingRequests((prev) =>
            prev.filter((r) => r.request_id !== resolved.request_id),
          );
        },
      },
    );
    // ql-20260623：fetchPendingDialogs 从 establishStream 解耦为独立 effect
    //（见下方 [view.sessionId] effect），避免恢复链路与建流链路绑定。
  }, []);

  // task-10 attach 模式：mount / attachSessionId 变化时建 SSE + 预填 turn + 进 reconnecting。
  // 轮询单独 effect 处理（见下）。
  useEffect(() => {
    if (!attachSessionId) return;
    // 防御：清旧 SSE（重复 attach / props 变化重建）
    if (streamConnRef.current) {
      streamConnRef.current.close();
      streamConnRef.current = null;
    }
    establishStream(attachSessionId);
    setView({
      sessionId: attachSessionId,
      status: "reconnecting",
      currentRunId: null,
      turns: initialTurns ?? [],
      errorMsg: null,
    });
    // initialTurns 仅在 mount 时读取，避免 props 变更抖动（react-hooks/exhaustive-deps 忽略）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachSessionId, establishStream]);

  // task-10 attach 轮询：每 ATTACH_POLL_MS 调 getAgentSession，
  // active → 转 active + 清轮询 + 启用输入；failed 或累计超时 → 回退 failed（只读）。
  useEffect(() => {
    if (!attachSessionId) return;
    let attempts = 0;
    let cancelled = false;
    const stop = () => {
      if (attachPollRef.current) {
        clearInterval(attachPollRef.current);
        attachPollRef.current = null;
      }
    };
    const tick = async () => {
      if (cancelled) return;
      attempts += 1;
      try {
        const detail = await getAgentSession(attachSessionId);
        if (cancelled) return;
        if (detail.status === "active") {
          stop();
          // 恢复 currentRunId（attach 运行中会话时启用打断按钮；detail.current_run_id
          // 由 get_session_detail 注入，无运行 run 则保持 null）
          setView((prev) => ({
            ...prev,
            status: "active",
            errorMsg: null,
            currentRunId: detail.current_run_id ?? prev.currentRunId,
          }));
        } else if (detail.status === "failed") {
          stop();
          setView((prev) => ({
            ...prev,
            status: "failed",
            errorMsg: "会话恢复失败，可能上下文已失效",
          }));
        } else if (detail.status === "ended") {
          // 2026-07-11-unify-runtime-session-dialog: ended 会话 attach（无 SDK session id
          // 等无法 reopen 的老会话）→ 转只读 ended 态，显示 initialTurns 历史，不卡轮询。
          stop();
          setView((prev) => ({ ...prev, status: "ended", errorMsg: null }));
        }
        // reconnecting / ended / pending → 继续轮询（由超时兜底）
      } catch {
        if (cancelled) return;
        // 单次网络错误不立刻回退，累计超时会兜底
      }
      if (attempts >= ATTACH_POLL_MAX_ATTEMPTS) {
        stop();
        setView((prev) =>
          prev.status === "active"
            ? prev
            : {
                ...prev,
                status: "failed",
                errorMsg: "会话恢复失败，可能上下文已失效",
              },
        );
      }
    };
    attachPollRef.current = setInterval(() => { void tick(); }, ATTACH_POLL_MS);
    return () => {
      cancelled = true;
      stop();
    };
  }, [attachSessionId]);

  // ql-20260623（改动二）：fetchPendingDialogs 从 establishStream 解耦为独立
  // effect。只要有有效 sessionId（来自 createSession / attach / URL 恢复）就
  // 触发一次 pending dialog 拉取，与建流链路解耦。
  // SSE 只推送实时新 permission_request，页面刷新 / attach 已 pending 的
  // AskUserQuestion 对话需通过此 REST 恢复（与 SSE 合并按 request_id 去重）。
  useEffect(() => {
    if (!view.sessionId) return;
    const sessionId = view.sessionId;
    let cancelled = false;
    void fetchPendingDialogs(sessionId)
      .then((dialogs) => {
        if (cancelled || !dialogs || dialogs.length === 0) return;
        setPendingRequests((prev) => {
          const existing = new Set(prev.map((r) => r.request_id));
          const merged = [...prev];
          for (const d of dialogs) {
            if (d.dialog_kind && !existing.has(d.request_id)) {
              merged.push(d);
            }
          }
          return merged.length === prev.length ? prev : merged;
        });
      })
      .catch(() => {
        // 恢复失败不阻塞：SSE 仍会推送后续新事件
      });
    return () => {
      cancelled = true;
    };
  }, [view.sessionId]);

  // unmount / session 切换：显式 close 旧 SSE + 清轮询 interval
  useEffect(() => {
    return () => {
      if (attachPollRef.current) {
        clearInterval(attachPollRef.current);
        attachPollRef.current = null;
      }
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

  // 2026-07-29-model-error-visibility：后续 turn 提交（injectSession）共享逻辑。
  // handleSend 的追问分支与失败轮次「重新发送」(handleResend) 共用此函数，确保占位
  // turn 创建 / SSE 不重建 / turn conflict 回填等行为完全一致（不新建提交逻辑）。
  const submitFollowup = useCallback(
    async (sessionId: string, prompt: string): Promise<void> => {
      const placeholderId = `__pending_inject_${Date.now()}__`;
      setView((prev) => ({
        ...prev,
        currentRunId: placeholderId,
        turns: [
          ...prev.turns,
          {
            runId: placeholderId,
            turn: null,
            prompt,
            output: "",
            thinking: "",
            toolEvents: [],
            status: "pending",
            seenLogIds: new Set(),
            inputTokens: null,
            outputTokens: null,
            errorDetail: null,
          },
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
    },
    [],
  );

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
          { runId: "__pending_create__", turn: null, prompt, output: "", thinking: "", toolEvents: [], status: "pending", seenLogIds: new Set(), inputTokens: null, outputTokens: null, errorDetail: null },
        ],
      });
      try {
        const resp = await createSession({
          provider: provider as InteractiveProvider,
          prompt,
          model,
          manual_approval: true,
          ask_user_only: true,
          ...(changeId ? { change_id: changeId } : {}),
          ...(workspaceId ? { workspace_id: workspaceId } : {}),
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
        // 清旧 attach stream 残留（panel 未 remount 时 streamConnRef 可能仍指向旧 session
        // 的 SSE，establishStream 防御会跳过建新流）+ 建新 session 的 SSE。
        if (streamConnRef.current) {
          streamConnRef.current.close();
          streamConnRef.current = null;
        }
        establishStream(resp.session_id);
        // ql-20260623（改动一）：上报 session_id 给父级写 URL（刷新恢复）
        onSessionCreated?.(resp.session_id);
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

    // 后续 turn：injectSession（同一 session 下一 turn）。复用 submitFollowup，与失败
    // 轮次「重新发送」共用同一提交链路（不新建提交逻辑）。
    if (view.status === "active" && view.sessionId) {
      await submitFollowup(view.sessionId, prompt);
    }
  }, [input, hasOnlineProvider, view, provider, model, establishStream, onSessionCreated, submitFollowup]);

  // 2026-07-29-model-error-visibility：失败轮次「重新发送」— 复用 submitFollowup 重新
  // 提交该 turn 的 prompt（injectSession，不新建提交逻辑）。受 turn 级串行 / active 守卫；
  // retryable=false 的错误由 RunErrorItem 隐藏按钮（onResend 仅在 retryable 时渲染），
  // 故点击时必为可重试错误。
  const handleResend = useCallback(async (prompt: string) => {
    if (!view.sessionId) return;
    if (!hasOnlineProvider) return;
    if (view.status !== "active") return;
    if (view.currentRunId) return; // turn 级串行：等待当前 turn 完成
    const trimmed = prompt.trim();
    if (!trimmed || trimmed.length > MAX_PROMPT_LEN) return;
    await submitFollowup(view.sessionId, trimmed);
  }, [view.sessionId, view.status, view.currentRunId, hasOnlineProvider, submitFollowup]);

  // 2026-07-29-model-error-visibility：「切换供应商」— 跳设置页（默认 tab=providers 我的供应商）。
  // 用 window.location.assign 做整页跳转（非 next/navigation useRouter）：后者需在每个渲染
  // 本组件的测试文件单独 vi.mock，而本面板被多个未 mock next/navigation 的测试覆盖且只读
  // 不可改，整页跳转零 mock 依赖、零回归，生产可达 /settings（providers 为默认 tab）。
  const handleSwitchProvider = useCallback(() => {
    if (typeof window !== "undefined") {
      window.location.assign("/settings");
    }
  }, []);

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
    setPendingRequests([]);
    // ql-20260623（改动一）：重置回 idle 时通知父级清除 URL ?session= param
    onSessionReset?.();
  }, [view.status, closeStream, handleEnd, onSessionReset]);

  // ql-20260621：用户在 AskUserDialogCard 提交回答后，AskUserDialogCard 内部
  // 已 POST respondSessionPermission；这里立即移除卡片（permission_resolved
  // SSE 到达后也会再次过滤，双保险）。
  const handleDialogResolved = useCallback((requestId: string) => {
    setPendingRequests((prev) =>
      prev.filter((r) => r.request_id !== requestId),
    );
  }, []);

  // task-08（FR-08 / D-001@v2）：「用团队分析」— 模式 team + 绑定当前 session_id。
  // 主 agent 作为 orchestrator 接管会话上下文，按预设 worker 列表派发分析。
  // worker_preset 用通用分析模板（arch + verify 两角色），具体业务可后续在
  // mission 详情页编辑（task-07 已支持 worker 列表编辑）。
  const handleAnalyzeWithTeam = useCallback(async () => {
    if (!view.sessionId) return;
    if (!workspaceId) return;
    if (teamAnalyzing || teamMissionId) return;
    setTeamAnalyzing(true);
    try {
      const m = await createMission(workspaceId, {
        objective: "团队分析当前会话上下文",
        mode: "team",
        session_id: view.sessionId,
        // changeId 透传（变更会话入口时绑定 change 上下文）
        ...(changeId ? { change_id: changeId } : {}),
        // 通用分析 worker 预设模板（D-002@v2 用户预设）
        worker_preset: [
          {
            agent_type: "claude_code",
            model: "",
            objective: "梳理会话上下文，输出问题与方案摘要",
            role: "arch",
          },
          {
            agent_type: "claude_code",
            model: "",
            objective: "核验方案可行性，标注风险与遗漏",
            role: "verify",
          },
        ],
      });
      setTeamMissionId(m.id);
      onTeamMissionCreated?.(m.id);
    } catch (err) {
      setView((prev) => ({
        ...prev,
        errorMsg: err instanceof ApiError ? err.message : "启动团队分析失败",
      }));
    } finally {
      setTeamAnalyzing(false);
    }
  }, [view.sessionId, workspaceId, teamAnalyzing, teamMissionId, changeId, onTeamMissionCreated]);

  // 输入框 / 发送按钮状态
  const sendingDisabled =
    view.status === "creating" ||
    view.status === "ending" ||
    view.status === "reconnecting" || // task-10 attach 恢复中
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
    if (view.status === "reconnecting") return "恢复会话中…";
    if (view.status === "creating") return "正在创建会话...";
    if (view.status === "ending") return "正在结束会话...";
    if (view.status === "active" && view.currentRunId) return "等待本轮完成...";
    if (view.status === "active") return "继续追问...";
    return "输入首条消息创建会话";
  }, [view.status, view.currentRunId]);

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-card">
      <header className="shrink-0 border-b bg-card px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <MessageSquareText className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <h2 className="text-base font-semibold">交互式会话</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {view.sessionId
                  ? `会话 ${view.sessionId.slice(0, 8)}…`
                  : "单一 SSE 贯穿多轮会话"}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {workspaceId && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleAnalyzeWithTeam}
                disabled={
                  !view.sessionId ||
                  view.status === "ended" ||
                  view.status === "failed" ||
                  teamAnalyzing ||
                  teamMissionId !== null
                }
                className="h-8 gap-1 px-3 text-xs"
                title="用团队（主 agent + worker）分析当前会话上下文"
              >
                <Users className="h-3 w-3" />
                {teamMissionId ? "已建团队" : teamAnalyzing ? "组建中…" : "用团队分析"}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={handleNewSession}
              disabled={view.status === "creating" || view.status === "ending"}
              className="h-8 gap-1 px-3 text-xs"
              title="新建会话"
            >
              <Plus className="h-3 w-3" />
              新建会话
            </Button>
            <Badge variant="outline" className="h-7 px-2 text-xs">
              {hasOnlineProvider ? `${providers.length} 个提供方` : "未连接"}
            </Badge>
          </div>
        </div>

        <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(160px,0.75fr)_minmax(220px,1fr)_auto] xl:items-end">
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-muted-foreground">智能体提供方</label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              disabled={!hasOnlineProvider || view.status === "active" || view.status === "ending" || view.status === "creating"}
              className="h-9 w-full min-w-0 rounded border border-input bg-background px-3 text-sm focus:border-ring focus:outline-none disabled:cursor-not-allowed disabled:bg-muted"
            >
              {(hasOnlineProvider ? providers : [provider]).map((item) => (
                <option key={item} value={item}>
                  {getProviderLabel(item)}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-muted-foreground">智能体模型</label>
            <AgentModelInput
              value={model}
              onChange={onModelChange}
              placeholder="模型覆盖"
              className="w-full"
              disabled={view.status === "active" || view.status === "ending" || view.status === "creating"}
            />
          </div>
          <div className="flex flex-wrap items-end justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleInterrupt}
              disabled={interruptDisabled}
              className="h-9 gap-1 px-3 text-xs"
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
              className="h-9 gap-1 px-3 text-xs"
              title="结束整个会话"
            >
              <Square className="h-3 w-3" />
              结束会话
            </Button>
          </div>
        </div>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto bg-background px-5 py-5">
        {view.errorMsg && (
          <div className="mb-3 rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
            {view.errorMsg}
          </div>
        )}
        {/* ql-20260621：AskUserQuestion 对话卡（permission_request.dialog_kind）。
            sticky top-0 让用户在长日志滚动时仍可见、可作答；提交 / SSE resolved
            后自动移除。普通工具审批（无 dialog_kind）不在本面板展示。
            ql-20260623（改动三）：ended/failed 会话不回显 pending dialog 卡片
           （session 已终止，残留 pending 行为死卡；onSessionEnded 也会清空）。 */}
        {pendingRequests.length > 0 && view.status !== "ended" && view.status !== "failed" && (
          <div className="sticky top-0 z-10 mb-3 space-y-2 border-b border-indigo-300 bg-indigo-50/95 px-3 py-2 shadow-sm backdrop-blur-sm">
            {pendingRequests.map((req) => (
              <ErrorBoundary
                key={req.request_id}
                label="ask-user-dialog-card"
                fallback={() => (
                  <div className="text-[11px] text-red-600/70">
                    提问卡片渲染失败
                  </div>
                )}
              >
                <AskUserDialogCard
                  request={req}
                  onResolved={handleDialogResolved}
                />
              </ErrorBoundary>
            ))}
          </div>
        )}
        {view.turns.length === 0 ? (
          <div className="flex h-full min-h-[260px] flex-col items-center justify-center text-center">
            <p className="text-xs font-medium text-foreground">
              {hasOnlineProvider
                ? `${getProviderLabel(provider)} 已就绪`
                : "没有在线守护进程"}
            </p>
            <p className="mt-1 max-w-[260px] text-[11px] text-muted-foreground">
              {hasOnlineProvider
                ? "首条消息将创建会话；单条 SSE 贯穿整段对话，可中途追问、打断本轮或结束会话。"
                : "启动守护进程后即可发送。"}
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
                {(turn.thinking || turn.toolEvents.length > 0 || turn.output) && (
                  <div className="flex justify-start">
                    <div className="max-w-[86%] space-y-1.5 rounded-md border bg-card px-3 py-2 text-xs leading-relaxed text-foreground shadow-sm">
                      {/* ql-20260730-001：思考过程(默认折叠) */}
                      {turn.thinking && (
                        <SessionCollapsible
                          tone="thinking"
                          title="💭 思考过程"
                          summary={turn.thinking.replace(/\s+/g, " ").trim().slice(0, 50)}
                        >
                          <div className="whitespace-pre-wrap break-words text-muted-foreground">
                            {turn.thinking}
                          </div>
                        </SessionCollapsible>
                      )}
                      {/* 工具调用(默认折叠,显示数量) */}
                      {turn.toolEvents.length > 0 && (
                        <SessionCollapsible
                          tone="tool"
                          title={`🔧 工具调用 · ${turn.toolEvents.length} 个`}
                        >
                          <div className="space-y-1.5">
                            {turn.toolEvents.map((evt, i) => (
                              <div
                                key={i}
                                className="rounded border border-border bg-background px-2 py-1.5"
                              >
                                <div className="mb-1 flex items-center gap-1.5">
                                  <span className="rounded bg-primary px-1.5 py-0.5 text-[10px] text-primary-foreground">
                                    {parseToolRaw(evt.raw)?.tool ?? "工具"}
                                  </span>
                                  <span
                                    className={
                                      evt.status === "ok"
                                        ? "text-[10px] text-success"
                                        : evt.status === "deny"
                                          ? "text-[10px] text-destructive"
                                          : "text-[10px] text-muted-foreground"
                                    }
                                  >
                                    {evt.status === "ok"
                                      ? "✓ 成功"
                                      : evt.status === "deny"
                                        ? "✗ 失败/拒绝"
                                        : "⏳ 进行中"}
                                  </span>
                                  {parseToolRaw(evt.raw)?.copyText && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const ct = parseToolRaw(evt.raw)?.copyText ?? "";
                                        void navigator.clipboard?.writeText(ct);
                                      }}
                                      className="ml-auto rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
                                      title="复制命令"
                                    >
                                      复制
                                    </button>
                                  )}
                                </div>
                                <div className="break-all font-mono text-[10px] text-muted-foreground">
                                  {parseToolRaw(evt.raw)?.primary ?? evt.raw}
                                </div>
                                {evt.result && (
                                  <div className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/40 p-1.5 font-mono text-[10px] text-muted-foreground">
                                    {evt.result}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </SessionCollapsible>
                      )}
                      {/* 最终回复(突出) */}
                      {turn.output && (
                        <>
                          {(turn.thinking || turn.toolEvents.length > 0) && (
                            <div className="border-t border-border" />
                          )}
                          <MarkdownText content={turn.output} />
                        </>
                      )}
                    </div>
                  </div>
                )}
                {turn.errorDetail && (
                  <div className="flex justify-start">
                    <div className="max-w-[86%]">
                      <ErrorBoundary
                        label="run-error-item"
                        fallback={() => (
                          <div className="text-[11px] text-red-600/70">
                            运行错误展示失败
                          </div>
                        )}
                      >
                        {/* 2026-07-29-model-error-visibility：turn 失败的结构化错误展示
                            （原因 + 针对性建议 + 操作）。onResend 仅在 prompt 存在时提供，
                            RunErrorItem 内部再按 retryable 决定是否渲染「重新发送」；
                            retryable=false 时主操作自动升为「切换供应商」。 */}
                        <RunErrorItem
                          item={turn.errorDetail}
                          onResend={
                            turn.prompt.trim()
                              ? () => {
                                  void handleResend(turn.prompt);
                                }
                              : undefined
                          }
                          onSwitchProvider={handleSwitchProvider}
                        />
                      </ErrorBoundary>
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  <TurnStatusBadge
                    status={turn.status}
                    turn={turn.turn}
                    inputTokens={turn.inputTokens}
                    outputTokens={turn.outputTokens}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <footer className="shrink-0 border-t bg-card px-5 py-4">
        <div className="flex items-end gap-3">
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
            className="min-h-12 flex-1 resize-none rounded border border-input bg-background px-3 py-2 text-sm leading-5 focus:border-ring focus:outline-none disabled:cursor-not-allowed disabled:bg-muted"
            rows={2}
            disabled={sendingDisabled}
          />
          <Button
            onClick={handleSend}
            disabled={sendingDisabled || !input.trim()}
            className="h-12 w-12 shrink-0 p-0"
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

/**
 * ql-20260730-003：会话气泡内的折叠卡片（灰底思考 / 蓝底工具）。
 * 带摘要的单行折叠条，点击展开内容。替代 agent-log 的 CollapsibleSection
 * （后者是日志流纯文字小箭头风格，与气泡视觉不搭）。
 */
function SessionCollapsible({
  tone,
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  tone: "thinking" | "tool";
  title: string;
  summary?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const headerCls =
    tone === "thinking"
      ? "bg-zinc-100 border-zinc-200 text-zinc-600"
      : "bg-blue-50 border-blue-200 text-blue-700";
  return (
    <div className={`overflow-hidden rounded border ${headerCls}`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-[11px] font-medium"
      >
        <span className="text-[9px]">{open ? "▼" : "▶"}</span>
        <span className="shrink-0">{title}</span>
        {!open && summary && (
          <span className="ml-1 min-w-0 flex-1 truncate text-[10px] font-normal opacity-60">
            {summary}
          </span>
        )}
      </button>
      {open && (
        <div className="border-t border-current/10 bg-background px-2.5 py-2 text-foreground">
          {children}
        </div>
      )}
    </div>
  );
}
/**
 * ql-20260730-002：解析 tool_use raw（JSON 字符串）为工具名 + 主要参数 + 复制文本。
 * 解析失败（非 JSON）返回 null，渲染时原样显示 raw。
 */
function parseToolRaw(
  raw: string,
): { tool: string; primary: string; copyText: string } | null {
  try {
    const obj = JSON.parse(raw);
    const tool = obj.tool ?? "工具";
    const args = obj.args ?? {};
    if (tool === "Bash") {
      const cmd = args.command ?? "";
      return { tool, primary: cmd, copyText: cmd };
    }
    if (tool === "Write" || tool === "Edit" || tool === "Read") {
      const fp = args.file_path ?? "";
      const ct = args.content ? `${fp}\n\n${args.content}` : fp;
      return { tool, primary: fp, copyText: ct };
    }
    if (tool === "Agent") {
      const desc = args.description ?? args.prompt ?? "";
      return { tool, primary: desc, copyText: desc };
    }
    // 通用：取 description/command/file_path/prompt，复制完整 args JSON
    const generic = args.description ?? args.command ?? args.file_path ?? args.prompt ?? raw.slice(0, 120);
    return { tool, primary: generic, copyText: JSON.stringify(args, null, 2) };
  } catch {
    return null;
  }
}

function TurnStatusBadge({
  status,
  turn,
  inputTokens,
  outputTokens,
}: {
  status: TurnUiStatus;
  turn: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
}) {
  const label =
    turn != null ? `第 ${turn} 轮` : "轮次";
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
  // ql-20260621：token 显示。执行中（running/pending）有累积值时显示「输入 N…」
  // 表明实时统计进行中；终态显示完整「↑in ↓out」。两者皆 null 时不渲染。
  // 规范化 undefined → null，防御上游 env.input_tokens / turn.inputTokens 缺失。
  const inTokens = inputTokens ?? null;
  const outTokens = outputTokens ?? null;
  const showTokens = inTokens !== null || outTokens !== null;
  const isLive = status === "running" || status === "pending" || status === "interrupting";
  return (
    <span className={cn("font-mono", tone[status])}>
      {label} · {statusLabel[status]}
      {showTokens && (
        <span className="ml-1.5 text-muted-foreground/80">
          {" · "}
          {inTokens !== null ? `↑${inTokens.toLocaleString()}` : "↑0"}
          {" "}
          {outTokens !== null
            ? `↓${outTokens.toLocaleString()}`
            : isLive
              ? "↓执行中…"
              : "↓0"}
        </span>
      )}
    </span>
  );
}

/** 把 log envelope 渲染成纯文本片段。
 *  2026-07-11-unify-runtime-session-dialog / FR-04 / D-004: 改调共享
 *  sanitizeSessionLogContent，与 logsToTurns（attach 历史预填）共用同一过滤，
 *  避免 thinking/SYSTEM/AskUserQuestion 等原始标记泄漏到正文。 */
function renderLogContent(env: SessionStreamEnvelope): string {
  return sanitizeSessionLogContent(env.content ?? "", env.channel);
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
      thinking: "",
      toolEvents: [],
      status: "running",
      seenLogIds: new Set(),
      inputTokens: env.input_tokens ?? null,
      outputTokens: env.output_tokens ?? null,
      errorDetail: null,
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
