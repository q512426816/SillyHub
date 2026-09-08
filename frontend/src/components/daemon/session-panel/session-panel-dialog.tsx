"use client";

/**
 * dialog 模式内部子组件 SessionPanelDialog（零 react-query，R4；自
 * session-panel.tsx 拆出，task-14 / 2026-09-07-arch-large-file-split design
 * §5 Wave 3，原样搬移；establishStream 闭包状态原样保留 R-03）。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import dayjs, { type Dayjs } from "dayjs";
import {
  Ban, MessageSquareText, PauseCircle, Plus, RefreshCw, Square, TriangleAlert, Users,
} from "lucide-react";
import { Button, Tag } from "antd";
import { AgentModelInput } from "@/components/AgentModelInput";
import { buildErrorLogItem, buildSystemFailureItem } from "@/components/agent-log/normalize";
import { applyLogToSegments, finishTurn } from "@/components/daemon/session-log-assembler";
import { TurnTimeline } from "@/components/daemon/turn-timeline";
import { type AttachmentRead } from "@/lib/api/session-attachments";
import { joinAttachmentMarkers } from "@/components/daemon/runtime-session-helpers";
import {
  SessionInputBar, type SessionInputMentions,
} from "@/components/daemon/session-input-bar";
import { MessageQueueBar } from "@/components/daemon/message-queue-bar";
// task-08（2026-09-07-session-pin-rename-scheduled-send / FR-04）：定时消息展示条
// （自建局部 QueryClientProvider，page / dialog 双挂载点均可安全挂——R4 不变式
// 不破，panel 层零 react-query）。
import {
  ScheduledMessagesBar,
  formatScheduledTime,
  summarizeScheduledPrompt,
} from "@/components/daemon/scheduled-messages-bar";
import { SessionUsageBar } from "@/components/daemon/session-usage-bar";
import { QUEUE_MAX_PENDING, useMessageQueue } from "@/hooks/use-message-queue";
import { logsToTurns } from "@/components/daemon/runtime-session-helpers";
import { ApiError } from "@/lib/api";
import { errMessage, useNotify } from "@/lib/errors";
import { isActiveTeamMission } from "@/components/daemon/team-task-block";
import { ActivityCatalog, type AgentTaskEntry } from "@/components/daemon/activity-catalog";
import { type TeamTriggerInitialConfig } from "@/components/daemon/team-trigger-popover";
import { PlanApprovalCard } from "@/components/daemon/plan-approval-card";
import {
  TaskExecutionPanel, type TaskExecutionPanelHandle,
} from "@/components/daemon/task-execution-panel";
import { type PlanSummary } from "@/lib/daemon";
import {
  cancelTeamMission, createScheduledMessage, createSession, endSession, fetchPendingDialogs, fetchSessionDialogHistory,
  getAgentSession, getAgentSessionLogs, injectSession, interruptSession, listSessionRuns,
  triggerSessionTeamMission, maxLogTimestamp, streamSession, type InteractiveProvider,
  type SessionDialogRead, type SessionPermissionRequest, type SessionStreamConnection,
  type TeamMissionTriggerRequest,
} from "@/lib/daemon";
import { getProviderCaps } from "@/lib/provider-caps";
import { cn } from "@/lib/utils";

import { type SessionPanelProps } from "./index";
import {
  HISTORY_PAGE_SIZE, MAX_PROMPT_LEN, MENTION_PLACEHOLDER_HINT, SUSPENDED_SESSION_REFETCH_MS,
  TERMINAL_TURN_STATUSES, applyBashStatusEvent, appendBashChunk, BashProgressState,
  deriveTurnTerminalStatus, mentionBindOptions, readSessionDraft, writeSessionDraft,
} from "./turn-state";
import {
  assembledViewOf, ATTACH_POLL_MAX_ATTEMPTS, ATTACH_POLL_MS, getProviderLabel,
  INITIAL_DIALOG_VIEW, SessionDialogView, toAssemblerLogInput, upsertDialogTurn,
} from "./dialog-helpers";
import { ScheduledSendModal, ScheduledSysHints } from "./scheduled-send";
import { TeamTriggerRow } from "./team-trigger-row";
import { WorkerSessionOverlay } from "./worker-session-overlay";
import {
  parseTeamCommand, teamTriggerErrorText, useSessionTeamMissions,
} from "./use-session-team-missions";
import { useStreamConnectionGuard } from "./use-stream-connection-guard";
import { StreamConnectionBanner, TurnStalledWatchdogBanner } from "./connection-banners";
import { applyAgentTaskStatusEvent } from "../agent-task-store";

export function SessionPanelDialog(props: SessionPanelProps) {
  // dialog props 解构（公共接口按草案全可选，适配层 task-07 保证 9 个必需项必传；
  // 此处给缺省值兜底，行为以 ISP 必填语义为准）。
  const {
    providers = [],
    defaultProvider = "",
    model,
    onModelChange,
    hasOnlineProvider = false,
    sessionId: attachSessionId,
    initialTurns,
    onSessionCreated,
    onSessionReset,
    changeId,
    workspaceId,
    onTeamMissionCreated,
    offlineReadOnly = false,
  } = props;

  const [provider, setProvider] = useState(defaultProvider);
  const [input, setInput] = useState("");
  const notify = useNotify();
  const [view, setView] = useState<SessionDialogView>(INITIAL_DIALOG_VIEW);
  // task-11（2026-08-22-team-session-unify）：会话内团队触发——弹层开关/预填、
  // 触发在途、错误文案、chip 取消；mission 列表 + 活跃 5s 轮询走共用 hook
  //（旧 teamAnalyzing/teamMissionId（createMission 直发）随「用团队分析」改造下线）。
  // ql-20260828-009-4a13：进行中轮时也轮询（mission 迟到盲区，同 page 模式）。
  const { missions: teamMissions, refresh: refreshTeamMissions } =
    useSessionTeamMissions(view.sessionId, view.currentRunId != null);
  const [teamPopover, setTeamPopover] = useState<{
    open: boolean;
    objective: string | null;
    initial: TeamTriggerInitialConfig | null;
  }>({
    open: false,
    objective: null,
    initial: null,
  });
  const [teamTriggering, setTeamTriggering] = useState(false);
  const [teamError, setTeamError] = useState<string | null>(null);
  // ql-20260828-009-4a13：chip × 真取消在途态（防重复提交）。
  const [teamCancelling, setTeamCancelling] = useState(false);
  // task-14（FR-08 / design §5.E）：查看分身子会话——TeamTaskBlock 分身行点击
  // 后置为该分身 sub_session_id，浮层（WorkerSessionOverlay）复用 SessionPanel
  // 打开；null = 关闭（主控面板 state 不动，关闭即原样返回）。
  const [workerSessionId, setWorkerSessionId] = useState<string | null>(null);
  // AskUserQuestion / 普通 permission_request 待答卡片队列。仅渲染 dialog_kind
  // 存在的（AskUserDialogCard）；普通工具审批卡在本面板不展示（/runtimes 页的
  // PermissionApprovalsPanel 负责）。
  const [pendingRequests, setPendingRequests] = useState<SessionPermissionRequest[]>([]);
  // task-09：plan 模式待确认卡片状态（按 runId 去重，一次只挂一张）。
  const [planPending, setPlanPending] = useState<{
    runId: string;
    summary: PlanSummary;
    requestedAt: string;
  } | null>(null);
  // task-09：bash 命令进度状态（running 期间追加 chunks，completed/failed 后冻结）。
  // 2026-08-25：状态归约统一走底部 applyBashStatusEvent / appendBashChunk（跨命令
  // 重置 + 环形截断，page / dialog 两模式共用）。
  const [bashProgress, setBashProgress] = useState<BashProgressState | null>(null);
  // verify P1 返工（FR-03）：后台 Agent 任务状态（按 task_id upsert，最近 6 条）。
  // task-12（FR-06）：state 扩到全生命周期（形状同 AgentTaskEntry），归约统一
  // 走底部 applyAgentTaskStatusEvent（page / dialog 两模式共用）。
  const [agentTasks, setAgentTasks] = useState<AgentTaskEntry[]>([]);
  // AskUserQuestion 问答历史（pending+answered），独立于实时卡片——卡片回答后
  // 即移除、failed/ended 会话不渲染卡片，历史靠 GET /dialogs/history 恢复展示。
  const [dialogHistory, setDialogHistory] = useState<SessionDialogRead[]>([]);
  // 消息视图模式：「对话」（默认）只显用户消息 + agent 答复正文；「进度」追加
  // thinking/工具调用/stderr 过程项（v2 段模型下为完整段时间线）。dialog 适配层
  // 不传 viewMode 受控对（diff-analysis §5.1），内部自持。
  const [viewMode, setViewMode] = useState<"conversation" | "all">("conversation");
  const streamConnRef = useRef<SessionStreamConnection | null>(null);
  // P0 竞态修复（2026-08-25）：unmount cleanup 先置 disposed 再 close 当前连接——
  // establishStream 的 prefetch await 窗口内卸载时（cleanup 已跑、streamConnRef 仍
  // null），await 返回后据此放弃建流，防无人 close 的僵尸连接（streamSession 内建
  // 退避以 30s 封顶永久重连）。remount（StrictMode 双挂载/复用实例）时由下次
  // establishStream 入口重置为 false。
  const disposedRef = useRef(false);
  // 建流代际：attach 切换 / 重挂载发起更新建流时推进；旧 in-flight await 返回后
  // 据此自查退出（不同 session 的并发建流不共享，见 establishingRef 注释）。
  const streamEpochRef = useRef(0);
  // in-flight 建流（同 sessionId 并发调用复用同一 promise）：入口的
  // `if (streamConnRef.current) return` 守卫在 prefetch await 窗口失效，防两次
  // 并发调用建双连接。不同 sessionId / 已卸载的 in-flight 不复用——前者由代际
  // 推进让其自查退出，后者废弃。
  const establishingRef = useRef<{ sessionId: string; promise: Promise<void> } | null>(
    null,
  );
  // attach 模式轮询句柄（unmount / 转出 attach 模式时清理）。
  const attachPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 已拉取过 error_detail 的 failed run_id 集合，防 SSE 重连重发 turn_completed
  // 触发重复 listSessionRuns（同一 failed run 只拉一次）。
  const fetchedErrorRunIdsRef = useRef<Set<string>>(new Set());
  // ql-20260825-007：dialog 附件三件套（镜像 page 模式 task-12 管线）——待发送
  // 附件（SessionInputBar 📎/粘贴上传回传，随追问/排队消息走 injectSession
  // attachment_ids）、chips 清理句柄、队列条目附件元数据镜像（D-004：投递侧
  // 占位轮标记行用，入队时登记、出队/移除时清理）。
  const [pendingAttachments, setPendingAttachments] = useState<AttachmentRead[]>([]);
  const clearAttachmentsRef = useRef<(() => void) | null>(null);
  const attachmentMetaRef = useRef(new Map<string, { kind: string; name: string }>());
  // task-05（2026-08-26-session-input-mention / FR-05 / FR-06）：@ 联想结构化选中
  // 暂存（同 page 模式——首句 createSession 合并语义见 handleSend idle 分支，
  // 追问/排队随 injectSession 上送 bind_change_key/bind_quick_id；发送成功后
  // 清空，草稿持久化不存，R-7）。
  const [pendingMentions, setPendingMentions] = useState<SessionInputMentions>({});
  // ql-20260825-011：发送中（inject 在途）占位信息——「打断本轮」发送窗口期
  // 触发时回退消息到输入框（同 page 模式 inflightSendRef 语义）。
  const inflightSendRef = useRef<{ placeholderId: string; prompt: string } | null>(null);
  // ql-20260825-011：服务端排队刷新桥——establishStream（SSE 回调，定义早于
  // useMessageQueue 调用）经 ref 触发队列刷新，避开 use-before-define。
  const queueRefreshRef = useRef<() => void>(() => {});
  // 2026-08-29-session-usage-stats task-04（R-04）：用量条重取信号——dialog 分支
  // 独立 state（零 react-query 铁律不引入 queryClient），onTurnCompleted 轮终态
  // 递增，驱动输入框上方 SessionUsageBar 重拉。
  const [usageRefresh, setUsageRefresh] = useState(0);
  // ── task-08（2026-09-07-session-pin-rename-scheduled-send / FR-04）：定时发送 ──
  // 同 page 模式四件套（弹窗开合 / 选定时间 / 提交在途 / 定时条刷新信号）+ 系统
  // 提示行；dialog 侧零 react-query 不变（ScheduledMessagesBar 自带局部 Provider，
  // 创建走命令式 API 调用）。仅 attach 到会话（view.sessionId 非空）时入口可见。
  const [schedOpen, setSchedOpen] = useState(false);
  const [schedAt, setSchedAt] = useState<Dayjs | null>(null);
  const [schedSubmitting, setSchedSubmitting] = useState(false);
  const [schedRefresh, setSchedRefresh] = useState(0);
  const [schedHints, setSchedHints] = useState<string[]>([]);
  // 会话切换（idle 首句创建成功 / attach 换目标）：关弹窗 + 清系统提示行。
  useEffect(() => {
    setSchedOpen(false);
    setSchedHints([]);
  }, [view.sessionId]);
  // 打开弹窗：默认选「1 小时后」（同 page 模式 / 原型默认选中项）。
  const openSchedModal = useCallback(() => {
    setSchedAt(dayjs().add(1, "hour"));
    setSchedOpen(true);
  }, []);
  /**
   * 确认创建（同 page 模式口径）：成功 → 关弹窗 + 清草稿（trim 比对）+ 聊天流
   * 系统提示行 + 递增刷新信号 + toast；失败保持弹窗开可重试。
   */
  const confirmSchedCreate = useCallback(async () => {
    const sid = view.sessionId;
    const prompt = input.trim();
    if (!sid || !schedAt || !prompt || schedSubmitting) return;
    setSchedSubmitting(true);
    try {
      await createScheduledMessage(sid, {
        prompt,
        dispatch_at: schedAt.toISOString(),
      });
      setSchedOpen(false);
      setInput((prev) => (prev.trim() === prompt ? "" : prev));
      setSchedHints((prev) => [
        ...prev,
        `已创建定时消息：${formatScheduledTime(schedAt.toISOString())} 发送「${summarizeScheduledPrompt(prompt)}」`,
      ]);
      setSchedRefresh((n) => n + 1);
      notify.success("已创建定时消息");
    } catch (err) {
      notify.error(err, "创建定时消息失败");
    } finally {
      setSchedSubmitting(false);
    }
  }, [view.sessionId, input, schedAt, schedSubmitting, notify]);

  // ── task-09 / design A6：连接横幅 + 运行轮看门狗（共用 hook；dialog 无
  // react-query——会话级对账不挂 invalidate，轮级终态经 resync 合成事件收敛）。──
  const connGuard = useStreamConnectionGuard({
    sessionId: view.sessionId,
    currentRunId: view.currentRunId,
    getConnection: () => streamConnRef.current,
  });

  // ── task-08（2026-09-04-session-task-execution-panel）：任务执行面板接线 ────
  // ref 桥接：establishStream（useCallback，定义早于渲染 JSX 挂 ref）内
  // onAgentTaskStatus 分发经 ref 注入实时事件（queueRefreshRef 先例语义，避开
  // use-before-define；不重建 SSE、不新建第二条任务数据链路）。
  const taskPanelRef = useRef<TaskExecutionPanelHandle | null>(null);
  // 任务清单快照重拉信号：SSE 重连恢复（connStatus → reconnected）后递增一次，
  // 对账断线期间落库的任务行（TaskExecutionPanel 内 useSessionTasks 自取数）。
  const [tasksRefresh, setTasksRefresh] = useState(0);
  useEffect(() => {
    if (connGuard.connStatus === "reconnected") {
      setTasksRefresh((n) => n + 1);
    }
  }, [connGuard.connStatus]);

  // ql-20260825-011：输入草稿持久化（同 page 模式；dialog 会话键 = view.sessionId，
  // idle 无会话用 __pre__ 固定键）。
  const draftHydratedRef = useRef(false);
  useEffect(() => {
    draftHydratedRef.current = false;
    setInput(readSessionDraft(view.sessionId ?? null));
    const raf = requestAnimationFrame(() => {
      draftHydratedRef.current = true;
    });
    return () => cancelAnimationFrame(raf);
  }, [view.sessionId]);
  useEffect(() => {
    if (!draftHydratedRef.current) return;
    writeSessionDraft(view.sessionId ?? null, input);
  }, [view.sessionId, input]);

  /**
   * ql-20260825-011：发送成功（直发建轮或入服务端队列）后收敛输入区——清草稿
   * 与附件 chips（失败路径原地保留可改后重发；不覆盖发送窗口期新输入的内容）。
   * ql-20260826-010：trim 比对（同 page 模式——prompt 是 input.trim()，尾随
   * 空白不比对会导致已发送消息残留输入框）。ql-20260901-002：/team 轮发原文
   * （同 page），t === prompt 直接对上；parseTeamCommand 比对保留兼容旧语义。
   */
  const onSendSettled = useCallback((prompt: string, attachmentIds: string[]) => {
    setInput((prev) => {
      const t = prev.trim();
      return t === prompt || parseTeamCommand(t) === prompt ? "" : prev;
    });
    setPendingAttachments((prev) =>
      attachmentIds.length === 0 ? prev : prev.filter((a) => !attachmentIds.includes(a.id)),
    );
    if (attachmentIds.length > 0) clearAttachmentsRef.current?.();
    for (const id of attachmentIds) attachmentMetaRef.current.delete(id);
    // task-05（FR-06）：发送成功清空 @ 联想选中（与 clearAttachments 同时机）。
    setPendingMentions({});
  }, []);

  // 消息队列（ql-20260825-011 服务端真实排队）：队列条目来自 GET /queue（刷新
  // 不丢）；忙轮发送由 sendToServerQueue 直达后端入队。idle / creating 首条消息
  // 绕过队列直发 createSession（handleSend idle 分支）。
  // 2026-08-31-session-queue-ux（task-09）：补三操作方法（FR-04 重排 / FR-05
  // 立即发送 / FR-06 编辑）供 MessageQueueBar 透传——API 失败静默由 hook 内
  // catch 承担，条目收敛统一以服务端 load 结果为准。
  const {
    queue,
    removeEntry,
    retryEntry,
    isQueueFull,
    refresh: refreshQueue,
    reorderEntry,
    editEntry,
    dispatchNowEntry,
  } = useMessageQueue({
    sessionId: view.sessionId ?? "",
    sessionActive: view.status === "active",
  });
  useEffect(() => {
    queueRefreshRef.current = refreshQueue;
  }, [refreshQueue]);

  // 当在线 provider 变化且当前选中的不再可用，回退到默认。
  useEffect(() => {
    if (providers.length > 0 && !providers.includes(provider)) {
      setProvider(providers[0] ?? defaultProvider);
    }
  }, [providers, provider, defaultProvider]);

  // SSE 连接由 sessionId 驱动：createSession 成功后建立唯一 SSE，贯穿整个会话。
  const establishStream = useCallback(async (sessionId: string): Promise<void> => {
    // 防御：已有连接不重建（inject 不重建 EventSource）。
    if (streamConnRef.current) return;
    // 并发防御（P0 竞态修复）：本守卫在下方 prefetch await 窗口失效——同
    // sessionId 的并发调用复用 in-flight promise（防双连接 + 双 prefetch）；已
    // 卸载（disposed，StrictMode 重挂载场景）或不同 sessionId 的 in-flight 不复用。
    const inFlight = establishingRef.current;
    if (inFlight && !disposedRef.current && inFlight.sessionId === sessionId) {
      return inFlight.promise;
    }
    // 新建流：重置卸载标志（remount 后可重建）+ 推进代际（旧 in-flight 自查退出）。
    disposedRef.current = false;
    const epoch = ++streamEpochRef.current;
    const promise: Promise<void> = (async () => {
      // prefetch 先回灌历史（防 SSE 订阅前 daemon publish 丢事件）。必须 await 先
      // 于 SSE 建连：否则 SSE 收到 turn_started 建空 turn 后 prev.turns 非空，
      // prefetch 条件（prev.turns 空）不满足 → 不回灌 → output 空白。
      // ql-20260827-018：回灌成功的最大 log ts 作 cursor 传给 streamSession——
      // 建连前缺口同步只增量拉取该点之后的日志，补「快照 → 订阅」窗口；预取
      // 失败时退 initialSync 全量对账兜底。
      let streamCursor: string | undefined;
      let initialSync = false;
      try {
        // ql-20260903-025：对齐 page 模式分页口径——原全量拉日志（长会话从
        // runtimes 弹窗/分身浮层打开秒级等待 + 内存尖峰），改最新 HISTORY_PAGE_SIZE
        // 条起步；弹窗无触顶加载入口（快速查看场景），更早历史去会话页看。
        const logs = await getAgentSessionLogs(sessionId, { limit: HISTORY_PAGE_SIZE });
        streamCursor = maxLogTimestamp(logs);
        if (logs.length > 0) {
          const turns = logsToTurns(logs);
          if (turns.length > 0) {
            setView((prev) =>
              prev.turns.length > 0 ? prev : { ...prev, sessionId, turns },
            );
          }
        }
      } catch {
        /* prefetch 失败不阻断 SSE；initialSync 全量对账兜底 */
        initialSync = true;
      }
        // await 窗口竞态自查：已卸载（cleanup 先跑过，streamConnRef 当时还是
        // null 未 close 到）/ 已有连接（并发先建）/ 代际已推进（attach 切换或
        // 重挂载发起更新建流）→ 放弃建流，不产生无人 close 的僵尸连接。
        if (disposedRef.current || streamConnRef.current) return;
        if (streamEpochRef.current !== epoch) return;
        // task-09：handlers 经 connGuard.tapStreamHandlers 包装——注入
        // onStatusChange（连接横幅）+ 看门狗活动时间推进，原事件语义逐字保留。
        streamConnRef.current = streamSession(
          sessionId,
          connGuard.tapStreamHandlers({
            onTurnStarted: (env) => {
              // ql-20260825-011：新轮开跑（含排队消息自动派发）→ 刷队列条。
              queueRefreshRef.current?.();
              setView((prev) => upsertDialogTurn(prev, env, (turn) => ({
                ...turn,
                turn: env.turn ?? turn.turn,
                // pending → running（首 turn 从 createSession 占位转正）；
                // 已终态保持终态，不被 SSE 重连重发覆盖。
                status: turn.status === "pending" ? "running" : turn.status,
              }), { setCurrentRun: env.run_id! }));
            },
            // 2026-08-31-session-queue-ux（FR-03）：后端任一队列动作（入队/派发/
            // 删除/失败/reordered/edited/dispatch_now）均发 queue_changed——事件
            // 驱动立即刷新队列条，不等 5s 轮询兜底。走 queueRefreshRef（同上方
            // onTurnStarted 先例）避开 use-before-define；SSE 与轮询双源并发由
            // hook 既有 epoch 丢弃兜底（RISK-5）。
            onQueueChanged: () => {
              queueRefreshRef.current?.();
            },
            onLog: (env) => {
              // channel=user_input 是用户消息（attach 时 initialTurns 已作 prompt），
              // 不追加到 agent output，避免 prompt 气泡与 output 气泡重复。
              if (env.channel === "user_input") return;
              setView((prev) => {
                // quick-9f86d2c3（会话 e87622aa）：非当前活跃 run 的 log = 终态轮迟到
                // 事件（轮后对账 1.5s 重放 / 断线 resync 增量）。此类 log 落在已终态
                // 轮时补跑 finishTurn——迟到的 partial 不再以 streaming 段常亮光标，
                // 残留前缀重复段就地收敛（「直播终态 == 刷新视图」不变式扩展到轮后）。
                // 当前活跃 run 不跑：healToRunning（ql-20260820-007 attach 竞态自愈）
                // 场景下流式光标仍需正常工作，下一 partial 会重新置位 streaming。
                const lateOnIdleRun = prev.currentRunId !== env.run_id;
                return upsertDialogTurn(prev, env, (turn) => {
                  const assembled = assembledViewOf(turn);
                  const next = applyLogToSegments(assembled, toAssemblerLogInput(env));
                  if (next === assembled) return turn;
                  const merged = { ...turn, ...next };
                  if (lateOnIdleRun && TERMINAL_TURN_STATUSES.has(turn.status)) {
                    return { ...merged, ...finishTurn(assembledViewOf(merged)) };
                  }
                  return merged;
                }, {});
              });
            },
            onTurnCompleted: (env) => {
              const terminal = deriveTurnTerminalStatus(env);
              // ql-20260825-011：轮终态 → 后台会自动派发下一条排队消息，刷队列条。
              queueRefreshRef.current?.();
              // 2026-08-29-session-usage-stats task-04（R-04）：轮终态递增用量条
              // 重取信号（dialog 独立 state，会话累计用量随轮终态落库）。
              setUsageRefresh((n) => n + 1);
              setView((prev) => upsertDialogTurn(prev, env, (turn) => {
                // 终态清全部 text/thinking 段的 streaming 标记（finishTurn）——流式
                // 光标与轮级状态条随之收起。segments 缺省的旧形状 turn 无 streaming
                // 标记，不经装配器（保持旧渲染路径，R1 吸收 ISP 防御）。
                const finished =
                  turn.segments !== undefined ? finishTurn(assembledViewOf(turn)) : null;
                return {
                  ...turn,
                  ...(finished ?? {}),
                  // turn_completed 收敛到 deriveTurnTerminalStatus 推导的真实终态
                  // （completed/failed/killed），无论 prior 是 running 还是 interrupting。
                  status: terminal,
                  // 终态 token 同步写入（null 不覆盖执行中已收到的累积值）。
                  inputTokens: env.input_tokens ?? turn.inputTokens,
                  outputTokens: env.output_tokens ?? turn.outputTokens,
                  // task-08（FR-01）：ctx_tokens 同步写入；null 不覆盖已收值
                  // （close 终态不携带 ctx，保留实时最后写入值）。
                  ctxTokens: env.ctx_tokens ?? turn.ctxTokens,
                };
              }, { clearCurrentRun: env.run_id! }));

              // turn 终态=failed 时拉取该 run 的结构化错误详情（AgentRun.error_detail，
              // GET /sessions/{id}/runs），buildErrorLogItem 安全映射写入对应 turn 供
              // RunErrorItem 渲染。同 run_id 只拉一次（fetchedErrorRunIdsRef 去重）；
              // 拉取失败 / error_detail 缺失 → 静默不崩，失败 turn 仍有状态徽标。
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
                    // ql-20260831-004：同上——系统级失败兜 failure_summary 映射。
                    const item =
                      buildErrorLogItem(matched?.error_detail ?? null) ??
                      buildSystemFailureItem(
                        matched?.error_code ?? null,
                        matched?.failure_summary ?? null,
                      );
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
                    // 拉取失败不崩：失败 turn 仍有状态徽标 + 通用 errorMsg
                  }
                })();
              }
              // R7：dialog 模式不刷新 runsMeta（whoLine / 孤儿 turn 派生链不启用，
              // turns 原样喂 TurnTimeline——ISP 现状）。
            },
            onTokens: (env) => {
              // 执行中实时累积 token：按 run_id upsert 到对应 turn，UI 立刻刷新计数。
              setView((prev) => upsertDialogTurn(prev, env, (turn) => ({
                ...turn,
                inputTokens: env.input_tokens ?? turn.inputTokens,
                outputTokens: env.output_tokens ?? turn.outputTokens,
                // task-08（FR-01）：ctx 实时写入（last-write-wins 瞬时量；
                // null/缺省不覆盖已收值）。
                ctxTokens: env.ctx_tokens ?? turn.ctxTokens,
              }), {}));
            },
            onSessionEnded: () => {
              // 收口 ended + 清终止中态（streamSession 内部已 close）；清待答卡片。
              // R9：dialog 侧无 react-query invalidate / onSessionListRefresh——
              // 状态同步由 view 自身承载，父级经 onSessionReset 链路自理。
              setView((prev) => ({
                ...prev,
                status: "ended",
                currentRunId: null,
                terminatingAt: null,
              }));
              setPendingRequests([]);
              setPlanPending(null);
              setBashProgress(null);
              setAgentTasks([]);
              streamConnRef.current = null;
            },
            onError: () => {
              // 不伪造 session/run 终态；fetch-sse 迁移后无浏览器自动重连，断线
              // 由 streamSession 内建指数退避 + resync 增量回放重建连接。
            },
            // permission 事件：收卡只按 dialog_kind 存在性（不区分具体 kind 值，天然
            // 支持 Claude ask_user / Codex codex_request_user_input / mcp_elicitation，
            // 三者 payload 经 daemon 归一化后同构）。按 request_id 去重；普通工具审批
            // （无 dialog_kind）交给 /runtimes 审批面板。
            onPermissionRequest: (req) => {
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
            // task-09：plan 模式进入 → 展示 PlanApprovalCard（按 runId 去重）。
            onPlanModeEntered: (event) => {
              setPlanPending((prev) => {
                if (prev && prev.runId === event.run_id) return prev;
                return {
                  runId: event.run_id,
                  summary: event.summary,
                  requestedAt: event.requested_at,
                };
              });
            },
        // task-09：bash 命令状态/输出 → BashProgressCard（归约统一走底部 helper：
        // 新命令重置 chunks，防同 run 上一条命令的输出/is_final 污染）。
        onBashStatus: (event) => {
          setBashProgress((prev) => applyBashStatusEvent(prev, event));
        },
        onBashChunk: (event) => {
          setBashProgress((prev) =>
            !prev || prev.runId !== event.run_id
              ? prev
              : appendBashChunk(prev, {
                  channel: event.channel,
                  content: event.content,
                  is_final: event.is_final,
                }),
          );
        },
            // verify P1 返工（FR-03）：后台 Agent 任务状态 → AgentTaskCard（按 task_id upsert）。
            // task-12（FR-06）：归约统一走底部 applyAgentTaskStatusEvent（扩展
            // 字段合并 + 终态定格 + 最近 6 条截断，page / dialog 两模式共用）。
            onAgentTaskStatus: (event) => {
              setAgentTasks((prev) => applyAgentTaskStatusEvent(prev, event));
              // task-08（2026-09-04-session-task-execution-panel / FR-02）：既有
              // AgentTaskCard 链路行为不变；追加经 ref 注入任务执行面板（组件内
              // useSessionTasks 按 session_id 守卫 + task_id upsert 归并任务清单）。
              taskPanelRef.current?.applyEvent(event);
            },
          }),
          { cursor: streamCursor, initialSync },
        );
    })();
    // in-flight 登记清理：promise settle 后仅当仍是本次 promise（未被后续建流
    // 覆盖）时清空。挂在 promise 链上而非函数体内 finally——避免闭包引用自身
    //（TS2454）；catch 吞错防未处理 rejection（effect 调用点不 await）。
    promise
      .finally(() => {
        if (establishingRef.current?.promise === promise) {
          establishingRef.current = null;
        }
      })
      .catch(() => {});
    establishingRef.current = { sessionId, promise };
    return promise;

    // fetchPendingDialogs 从 establishStream 解耦为独立 effect（见下方
    // [view.sessionId] effect），避免恢复链路与建流链路绑定。
    // task-09：tapStreamHandlers 为 useCallback([]) 稳定引用（ deps 变化不触发
    // effect 重跑 / SSE 重建），此处入 deps 仅为 exhaustive-deps 完整性。
  }, [connGuard.tapStreamHandlers]);

  // attach 模式：mount / attachSessionId 变化时建 SSE + 预填 turn + 进
  // reconnecting。轮询单独 effect 处理（见下）。
  useEffect(() => {
    if (!attachSessionId) return;
    // 离线只读（D10）：不建 SSE，直接以 initialTurns 只读渲染（active 态保持），
    // 重连后 effect 重跑建 SSE（deps 含 offlineReadOnly）。
    if (offlineReadOnly) {
      if (streamConnRef.current) {
        streamConnRef.current.close();
        streamConnRef.current = null;
      }
      setView({
        sessionId: attachSessionId,
        status: "active",
        suspended: false,
        currentRunId: null,
        turns: initialTurns ?? [],
        errorMsg: null,
        terminatingAt: null,
      });
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
      suspended: false,
      currentRunId: null,
      turns: initialTurns ?? [],
      errorMsg: null,
      terminatingAt: null,
    });
    // initialTurns 仅在 mount 时读取，避免 props 变更抖动（exhaustive-deps 忽略）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachSessionId, establishStream, offlineReadOnly]);

  // attach 轮询（D3）：每 ATTACH_POLL_MS 调 getAgentSession，active → 转 active +
  // 清轮询 + 恢复 currentRunId / terminatingAt；failed / ended / 累计超时 → 只读
  // 终态。pending / reconnecting 期间 terminating_at 已带则先更新（尽早显示横幅）。
  // ql-20260829-004：suspended 期间实际拉取节流到 SUSPENDED_SESSION_REFETCH_MS
  // （15s，对齐 page 模式 refetchInterval 低频档）——挂起窗口以小时计，1.5s
  // 高频轮询是请求风暴；离开挂起（daemon 回归转其它状态）即恢复 1.5s 档。
  useEffect(() => {
    if (!attachSessionId) return;
    let attempts = 0;
    let cancelled = false;
    // 挂起节流镜像（组件 state 的 suspended 只驱动 UI，tick 闭包内自持布尔 +
    // 上次实际拉取时间戳做节流；挂起的识别与回归检测最多各延迟一个 15s 窗）。
    let suspendedNow = false;
    let lastPollAt = 0;
    const stop = () => {
      if (attachPollRef.current) {
        clearInterval(attachPollRef.current);
        attachPollRef.current = null;
      }
    };
    const tick = async () => {
      if (cancelled) return;
      // ql-20260904-009：后台标签页跳过 tick（回前台下一拍恢复；超时计数
      // 同时暂停——不在用户看不见时把恢复窗口耗尽判失败）。
      if (typeof document !== "undefined" && document.hidden) return;
      const now = Date.now();
      if (suspendedNow && now - lastPollAt < SUSPENDED_SESSION_REFETCH_MS) return;
      lastPollAt = now;
      attempts += 1;
      try {
        const detail = await getAgentSession(attachSessionId);
        if (cancelled) return;
        // detail.terminating_at 由后端经 lease 关联注入；daemon.ts 的手写
        // AgentSessionRead 类型未声明此字段，运行时已带——cast 安全读取。
        const detailTermAt =
          (detail as { terminating_at?: string | null }).terminating_at ?? null;
        if (detail.status === "active") {
          stop();
          // 恢复 currentRunId（attach 运行中会话时启用打断按钮）；无运行 run
          // 则保持 null。
          setView((prev) => ({
            ...prev,
            status: "active",
            suspended: false,
            errorMsg: null,
            currentRunId: detail.current_run_id ?? prev.currentRunId,
            terminatingAt: detailTermAt,
          }));
        } else if (detail.status === "failed") {
          stop();
          setView((prev) => ({
            ...prev,
            status: "failed",
            suspended: false,
            errorMsg: "会话恢复失败，可能上下文已失效",
            terminatingAt: null,
          }));
        } else if (detail.status === "ended") {
          // ended 会话 attach（无法 reopen 的老会话）→ 转只读 ended 态，显示
          // initialTurns 历史，不卡轮询。
          stop();
          setView((prev) => ({
            ...prev,
            status: "ended",
            suspended: false,
            errorMsg: null,
            terminatingAt: null,
          }));
        } else if ((detail.status as string) === "suspended") {
          // task-10（design A5/A6）：挂起不算恢复失败——daemon 不在线是挂起的
          // 因，15s attach 轮询上限对以小时计的挂起窗口无意义；置挂起标志
          //（info 横幅 + 输入禁用）并重置计数继续轮询（ql-20260829-004：轮询
          // 节流到 15s 档，见 effect 头注释），daemon 重启转 reconnecting/active
          // 后由上方分支收敛（D-001 自动恢复）。
          attempts = 0;
          suspendedNow = true;
          setView((prev) =>
            prev.suspended && prev.errorMsg === null
              ? prev
              : { ...prev, suspended: true, errorMsg: null },
          );
        } else {
          // pending/reconnecting：terminating_at 可能已带，先更新以便尽早显示
          //「终止中…」横幅；task-10：离开挂起（daemon 已回归）清挂起标志 +
          // 恢复 1.5s 轮询档（ql-20260829-004）。
          suspendedNow = false;
          setView((prev) =>
            !prev.suspended && prev.terminatingAt === detailTermAt
              ? prev
              : { ...prev, suspended: false, terminatingAt: detailTermAt },
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
          prev.status === "active" || prev.suspended
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

  // pending AskUser 对话恢复：只要有有效 sessionId（来自 createSession / attach）
  // 就触发一次 REST 拉取（SSE 只推实时新 permission_request，刷新 / attach 已
  // pending 的对话需 REST 恢复，与 SSE 合并按 request_id 去重）。
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

  // AskUserQuestion 完整问答历史（pending+answered）：sessionId 变化时拉一次
  //（SSE 只推实时新事件，刷新/重连不重放）。
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

  // unmount / session 切换：显式 close 旧 SSE + 清轮询 interval（R6：清理逻辑随
  // 组件生命周期，key 重挂载即全量重置）。
  useEffect(() => {
    return () => {
      // P0 竞态修复：先置 disposed 再 close——establishStream 的 prefetch await
      // 窗口内卸载时（此刻 streamConnRef 还是 null，close 落空），await 返回后
      // 据此自查退出，不再新建无人 close 的僵尸连接。
      disposedRef.current = true;
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

  /**
   * 直接投递（injectSession）——ISP submitFollowup 队列化改造版：
   *   - 占位 turn → inject 响应替换真实 run_id（进入即同步置占位 currentRunId，
   *     防 hook 投递窗口期连发，同 page sendFromQueue 时序注释）；
   *   - 409 TURN_CONFLICT 不再回填输入框（D-003 有意变更，替代旧
   *     setInput(prompt) 语义）——失败统一向上抛，由调用方决定呈现：
   *     队列路径 sendFromQueue 透传 → hook 标记 failed 留队头 + 重试/删除；
   *     重发路径 handleResend 捕获吞错（errorMsg 已写入 view）。
   *   - ql-20260825-007：attachmentIds 附件引用随 inject 上送（后端 task-05 契约，
   *     D-7 豁免空 prompt）；占位轮 prompt 拼附件标记行（镜像 page sendFromQueue）。
   */
  const submitFollowup = useCallback(
    async (prompt: string, attachmentIds: string[] = []): Promise<void> => {
      const sid = view.sessionId;
      if (!sid) return;
      const placeholderId = `__pending_inject_${Date.now()}__`;
      // ql-20260825-011：发送中打断回退标记（同 page 模式 inflightSendRef）。
      inflightSendRef.current = { placeholderId, prompt };
      // 占位轮展示文本 = 标记行 + 原文（kind/name 查 attachmentMetaRef，D-004
      // 入队时已登记；无附件经 joinAttachmentMarkers 原样返回正文，不拼前导换行）。
      const markerLines = attachmentIds
        .map((id) => {
          const meta = attachmentMetaRef.current.get(id);
          return `[附件:${id}|${meta?.kind ?? "file"}|${meta?.name ?? id}]`;
        })
        .join("\n");
      const displayPrompt = joinAttachmentMarkers(markerLines, prompt);
      setView((prev) => ({
        ...prev,
        currentRunId: placeholderId,
        turns: [
          ...prev.turns,
          {
            runId: placeholderId,
            turn: null,
            prompt: displayPrompt,
            output: "",
            status: "pending",
            seenLogIds: new Set(),
            inputTokens: null,
            outputTokens: null,
            ctxTokens: null,
            errorDetail: null,
            processItems: [],
            // 装配化初始形状 + live 计时锚点（本地发送占位时刻），带 segments
            // 即走 TurnTimeline v2 段模型渲染 + 内置轮级状态条。
            segments: [],
            turnStartedAt: Date.now(),
          },
        ],
      }));
      try {
        // 无附件且无绑定字段保持两参调用（与既有形态逐字节一致，缺省零回归）；
        // 任一有值才带第三参 options（task-05：@ 联想绑定字段，FR-06/D-003；
        // dialog 重发复用本函数，随该点位一并生效——当前选中通常已清空）。
        const bindOpts = mentionBindOptions(pendingMentions);
        const resp =
          attachmentIds.length > 0 || Object.keys(bindOpts).length > 0
            ? await injectSession(sid, prompt, {
                ...(attachmentIds.length > 0 ? { attachment_ids: attachmentIds } : {}),
                ...bindOpts,
              })
            : await injectSession(sid, prompt);
        if (inflightSendRef.current?.placeholderId !== placeholderId) {
          // ql-20260825-011：发送窗口期被「打断本轮」回退（占位轮已移除、消息
          // 已回输入框）→ run 已创建则立即补发 interrupt 真停（409 忽略）。
          if (resp.run_id) {
            try {
              await interruptSession(sid);
            } catch {
              /* NO_CURRENT_RUN：run 已完结 */
            }
          }
          return;
        }
        if (resp.queued) {
          // ql-20260825-011：竞态入队（上一轮尚未终结）→ 撤占位轮转服务端排队。
          setView((prev) => ({
            ...prev,
            currentRunId: null,
            turns: prev.turns.filter((t) => t.runId !== placeholderId),
            errorMsg: null,
          }));
          queueRefreshRef.current?.();
          onSendSettled(prompt, attachmentIds);
          return;
        }
        setView((prev) => ({
          ...prev,
          currentRunId: resp.run_id,
          turns: prev.turns.map((t) =>
            t.runId === placeholderId
              ? { ...t, runId: resp.run_id!, status: "running" }
              : t,
          ),
          errorMsg: null,
        }));
        onSendSettled(prompt, attachmentIds);
        // 不重建 SSE（贯穿多 turn）
      } catch (err) {
        const apiErr = err as ApiError;
        if (inflightSendRef.current?.placeholderId !== placeholderId) return;
        // 移除未被接受的占位 turn；currentRunId 清空（inject 失败，无运行中 turn）。
        setView((prev) => ({
          ...prev,
          currentRunId: null,
          turns: prev.turns.filter((t) => t.runId !== placeholderId),
          errorMsg: errMessage(apiErr, "追问失败"),
        }));
        throw err; // D-003：向上抛 → 调用方按路径处理（见函数头注释）
      } finally {
        if (inflightSendRef.current?.placeholderId === placeholderId) {
          inflightSendRef.current = null;
        }
      }
    },
    [view.sessionId, pendingMentions, onSendSettled],
  );

  /**
   * 忙轮路径（ql-20260825-011）：直接 POST inject——后端忙轮自动入服务端排队
   * （无占位轮；run 终态后自动派发，SSE turn_started 自然建轮）。失败（满员
   * 409 / 离线）errorMsg 提示，草稿与附件保留可改后重发。
   */
  const sendToServerQueue = useCallback(
    async (prompt: string, attachmentIds: string[]): Promise<void> => {
      const sid = view.sessionId;
      if (!sid) return;
      try {
        // task-05（FR-06 / D-003）：忙轮排队路径带 @ 联想绑定字段（有值才带）；
        // 无附件且无绑定时保持第三参 undefined（与既有形态逐字节一致，缺省零
        // 回归——后端 binder 插入点在排队早退分支之前，design §4.2）。
        const bindOpts = mentionBindOptions(pendingMentions);
        await injectSession(
          sid,
          prompt,
          attachmentIds.length > 0 || Object.keys(bindOpts).length > 0
            ? {
                ...(attachmentIds.length > 0 ? { attachment_ids: attachmentIds } : {}),
                ...bindOpts,
              }
            : undefined,
        );
        setView((prev) => ({ ...prev, errorMsg: null }));
        queueRefreshRef.current?.();
        onSendSettled(prompt, attachmentIds);
      } catch (err) {
        const apiErr = err as ApiError;
        setView((prev) => ({
          ...prev,
          errorMsg: errMessage(apiErr, "发送失败"),
        }));
      }
    },
    [view.sessionId, pendingMentions, onSendSettled],
  );

  // ── task-11：会话内团队触发（弹层开关 + 预建回调，语义同 page 模式）──────
  // ql-20260828-012-4425：initial 携带编辑回显配置（chip 点击派生自活跃
  // mission / 预会话暂存 payload）；缺省 null 走弹层默认值。
  const openTeamPopover = useCallback(
    (
      objective: string | null,
      initial?: TeamTriggerInitialConfig | null,
    ) => {
      setTeamError(null);
      setTeamPopover({ open: true, objective, initial: initial ?? null });
    },
    [],
  );
  const closeTeamPopover = useCallback(() => {
    setTeamError(null);
    setTeamPopover({ open: false, objective: null, initial: null });
  }, []);

  /**
   * 弹层确认 → triggerSessionTeamMission 预建；成功刷新 mission 列表 +
   * onTeamMissionCreated 上报（透传位保留，父级可挂 TeamProgress）+ objective
   * 回填输入框；失败弹层保持打开，行内中文文案（409/403/422）。
   * ql-20260826-010：回填前置 /team 指令（同 page 模式——裸 objective 常被
   * agent 当普通聊天不派发；刷新 mission 在回填前 await，回填时 activeTeamMission
   * 已就位，紧接发送不被 /team 拦截重开弹层）。
   */
  const handleTeamTrigger = useCallback(
    async (payload: TeamMissionTriggerRequest) => {
      const sid = view.sessionId;
      if (!sid) return;
      setTeamTriggering(true);
      setTeamError(null);
      try {
        // ql-20260828-009-4a13：更新指派语义——已有活跃 mission 先取消再派
        //（同 page 模式；直发场景旧 mission 终态自然跳过）。
        const activeId = teamMissions.find((m) =>
          isActiveTeamMission(m.status),
        )?.mission_id;
        if (activeId) await cancelTeamMission(activeId);
        const summary = await triggerSessionTeamMission(sid, payload);
        closeTeamPopover();
        onTeamMissionCreated?.(summary.mission_id);
        await refreshTeamMissions();
        setInput(
          payload.objective ? `/team ${payload.objective.trim()}` : "/team",
        );
      } catch (err) {
        setTeamError(teamTriggerErrorText(err));
        void refreshTeamMissions();
      } finally {
        setTeamTriggering(false);
      }
    },
    [view.sessionId, teamMissions, refreshTeamMissions, closeTeamPopover, onTeamMissionCreated],
  );

  /**
   * ql-20260828-009-4a13：chip × 真取消（dialog 模式，同 page 模式语义）。
   */
  const handleCancelTeamMission = useCallback(async () => {
    const activeId = teamMissions.find((m) =>
      isActiveTeamMission(m.status),
    )?.mission_id;
    if (!activeId || teamCancelling) return;
    setTeamCancelling(true);
    setTeamError(null);
    try {
      await cancelTeamMission(activeId);
      await refreshTeamMissions();
    } catch {
      setTeamError("取消团队任务失败，请稍后重试");
    } finally {
      setTeamCancelling(false);
    }
  }, [teamMissions, teamCancelling, refreshTeamMissions]);

  /**
   * 发送主入口（队列化，design §3.3）：
   *   - idle 首条 → createSession 直发（R2：creating 态无既有 session 可附着，
   *     且 createSession 成功切 sessionId 会触发 hook 清队，排队必丢）；
   *   - active / reconnecting → 统一 enqueue（D-001）：active 且无 currentRun 时
   *     hook 立即投递（等效原 submitFollowup 直发）；running / reconnecting 排队，
   *     turn_completed / attach 轮询转 active 后自动投递；
   *   - 直发拦截：终态（ended/failed，须新建）、离线（!hasOnlineProvider /
   *     offlineReadOnly）、creating/ending 过渡态（ISP 原守卫——create/end 在途，
   *     挂起一条到过渡态的语义不明）、队满（D-002）。
   */
  const handleSend = useCallback(async () => {
    const prompt = input.trim();
    // ql-20260825-007：D-7 对齐 page——附件非空豁免空文本（看图说话）；纯文本
    // 仍要求非空。idle 首句走 createSession（无附件可带），但该态附件入口已被
    // 门控（attachmentsDisabled），pendingAttachments 恒空。
    if (
      !prompt &&
      pendingAttachments.length === 0
    ) {
      return;
    }
    if (prompt.length > MAX_PROMPT_LEN) {
      notify.warning(
        `单条消息最长 ${MAX_PROMPT_LEN} 字（当前 ${prompt.length} 字），请精简后再发送`,
      );
      return;
    }
    if (!hasOnlineProvider) return;
    if (offlineReadOnly) return;
    if (view.status === "ended" || view.status === "failed") return;
    if (view.status === "creating" || view.status === "ending") return;
    // task-10（design A5）：挂起禁发——daemon 不在线，发也必失败；输入框本已
    // 禁用，此处为发送路径防御性兜底（恢复由 daemon 重启自动完成，D-001）。
    if (view.suspended) return;
    if (isQueueFull) {
      // D-002 满员拒收（同 page 模式 toast 明示，ql-20260903-014）
      notify.warning(
        `排队消息已达上限（${QUEUE_MAX_PENDING} 条），请等待派发或先删除排队消息`,
      );
      return;
    }

    // task-11（D-004 四路等价）：/team 前缀拦截——不发送，弹层确认后目标随下条
    // 消息发出（objective 预填去前缀文本）。仅 Claude 引擎且已有 active 会话时
    // 拦截（idle 无会话可挂 mission / 非 active 原路发送）。
    // ql-20260826-010：已有活跃 mission（弹层确认预建）时放行直发——确认后
    // 回填的 /team 指令若再被拦截会陷入「弹层⇄回填」死循环（同 page 模式）。
    // provider-abstraction task-11：引擎门控收敛查 ProviderCaps（subagent 键，
    // 与原 === "claude" 等价）。
    const teamCmd = parseTeamCommand(prompt);
    const hasActiveMission = teamMissions.some((m) => isActiveTeamMission(m.status));
    if (
      teamCmd !== null &&
      !hasActiveMission &&
      getProviderCaps(provider).subagent &&
      view.sessionId &&
      view.status === "active"
    ) {
      openTeamPopover(teamCmd || null);
      setInput("");
      // task-05：拦截清空输入的同点位清空 @ 联想选中（拦截不发送，残留选中
      // 会错绑到下一条消息；/team 拦截语义本身零改动）。
      setPendingMentions({});
      return;
    }

    // ql-20260901-002：/team 前缀不再剥离——发原始输入（气泡/回放显示 "/team
    // 目标"，对齐技能指令显示形态）；剥离收口到后端派发层（同 page 模式）。
    // 裸 /team 无可发内容 → 不发（带附件可发，D-7 豁免）。
    if ((!prompt || teamCmd === "") && pendingAttachments.length === 0) return;

    // 首 turn：createSession（绕过队列直发，R2）
    if (view.status === "idle") {
      // task-05（FR-05）：@ 联想选中捕获后再清（dialog idle 先清输入的既有
      // 语义下，创建失败也不留僵尸绑定）；change_id 合并语义 = @ 选中优先
      //（用户显式最新选择），changeId prop（change-session-section 入口上下文）
      // 兜底——单值字段不并送，缺省回落既有语义零回归（不互相覆盖：无 @ 选中
      // 时 prop 照常生效，有 @ 选中时以用户选择为准）。
      const mentions = pendingMentions;
      const createChangeId = mentions.change?.id ?? changeId;
      setInput("");
      setPendingMentions({});
      setView({
        ...INITIAL_DIALOG_VIEW,
        status: "creating",
        turns: [
          {
            runId: "__pending_create__",
            turn: null,
            prompt: prompt,
            output: "",
            status: "pending",
            seenLogIds: new Set(),
            inputTokens: null,
            outputTokens: null,
            ctxTokens: null,
            errorDetail: null,
            processItems: [],
            // 装配化初始形状 + live 计时锚点（同 submitFollowup）。
            segments: [],
            turnStartedAt: Date.now(),
          },
        ],
      });
      try {
        const resp = await createSession({
          provider: provider as InteractiveProvider,
          prompt: prompt,
          manual_approval: true,
          ask_user_only: true,
          ...(createChangeId ? { change_id: createChangeId } : {}),
          ...(workspaceId ? { workspace_id: workspaceId } : {}),
          // task-05（FR-05）：@ 快速修复选中随首句上送 quicklog_id（对齐 page
          // 预会话 create 展开形态，缺省不进请求体零回归）。
          ...(mentions.quick ? { quicklog_id: mentions.quick.ql_id } : {}),
          // task-06（FR-02）：@ PPM 任务/问题选中随首句成对上送（对齐 page 预会话
          // create 展开形态，缺省不进请求体零回归；后端创建即绑定 + 注入前导）。
          ...(mentions.ppmItem
            ? {
                ppm_item_kind: mentions.ppmItem.kind,
                ppm_item_id: mentions.ppmItem.id,
              }
            : {}),
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
        // 清旧 attach stream 残留（panel 未 remount 时 streamConnRef 可能仍指向
        // 旧 session 的 SSE，establishStream 防御会跳过建新流）+ 建新 session 的 SSE。
        if (streamConnRef.current) {
          streamConnRef.current.close();
          streamConnRef.current = null;
        }
        establishStream(resp.session_id);
        // 上报 session_id 给父级写 URL ?session= / 刷新列表
        onSessionCreated?.(resp.session_id);
      } catch (err) {
        const msg = errMessage(err, "创建会话失败");
        setView({
          ...INITIAL_DIALOG_VIEW,
          status: "idle",
          errorMsg: msg,
        });
      }
      return;
    }

    // 后续 turn（active / reconnecting）：ql-20260825-011 改服务端排队——忙轮
    // （有 currentRun）直接 POST inject 入队；空闲走 submitFollowup 占位轮直发。
    // 草稿与附件改为发送成功后清（onSendSettled），失败原地保留可改后重发。
    const attachmentIds = pendingAttachments.map((a) => a.id);
    for (const a of pendingAttachments) {
      attachmentMetaRef.current.set(a.id, { kind: a.kind, name: a.name });
    }
    if (view.currentRunId != null) {
      await sendToServerQueue(prompt, attachmentIds);
      return;
    }
    try {
      await submitFollowup(prompt, attachmentIds);
    } catch {
      /* errorMsg 已写入 view（占位轮回滚），此路径不向上抛 */
    }
  }, [input, hasOnlineProvider, offlineReadOnly, view.status, view.suspended, view.sessionId, view.currentRunId, isQueueFull, notify, provider, changeId, workspaceId, pendingMentions, establishStream, onSessionCreated, sendToServerQueue, submitFollowup, openTeamPopover, pendingAttachments, teamMissions]);

  // 失败轮次「重新发送」——复用 submitFollowup 重新提交该 turn 的 prompt。受
  // turn 级串行 / active / 在线守卫；ql-20260904-010 起 RunErrorItem 对所有失败
  // 卡渲染重发按钮（不再按 retryable 门控），重试约束由上述提交守卫承担。
  // 不走队列（用户已显式点击，等价 retry 语义）。
  const handleResend = useCallback(async (prompt: string) => {
    if (!view.sessionId) return;
    if (!hasOnlineProvider) return;
    if (view.status !== "active") return;
    if (view.currentRunId) return; // turn 级串行：等待当前 turn 完成
    const trimmed = prompt.trim();
    if (!trimmed || trimmed.length > MAX_PROMPT_LEN) return;
    try {
      await submitFollowup(trimmed);
    } catch {
      /* errorMsg 已写入 view（占位轮回滚），重发路径不向上抛 */
    }
  }, [view.sessionId, view.status, view.currentRunId, hasOnlineProvider, submitFollowup]);

  // ql-20260903-026：行级 memo props 稳定化（同 page 模式）。
  const timelineOnResend = useCallback(
    (prompt: string) => {
      void handleResend(prompt);
    },
    [handleResend],
  );

  // 「切换供应商」— 跳设置页（ql-20260904-010：page 模式已改为定位会话底部
  // 配置条，见 timelineOnSwitchProvider；dialog 浮窗内无供应商配置条，跳设置页
  // 仍是唯一去处）。用 window.location.assign 做整页跳转（非 next/navigation
  // useRouter）：后者需在每个渲染本组件的测试文件单独 vi.mock，整页跳转零 mock
  // 依赖、零回归。
  const handleSwitchProvider = useCallback(() => {
    if (typeof window !== "undefined") {
      window.location.assign("/settings");
    }
  }, []);

  // interrupt：只收敛 currentRun（session 保持 active）。
  const handleInterrupt = useCallback(async () => {
    if (!view.sessionId || !view.currentRunId || view.status !== "active") return;
    const localRunId = view.currentRunId;
    // ql-20260825-011：发送中（inject 在途，占位 id）打断——消息回退输入框；
    // 请求不 abort（后端可能已建 run），响应到达后由 submitFollowup 对真实
    // run 补发 interruptSession 真停（见其 inflight 不匹配分支）。
    if (localRunId.startsWith("__pending_inject_")) {
      const inflight = inflightSendRef.current;
      if (inflight && inflight.placeholderId === localRunId) {
        inflightSendRef.current = null; // 标记已打断（响应侧据此走补发打断分支）
        setView((prev) => ({
          ...prev,
          currentRunId: null,
          turns: prev.turns.filter((t) => t.runId !== localRunId),
        }));
        // 回退消息：不覆盖用户在发送窗口期新输入的内容。
        setInput((prev) => (prev === "" ? inflight.prompt : prev));
      }
      return;
    }
    setView((prev) => ({
      ...prev,
      turns: prev.turns.map((t) =>
        t.runId === localRunId ? { ...t, status: "interrupting" } : t,
      ),
    }));
    try {
      const resp = await interruptSession(view.sessionId);
      // REST 返回 current_run_id 不一致 → 提示，等待 SSE 同步（R10：两模式通用）
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
          errorMsg: errMessage(apiErr, "打断失败"),
        }));
      }
    }
  }, [view.sessionId, view.currentRunId, view.status]);

  // end：结束整个 session（D6）。
  const handleEnd = useCallback(async () => {
    if (!view.sessionId || view.status !== "active") return;
    setView((prev) => ({ ...prev, status: "ending" }));
    try {
      await endSession(view.sessionId);
      closeStream();
      setView((prev) => ({
        ...prev,
        status: "ended",
        currentRunId: null,
        errorMsg: null,
      }));
      // 结束会话成功后通知父级（清选中 / 清 URL ?session= / 刷新列表）。
      onSessionReset?.();
    } catch (err) {
      // 网络错误：不假定 ended，恢复 active，允许重试
      const apiErr = err as ApiError;
      setView((prev) => ({
        ...prev,
        status: "active",
        errorMsg: errMessage(apiErr, "结束会话失败，请重试"),
      }));
    }
  }, [view.sessionId, view.status, closeStream, onSessionReset]);

  // 新建会话（D7）：不结束当前会话（backend session 保持 active，列表仍显示
  // 进行中，需继续可重新点击 attach）。仅断开当前 SSE + 重置面板到新建模式。
  const handleNewSession = useCallback(() => {
    closeStream();
    setView(INITIAL_DIALOG_VIEW);
    setInput("");
    setPendingRequests([]);
    setPlanPending(null);
    setBashProgress(null);
    setAgentTasks([]);
    // ql-20260825-007：随新建重置丢弃待发送附件与元数据镜像（hook 同按
    // sessionId 切换清队，对齐 page 模式会话切换清理语义）。
    setPendingAttachments([]);
    // 缺陷修复收口（A-1）：@ 联想选中残留同点位清空——只重置 view/input/
    // 附件时，未消费的 pendingMentions 会随下一个新建会话首句 create 错绑
    //（组件侧归空 effect 的双向复位是兜底通道，此处显式清保证不依赖 effect
    // 触发时序）。
    setPendingMentions({});
    clearAttachmentsRef.current?.();
    attachmentMetaRef.current.clear();
    // 重置回 idle 时通知父级清除 URL ?session= / 清选中（触发 key 重挂载）
    onSessionReset?.();
  }, [closeStream, onSessionReset]);

  // 用户在 AskUserDialogCard 提交回答后，卡片内部已 POST respondSessionPermission；
  // 这里立即移除卡片（permission_resolved SSE 到达后也会再次过滤，双保险）。
  const handleDialogResolved = useCallback((requestId: string) => {
    setPendingRequests((prev) =>
      prev.filter((r) => r.request_id !== requestId),
    );
  }, []);

  // task-11（FR-03 / D-004）：「用团队分析」不再直调 createMission（task-13 将删
  // 该 client），改为打开触发弹层（objective 预填通用分析提示句），确认后走
  // triggerSessionTeamMission 预建链路（handleTeamTrigger，与派团队按钮/指令等价）。

  // 输入框 / 发送按钮状态（队列化语义，design §3.3）：仅终态与离线禁输入——
  // running / reconnecting 排队可输入（有意行为变更：ISP 旧语义为全态禁用，
  // diff-analysis §5.2-2；弹窗测试旧禁用断言由 task-08/09 更新，非回归）。
  // 队满（D-002）不禁输入但 handleSend 阻止提交，提示由 placeholder 承载。
  // task-14（FR-08 辅半）：纯空文本禁点不在本条件追加——空内容判断收口在共享
  // SessionInputBar 发送按钮（!value.trim() 且无附件，D-7 附件例外维持）+
  // handleSend 入口守卫；本 disabled 同时禁 textarea，并入 trim 判断会在空
  // 输入时锁死输入框无法打字。
  const sendingDisabled =
    view.status === "ended" ||
    view.status === "failed" ||
    view.suspended || // task-10：挂起禁输入——daemon 不在线，恢复自动完成（D-001）
    !hasOnlineProvider ||
    offlineReadOnly;

  // ql-20260825-007：附件门控（D-6 引擎门控同构 + 首句门控）——codex 引擎禁；
  // 无 sessionId（idle 首句 / creating）禁：createSession 契约无 attachment_ids
  //（R3），放开会出现「上传成功但发不出去」。attach 模式进入即有 sessionId，
  // 追问/排队路径（injectSession）已支持附件，正常开放。
  // provider-abstraction task-11：引擎门控收敛查 ProviderCaps（multimodal 键，
  // 与原 !== / === "claude" 等价）。
  const attachmentsDisabled = !getProviderCaps(provider).multimodal || !view.sessionId;
  const attachmentsDisabledTitle =
    getProviderCaps(provider).multimodal && !view.sessionId
      ? "发送首条消息创建会话后可添加附件"
      : undefined;

  const interruptDisabled =
    view.status !== "active" || !view.currentRunId ||
    view.turns.some((t) => t.runId === view.currentRunId && t.status === "interrupting") ||
    offlineReadOnly; // 离线只读禁用打断
  const endDisabled = view.status !== "active" || offlineReadOnly; // 离线只读禁用结束

  // task-11：团队入口派生——引擎门控（provider state 即面板现有引擎信息源，
  // D-003 一期 Claude 专属；provider-abstraction task-11 收敛查 ProviderCaps
  // subagent 键，与原 === "claude" 等价）+ 活跃 chip（R-07 单活跃约束，取首个
  // 活跃 mission）。
  const teamEngineOk = getProviderCaps(provider).subagent;
  const teamButtonDisabled =
    !teamEngineOk ||
    !view.sessionId ||
    view.status === "ended" ||
    view.status === "failed" ||
    !hasOnlineProvider ||
    offlineReadOnly;
  const teamButtonTitle = !teamEngineOk
    ? "团队需要 Claude 引擎"
    : !view.sessionId
      ? "发送首条消息创建会话后可用"
      : view.status === "ended" || view.status === "failed"
        ? "会话已结束，无法派团队"
        : "派团队：当前会话智能体升级为主控，派发分身";
  const activeTeamMission =
    teamMissions.find((m) => isActiveTeamMission(m.status)) ?? null;
  // ql-20260828-009-4a13：dismissed 收起记忆下线——chip 常驻至 mission 终态。
  const teamChipWorkers = activeTeamMission
    ? activeTeamMission.workers.length
    : null;

  // 占位文案（队列化语义，与 page 模式同构的优先级链）：终态 / 离线 / 队满 →
  // 提示；reconnecting / creating / ending / running → 排队或过渡提示（running 的
  // 「等待本轮完成…」旧禁用文案改为排队文案——有意行为变更，diff-analysis
  // §5.2-2）；idle / active 空闲 → 常规输入提示（active 用 page 同款文案）。
  // task-05（FR-08）：可正常输入的两态追加联想能力提示（MENTION_PLACEHOLDER_HINT）。
  const placeholder =
    view.status === "ended" || view.status === "failed"
      ? "会话已结束，请新建会话"
      : view.suspended
        ? "等待守护进程恢复后可继续对话…" // task-10（原型⑤）：挂起禁输入占位
        : !hasOnlineProvider
          ? "未连接提供方，输入不可用…"
          : isQueueFull
            ? "队列已满，请等待投递或删除排队消息…"
            : view.status === "reconnecting"
            ? "恢复会话中，消息将排队等待恢复完成后自动发送…"
            : view.status === "creating"
              ? "正在创建会话..."
              : view.status === "ending"
                ? "正在结束会话..."
                : view.status === "active" && view.currentRunId
                  ? "消息将排队，等待本轮完成后自动发送…"
                  : view.status === "active"
                    ? `继续追问…（Enter 发送 · Shift+Enter 换行 · ${MENTION_PLACEHOLDER_HINT}）`
                    : `输入首条消息创建会话…（${MENTION_PLACEHOLDER_HINT}）`;

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-card">
      {offlineReadOnly ? (
        <div className="flex items-center gap-2 border-b border-amber-300 bg-amber-50 px-5 py-2 text-xs text-amber-800">
          <TriangleAlert aria-hidden className="h-3.5 w-3.5 shrink-0" />
          <span>运行时离线，当前为只读浏览（发送/打断/结束/新建已禁用），重连后自动恢复。</span>
        </div>
      ) : null}
      {/* task-10 / design A5+A6（原型⑤）：attach 目标会话挂起（backend status
          === suspended）——info 横幅 + 输入禁用（见 sendingDisabled）。
          attach 轮询持续观察，daemon 重启转 reconnecting/active 后自动收敛。
          quick 风险审查修（2026-09-01）：dialog 变体无 reopen 机制（页模式横幅
          已补「继续对话」按钮），本处文案去掉手动恢复承诺只保自动恢复。 */}
      {view.suspended ? (
        <div
          role="status"
          aria-live="polite"
          data-session-banner="suspended"
          className="border-b border-info/30 bg-info/10 px-5 py-2 text-xs text-info"
        >
          <div className="flex items-center gap-2">
            <PauseCircle aria-hidden className="h-3.5 w-3.5 shrink-0" />
            <span>会话已挂起——守护进程在线后将自动恢复</span>
          </div>
          <p className="ml-[22px] mt-0.5 text-[11px] leading-4 text-info/80">
            历史消息完整保留，可在下方继续浏览；挂起超过 24 小时才会被标记为失败
          </p>
        </div>
      ) : null}
      {/* lease 处于 terminating 态（terminating_at 非空，D5）时显示「终止中…」
          横幅——backend cancel_lease 已标 lease.terminating_at、等 daemon 回传
          终态的观测窗口。横幅在 session 终态（ended/failed）外才显示；
          onSessionEnded 会清空 terminatingAt。 */}
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
      {/* task-09 / design A6（原型②③④）：连接状态横幅 + 运行轮看门狗提示——
          断线重连中 warning 常驻（第 N 次尝试）；恢复 success 2s 自动消失；
          看门狗长时间无响应仅提示对账中，不伪造终态。 */}
      <StreamConnectionBanner
        connStatus={connGuard.connStatus}
        attempt={connGuard.reconnectAttempt}
      />
      {connGuard.stalledHint && <TurnStalledWatchdogBanner />}
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
            {/* ql-20260826-010：后台活动目录（bash/后台任务/团队任务头部下拉，
                同 page 模式——原三段常驻区挤占会话窗口）。 */}
            <ActivityCatalog
              bashProgress={bashProgress}
              agentTasks={agentTasks}
              missions={teamMissions}
              workspaceId={workspaceId ?? null}
              onRefreshMissions={() => {
                void refreshTeamMissions();
              }}
              onOpenWorkerSession={(subSessionId) => {
                setWorkerSessionId(subSessionId);
              }}
            />
            {/* 对话/进度二态切换（仅在有消息时出现；page 模式同款 JSX）。 */}
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
                    {m === "conversation" ? "对话" : "进度"}
                  </button>
                ))}
              </div>
            )}
            {workspaceId && (
              <Button
                icon={<Users className="h-3 w-3" />}
                // task-11：改为打开触发弹层（不再直调 createMission）——objective
                // 预填通用分析提示句，确认走 triggerSessionTeamMission 预建链路。
                onClick={() => openTeamPopover("团队分析当前会话上下文")}
                disabled={
                  !view.sessionId ||
                  view.status === "ended" ||
                  view.status === "failed" ||
                  !teamEngineOk
                }
                title={
                  !teamEngineOk
                    ? "团队需要 Claude 引擎"
                    : "用团队（主 agent + worker）分析当前会话上下文"
                }
              >
                用团队分析
              </Button>
            )}
            <Button
              icon={<Plus className="h-3 w-3" />}
              onClick={handleNewSession}
              disabled={offlineReadOnly || view.status === "creating" || view.status === "ending"}
              title="新建会话"
            >
              新建会话
            </Button>
            <Tag>
              {hasOnlineProvider ? `${providers.length} 个提供方` : "未连接"}
            </Tag>
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
              value={model ?? null}
              // 受控对按草案为可选（4/4 消费方实际都传）；缺省给 no-op 兜底，
              // 类型上对齐 AgentModelInput 的必填 onChange。
              onChange={onModelChange ?? (() => undefined)}
              placeholder="模型覆盖"
              className="w-full"
              disabled={view.status === "active" || view.status === "ending" || view.status === "creating"}
            />
          </div>
          <div className="flex flex-wrap items-end justify-end gap-2">
            <Button
              size="small"
              icon={<Ban className="h-3 w-3" />}
              onClick={handleInterrupt}
              disabled={interruptDisabled}
              title="打断本轮（session 保持 active）"
            >
              打断本轮
            </Button>
            <Button
              danger
              icon={<Square className="h-3 w-3" />}
              onClick={handleEnd}
              disabled={endDisabled}
              title="结束整个会话"
            >
              结束会话
            </Button>
          </div>
        </div>
      </header>

      {/* task-08（2026-09-04-session-task-execution-panel / FR-01 / D-004@v1 / R-04）：
          任务执行折叠面板——弹窗头部之下、消息流之上的横向信息条层级（page 模式
          AgentLogCard 同层语义）。折叠态仅一行常驻不挤压弹窗纵向空间（展开态由
          组件内部 max-h 滚动兜底）；运行中区数据与头部 ActivityCatalog 同源
          （agentTasks / bashProgress / teamMissions 既有内存态，不新建 state /
          SSE），实时事件经 taskPanelRef 由 establishStream 分发注入。 */}
      <TaskExecutionPanel
        ref={taskPanelRef}
        sessionId={view.sessionId ?? ""}
        runningTasks={agentTasks.filter((t) => t.status === "running")}
        bashProgress={bashProgress}
        teamMissions={teamMissions}
        workspaceId={workspaceId ?? null}
        onRefreshMissions={() => {
          void refreshTeamMissions();
        }}
        onOpenWorkerSession={(subSessionId) => {
          setWorkerSessionId(subSessionId);
        }}
        planObjective={planPending?.summary.objective ?? null}
        planTasks={planPending?.summary.tasks ?? null}
        runsRefreshSignal={usageRefresh}
        tasksRefreshSignal={tasksRefresh}
      />

      {/* 消息流（task-13 共享子组件）。R7：dialog 模式 turns 原样喂 TurnTimeline
          （无 whoLine / 历史 usage / 孤儿 turn 派生链——ISP 现状，强开会多打
          listSessionRuns 请求并重排顺序）。 */}
      <TurnTimeline
        turns={view.turns}
        viewMode={viewMode}
        errorMsg={view.errorMsg}
        sessionStatus={view.status}
        pendingRequests={pendingRequests}
        dialogHistory={dialogHistory}
        onDialogResolved={handleDialogResolved}
        onResend={timelineOnResend}
        onSwitchProvider={handleSwitchProvider}
        hasOnlineProvider={hasOnlineProvider}
        emptyProviderLabel={getProviderLabel(provider)}
        // task-08（FR-04）：定时发送系统提示行（streamFooter 注入口，同 page 模式）。
        streamFooter={
          schedHints.length > 0 ? <ScheduledSysHints hints={schedHints} /> : undefined
        }
      />

      {/* task-11：会话团队任务块——ql-20260826-010 起收编进头部 ActivityCatalog
          下拉（同 page 模式）；取消/分身子会话交互经 props 透传，活跃 5s 轮询不变。 */}

      {/* task-09：plan 模式待确认卡片——planPending 存在时渲染，用户操作后 onSubmitted 清除。 */}
      {planPending && (
        <div className="shrink-0 border-t border-border bg-card px-5 py-3">
          <PlanApprovalCard
            sessionId={view.sessionId ?? ""}
            runId={planPending.runId}
            summary={planPending.summary}
            requestedAt={planPending.requestedAt}
            onSubmitted={() => setPlanPending(null)}
          />
        </div>
      )}
      {/* task-09 bash 进度卡 + verify P1 后台任务卡——ql-20260826-010 起收编进头部
          ActivityCatalog 下拉（同 page 模式），此处仅保留运行中提示行。 */}
      {view.currentRunId == null && agentTasks.some((t) => t.status === "running") && (
        <p className="shrink-0 px-5 pb-1 pt-2 text-xs font-medium text-brand-700">
          后台任务仍在运行，会话未结束（详情见头部「后台」）
        </p>
      )}

      {/* 2026-08-29-session-usage-stats task-04（FR-02 / 原型场景二 / D-001@v1）：
          会话累计用量条——dialog 模式挂输入框上方（消息区与输入区之间的信息条）；
          attach 有会话才渲染（view.sessionId 为空 = idle 新建，无用量可显）。
          refreshSignal 挂 dialog 自己的 onTurnCompleted 轮终态递增（独立
          usageRefresh state，R-04：组件自取数，dialog 路径零 react-query）。 */}
      {view.sessionId ? (
        <SessionUsageBar sessionId={view.sessionId} refreshSignal={usageRefresh} />
      ) : null}

      {/* 排队消息条（design §3.2 / 目标 3：dialog 与 page 共用；空队列组件自返回
          null 不占位）。ql-20260825-007：条目可带附件（📎 数展示），onRemove 顺带
          清理附件元数据镜像防残留（镜像 page 模式）；onRetry 仅用户触发（D-003，
          hook 内 failed→pending 后条件满足即投递）。
          2026-08-31-session-queue-ux（task-09 / FR-04/05/06）：三回调透传 hook
          方法——onReorder 拖拽全量上传（D-003）、onEdit ✎ 保存重写、
          onDispatchNow ⚡ 打断当前轮立即派发（D-001）；失败静默由 hook catch
          承担，条目收敛统一以服务端 load 结果为准。 */}
      <MessageQueueBar
        entries={queue}
        onRemove={(id) => {
          const entry = queue.find((e) => e.id === id);
          for (const aid of entry?.attachmentIds ?? []) {
            attachmentMetaRef.current.delete(aid);
          }
          removeEntry(id);
        }}
        onRetry={(id) => {
          void retryEntry(id);
        }}
        onReorder={(ids) => {
          void reorderEntry(ids);
        }}
        onEdit={(id, prompt) => {
          void editEntry(id, prompt);
        }}
        onDispatchNow={(id) => {
          void dispatchNowEntry(id);
        }}
      />
      {/* task-08（2026-09-07-session-pin-rename-scheduled-send / FR-04）：定时消息
          展示条——MessageQueueBar 邻位挂载（Grill B-05 双挂载点之二：dialog 模式）。
          组件自建局部 QueryClientProvider（dialog 渲染路径零 react-query 的 R4
          不变式不破——弹窗测试无 QueryClientProvider 也能挂）；idle 未建会话时
          sessionId 空串组件自守卫返回 null。 */}
      <ScheduledMessagesBar
        sessionId={view.sessionId ?? ""}
        refreshSignal={schedRefresh}
      />

      {/* task-11：输入区上方团队触发行（活跃 chip + 配置弹层挂载），原型 §01
          .team-trigger-row；弹层相对本行向上弹出（§02 .team-pop）。ql-20260827-020：
          派团队按钮移入 SessionInputBar ＋ 菜单，本行按需渲染（chip/错误/弹层）。 */}
      <TeamTriggerRow
        activeWorkers={teamChipWorkers}
        onCancelMission={() => {
          void handleCancelTeamMission();
        }}
        cancelling={teamCancelling}
        onChipClick={() => {
          // ql-20260828-012-4425：chip 点击回显活跃 mission 配置（同 page 模式）。
          const m = activeTeamMission;
          if (!m) {
            openTeamPopover(null);
            return;
          }
          const raw = m.objective?.trim() ?? "";
          const objective =
            !raw ||
            raw === "（由会话首条团队指令定义）" ||
            raw.startsWith("/team")
              ? null
              : raw;
          openTeamPopover(objective, {
            objective,
            projectId: m.project_id ?? null,
            scopeWorkspaceIds: m.scope_workspace_ids ?? null,
            budgetUsd: m.budget_usd ?? null,
            mainAgentConfig: m.main_agent_config ?? null,
            workerPreset: m.worker_preset ?? null,
          });
        }}
        hasActiveMission={teamChipWorkers !== null}
        popoverOpen={teamPopover.open}
        workspaceId={workspaceId ?? null}
        workspaceName={null}
        defaultObjective={teamPopover.objective}
        popoverInitial={teamPopover.initial}
        submitting={teamTriggering}
        errorText={teamError}
        onTrigger={(payload) => {
          void handleTeamTrigger(payload);
        }}
        onClose={closeTeamPopover}
      />

      {/* 输入区共享子组件。ql-20260825-007：接通附件管线（此前 R3 不传附件
          props——📎/粘贴能上传但发送被丢，因 createSession 无 attachment_ids 只
          限制首句；追问/排队走 injectSession 早已支持）。首句门控见
          attachmentsDisabled 派生。 */}
      <SessionInputBar
        value={input}
        onChange={setInput}
        onSend={() => {
          void handleSend();
        }}
        disabled={sendingDisabled}
        placeholder={placeholder}
        creating={view.status === "creating"}
        attachmentsDisabled={attachmentsDisabled}
        attachmentsDisabledTitle={attachmentsDisabledTitle}
        onAttachmentsChange={setPendingAttachments}
        registerClearAttachments={(fn) => {
          clearAttachmentsRef.current = fn;
        }}
        // task-05（FR-05/FR-06/FR-08）：@ 联想回传与数据源工作区（dialog 的
        // workspaceId prop——attach 续聊工作区由宿主注入，缺省 @ 联想禁用）。
        onMentionsChange={setPendingMentions}
        workspaceId={workspaceId ?? null}
        // ql-20260827-020：＋ 菜单派团队入口（门控口径同原触发行按钮）。
        onTeamTrigger={() => openTeamPopover(null)}
        teamTriggerDisabled={teamButtonDisabled}
        teamTriggerTitle={teamButtonTitle}
        // task-08（FR-04）：⏰ 定时发送入口——仅 attach 到会话（view.sessionId
        // 非空）注入；idle 未建会话不渲染入口（定时条目需既有会话承载）。
        onSchedule={view.sessionId ? openSchedModal : undefined}
      />

      {/* task-14：分身会话浮层——复用 SessionPanel（dialog/attach 形态）打开分身
          子会话；dialog 必需 props 按本面板透传（模型覆盖受控对共用父级 state）。 */}
      {workerSessionId != null && (
        <WorkerSessionOverlay
          subSessionId={workerSessionId}
          onClose={() => {
            setWorkerSessionId(null);
          }}
        />
      )}

      {/* task-08（FR-04）：定时发送弹窗（同 page 模式，dialog 侧状态源 view.sessionId）。 */}
      <ScheduledSendModal
        open={schedOpen}
        draft={input}
        value={schedAt}
        submitting={schedSubmitting}
        onChange={setSchedAt}
        onCancel={() => {
          setSchedOpen(false);
        }}
        onConfirm={() => {
          void confirmSchedCreate();
        }}
      />
    </section>
  );
}
