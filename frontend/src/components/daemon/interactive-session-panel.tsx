"use client";

/**
 * task-11（FR-10 / D-006@v1 / D-002@v3）：交互式会话面板。
 *
 * task-13（2026-08-14-sessions-portal / FR-05 / D-002@v1）：消息流与输入区抽为共享
 * 子组件 TurnTimeline / SessionInputBar（./turn-timeline、./session-input-bar），本面板
 * 改为组装层——弹窗 header（智能体提供方/智能体模型等）与全部状态机/提交逻辑保留原样，
 * 对外 props 与行为零回归（NG-04/D-002，弹窗继续用原 provider 入参路径）。
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
  Square,
  Users,
} from "lucide-react";

import { AgentModelInput } from "@/components/AgentModelInput";
import { buildErrorLogItem } from "@/components/agent-log/normalize";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  type SessionStreamConnection,
  type SessionStreamEnvelope,
} from "@/lib/daemon";
import { cn } from "@/lib/utils";
import { classifySessionLog, isToolResultDenied, statusFromToolUseRaw } from "@/components/daemon/session-log-sanitize";
import { logsToTurns } from "@/components/daemon/runtime-session-helpers";
import {
  TurnTimeline,
  type SessionTurnView,
  type SessionUiStatus,
  type TurnUiStatus,
} from "@/components/daemon/turn-timeline";
import { SessionInputBar } from "@/components/daemon/session-input-bar";

// task-13：类型定义已迁至 turn-timeline.tsx（共享子组件持有数据契约）。
// 此处 re-export 维持既有 import 路径（runtime-session-helpers / change-session-section
// / runtime-session-dialog 均从本文件导入，不在本 task 改动范围）。
export type {
  SessionProcessItem,
  SessionToolEvent,
  SessionTurnView,
  SessionUiStatus,
  TurnUiStatus,
} from "@/components/daemon/turn-timeline";

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
      // 结束会话成功后通知父级刷新列表（左侧状态即时更新为「已结束」）。
      // 原实现不调 onSessionReset，父级 handleSessionReset 的 reloadSessions 不会触发。
      onSessionReset?.();
    } catch (err) {
      // 网络错误：不假定 ended，恢复 active，允许重试
      const apiErr = err as ApiError;
      setView((prev) => ({
        ...prev,
        status: "active",
        errorMsg: apiErr instanceof ApiError ? apiErr.message : "结束会话失败，请重试",
      }));
    }
  }, [view.sessionId, view.status, closeStream, onSessionReset]);

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
    (offlineReadOnly ?? false); // task-03：离线只读禁用发送（task-13：?? false 规范化 optional → boolean）

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

      {/* task-13（2026-08-14-sessions-portal / FR-05 / D-002@v1）：消息流共享子组件。
          从本面板纯机械抽取（行为/样式零变化），供 /sessions 新页面独立组装复用。 */}
      <TurnTimeline
        turns={view.turns}
        viewMode={viewMode}
        errorMsg={view.errorMsg}
        sessionStatus={view.status}
        pendingRequests={pendingRequests}
        dialogHistory={dialogHistory}
        onDialogResolved={handleDialogResolved}
        onResend={(prompt) => {
          void handleResend(prompt);
        }}
        onSwitchProvider={handleSwitchProvider}
        hasOnlineProvider={hasOnlineProvider}
        emptyProviderLabel={getProviderLabel(provider)}
      />

      {/* task-13：输入区共享子组件（同上，纯机械抽取）。 */}
      <SessionInputBar
        value={input}
        onChange={setInput}
        onSend={() => {
          void handleSend();
        }}
        disabled={sendingDisabled}
        placeholder={placeholder}
        creating={view.status === "creating"}
      />
    </section>
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
  // ql-20260817-007：同 /sessions 页——attach 历史 turn（伪 runId + realRunId）
  // 与 SSE 事件按两者匹配合并，防同 run 双 turn。
  const idx = prev.turns.findIndex(
    (t) => t.runId === runId || t.realRunId === runId,
  );
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
