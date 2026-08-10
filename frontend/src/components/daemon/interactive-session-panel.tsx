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

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Ban,
  Bot,
  MessageSquareText,
  Plus,
  RefreshCw,
  Send,
  Square,
  Users,
  Wrench,
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
  fetchSessionDialogHistory,
  injectSession,
  interruptSession,
  endSession,
  streamSession,
  getAgentSession,
  getAgentSessionLogs,
  listSessionRuns,
  PROVIDER_META,
  type InteractiveProvider,
  type SessionDialogRead,
  type SessionPermissionRequest,
  type SessionPermissionResolved,
  type SessionStreamConnection,
  type SessionStreamEnvelope,
} from "@/lib/daemon";
import { cn } from "@/lib/utils";
import { classifySessionLog, extractDialogQA, isToolResultDenied, statusFromToolUseRaw } from "@/components/daemon/session-log-sanitize";
import { logsToTurns } from "@/components/daemon/runtime-session-helpers";

/**
 * ql-20260730-003：一个回合内按真实到达顺序排列的过程项。
 * 思考/工具/stderr 混在同一有序序列，渲染时连续 thinking 合并成一整段（被工具/stderr
 * 打断则分段、工具卡片穿插其间），保留 agent 真实执行时序——不一股脑合并丢顺序。
 * - thinking：[THINKING] 片段（可能多段，连续的才合并）
 * - tool：工具调用事件（含配对 result + 状态；raw 空串=孤儿 result 无配对 use）
 * - stderr：channel=stderr 的错误/告警文本
 */
export type SessionProcessItem =
  | { kind: "thinking"; text: string; ts?: number }
  | ({ kind: "tool" } & SessionToolEvent & { ts?: number })
  | { kind: "stderr"; text: string; ts?: number };

type SessionUiStatus = "idle" | "creating" | "active" | "ending" | "ended" | "failed" | "reconnecting";
type TurnUiStatus = "pending" | "running" | "interrupting" | "completed" | "failed" | "killed";

/**
 * ql-20260730-001：agent 回合内的工具调用事件（折叠卡片用）。
 * - raw：[TOOL_USE] 内容（命令/args，已剥前缀；空串=孤儿 result 无配对 use）
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
  /**
   * ql-20260730-003：回合过程项（思考/工具/stderr），按真实到达顺序累积。
   * 默认「对话」视图只渲染 prompt + output（答复正文）；切「全部」后在答复气泡前按序
   * 渲染——连续 thinking 合并成一整段、被工具/stderr 打断则分段（保留时序）。
   * 可选：外部构造的历史 turn（logsToTurns 已填充）。
   */
  processItems?: SessionProcessItem[];
  /**
   * ql-20260802-001：真实 agent_run_id（attach 历史 turn 用）。logsToTurns 按 log.run_id
   * 分组但 turn.runId 用伪 id（__attach_history_N__）作 React key；realRunId 保留真实
   * run_id，供 AskUser 提问历史按 run_id 穿插到对应 turn（跟会话顺序，不再堆顶）。实时
   * turn 的 runId 本就是真实 run_id，realRunId 留 undefined，渲染匹配用 realRunId ?? runId。
   */
  realRunId?: string;
}

interface InteractiveSessionView {
  sessionId: string | null;
  status: SessionUiStatus;
  currentRunId: string | null;
  turns: SessionTurnView[];
  errorMsg: string | null;
  /**
   * 2026-08-05-daemon-kill-channel-unify task-13 / FR-04 / design §5 Phase4：
   * lease.terminating_at（ISO 字符串）非空时表示 lease 处于「已标终止、等 daemon
   * 回传确认」的观测窗口。attach 轮询时从 getAgentSession 拿到（AgentSessionRead
   * 已暴露 terminating_at）；非空时顶部显示「终止中…」横幅而非立刻判定已停止。
   * daemon 回传 session_ended（onSessionEnded）后清空。
   */
  terminatingAt: string | null;
}

const INITIAL_VIEW: InteractiveSessionView = {
  sessionId: null,
  status: "idle",
  currentRunId: null,
  turns: [],
  errorMsg: null,
  terminatingAt: null,
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
  /**
   * 2026-07-31-offline-session-readonly：运行时离线只读模式。true 时禁用 4 操作
   * （新建/发送/打断/结束）+ 顶部离线横幅 + attach 不建 SSE 直接以 initialTurns 只读。
   * 由 RuntimeSessionDialog 据 runtime.status!=='online' 传入；change-session-section
   * 不传（默认 false）→ 原行为不变（D-003）。
   */
  offlineReadOnly?: boolean;
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
  offlineReadOnly,
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
  // ql-20260801-003：AskUserQuestion 问答历史（pending+answered），独立于实时卡片——
  // 卡片回答后即移除、failed/ended 会话不渲染卡片，历史靠 GET /dialogs/history 恢复展示。
  const [dialogHistory, setDialogHistory] = useState<SessionDialogRead[]>([]);
  // ql-20260729-005：消息视图模式。「对话」（默认）只显用户消息 + agent 答复正文；
  // 「全部」追加 thinking/工具调用/stderr 过程项。参考 agent-log-viewer 的
  // 对话/全部二态 tab（ql-20260626-001），但不做二级筛选按钮组。
  const [viewMode, setViewMode] = useState<"conversation" | "all">("conversation");
  const scrollRef = useRef<HTMLDivElement>(null);
  const streamConnRef = useRef<SessionStreamConnection | null>(null);
  // task-10 attach 模式轮询句柄（unmount / 转出 attach 模式时清理）
  const attachPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 2026-07-29-model-error-visibility：已拉取过 error_detail 的 failed run_id 集合，
  // 防 SSE 重连重发 turn_completed 触发重复 listSessionRuns（同一 failed run 只拉一次）。
  const fetchedErrorRunIdsRef = useRef<Set<string>>(new Set());
  // 2026-08-03-session-stream-partial-revoke / FR-05 / design §5 Phase2 / §7.2：
  // partial segment 起点（reply→outputStart / thinking→itemIndex），按 segmentId 索引。
  // 挂 useRef 不驱动渲染——撤回的渲染由 setView/upsertTurn 触发，Map 仅作 segmentId→起点
  // 查表。收到 override 令箭时按 segmentId 截断 turn.output(slice(0, outputStart)) 或移除
  // processItems 项。turn 边界（onTurnCompleted/clearCurrentRun）清空防跨 turn 串扰（R-02）。
  const partialSegmentsRef = useRef<Map<string, { outputStart: number; length: number } | { itemIndex: number }>>(new Map());

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
  const establishStream = useCallback(async (sessionId: string) => {
    // 防御：已有连接不重建（inject 不重建 EventSource）。
    if (streamConnRef.current) return;
    // prefetch 先回灌历史（agent-stream.ts 模式，防 SSE 订阅前 daemon publish 丢事件）。
    // 必须 await 先于 SSE 建连：否则 SSE 收到 turn_started 建空 turn 后 prev.turns 非空，
    // prefetch 条件（prev.turns 空）不满足 → 不回灌 → output 空白。
    try {
      const logs = await getAgentSessionLogs(sessionId);
      if (logs.length > 0) {
        const turns = logsToTurns(logs);
        if (turns.length > 0) {
          setView((prev) =>
            prev.turns.length > 0 ? prev : { ...prev, sessionId, turns },
          );
        }
      }
    } catch {
      /* prefetch 失败不阻断 SSE */
    }
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
              // ql-20260730-003：分类分流 + 工具 use/result 配对，按真实到达顺序入 processItems
              // （思考/工具/stderr 混在同一有序序列，渲染时连续 thinking 才合并、被工具打断分段）。
              // - tool_use → 追加 tool 项（status 从 tool_call JSON 的 success 取，已结束会话不假运行）
              // - tool_result → 配对最近「尚无 result」的 tool 项补输出文本（status 保留 success 值）；
              //   找不到配对（孤儿 result）降级为 raw 空的 tool 项兜底，不丢数据
              // - thinking/stderr → 追加过程项（保留到达顺序）
              // - reply → 答复正文（对话视图默认展示）
              const seg = classifySessionLog(env.content ?? "", env.channel);
              if (!seg) return turn;
              // 2026-08-03-session-stream-partial-revoke / FR-05：override 撤回令箭——按
              // segmentId 精确撤回已渲染的半截。override 是信号非日志（log_id=None，
              // task-02 design §7.1），不写 seenLogIds、不渲染正文。Map 无该 segmentId
              // （迟到 override / complete 已替换）静默 no-op。
              if (seg.kind === "override" && seg.segmentId) {
                const start = partialSegmentsRef.current.get(seg.segmentId);
                if (!start) return turn;
                partialSegmentsRef.current.delete(seg.segmentId);
                if (seg.variant === "assistant" && "outputStart" in start) {
                  const end = start.outputStart + (start.length ?? 0);
                  return { ...turn, output: turn.output.slice(0, start.outputStart) + turn.output.slice(end) };
                }
                if (seg.variant === "thinking" && "itemIndex" in start) {
                  return {
                    ...turn,
                    processItems: (turn.processItems ?? []).filter((_, i) => i !== start.itemIndex),
                  };
                }
                return turn;
              }
              // ql-20260802-003：保留 log 时间戳（ms），供「全部」视图把 AskUser 提问按
              // created_at 穿插进思考/工具时间线（真实顺序，而非固定堆末尾）。
              const ts = env.timestamp ? Date.parse(env.timestamp) : undefined;
              if (seg.kind === "tool_use") {
                // status 从 tool_call JSON 的 success 字段取（权威源，避免已结束会话假运行）
                return {
                  ...turn,
                  seenLogIds: nextSeen,
                  processItems: [
                    ...(turn.processItems ?? []),
                    { kind: "tool", raw: seg.text, status: statusFromToolUseRaw(seg.text), ts },
                  ],
                };
              }
              if (seg.kind === "tool_result") {
                // 配对最近「尚无 result」的 tool 项（补输出文本）：status 优先保留 success 已定
                // 的值；仅当仍 running（success 未解析出）才用 result 文本关键词兜底。
                const items = [...(turn.processItems ?? [])];
                let paired = false;
                for (let i = items.length - 1; i >= 0; i -= 1) {
                  const it = items[i];
                  if (it && it.kind === "tool" && it.result === undefined) {
                    // ql-20260801-004：result 拒绝优先覆盖 use 的 success。daemon tool_call
                    // JSON 硬编码 success:true（表「已放行」非「执行成功」），Runtime Policy 拒绝
                    // 只在 result 文本——result 含明确拒绝/失败 → deny（覆盖已 ok）；否则 success
                    // 权威（成功输出含 fail/error 字样不误判，isToolResultDenied 已收紧关键词）。
                    const status = isToolResultDenied(seg.text)
                      ? "deny"
                      : it.status === "running"
                        ? "ok"
                        : it.status;
                    items[i] = { kind: "tool", raw: it.raw, result: seg.text, status, ts: it.ts };
                    paired = true;
                    break;
                  }
                }
                if (!paired) {
                  // ql-20260801-004：孤儿拒绝 result 也判 deny（不硬编码 ok）
                  items.push({
                    kind: "tool",
                    raw: "",
                    result: seg.text,
                    status: isToolResultDenied(seg.text) ? "deny" : "ok",
                    ts,
                  });
                }
                return { ...turn, seenLogIds: nextSeen, processItems: items };
              }
              if (seg.kind === "reply") {
                // 2026-08-03-session-stream-partial-revoke / FR-05：partial reply（带
                // segment_id）先记半截起点（concat 前 output 长度），再 concat。收到对应
                // override 时按此起点 slice(0, outputStart) 截断撤回。complete（segment_id
                // 为 null/undefined）不记 Map——design §9 兼容：旧 backend 缺字段 undefined 空转。
                if (env.segment_id) {
                  const existing = partialSegmentsRef.current.get(env.segment_id);
                    if (existing && "outputStart" in existing) {
                      existing.length += seg.text.length;
                    } else {
                      partialSegmentsRef.current.set(env.segment_id, { outputStart: turn.output.length, length: seg.text.length });
                    }
                }
                return {
                  ...turn,
                  seenLogIds: nextSeen,
                  // ql-20260730-004：reply 流式 delta 直接 concat（不加 \n）——
                  // 它们是同一段流式输出的连续片段，换行保留在各 delta 内部，
                  // 在 token 边界插 \n 会破坏 markdown 连续结构（实测 7fb9227d 确诊）。
                  output: turn.output + seg.text,
                };
              }
              // 2026-08-03-session-stream-partial-revoke / FR-05：partial thinking 先记
              // 即将 append 的项索引（concat 前 processItems 长度），收到 override 时按此
              // itemIndex filter 移除。stderr 不记（无撤回）。
              if (seg.kind === "thinking" && env.segment_id) {
                partialSegmentsRef.current.set(env.segment_id, {
                  itemIndex: (turn.processItems ?? []).length,
                });
              }
              // thinking / stderr → 追加过程项（保留到达顺序，渲染时连续 thinking 才合并）
              return {
                ...turn,
                seenLogIds: nextSeen,
                processItems: [
                  ...(turn.processItems ?? []),
                  seg.kind === "thinking"
                    ? { kind: "thinking", text: seg.text, ts }
                    : { kind: "stderr", text: seg.text, ts },
                ],
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

          // 2026-08-03-session-stream-partial-revoke / FR-05 / R-02：turn 边界清空 partial
          // segment Map——防跨 turn segmentId 复用导致误撤回。在 setView 回调外层直接清 ref，
          // 不依赖渲染时机（task-06 constraints）。clearCurrentRun 已把 currentRunId 置 null，
          // 此 turn 的 partial 历史不再需要。
          partialSegmentsRef.current.clear();

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
            // task-13 / FR-04：daemon 回传 session_ended → 清终止中态（终止已确认）
            terminatingAt: null,
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
    // task-04（2026-07-31-offline-session-readonly / B3）：离线只读——不建 SSE，直接以
    // initialTurns 只读渲染（active 态保持），重连后 effect 重跑建 SSE（deps 含 offlineReadOnly）。
    if (offlineReadOnly) {
      if (streamConnRef.current) {
        streamConnRef.current.close();
        streamConnRef.current = null;
      }
      setView({
        sessionId: attachSessionId,
        status: "active",
        currentRunId: null,
        turns: initialTurns ?? [],
        errorMsg: null,
        terminatingAt: null,
      });
      // eslint-disable-next-line react-hooks/exhaustive-deps
      return;
    }
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
      terminatingAt: null,
    });
    // initialTurns 仅在 mount 时读取，避免 props 变更抖动（react-hooks/exhaustive-deps 忽略）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachSessionId, establishStream, offlineReadOnly]);

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
        // task-13 / FR-04：detail.terminating_at 由后端经 lease 关联注入（AgentSessionRead
        // 已暴露）。daemon.ts 的手写 AgentSessionRead 类型暂未声明此字段，运行时已带——
        // 用 cast 安全读取（不强制改 daemon.ts，避免越 allowed_paths）。非空表示 lease
        // 处于终止中观测窗口，面板据此显示「终止中…」横幅。
        const detailTermAt =
          (detail as { terminating_at?: string | null }).terminating_at ?? null;
        if (detail.status === "active") {
          stop();
          // 恢复 currentRunId（attach 运行中会话时启用打断按钮；detail.current_run_id
          // 由 get_session_detail 注入，无运行 run 则保持 null）
          setView((prev) => ({
            ...prev,
            status: "active",
            errorMsg: null,
            currentRunId: detail.current_run_id ?? prev.currentRunId,
            terminatingAt: detailTermAt,
          }));
        } else if (detail.status === "failed") {
          stop();
          setView((prev) => ({
            ...prev,
            status: "failed",
            errorMsg: "会话恢复失败，可能上下文已失效",
            terminatingAt: null,
          }));
        } else if (detail.status === "ended") {
          // 2026-07-11-unify-runtime-session-dialog: ended 会话 attach（无 SDK session id
          // 等无法 reopen 的老会话）→ 转只读 ended 态，显示 initialTurns 历史，不卡轮询。
          stop();
          setView((prev) => ({ ...prev, status: "ended", errorMsg: null, terminatingAt: null }));
        } else {
          // pending/reconnecting：terminating_at 可能已带，先更新以便尽早显示「终止中…」
          setView((prev) =>
            prev.terminatingAt === detailTermAt
              ? prev
              : { ...prev, terminatingAt: detailTermAt },
          );
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

  // ql-20260801-003：拉取会话的 AskUserQuestion 完整问答历史（pending+answered）。
  // 实时卡片回答后即移除、failed/ended 会话不渲染卡片，历史问答只能靠此 REST 恢复。
  // 与 pending 恢复同理：sessionId 变化时拉一次（SSE 只推实时新事件，刷新/重连不重放）。
  useEffect(() => {
    if (!view.sessionId) return;
    const sessionId = view.sessionId;
    let cancelled = false;
    void fetchSessionDialogHistory(sessionId)
      .then((history) => {
        if (cancelled || !history) return;
        setDialogHistory(history);
      })
      .catch(() => {
        // 历史拉取失败不阻塞会话主流程
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
            status: "pending",
            seenLogIds: new Set(),
            inputTokens: null,
            outputTokens: null,
            errorDetail: null,
            processItems: [],
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
          { runId: "__pending_create__", turn: null, prompt, output: "", status: "pending", seenLogIds: new Set(), inputTokens: null, outputTokens: null, errorDetail: null, processItems: [] },
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
    // 新建会话不结束当前会话：backend session 保持 active（列表仍显示进行中，
    // 需继续可重新点击会话 attach）。仅断开当前 SSE + 重置面板到新建模式。
    // 原实现 active 时先 handleEnd 结束当前会话，导致「点新建=误结束当前会话」。
    closeStream();
    setView(INITIAL_VIEW);
    setInput("");
    setPendingRequests([]);
    // ql-20260623（改动一）：重置回 idle 时通知父级清除 URL ?session= param
    onSessionReset?.();
  }, [closeStream, onSessionReset]);

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
    !hasOnlineProvider ||
    offlineReadOnly; // task-03：离线只读禁用发送

  const interruptDisabled =
    view.status !== "active" || !view.currentRunId ||
    view.turns.some((t) => t.runId === view.currentRunId && t.status === "interrupting") ||
    offlineReadOnly; // task-03：离线只读禁用打断
  const endDisabled = view.status !== "active" || offlineReadOnly; // task-03：离线只读禁用结束

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
      {offlineReadOnly ? (
        <div className="flex items-center gap-2 border-b border-amber-300 bg-amber-50 px-5 py-2 text-xs text-amber-800">
          <span aria-hidden>⚠️</span>
          <span>运行时离线，当前为只读浏览（发送/打断/结束/新建已禁用），重连后自动恢复。</span>
        </div>
      ) : null}
      {/* task-13 / FR-04 / R-08 / design §5 Phase4：lease 处于 terminating 态（terminating_at
          非空）时显示「终止中…」横幅——backend cancel_lease 已标 lease.terminating_at、
          等 daemon 回传统态的观测窗口。避免立刻判定「已停止」给用户错误终态印象。
          横幅在 session 终态（ended/failed）外才显示；onSessionEnded 会清空 terminatingAt。 */}
      {view.terminatingAt && view.status !== "ended" && view.status !== "failed" ? (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-2 border-b border-amber-300 bg-amber-50 px-5 py-2 text-xs text-amber-800"
        >
          <RefreshCw className="h-3 w-3 animate-spin" aria-hidden />
          <span>终止中…守护进程正在结束会话进程，稍候将自动更新为已停止。</span>
        </div>
      ) : null}
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
            {/* ql-20260729-005：对话/全部二态切换（仅在有消息时出现）。对话=只显
                用户消息与 agent 答复；全部=追加思考/工具/ stderr 过程项。 */}
            {view.turns.length > 0 && (
              <div
                role="tablist"
                aria-label="消息显示范围"
                className="inline-flex items-center rounded-full border bg-muted/50 p-0.5"
              >
                {(["conversation", "all"] as const).map((m) => (
                  <button
                    key={m}
                    role="tab"
                    aria-selected={viewMode === m}
                    onClick={() => setViewMode(m)}
                    className={cn(
                      "rounded-full px-2.5 py-1 text-[11px] leading-none transition-colors",
                      viewMode === m
                        ? "bg-card font-medium text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {m === "conversation" ? "对话" : "全部"}
                  </button>
                ))}
              </div>
            )}
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
              disabled={offlineReadOnly || view.status === "creating" || view.status === "ending"}
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
        {/* ql-20260802-001：AskUser 提问记录已改为按 run_id 穿插到对应 turn 内（跟会话
            顺序），不再在此处堆顶展示。顶部仅保留 pending 实时交互卡片（上方 pendingRequests）。 */}
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
          <div className="space-y-5">
            {view.turns.map((turn) => (
              <div key={turn.runId} className="space-y-2.5">
                {/* 用户消息气泡（右）。attach 中途接入的 unknown-run turn 无 prompt，不渲染。 */}
                {turn.prompt && (
                  <div className="flex justify-end">
                    <div className="max-w-[82%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm leading-6 text-primary-foreground shadow-sm">
                      <div className="whitespace-pre-wrap break-words">{turn.prompt}</div>
                    </div>
                  </div>
                )}
                {/* ql-20260802-003：「全部」视图把过程项（思考/工具/stderr）与 AskUser 提问
                    按 timestamp/created_at 合并排序统一渲染——AskUser 不再固定堆在过程项
                    之后，而是穿插进真实时间线（思考→工具→提问→工具→…连贯有序）。 */}
                {viewMode === "all" &&
                  (() => {
                    const realRunId = turn.realRunId ?? turn.runId;
                    const turnDialogs = dialogHistory.filter((d) => d.run_id === realRunId);
                    if ((turn.processItems?.length ?? 0) === 0 && turnDialogs.length === 0) return null;
                    const merged: Array<
                      SessionProcessItem | { kind: "askUser"; dialog: SessionDialogRead; ts?: number }
                    > = [
                      ...(turn.processItems ?? []),
                      ...turnDialogs.map((d) => ({
                        kind: "askUser" as const,
                        dialog: d,
                        ts: d.created_at ? Date.parse(d.created_at) : undefined,
                      })),
                    ];
                    merged.sort(
                      (a, b) =>
                        (Number.isFinite(a.ts) ? a.ts! : 0) - (Number.isFinite(b.ts) ? b.ts! : 0),
                    );
                    return <TurnDetailsList items={merged} />;
                  })()}
                {/* ql-20260802-001/003：「对话」视图用轻量 ❓ 提问记录（只显问题+作答，
                    穿插在对应 turn、答复之前）。AskUser 走 onUserDialog 不走 tool_use 日志，
                    故用 dialog 历史渲染。全部视图的 AskUser 已并入上方时间线。 */}
                {viewMode !== "all" &&
                  dialogHistory
                    .filter((d) => d.run_id === (turn.realRunId ?? turn.runId))
                    .map((d) => {
                      const qa = extractDialogQA(d);
                      if (qa.length === 0) return null;
                      return (
                        <div
                          key={`dialog-${d.request_id}`}
                          className="ml-9 space-y-0.5 rounded-md border border-indigo-200 bg-indigo-50/40 px-3 py-1.5 text-xs leading-5"
                        >
                          {qa.map((item, i) => (
                            <div key={i} className="break-words">
                              <span className="font-medium text-foreground">❓ {item.question}</span>
                              <span className="ml-1 text-muted-foreground">
                                → {item.answerText ?? (d.status === "pending" ? "（待答）" : "（未回答）")}
                              </span>
                            </div>
                          ))}
                        </div>
                      );
                    })}
                {/* agent 答复气泡（左，带助手图标）。运行中尚无答复时显示思考占位。 */}
                {turn.output ? (
                  <div className="flex items-start gap-2.5">
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border bg-muted text-muted-foreground">
                      <Bot className="h-3.5 w-3.5" aria-hidden />
                    </span>
                    <div className="max-w-[82%] rounded-2xl rounded-tl-md border bg-card px-4 py-2.5 text-sm leading-6 text-foreground shadow-sm">
                      <MarkdownText content={turn.output} />
                    </div>
                  </div>
                ) : (
                  (turn.status === "running" ||
                    turn.status === "pending" ||
                    turn.status === "interrupting") && (
                    <div className="flex items-start gap-2.5">
                      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border bg-muted text-muted-foreground">
                        <Bot className="h-3.5 w-3.5" aria-hidden />
                      </span>
                      <div className="flex items-center gap-1.5 rounded-2xl rounded-tl-md border bg-card px-4 py-3 shadow-sm">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground/60" />
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground/60 [animation-delay:150ms]" />
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground/60 [animation-delay:300ms]" />
                        <span className="ml-1 text-xs text-muted-foreground">
                          {viewMode === "all" ? "执行中…" : "正在思考…"}
                        </span>
                      </div>
                    </div>
                  )
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
                <div className="flex items-center gap-1.5 pl-9 text-[10px] text-muted-foreground">
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
 * ql-20260729-005：「全部」视图的过程项列表，按真实到达顺序渲染。
 * 缩进对齐答复气泡（ml-9 ≈ 助手图标宽度），左侧竖线表示"执行过程"语义。
 * ql-20260730-003：连续 thinking 合并成一整段「思考过程」卡片，被工具/stderr 打断则
 * 分段（参考 agent 日志 mergedThinkingContent），工具卡片穿插其间保留时序；思考正文
 * 与工具结果均用 MarkdownText 渲染（与对话答复一致）。
 */
function TurnDetailsList({
  items,
}: {
  items: Array<SessionProcessItem | { kind: "askUser"; dialog: SessionDialogRead }>;
}) {
  // 先把连续 thinking 合并成单个渲染项（被 tool/stderr/askUser 打断则分段），保留真实顺序
  type RenderItem =
    | { kind: "thinking"; text: string }
    | { kind: "tool"; event: SessionToolEvent }
    | { kind: "stderr"; text: string }
    | { kind: "askUser"; dialog: SessionDialogRead };
  const grouped: RenderItem[] = [];
  for (const item of items) {
    if (item.kind === "thinking") {
      const last = grouped[grouped.length - 1];
      if (last && last.kind === "thinking") {
        last.text = `${last.text}\n${item.text}`;
      } else {
        grouped.push({ kind: "thinking", text: item.text });
      }
    } else if (item.kind === "tool") {
      grouped.push({
        kind: "tool",
        event: { raw: item.raw, result: item.result, status: item.status },
      });
    } else if (item.kind === "askUser") {
      grouped.push({ kind: "askUser", dialog: item.dialog });
    } else {
      grouped.push({ kind: "stderr", text: item.text });
    }
  }
  return (
    <div className="ml-9 space-y-1 border-l-2 border-muted pl-3">
      {grouped.map((item, idx) => {
        if (item.kind === "thinking") {
          const summary = item.text.replace(/\s+/g, " ").trim();
          return (
            <SessionCollapsible
              key={idx}
              tone="thinking"
              title="思考过程"
              summary={summary.slice(0, 60) + (summary.length > 60 ? "…" : "")}
            >
              <div className="rounded-md bg-muted/50 px-2.5 py-1.5 text-[11px] leading-5 text-muted-foreground">
                <MarkdownText content={item.text} />
              </div>
            </SessionCollapsible>
          );
        }
        if (item.kind === "tool") {
          return <ToolEventCard key={idx} event={item.event} />;
        }
        if (item.kind === "askUser") {
          return <AskUserToolCard key={idx} dialog={item.dialog} />;
        }
        // stderr
        return (
          <div key={idx} className="flex items-start gap-1.5 text-[11px] text-amber-700">
            <span aria-hidden className="shrink-0">⚠</span>
            <span className="min-w-0 whitespace-pre-wrap break-words">{item.text}</span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * ql-20260730-003：单个配对工具事件卡片。
 * 解析 raw（tool_use JSON）为工具名 + 命令 + 复制文本（parseToolRaw，解析失败原样显示），
 * 右上角状态徽章（✓ 成功 / ✗ 失败·被拒 / ⏳ 执行中），result 默认折叠（结果常太长），
 * 展开后用 MarkdownText 渲染。raw 空串=孤儿 result（无配对 use），只显示结果。
 */
function ToolEventCard({ event }: { event: SessionToolEvent }) {
  const parsed = event.raw ? parseToolRaw(event.raw) : null;
  const badge =
    event.status === "ok"
      ? { icon: "✓", cls: "text-emerald-600", title: "执行成功" }
      : event.status === "deny"
        ? { icon: "✗", cls: "text-destructive", title: "执行失败 / 被拒" }
        : { icon: "⏳", cls: "text-blue-600", title: "执行中" };
  const result = event.result?.trim() ?? "";
  return (
    <div className="rounded border border-blue-200 bg-blue-50/40 px-2 py-1.5">
      <div className="mb-0.5 flex items-center gap-1.5 text-[10px] text-blue-700">
        <Wrench className="h-3 w-3 shrink-0" aria-hidden />
        <span className="font-medium">{parsed?.tool ?? (event.raw ? "工具调用" : "工具结果")}</span>
        <span className={cn("font-mono", badge.cls)} title={badge.title} aria-label={badge.title}>
          {badge.icon}
        </span>
        {parsed?.copyText && (
          <button
            type="button"
            onClick={() => {
              const ct = parsed?.copyText ?? "";
              void navigator.clipboard?.writeText(ct);
            }}
            className="ml-auto rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
            title="复制命令"
          >
            复制
          </button>
        )}
      </div>
      {event.raw && (
        <div className="break-all font-mono text-[10px] text-muted-foreground" title={event.raw}>
          {parsed?.primary ?? event.raw}
        </div>
      )}
      {result && (
        <SessionCollapsible
          tone="tool"
          title="结果"
          summary={result.slice(0, 60) + (result.length > 60 ? "…" : "")}
        >
          <div className="rounded-md bg-muted/50 px-2 py-1 text-[10px] leading-5 text-muted-foreground">
            <MarkdownText content={result} />
          </div>
        </SessionCollapsible>
      )}
    </div>
  );
}

/**
 * ql-20260802-002/003：「全部」视图把 AskUser 提问渲染成工具调用卡片（和 Write/Bash 一致），
 * 让 AskUser 在工具区可见。AskUser 不走 tool_use 日志（走 onUserDialog 对话协议，
 * cli.ts:653-659），故用 dialog 历史数据模拟工具卡片：工具名 AskUserQuestion +
 * ✓已答/⏳待答 徽章 + 问题（参数）+ 全部可选项（选中项绿底✓，未选灰○，hover 显 description）。
 * ql-20260802-003 修复：旧版只显用户选中的那一项、看不到其余备选；现显全部 options。
 */
function AskUserToolCard({ dialog }: { dialog: SessionDialogRead }) {
  const qa = extractDialogQA(dialog);
  if (qa.length === 0) return null;
  const pending = dialog.status === "pending";
  const badge = pending
    ? { icon: "⏳", cls: "text-blue-600", title: "等待回答" }
    : { icon: "✓", cls: "text-emerald-600", title: "已回答" };
  return (
    <div className="rounded border border-blue-200 bg-blue-50/40 px-2 py-1.5">
      <div className="mb-0.5 flex items-center gap-1.5 text-[10px] text-blue-700">
        <Wrench className="h-3 w-3 shrink-0" aria-hidden />
        <span className="font-medium">AskUserQuestion</span>
        <span className={cn("font-mono", badge.cls)} title={badge.title} aria-label={badge.title}>
          {badge.icon}
        </span>
      </div>
      <div className="space-y-1">
        {qa.map((item, i) => (
          <div key={i} className="space-y-0.5">
            <div className="break-words font-mono text-[10px] text-muted-foreground">
              ❓ {item.question}
            </div>
            {item.options.length > 0 ? (
              <div className="space-y-0.5 pl-1">
                {item.options.map((opt, j) => (
                  <div
                    key={j}
                    title={opt.description}
                    className={cn(
                      "flex items-start gap-1 rounded px-1.5 py-0.5 text-[10px] leading-5",
                      opt.selected
                        ? "bg-emerald-50 font-medium text-emerald-700"
                        : "text-muted-foreground/70",
                    )}
                  >
                    <span aria-hidden className="shrink-0">
                      {opt.selected ? "✓" : "○"}
                    </span>
                    <span className="min-w-0 break-words">{opt.label}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="break-words text-muted-foreground">
                → {item.answerText ?? (pending ? "（待答）" : "（未回答）")}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * ql-20260730-003：会话气泡内的折叠卡片（灰底思考 / 蓝底工具）。
 * 带摘要的单行折叠条，点击展开内容。替代 agent-log 的 CollapsibleSection
 * （后者日志流小箭头风格与气泡不搭）。融合自 WhaleFall d5466b7e，配 processItems 渲染。
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
  children: ReactNode;
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

interface UpsertOpts {
  setCurrentRun?: string;
  clearCurrentRun?: string;
  requireRunId?: boolean;
  /** 绕过终态幂等检查——onLog 追加 output/工具数据时 true（turn_completed
   * 可能因 daemon submitMessages 退避重试延迟而在 log 之前到达，导致 turn
   * 已终态但 output 还没追加上去）。 */
  bypassTerminal?: boolean;
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
      inputTokens: env.input_tokens ?? null,
      outputTokens: env.output_tokens ?? null,
      errorDetail: null,
      processItems: [],
    };
    turns = [...prev.turns, apply(newTurn)];
  } else {
    turns = prev.turns.map((t, i) => {
      if (i !== idx) return t;
      // P1-3 终态幂等：已终态的 turn 不被后续事件覆盖。
      // 但 onLog（log 事件）例外——daemon submitMessages 退避重试可能导致
      // turn_completed 在 log 之前到达，此时 turn 已终态但 output 还没追加。
      if (!(opts.bypassTerminal || env.event === "log") && TERMINAL_TURN_STATUSES.has(t.status)) return t;
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
