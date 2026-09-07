"use client";

/** page 模式内部子组件 SessionPanelPage（含 react-query，R4；自 session-panel.tsx 原样搬移；纯派生外提 ./page-helpers，handler/闭包保持组件内 R-03）。 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Ban, Bot, ClipboardList, FolderOpen, Lock, Monitor, MoreHorizontal, PauseCircle, Puzzle,
  Search, TriangleAlert, Zap,
} from "lucide-react";
import { Badge, Button, Input, Spin } from "antd";
import { buildErrorLogItem, buildSystemFailureItem } from "@/components/agent-log/normalize";
import { extractPreambleText, finishTurn } from "@/components/daemon/session-log-assembler";
import { TurnTimeline } from "@/components/daemon/turn-timeline";
import { type AttachmentRead } from "@/lib/api/session-attachments";
import {
  joinAttachmentMarkers, logsToTurns, parseAttachmentMarkers,
} from "@/components/daemon/runtime-session-helpers";
import {
  SessionInputBar, type SessionInputMentions,
} from "@/components/daemon/session-input-bar";
import { MessageQueueBar } from "@/components/daemon/message-queue-bar";
import { SessionUsageBar } from "@/components/daemon/session-usage-bar";
import { QUEUE_MAX_PENDING, useMessageQueue } from "@/hooks/use-message-queue";
import { CtxUsageBar } from "@/components/sessions/ctx-usage-bar";
import {
  SessionConfigBar, useActiveSharedAgents,
} from "@/components/sessions/session-config-bar";
import { SubagentCatalog } from "@/components/sessions/subagent-catalog";
import { ApiError } from "@/lib/api";
import {
  type AgentRunLogEntry, type MainAgentConfig, type WorkerPresetItem,
} from "@/lib/agent";
import { errMessage, useNotify } from "@/lib/errors";
import { isActiveTeamMission } from "@/components/daemon/team-task-block";
import { ActivityCatalog, type AgentTaskEntry } from "@/components/daemon/activity-catalog";
import { type TeamTriggerInitialConfig } from "@/components/daemon/team-trigger-popover";
import { AgentLogCard, AgentLogSessionBody } from "@/components/daemon/agent-log-card";
import { PlanApprovalCard } from "@/components/daemon/plan-approval-card";
import {
  TaskExecutionPanel, type TaskExecutionPanelHandle,
} from "@/components/daemon/task-execution-panel";
import { listWorkspaces } from "@/lib/workspaces";
import { getProject } from "@/lib/ppm/project";
import { getChange } from "@/lib/changes";
import { getQuicklogDetail } from "@/lib/quicklog";
import {
  cancelTeamMission, createSession, fetchPendingDialogs, fetchSessionDialogHistory,
  getAgentSession, getAgentSessionLogs, injectSession, interruptSession, listSessionRuns,
  triggerSessionTeamMission, maxLogTimestamp, reopenSession, streamSession,
  updateSessionCtxWindow, type SessionCreateTeamMission, type SessionDialogRead, type SessionPermissionRequest,
  type SessionRunRead, type SessionStreamConnection, type TeamMissionTriggerRequest,
  type PlanSummary,
} from "@/lib/daemon";
import { getProviderCaps } from "@/lib/provider-caps";
import { cn } from "@/lib/utils";

import {
  HISTORY_PAGE_SIZE, INITIAL_TURN_STATE, MAX_PROMPT_LEN,
  SUSPENDED_SESSION_REFETCH_MS, TERMINAL_TURN_STATUSES, TurnState, applyBashStatusEvent,
  appendBashChunk, applyEnvelopeToTurn, asAssembled, BashProgressState, deriveTurnTerminalStatus,
  findSegmentById, mentionBindOptions, readPersistedViewMode,
  readSessionDraft, subagentBlockNameOf, upsertTurn, writePersistedViewMode, writeSessionDraft,
} from "./turn-state";
import { highlightSearchHit, searchResultLabel, searchResultText } from "./search";
import { TeamTriggerRow } from "./team-trigger-row";
import { WorkerSessionOverlay } from "./worker-session-overlay";
import {
  parseTeamCommand, teamTriggerErrorText, useSessionTeamMissions,
} from "./use-session-team-missions";
import { useStreamConnectionGuard } from "./use-stream-connection-guard";
import { StreamConnectionBanner, TurnStalledWatchdogBanner } from "./connection-banners";
import { applyAgentTaskStatusEvent } from "../agent-task-store";
import {
  deriveMachineMeta, derivePreMachineLabels, derivePreSessionChrome,
  deriveSessionPlaceholder, deriveSessionStatusFlags, deriveStatusBadge,
  deriveTeamButtonState, deriveTimelineSessionStatus, enrichDisplayTurns,
  findActiveTeamMissionChip, findPreMachine, findPreRuntimeHit, findProviderById,
  findRuntimeHitById, hasPlatformSharedProfile, isMultimodalDowngraded,
  isWorkspaceArchived, latestCtxTokens, LOAD_EARLIER_TRIGGER_PX,
  PANEL_BODY_WRAP_CLS_MOBILE, PANEL_HEADER_CLS_DESKTOP, PANEL_HEADER_CLS_MOBILE,
  PANEL_ROOT_CLS_DESKTOP, PANEL_ROOT_CLS_MOBILE, providerLabelOf,
  RECONNECT_TIMEOUT_MS, renderHistoryAndLocalReport, REOPEN_ERROR_ZH,
  resolveAgentDisplayName, resolveCtxRoleMapping, resolvePageProjectId,
  resolvePreChangeName, resolvePreQuicklogName, resolvePreWorkspaceName,
  resolveWorkspaceName, splitToolReportTurns, type SessionPanelPageProps,
} from "./page-helpers";

/* ────────────────────── page 模式内部子组件（含 react-query，R4） ────────────────────── */

export function SessionPanelPage({
  sessionId,
  machines,
  llmProviders,
  onSessionListRefresh,
  preContext,
  autoTeamOpen,
  onPreSessionCreated,
  pageContextOverride,
  variant,
}: SessionPanelPageProps) {
  const qc = useQueryClient();
  const notify = useNotify();

  // task-14（design §5.4）：视口样式派生——仅渲染层消费（className 三元/次要
  // chrome 显隐），不进入任何数据/effect/回调逻辑分支（可 grep 验证）。
  const mobile = variant === "mobile";

  // ── 会话详情（配置三列 + 状态 + current_run_id）────────────────────────
  // task-03（R-01）：预会话态（sessionId=null）不发起 getAgentSession(null)——
  // enabled 守卫停轮询；queryFn 内再防御性窄化（enabled 走漏也不发脏请求）。
  const detailQuery = useQuery({
    queryKey: ["agentSessionDetail", sessionId],
    queryFn: () => {
      if (!sessionId) throw new Error("预会话态不请求会话详情");
      return getAgentSession(sessionId);
    },
    enabled: sessionId !== null,
    // pending/reconnecting 期间轮询直到 active/终态（attach 恢复语义）。
    // task-10：suspended 挂起期间低频轮询（design A5/A6）——daemon 重启后
    // recover 的状态翻转（suspended → reconnecting → active）靠轮询发现，
    // 横幅/输入禁用随之收敛。
    refetchInterval: (query) => {
      // task-10 类型过渡：status 联合暂不含 suspended（task-11 收口），字符串化比较。
      const st = query.state.data?.status as string | undefined;
      if (st === "pending" || st === "reconnecting") return 1500;
      if (st === "suspended") return SUSPENDED_SESSION_REFETCH_MS;
      return false;
    },
  });
  const session = detailQuery.data ?? null;

  // ── 工作区名称解析（面板头部显示）─────────────────────────────────────────
  const workspacesQuery = useQuery({
    queryKey: ["workspaces", "session-panel"],
    queryFn: () => listWorkspaces({ limit: 100 }),
    staleTime: 60_000,
  });
  // ql-20260825-011：别名优先（先例 workspace-switcher / workspace-card）。
  const workspaceName = useMemo(
    () => resolveWorkspaceName(session?.workspace_id, workspacesQuery.data),
    [session?.workspace_id, workspacesQuery.data],
  );

  // ql-20260829-011：归档区存量会话只读——后端 inject/interrupt 已 409，输入栏
  // 置灰 + 占位提示恢复路径（预会话态兜底 preContext.workspaceId 同判）。
  const sessionWorkspaceArchived = useMemo(
    () =>
      isWorkspaceArchived(
        session?.workspace_id,
        preContext?.workspaceId,
        workspacesQuery.data,
      ),
    [session?.workspace_id, preContext?.workspaceId, workspacesQuery.data],
  );

  // ── task-07（D-106）：change 入口预会话上下文行加显变更名 ────────────────
  // X-13 双传契约保证 changeId 存在时 workspaceId 必在；真会话态 / 非 change
  // 预会话（changeId 空）enabled 守卫停请求。title 缺省回退 change_key。
  const preChangeQuery = useQuery({
    queryKey: [
      "change",
      "preSessionCtx",
      preContext?.workspaceId,
      preContext?.changeId,
    ],
    queryFn: () => {
      if (!preContext?.workspaceId || !preContext.changeId) {
        throw new Error("变更名解析缺 workspaceId/changeId（X-13 双传契约）");
      }
      return getChange(preContext.workspaceId, preContext.changeId);
    },
    enabled: Boolean(preContext?.workspaceId && preContext?.changeId),
    staleTime: 60_000,
  });

  // ── task-11（2026-08-25-session-spec-binding / FR-06）：quicklog 入口预会话
  // 上下文行加显快速修复标题 ─────────────────────────────────────────────────
  // 对齐 preChangeQuery 模式：单条语义调 getQuicklogDetail（按 ql_id 精确取）；
  // 双传契约同 X-13（quickId 存在时 workspaceId 必在）；真会话态 / 无 quickId
  // 预会话 enabled 守卫停请求；解析失败静默回退 ql_id 短码展示（D-001：双源
  // 合并条目允许后到，不校验存在性）。
  const preQuicklogQuery = useQuery({
    queryKey: [
      "quicklog",
      "preSessionCtx",
      preContext?.workspaceId,
      preContext?.quickId,
    ],
    queryFn: () => {
      if (!preContext?.workspaceId || !preContext.quickId) {
        throw new Error("快速修复标题解析缺 workspaceId/quickId（双传契约，对齐 X-13）");
      }
      return getQuicklogDetail(preContext.workspaceId, preContext.quickId);
    },
    enabled: Boolean(preContext?.workspaceId && preContext?.quickId),
    staleTime: 60_000,
  });

  // ── task-10（2026-08-28-daemon-agent-share / FR-05 / D-004@v2）：平台共享
  // 会话徽标数据源 ─────────────────────────────────────────────────────────
  // 判定路径：AgentSessionRead / config_snapshot 均无 platform 共享标识字段
  //（后端 task-05 未落展示位），前端对照 active 共享智能体生效列表——会话
  // agent_profile_id ∈ 列表即「平台共享」。仅显示不改行为；预会话态不判定
  //（sessionId=null 无档案绑定事实，首句创建后徽标自然出现）。失败降级 []
  //（useActiveSharedAgents 内建），徽标数据缺失不阻塞面板。
  const { activeSharedAgents } = useActiveSharedAgents();
  const isPlatformSharedSession = useMemo(
    () => hasPlatformSharedProfile(activeSharedAgents, session?.agent_profile_id),
    [activeSharedAgents, session?.agent_profile_id],
  );

  // ── 实时 turn 状态机（对齐 interactive-session-panel 的 SSE 处理）───────
  const [turnState, setTurnState] = useState<TurnState>(INITIAL_TURN_STATE);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // ── 群聊体验 quick（2026-09-02）：历史窗口化 + 会话内搜索（克制最小改）──
  // 初始历史改 limit=100 起步（HISTORY_PAGE_SIZE），时间线顶部「加载更早消息」
  // 按钮 before 游标 prepend（resync after 增量不受影响——cursor 语义不变）。
  const [historyLoading, setHistoryLoading] = useState(false);
  const [hasEarlier, setHasEarlier] = useState(false);
  const historyCursorRef = useRef<string | null>(null);
  // 会话内搜索（头部搜索 icon → 输入回车 q 查询 → 结果浮层；点击条目即关闭，
  // 不做跳转定位——最小可用）。
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<AgentRunLogEntry[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [pendingRequests, setPendingRequests] = useState<
    SessionPermissionRequest[]
  >([]);
  const [dialogHistory, setDialogHistory] = useState<SessionDialogRead[]>([]);
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
  // verify P1 返工（FR-03）：后台 Agent 任务状态（按 task_id upsert，保留终态供
  // 回看；最多展示最近 6 条防长会话刷屏，会话结束清空）。
  // task-12（2026-08-27-background-subagent-progress / FR-06）：state 扩到全生命
  // 周期——status 增补 stopped 终态，存「正在做什么」/ 走秒锚点 / tokens /
  // 最后活跃 / 终态定格字段（形状同 ActivityCatalog 的 AgentTaskEntry）；归约
  // 统一走底部 applyAgentTaskStatusEvent（page / dialog 两模式共用）。
  const [agentTasks, setAgentTasks] = useState<AgentTaskEntry[]>([]);
  // gap-fix（FR-07 / FR-08）：run 级轮次快照（id → SessionRunRead），attach 时
  // 预取 + 每轮 turn_completed 后刷新，供 whoLine 注入与历史 usage 回填。
  const [runsMeta, setRunsMeta] = useState<Map<string, SessionRunRead>>(new Map());
  const [viewMode, setViewMode] = useState<"conversation" | "all">("conversation");
  // 2026-08-29-session-usage-stats task-04（R-04）：用量条重取信号——
  // onTurnCompleted 轮终态递增，驱动头部下方 SessionUsageBar 重拉
  //（用量数据轮次终态才落库，非实时精确可接受，design R-04）。
  const [usageRefresh, setUsageRefresh] = useState(0);
  // ql-20260822-010：视图模式（对话/进度）按会话持久化——原实现刷新后回默认
  // 「对话」，与聊天中切到的视图不一致。挂载后回读（effect 内 set，避免 SSR
  // hydration mismatch）；切换时写入。dialog 适配层无刷新恢复场景，不持久化。
  // task-03（R-01）：预会话态无会话级持久化键，跳过（转真会话时随依赖重跑）。
  useEffect(() => {
    if (!sessionId) return;
    setViewMode(readPersistedViewMode(sessionId));
  }, [sessionId]);
  const changeViewMode = useCallback(
    (m: "conversation" | "all") => {
      setViewMode(m);
      if (sessionId) writePersistedViewMode(sessionId, m);
    },
    [sessionId],
  );
  const [input, setInput] = useState("");
  // 2026-08-20 task-12：待发送附件 ids（SessionInputBar 上传产物）与清理句柄。
  const [pendingAttachments, setPendingAttachments] = useState<AttachmentRead[]>([]);
  const clearAttachmentsRef = useRef<(() => void) | null>(null);
  const [reopening, setReopening] = useState(false);
  // task-05（2026-08-26-session-input-mention / FR-05 / FR-06）：@ 联想结构化
  // 选中暂存（SessionInputBar onMentionsChange 回传，change/quick 两槽位）——
  // 预会话随首句 createSession 上送 change_id/quicklog_id，真会话随
  // injectSession 上送 bind_change_key/bind_quick_id；发送成功后清空（与
  // clearAttachments 同时机），切会话（下方草稿恢复 effect）与组件 value 归空
  //（A-1 双向复位回调）同步清零，草稿持久化不存（R-7：草稿恢复后 @ 文本仍在，
  // 绑定需重新选择）。
  const [pendingMentions, setPendingMentions] = useState<SessionInputMentions>({});

  // ── ql-20260825-011：输入框草稿持久化（刷新/切换会话不丢）──────────────────
  // 回读：挂载 + sessionId 变化（预会话态无 id 用固定键 __pre__）。
  // hydrated 门闩防「回读前先写空串」冲掉已存草稿：restore 先 setInput，rAF 后
  // 才放行持久化 effect（该 commit 内 input 仍是旧会话的值，不写新会话键）。
  // 缺陷修复收口（A-1）：切会话时清 @ 联想选中残留——草稿换装（setInput 非
  // 空新草稿）不触发组件归空复位，会话 A 的绑定会随会话 B 的消息错绑；
  // R-7 语义（草稿只存文本、绑定需重选）在切会话边界同样成立。
  const draftHydratedRef = useRef(false);
  useEffect(() => {
    draftHydratedRef.current = false;
    setInput(readSessionDraft(sessionId));
    setPendingMentions({});
    const raf = requestAnimationFrame(() => {
      draftHydratedRef.current = true;
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);
  useEffect(() => {
    if (!draftHydratedRef.current) return;
    writeSessionDraft(sessionId, input);
  }, [sessionId, input]);

  // ── task-03（2026-08-23-sessions-workspace-hub）：预会话首句创建态 ────────
  // creating 在途（发送按钮 spinner + 防重复提交）；失败内联错误（R-02：输入
  // 保留可重试，不切真会话态）。dialog idle 先例是"先清输入再建、失败即丢"，
  // 这里改为成功后才清空（Grill X-02）。
  const [preCreating, setPreCreating] = useState(false);
  // ql-20260823-008：预会话供应商/档案暂存——SessionConfigBar provisional 模式
  // 点选暂存（无会话不 inject），首句 createSession 携带（""=不指定/本机默认不传）。
  const [preProviderId, setPreProviderId] = useState("");
  const [preProfileId, setPreProfileId] = useState("");
  // D-002@v1（2026-08-29-usage-by-provider-model）：预会话模型暂存——级联专用
  // 回调（不能复用 onProvisionalSwitch 二分收值），首句 createSession 携带
  // （""=跟随供应商配置不传）。
  const [preModelId, setPreModelId] = useState("");
  const [preError, setPreError] = useState<string | null>(null);
  // task-13（FR-05/D-009@v2）：预会话团队 payload 暂存——弹层确认后暂存（含
  // task-12 主 agent 选择器落定的 orchestrator_workspace_id），首句 createSession
  // 随 team_mission 上送；成功清空、失败保留可原地重试（R-02 语义延伸）。
  const [preTeamMission, setPreTeamMission] = useState<SessionCreateTeamMission | null>(
    null,
  );

  // ── task-11（2026-08-22-team-session-unify）：会话内团队触发 + TeamTaskBlock ──
  // 任务列表/轮询共用 hook；弹层开关与预填、触发在途、错误文案、chip 取消为面板态。
  // ql-20260828-009-4a13：running（进行中轮）时也轮询——mission 迟到不再盲区。
  const { missions: teamMissions, refresh: refreshTeamMissions } =
    useSessionTeamMissions(sessionId, turnState.currentRunId != null);
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
  // task-14（design §5.4）：mobile 头部 ⋯ 菜单开关（次要 chrome 收纳容器）。
  // hook 无条件声明（desktop 渲染层不读它），variant 保持在渲染层。
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);

  const streamRef = useRef<SessionStreamConnection | null>(null);
  // 面板根 ref（task-09 / FR-04）：子代理目录跳转的 DOM 定位查询范围（限面板内）。
  const panelRef = useRef<HTMLElement | null>(null);
  // 已拉取过 error_detail 的 failed run_id 集合（防 SSE 重连重复拉取）。
  const fetchedErrorRunIdsRef = useRef<Set<string>>(new Set());
  // attach 竞态修复（ql-20260820-007）：镜像最新 detail.current_run_id。历史 logs
  // 回灌可能晚于 detail 到达——彼时下方 attach 修正 effect 已对空 turns 扫过且其
  // currentRunId 守卫不再重放，回灌时据本 ref 重放同一修正，使两种到达顺序结果一致。
  const currentRunIdRef = useRef<string | null>(null);
  // task-03（2026-08-21-session-message-queue / D-004 附件排队）：附件元数据镜像
  // （id → kind/name）。hook 的 onSend 契约只携带 attachmentIds（hook 源码不动），
  // 而占位轮合成标记行（ql-20260821-002 的 [附件:id|kind|name]）需要 kind/name
  // ——入队时在 handleSend 登记、投递时在 sendFromQueue 查表、成功/删条目后清除。
  const attachmentMetaRef = useRef(new Map<string, { kind: string; name: string }>());
  // ql-20260825-011：发送中（inject 在途）的占位信息——「打断本轮」在发送窗口
  // 期触发时用它回退消息到输入框；响应到达后据 placeholderId 是否仍匹配判定
  // 是否已被打断（不匹配 = 已回退，需对真实 run 补发 interrupt）。
  const inflightSendRef = useRef<{ placeholderId: string; prompt: string } | null>(null);

  // ── task-09 / design A6：连接横幅 + 运行轮看门狗（共用 hook）──────────────
  // 建流 effect 的 handlers 经 tapStreamHandlers 包装注入 onStatusChange 与活动
  // 时间推进；对账发现会话非 active 时 invalidate 详情查询（刷新状态章 / current_run_id）。
  const connGuard = useStreamConnectionGuard({
    sessionId,
    currentRunId: turnState.currentRunId,
    getConnection: () => streamRef.current,
    onSessionReconciled: () => {
      void qc.invalidateQueries({ queryKey: ["agentSessionDetail", sessionId] });
    },
  });

  // ── task-08（2026-09-04-session-task-execution-panel）：任务执行面板接线 ────
  // ref 桥接：下方建流 effect 的 onAgentTaskStatus 分发（定义早于渲染 JSX 挂
  // ref）经 ref 注入实时事件（queueRefreshRef 先例语义，避开 use-before-define；
  // 不重建 SSE、不新建第二条任务数据链路）。
  const taskPanelRef = useRef<TaskExecutionPanelHandle | null>(null);
  // 任务清单快照重拉信号：SSE 重连恢复（connStatus → reconnected）后递增一次，
  // 对账断线期间落库的任务行（TaskExecutionPanel 内 useSessionTasks 自取数）。
  const [tasksRefresh, setTasksRefresh] = useState(0);
  useEffect(() => {
    if (connGuard.connStatus === "reconnected") {
      setTasksRefresh((n) => n + 1);
    }
  }, [connGuard.connStatus]);

  // ── SSE 建流 + 历史预取（sessionId 驱动，切换会话即重建）────────────────
  // gap-fix（FR-07/FR-08）：runs 快照拉取失败不阻断——whoLine 不注入、历史
  // usage 走实时 SSE 路径，与 logs 预取同一容错语义。
  // F7（2026-08-25）：refreshRunsMeta 定义移入下方建流 effect（唯一调用点在
  // effect 内的 onTurnCompleted 回调）——共用既有 cancelled 标志，会话切换/
  // 卸载后迟到的 runs 快照不再 setRunsMeta（旧会话 whoLine 数据覆盖新会话 +
  // 卸载后 setState 卫生，React 18 no-op 但按既有 cancelled 模式收口）。
  // F7：渲染作用域异步回调（onSwitched）的卸载守卫——effect 作用域 cancelled
  // 覆盖不到 JSX 回调，用组件级 mountedRef 等价守卫。
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    // task-03（R-01）：预会话态不建流/不预取历史（getAgentSessionLogs /
    // listSessionRuns 均零调用）。首句创建成功后父层切 sessionId，本 effect 随
    // 依赖变化自然接管；string→null 时上方 cleanup 已 close 旧流。
    if (!sessionId) return;
    let cancelled = false;
    // ql-20260903-018：换会话纪元 +1 并 abort 在途「加载更早」——旧会话翻页
    // 响应经纪元归属校验丢弃，不再串进新会话时间线。
    sessionEpochRef.current += 1;
    historyAbortRef.current?.abort();
    historyAbortRef.current = null;
    setTurnState(INITIAL_TURN_STATE);
    setErrorMsg(null);
    setPendingRequests([]);
    setPlanPending(null);
    setBashProgress(null);
    setAgentTasks([]);
    setRunsMeta(new Map());
    fetchedErrorRunIdsRef.current.clear();
    currentRunIdRef.current = null;
    // task-03：随队列清空（hook 同按 sessionId 切换清队）一并丢弃附件元数据镜像。
    attachmentMetaRef.current.clear();
    // quick 历史窗口化：换会话重置「加载更早」游标/翻页态 + 清搜索浮层状态。
    historyCursorRef.current = null;
    setHasEarlier(false);
    setHistoryLoading(false);
    historyLoadingRef.current = false;
    autoFillCountRef.current = 0;
    setSearchOpen(false);
    setSearchTerm("");
    setSearchResults(null);
    setSearching(false);

    // ql-20260827-018：历史预取改 await **先回灌再建流**——原并行时活跃会话
    // SSE 先到建 turn，回灌条件（prev.turns 空）不满足 → 历史被整体丢弃，
    // 旧轮内容永久缺失（「有时加载不出来」根因；dialog 模式 establishStream
    // 同款竞态先例）。建流缺口（历史快照 → SSE 订阅间发布的事件）由
    // streamSession cursor 首连缺口同步增量补齐，不再依赖「SSE 抢先订阅」。
    const establish = async (): Promise<void> => {
      let streamCursor: string | undefined;
      let initialSync = false;
      try {
        // quick：limit=100 起步（最新 100 条日志窗口）——resync 游标语义不变
        //（after=maxLogTimestamp 仍只增量拉窗口之后），更早走「加载更早消息」。
        const logs = await getAgentSessionLogs(sessionId, {
          limit: HISTORY_PAGE_SIZE,
        });
        if (cancelled) return;
        streamCursor = maxLogTimestamp(logs);
        // 翻页游标 = 窗口内最早行 ts；满页即可能还有更早（按钮可见）。
        historyCursorRef.current = logs[0]?.timestamp ?? null;
        setHasEarlier(logs.length >= HISTORY_PAGE_SIZE);
        // 触顶补口：内容不满视口（无滚动条）时 scroll 事件永不触发——满页
        // 且初始内容撑不满一屏时自动续拉直至可滚动/到头（见 maybeAutoFill）。
        // 双 rAF：等本批 setState 的 DOM 提交 + 布局完成（setTimeout(0) 早于
        // 提交，scrollHeight=0 链断——分身会话实测复现「无滚动条不加载」）。
        if (logs.length >= HISTORY_PAGE_SIZE) {
          scheduleAutoFillRef.current();
        }
        const restored = logsToTurns(logs);
        setTurnState((prev) => {
          // 预取窗口内用户抢先发送的占位轮（__pending_inject_*）不覆盖——
          // 该轮由 inject 响应回填真实 run_id 后走 SSE 增量，正常路径。
          if (prev.turns.length > 0) return prev;
          // attach 竞态修复（ql-20260820-007）：detail 先到时修正 effect 已扫过空
          // turns——装回后按 currentRunIdRef 重放同一修正，运行中 run 不再被
          // logsToTurns 的「一律 completed」卡成「已完成」（状态条随之恢复挂载）。
          const cur = currentRunIdRef.current;
          return {
            ...prev,
            turns: cur
              ? restored.map((t) =>
                  t.realRunId === cur && t.status === "completed"
                    ? { ...t, status: "running" }
                    : t,
                )
              : restored,
          };
        });
      } catch {
        /* 历史拉取失败：不阻断建流，streamSession initialSync 全量对账兜底 */
        initialSync = true;
      }
      if (cancelled) return;
      // task-09：handlers 经 connGuard.tapStreamHandlers 包装——注入 onStatusChange
      //（连接横幅）+ 看门狗活动时间推进，原事件语义逐字保留。
      streamRef.current = streamSession(
        sessionId,
        connGuard.tapStreamHandlers({
          onTurnStarted: (env) => {
            // ql-20260825-011：新轮开跑（含排队消息自动派发）→ 刷队列条（队头条目
            // 已转正式轮，应从队列中消失）。
            void qc.invalidateQueries({ queryKey: ["agentSessionQueue", sessionId] });
            setTurnState((prev) =>
              upsertTurn(
                prev,
                env,
                (turn) => ({
                  ...turn,
                  turn: env.turn ?? turn.turn,
                  status: turn.status === "pending" ? "running" : turn.status,
                }),
                { setCurrentRun: env.run_id! },
              ),
            );
          },
          // 2026-08-31-session-queue-ux（FR-03）：后端任一队列动作（入队/派发/
          // 删除/失败/reordered/edited/dispatch_now）均发 queue_changed——事件驱动
          // 立即刷新队列条，不等 5s 轮询兜底。refreshQueue 为 hook 稳定回调（仅随
          // sessionId 变化，本 effect 亦按 sessionId 重建，闭包常新）；SSE 与轮询
          // 双源并发由 hook 既有 epoch 丢弃兜底（RISK-5）。
          onQueueChanged: () => {
            refreshQueue();
          },
          onLog: (env) => {
            // user_input 是用户消息（attach 历史/占位 turn 已作 prompt），不进 output
            // （装配器内同语义双保险）。task-09（FR-05）：其余日志归一喂共享装配器，
            // 分类 / override 撤回 / tool 配对 / 子代理归属一律依赖装配器导出。
            if (env.channel === "user_input") {
              // 2026-08-25-unified-floating-session task-11（FR-7）：daemon 回传的
              // 首条 user_input 含完整 dispatch_prompt——提取前导为 preamble 段
              // （对话视图不渲染，「全部」视图显示注入来源）。
              const preambleText = extractPreambleText(env.content ?? "");
              if (preambleText && env.run_id) {
                setTurnState((prev) =>
                  upsertTurn(
                    prev,
                    env,
                    (turn) =>
                      turn.segments?.some((s) => s.kind === "preamble")
                        ? turn
                        : {
                            ...turn,
                            segments: [
                              {
                                kind: "preamble",
                                id: `preamble:${env.run_id}`,
                                text: preambleText,
                                ts: env.timestamp
                                  ? Date.parse(env.timestamp)
                                  : Date.now(),
                              },
                              ...(turn.segments ?? []),
                            ],
                          },
                    { setCurrentRun: env.run_id! },
                  ),
                );
              }
              return;
            }
            setTurnState((prev) =>
              upsertTurn(
                prev,
                env,
                (turn) => {
                  const applied = applyEnvelopeToTurn(turn, env);
                  // quick-9f86d2c3（会话 e87622aa）：终态轮迟到 log（轮后对账 / 断线
                  // resync 重放）补跑 finishTurn——迟到 partial 不常亮光标、前缀重复
                  // 段就地收敛。当前活跃 run（healToRunning 自愈场景）不跑，流式光标
                  // 照常。同款兜底见 dialog onLog（lateOnIdleRun）。
                  const lateOnIdleRun = prev.currentRunId !== env.run_id;
                  if (
                    lateOnIdleRun &&
                    TERMINAL_TURN_STATUSES.has(turn.status) &&
                    applied !== turn
                  ) {
                    return { ...applied, ...finishTurn(asAssembled(applied)) };
                  }
                  return applied;
                },
                {},
              ),
            );
          },
          onTurnCompleted: (env) => {
            const terminal = deriveTurnTerminalStatus(env);
            setTurnState((prev) =>
              upsertTurn(
                prev,
                env,
                (turn) => {
                  // task-09：finishTurn 清全部 text/thinking 段 streaming 标记
                  // （流式光标收起，段级状态随终态收敛）；终态与 token 照旧页面胶水写入。
                  const finished = finishTurn(asAssembled(turn));
                  return {
                    ...turn,
                    segments: finished.segments,
                    output: finished.output,
                    processItems: finished.processItems,
                    turnStartedAt: finished.turnStartedAt,
                    seenLogIds: finished.seenLogIds,
                    status: terminal,
                    inputTokens: env.input_tokens ?? turn.inputTokens,
                    outputTokens: env.output_tokens ?? turn.outputTokens,
                    // task-08（FR-01）：ctx_tokens null 不覆盖已收值（终态保留实时
                    // 最后写入——close_interactive_run 请求 DTO 不含 ctx_tokens）。
                    ctxTokens: env.ctx_tokens ?? turn.ctxTokens,
                  };
                },
                { clearCurrentRun: env.run_id! },
              ),
            );

            // gap-fix（D-008@v1）：每轮终态后刷新 run 快照——本轮 whoLine/usage 由
            // run 行（dispatch 冻结）注入，切换配置后的下一轮跟随新快照。
            refreshRunsMeta(sessionId);

            // 2026-08-29-session-usage-stats task-04（R-04）：轮终态递增用量条
            // 重取信号（会话累计用量随轮终态落库，SessionUsageBar 自取数重拉）。
            setUsageRefresh((n) => n + 1);

            // ql-20260825-011：轮终态 → 后台会自动派发下一条排队消息，刷队列条
            // （新派发轮的 turn_started 事件也会再刷一次，双保险）。
            void qc.invalidateQueries({ queryKey: ["agentSessionQueue", sessionId] });

            // ql-20260824-004：每轮完成即时刷新左栏列表（轮数/相对时间/状态点，
            // 不等 10s 轮询兜底；dialog 模式不传 onSessionListRefresh 天然不受影响）。
            onSessionListRefresh?.();

            // 失败轮拉取结构化错误详情（同 run 只拉一次，供 RunErrorItem 渲染）。
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
                  // ql-20260831-004：error_detail（模型层）为空的系统级失败（撞闸/
                  // inject 过期）兜 failure_summary + error_code 映射（normalize）。
                  const item =
                    buildErrorLogItem(matched?.error_detail ?? null) ??
                    buildSystemFailureItem(
                      matched?.error_code ?? null,
                      matched?.failure_summary ?? null,
                    );
                  if (!item) return;
                  setTurnState((prev) => ({
                    ...prev,
                    turns: prev.turns.map((t) =>
                      t.runId === failedRunId && !t.errorDetail
                        ? { ...t, errorDetail: item }
                        : t,
                    ),
                  }));
                } catch {
                  /* 拉取失败不阻塞：失败 turn 仍有状态徽标 */
                }
              })();
            }
          },
          onTokens: (env) => {
            setTurnState((prev) =>
              upsertTurn(
                prev,
                env,
                (turn) => ({
                  ...turn,
                  inputTokens: env.input_tokens ?? turn.inputTokens,
                  outputTokens: env.output_tokens ?? turn.outputTokens,
                  // task-08（FR-01）：ctx 是 last-write-wins 瞬时量，null/缺省
                  // （旧 daemon）不覆盖已收值，保持环未知态语义。
                  ctxTokens: env.ctx_tokens ?? turn.ctxTokens,
                }),
                {},
              ),
            );
          },
          onSessionEnded: () => {
            // streamSession 内部已 close；收口本地态 + 刷新详情/列表。
            setTurnState((prev) => ({ ...prev, currentRunId: null }));
            setPendingRequests([]);
            setPlanPending(null);
            setBashProgress(null);
            setAgentTasks([]);
            streamRef.current = null;
            void qc.invalidateQueries({ queryKey: ["agentSessionDetail", sessionId] });
            onSessionListRefresh?.();
          },
          onError: () => {
            // 不伪造终态；fetch-sse 迁移后无浏览器自动重连，断线由 streamSession
            // 内建指数退避 + resync 增量回放重建连接（onError 仅记录，见 lib/daemon.ts）。
          },
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
              prev.filter((r) => r.request_id === resolved.request_id),
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
    };

    // gap-fix：attach 并发拉 run 级轮次快照（whoLine + 历史 usage 数据源）。
    void listSessionRuns(sessionId)
      .then((runs) => {
        if (cancelled) return;
        setRunsMeta(new Map(runs.map((r) => [r.id, r])));
      })
      .catch(() => {
        /* 快照拉取失败不阻断 SSE */
      });

    // F7：runs 快照刷新（onTurnCompleted 调用）——共用本 effect 的 cancelled
    // 标志（语义同上：迟到快照丢弃，不写新会话 / 不卸载后 setState）。
    const refreshRunsMeta = (id: string) => {
      void listSessionRuns(id)
        .then((runs) => {
          if (cancelled) return;
          setRunsMeta(new Map(runs.map((r) => [r.id, r])));
        })
        .catch(() => {
          /* 快照拉取失败不阻断主流程 */
        });
    };

    void establish();

    return () => {
      cancelled = true;
      streamRef.current?.close();
      streamRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // ── quick（2026-09-02 群聊体验）：加载更早消息（before 游标 prepend）─────
  // 装配层为 turn 形态（logsToTurns run 分组）——更老日志独立装配成 turns 后
  // 头部拼接；realRunId 已在当前 turns 的轮跳过（长 run 跨游标边界时防双条，
  // 该轮更早段丢弃属可接受降级，正常轮不跨游标）。resync/增量路径零改动。
  // 触顶自动加载（quick 迭代）：原顶部按钮改滚动触发——滚动接线与 prepend
  // 滚动锚的 DOM 组装在 sessionBody 处（isToolReportBody 之后），经 ref 间接
  // 供本回调读取，避免块级声明顺序耦合。
  const bodyWrapRef = useRef<HTMLDivElement | null>(null);
  /** 主体挂载 state 镜像（稳定 callback ref 驱动，滚动监听重挂维度——内联箭头
   *  ref 每渲染换身份致 detach/attach 循环 + Maximum update depth）。 */
  const [bodyWrapMounted, setBodyWrapMounted] = useState(false);
  const bodyWrapCallbackRef = useCallback((el: HTMLDivElement | null) => {
    bodyWrapRef.current = el;
    setBodyWrapMounted(Boolean(el));
  }, []);
  const scrollElQueryRef = useRef<() => HTMLElement | null>(() => null);
  /** prepend 滚动锚：加载前 scrollHeight，加载后按增量补回视口位置。 */
  const pendingAnchorRef = useRef<number | null>(null);
  /** 同步加载锁（滚动事件高频，state 锁同 tick 内不生效）。 */
  const historyLoadingRef = useRef(false);
  /** 视口补拉连拉计数（上限防极端空渲染批量请求；换会话重置）。 */
  const autoFillCountRef = useRef(0);
  /** 会话切换纪元（ql-20260903-018）：在途「加载更早」响应携带发起时纪元，
   *  归属校验不过即丢弃——旧会话历史不得 prepend 进新会话时间线（串台）。 */
  const sessionEpochRef = useRef(0);
  /** 在途「加载更早」请求的取消器（换会话时 abort，省在途带宽）。 */
  const historyAbortRef = useRef<AbortController | null>(null);
  const handleLoadEarlierRef = useRef<() => Promise<void>>(async () => {});
  const handleLoadEarlier = useCallback(async () => {
    if (!sessionId || historyLoadingRef.current || !hasEarlier) return;
    const cursor = historyCursorRef.current;
    if (!cursor) return;
    const epochAtStart = sessionEpochRef.current;
    const abort = new AbortController();
    historyAbortRef.current = abort;
    historyLoadingRef.current = true;
    setHistoryLoading(true);
    let chainedMore = false;
    try {
      const older = await getAgentSessionLogs(sessionId, {
        before: cursor,
        limit: HISTORY_PAGE_SIZE,
        signal: abort.signal,
      });
      // 会话身份校验（ql-20260903-018）：请求在途切换会话（新会话 effect 已
      // 重置 turnState）时，旧响应直接丢弃，不 prepend 进新会话时间线。
      if (epochAtStart !== sessionEpochRef.current) return;
      // 滚动锚：记录 prepend 前 scrollHeight，加载后按增量补回（正在读的
      // 内容不被新段顶走，向上滚动自然续读更早）。
      const scrollEl = scrollElQueryRef.current();
      if (scrollEl) pendingAnchorRef.current = scrollEl.scrollHeight;
      historyCursorRef.current = older[0]?.timestamp ?? null;
      setHasEarlier(older.length >= HISTORY_PAGE_SIZE);
      chainedMore = older.length >= HISTORY_PAGE_SIZE;
      const olderTurns = logsToTurns(older);
      if (olderTurns.length > 0) {
        setTurnState((prev) => {
          // 每页伪 runId 统一加游标后缀（ql-20260903-002）：logsToTurns 每次调用
          // 的 __attach_history_N__ 都从 1 重新编号——此前只给「realRunId 已在
          // 当前窗口」的轮（同 run 跨游标）加后缀，多 run 会话更早页的**不同
          // run** 保留原伪 id，与当前窗口 1..N 同名撞 React key（列表行为未
          // 定义，触顶自动加载 + 连拉放大到多页）。后缀取全量数字游标（页首
          // 日志时间戳，微秒精度）：before 链单调递减 → 跨页唯一（秒级短码在
          // 同秒高吞吐日志下仍可能撞）。realRunId 保持原值——SSE 增量与孤儿
          // run 补建按 realRunId 匹配不受影响（upsertTurn 实时增量取最末块）。
          // 同一 run 跨页展示为多个轮块（时间序正确）；原整 turn 丢弃对单 run
          // 会话 = 永远丢弃，按钮点了没反应（ee24ba15 用户实证）。
          const pageKey = cursor.replace(/[^0-9]/g, "");
          const decorated = olderTurns.map((t) => ({
            ...t,
            runId: `${t.runId}#e${pageKey}`,
          }));
          return { ...prev, turns: [...decorated, ...prev.turns] };
        });
      }
    } catch {
      /* 翻页失败静默（含换会话主动 abort 的 AbortError；触顶自动重试；不干扰实时流）。 */
    } finally {
      if (historyAbortRef.current === abort) historyAbortRef.current = null;
      historyLoadingRef.current = false;
      setHistoryLoading(false);
      // 视口补拉链：本次满页（可能还有更早）→ DOM 提交后复查是否仍不满
      // 一屏（无滚动条 scroll 事件永不触发），不满即续拉（见 scheduleAutoFill
      // ——双 rAF 等提交 + 布局，setTimeout(0) 早于提交链断）。
      if (chainedMore) {
        chainedMore = false;
        scheduleAutoFillRef.current();
      }
    }
  }, [sessionId, hasEarlier]);
  handleLoadEarlierRef.current = handleLoadEarlier;

  /** 视口补拉（触顶补口）：内容不满视口且可能还有更早 → 自动续拉一页。
   *  守卫：容器存在且有布局高度（jsdom 无布局 scrollHeight=0 不触发）、
   *  连拉上限 AUTO_FILL_MAX（防整段历史全被空渲染吞掉的极端批量请求；
   *  换会话重置）。撑出滚动条（scrollHeight > clientHeight）即停走正常触顶。
   *  经 scheduleAutoFill 调用（等布局），不直接从数据回调调（时序见其注释）。 */
  const AUTO_FILL_MAX = 10;
  const maybeAutoFill = useCallback(() => {
    const el = scrollElQueryRef.current();
    if (!el || el.scrollHeight === 0) return;
    if (el.scrollHeight > el.clientHeight) return;
    if (autoFillCountRef.current >= AUTO_FILL_MAX) return;
    autoFillCountRef.current += 1;
    void handleLoadEarlierRef.current();
  }, []);
  const maybeAutoFillRef = useRef(maybeAutoFill);
  maybeAutoFillRef.current = maybeAutoFill;

  /** 补拉调度：双 rAF 等数据 setState 的 DOM 提交 + 布局完成；布局仍不可用
   *  （scrollHeight/clientHeight 为 0——提交竞态或容器零高）则继续 rAF 重试，
   *  至多 AUTO_FILL_LAYOUT_FRAMES 帧（~160ms）放弃（下次翻页/滚动再试）。
   *  原 setTimeout(0) 早于 React 提交，scrollHeight=0 被 maybeAutoFill 守卫
   *  拦下且无重试——补拉链断在首跳（分身会话「无滚动条不加载」实测根因）。 */
  const AUTO_FILL_LAYOUT_FRAMES = 10;
  const scheduleAutoFill = useCallback(() => {
    let frames = 0;
    const tick = () => {
      const el = scrollElQueryRef.current();
      if (el && el.scrollHeight > 0 && el.clientHeight > 0) {
        maybeAutoFillRef.current();
        return;
      }
      if (++frames < AUTO_FILL_LAYOUT_FRAMES) {
        requestAnimationFrame(tick);
      }
    };
    requestAnimationFrame(tick);
  }, []);
  const scheduleAutoFillRef = useRef(scheduleAutoFill);
  scheduleAutoFillRef.current = scheduleAutoFill;

  // ── quick（2026-09-02 触顶自动加载）：滚动接线 + prepend 滚动锚 ──
  // 捕获阶段监听 bodyWrap 内部滚动容器（native scroll 不冒泡，capture 命中
  // 全部后代；jsdom fireEvent 派发亦走捕获相位）；触顶（scrollTop ≤
  // LOAD_EARLIER_TRIGGER_PX）即触发加载更早一页——hasEarlier=false（到头）
  // 后 handleLoadEarlier 内部自挡，触顶不再发起请求。对齐 shadow-session-viewer
  // 同款模式。
  // ql-20260903-018：不再按 isToolReportBody 早退——该镜像只在渲染期更新，
  // tool_report 会话聊首句后主体切到时间线时 effect 依赖不含此翻转维度，
  // 监听永不挂载（触顶加载静默失效）。现常驻挂载：监听器自身按
  // data-testid 过滤，AgentLog 主体（无该 testid）滚动自然不触发。
  const timelineScrollEl = useCallback(
    () =>
      bodyWrapRef.current?.querySelector<HTMLElement>(
        '[data-testid="turn-timeline-scroll"]',
      ) ?? null,
    [],
  );
  useEffect(() => {
    const wrap = bodyWrapRef.current;
    if (!wrap) return;
    const onScroll = (e: Event) => {
      const el = e.target as HTMLElement | null;
      if (!el || el.getAttribute("data-testid") !== "turn-timeline-scroll") return;
      if (el.scrollTop <= LOAD_EARLIER_TRIGGER_PX) {
        void handleLoadEarlierRef.current();
      }
    };
    wrap.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () =>
      wrap.removeEventListener(
        "scroll",
        onScroll,
        { capture: true } as AddEventListenerOptions,
      );
    // 挂载维度：会话主体骨架（早退渲染）先于时间线出现——经 callback ref 的
    // state 镜像驱动主体挂载/卸载时重挂监听（sessionId 变化亦重挂）。
  }, [sessionId, bodyWrapMounted]);
  // prepend 滚动锚：turnState 变化且有待补锚时，按 scrollHeight 增量补回
  // 视口位置——正在读的内容不被新段顶走，向上滚动自然续读更早段。
  useEffect(() => {
    const anchor = pendingAnchorRef.current;
    if (anchor == null) return;
    const el = timelineScrollEl();
    pendingAnchorRef.current = null;
    if (!el) return;
    el.scrollTop += el.scrollHeight - anchor;
  }, [turnState, timelineScrollEl]);

  /** quick 会话内搜索：q 全量查询（limit=100），结果浮层展示。 */
  const handleSessionSearch = useCallback(async () => {
    const q = searchTerm.trim();
    if (!sessionId || !q || searching) return;
    setSearching(true);
    try {
      const hits = await getAgentSessionLogs(sessionId, { q, limit: 100 });
      setSearchResults(hits);
    } catch (err) {
      notify.error(err, "搜索失败，请稍后重试");
    } finally {
      setSearching(false);
    }
  }, [searchTerm, sessionId, searching, notify]);

  /** quick 搜索浮层收起 + 清空（恢复关闭态；不回滚时间线——搜索只读不侵入）。 */
  const resetSessionSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchTerm("");
    setSearchResults(null);
  }, []);

  // ── pending AskUser 对话 + 问答历史恢复（REST，SSE 只推实时增量）────────
  // task-03（R-01）：对齐 dialog 版守卫（:2129/:2157 先例）——预会话态不发起
  // fetchPendingDialogs / fetchSessionDialogHistory 恢复拉取。
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    void fetchPendingDialogs(sessionId)
      .then((dialogs) => {
        if (cancelled || !dialogs || dialogs.length === 0) return;
        setPendingRequests((prev) => {
          const existing = new Set(prev.map((r) => r.request_id));
          const merged = [...prev];
          for (const d of dialogs) {
            if (d.dialog_kind && !existing.has(d.request_id)) merged.push(d);
          }
          return merged.length === prev.length ? prev : merged;
        });
      })
      .catch(() => {
        /* 恢复失败不阻塞 SSE */
      });
    void fetchSessionDialogHistory(sessionId)
      .then((history) => {
        if (cancelled || !history) return;
        setDialogHistory(history);
      })
      .catch(() => {
        /* 历史拉取失败不阻塞主流程 */
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  // ── attach 竞态修复（ql-20260820-007）：镜像 current_run_id 供历史回灌消费 ──
  useEffect(() => {
    currentRunIdRef.current =
      session && session.status === "active"
        ? (session.current_run_id ?? null)
        : null;
  }, [session]);

  // ── attach 恢复运行中轮：detail.current_run_id 回填（SSE 只推新事件）────
  useEffect(() => {
    if (!session || session.status !== "active" || !session.current_run_id) return;
    const runId = session.current_run_id;
    setTurnState((prev) => {
      if (prev.currentRunId) return prev;
      return {
        currentRunId: runId,
        // logsToTurns 把历史 turn 一律标 completed；运行中的真实 run 修正为 running。
        turns: prev.turns.map((t) =>
          t.realRunId === runId && t.status === "completed"
            ? { ...t, status: "running" }
            : t,
        ),
      };
    });
  }, [session]);

  // ── 派生态 ─────────────────────────────────────────────────────────────
  // 找不到所属机器（列表分页外/已删除）不武断判离线（派生外提 page-helpers）。
  const { machineOnline, machineName } = deriveMachineMeta(
    machines,
    session?.runtime_id,
    session,
  );

  // ── task-03（D-101）：预会话派生（preContext → 上下文行 + 输入门控）──────
  // 与真会话的 machineHit/machineOnline 同构：runtimeId 反查所属机器与引擎；
  // 找不到机器（列表分页外/已删除）不武断判离线（既有 machineOnline 同语义）。
  const preRuntimeHit = useMemo(
    () => findPreRuntimeHit(machines, preContext?.runtimeId),
    [machines, preContext],
  );
  const preMachine = useMemo(
    () => findPreMachine(machines, preContext?.runtimeId),
    [machines, preContext],
  );
  const { preMachineName, preMachineOnline, preEngine, preAgentLabel } =
    derivePreMachineLabels(preMachine, preRuntimeHit);
  // 上下文行工作区名（与真会话 workspaceName 同源 workspacesQuery；预会话态
  // 该 query 仍启用——页面级数据，非会话作用域）。
  const preWorkspaceName = useMemo(
    () => resolvePreWorkspaceName(preContext, workspacesQuery.data),
    [preContext, workspacesQuery.data],
  );
  // 上下文行变更名（task-07 / D-106）：change 入口加显——title 回退 change_key，
  // 查询中/失败显 —（FRONTEND_PAGE_STYLE 空值统一）。
  const preChangeName = useMemo(
    () => resolvePreChangeName(preContext?.changeId, preChangeQuery.data),
    [preContext?.changeId, preChangeQuery.data],
  );
  // 上下文行快速修复名（task-11 / FR-06）：quicklog 入口加显——title 回退
  // ql_id 短码（查询中/失败均显短码，不显 —：变更行回退 change_key 的同构）。
  const preQuicklogName = useMemo(
    () => resolvePreQuicklogName(preContext?.quickId, preQuicklogQuery.data),
    [preContext?.quickId, preQuicklogQuery.data],
  );
  // 附件门控（D-6 引擎门控同构）：预会话无会话实体，按目标 runtime 引擎判定。
  // task-11（provider-abstraction）：引擎字面量门控收敛查 ProviderCaps 表
  //（multimodal 键；未知/空引擎全 false 默认拒绝，与原 !== "claude" 等价）。
  const preAttachmentsDisabled = !getProviderCaps(preEngine ?? "").multimodal;

  // task-10（design A5/A6 / 原型⑤）：suspended / task-03（design §3.3）：sessionActive
  // 派生语义见 page-helpers.deriveSessionStatusFlags（逻辑原样外提）。
  const { status, ended, restoring, suspended, sessionActive } =
    deriveSessionStatusFlags(session);
  const running = turnState.currentRunId != null;

  // ── 2026-08-20 task-12：附件门控派生（D-6 引擎 / FR-10 D-9 多模态降级）────
  const sessionEngine = session?.provider ?? null;
  // task-11（provider-abstraction）：引擎门控收敛查 ProviderCaps（multimodal 键；
  // null/未知引擎全 false 默认拒绝，与原 !== "claude" 等价）。
  const attachmentsDisabled = !getProviderCaps(sessionEngine ?? "").multimodal;
  // 会话实际生效供应商（会话绑定优先；本机默认/未选 → null = 能力未知）。
  const effectiveProvider = useMemo(
    () => findProviderById(llmProviders, session?.llm_provider_id ?? null),
    [llmProviders, session?.llm_provider_id],
  );
  const multimodalDowngraded = useMemo(
    () => isMultimodalDowngraded(effectiveProvider),
    [effectiveProvider],
  );

  // ── task-08（FR-09 / DS-5）：reconnecting 本地计时 ───────────────────────
  // 进入 restoring（pending/reconnecting）以 Date.now() 锚定起点；status 离开
  // reconnecting（active/ended/failed）即清零重置（锚点置 null + 超时态复位）。
  // 驱动方式：restoring 期间单个 setTimeout（到期翻超时态），离开/卸载即清理，
  // 不新增常驻定时器；pending→reconnecting 不重锚（effect 依赖 restoring 布尔）。
  const [reconnectTimedOut, setReconnectTimedOut] = useState(false);
  const reconnectAnchorRef = useRef<number | null>(null);
  useEffect(() => {
    if (!restoring) {
      reconnectAnchorRef.current = null;
      setReconnectTimedOut(false);
      return;
    }
    reconnectAnchorRef.current ??= Date.now();
    const remaining = Math.max(
      0,
      RECONNECT_TIMEOUT_MS - (Date.now() - reconnectAnchorRef.current),
    );
    const timer = window.setTimeout(() => setReconnectTimedOut(true), remaining);
    return () => window.clearTimeout(timer);
  }, [restoring]);
  // 显示条件：status === "reconnecting" 且本地计时 >240s（pending 不显示入口）。
  const reconnectTimedOutBanner = status === "reconnecting" && reconnectTimedOut;

  // ── gap-fix（FR-07 / FR-08）：whoLine 注入 + 历史 usage 回填（渲染时派生）──
  // agentName：AgentRun 不存 runtime 展示名，按 config_snapshot.agent_name →
  // runtime 别名/名称 → 引擎 label 链兜底；快照缺键如实显示，不编造。
  const runtimeHit = useMemo(
    () => findRuntimeHitById(machines, session?.runtime_id),
    [machines, session?.runtime_id],
  );
  const agentDisplayName = useMemo(
    () => resolveAgentDisplayName(session, runtimeHit),
    [session, runtimeHit],
  );

  // 按 run 快照补 whoLine / 历史 usage（派生体外提 page-helpers.enrichDisplayTurns，
  // 依赖数组逐项保留）：只补缺（?? 链），实时 SSE 值优先；run 快照缺失（拉取失败 /
  // 占位 turn）原样返回——whoLine 不渲染（零回归）。
  const displayTurns = useMemo(
    () =>
      enrichDisplayTurns(
        turnState.turns,
        runsMeta,
        llmProviders,
        agentDisplayName,
        session?.user_id,
      ),
    [turnState.turns, runsMeta, llmProviders, agentDisplayName, session?.user_id],
  );

  /* quick（2026-09-02 本地 Agent 会话信息折叠）：tool_report 会话激活后
   *（turn_count>0），对话流里 CLI 上报的历史轮（run spec_strategy=
   * 'platform-managed'——CLI 上报链路统一标记）不再混在对话记录里：拆为
   * localReportTurns，时间线顶部小按钮点开才展开；dialogTurns（用户交互轮）
   * 为对话流主体。非 tool_report 会话零影响。hook 置于顶层区（early-return
   * 之前）保 hook 顺序稳定。 */
  const isToolReportActivated =
    session?.origin === "tool_report" && (session?.turn_count ?? 0) > 0;
  const { dialogTurns, localReportTurns } = useMemo(
    () => splitToolReportTurns(isToolReportActivated, displayTurns, runsMeta),
    [isToolReportActivated, displayTurns, runsMeta],
  );
  const [localReportOpen, setLocalReportOpen] = useState(false);
  // CtxUsageBar：环分子（task-08 / FR-01 改口径）= displayTurns 逆序第一个非 null
  // 的 ctxTokens（最近一次模型调用提示词大小，瞬时量；SSE 实时 + runsMeta 历史回填
  // 两路写入）+ 分母派生（会话供应商 role mapping one_m → fallback model，D-014）。
  // 旧口径「Σ 各轮 inputTokens」把跨调用可加的计费量当瞬时量，环永远虚高封顶
  // （design §1.1 失真根因），已废弃；全 null（历史会话 / 旧 daemon）→ null，
  // 环渲染未知态（D-003，CtxUsageRing usedTokens 可空）。
  const ctxProvider = useMemo(
    () => findProviderById(llmProviders, session?.llm_provider_id),
    [llmProviders, session?.llm_provider_id],
  );
  const ctxRoleMapping = useMemo(
    () => resolveCtxRoleMapping(ctxProvider),
    [ctxProvider],
  );
  const ctxFallbackModel =
    ctxProvider?.default_fallback_model ?? ctxProvider?.model ?? null;
  const usedTokens = useMemo(
    () => latestCtxTokens(displayTurns),
    [displayTurns],
  );

  // ql-20260831-002：会话级窗口分母覆盖（环浮层编辑 → PATCH ctx-window →
  // 本地 detailQuery 缓存同步，免整页刷新）。null = 清除覆盖回自动链。
  const handleCtxWindowOverrideChange = useCallback(
    async (tokens: number | null) => {
      if (!sessionId) return;
      try {
        await updateSessionCtxWindow(sessionId, tokens);
        qc.setQueryData<{ ctx_window_tokens?: number | null }>(
          ["agentSessionDetail", sessionId],
          (old: { ctx_window_tokens?: number | null } | undefined) =>
            old ? { ...old, ctx_window_tokens: tokens } : old,
        );
        notify.success(tokens == null ? "已恢复默认窗口" : "窗口总量已更新");
      } catch (err) {
        notify.error(err, "窗口总量更新失败");
      }
    },
    [sessionId, qc, notify],
  );

  // ── 消息发送 + 服务端排队（ql-20260825-011 后端真实排队重写）──────────────
  // 空闲（无 currentRun）→ 占位轮直发（sendFromQueue）；忙轮 → 直接 POST
  // inject（后端落 agent_session_queued_messages 排队，run 终态后自动派发，
  // 刷新页面不丢）。队列展示/删除/重试走 useMessageQueue（GET/DELETE/retry
  // 端点），面板不再持有前端投递状态机。

  /**
   * 发送成功（直发建轮或入服务端队列）后收敛输入区：清草稿与附件 chips。
   * ql-20260825-011 改为「响应成功后才清」（原入队即清）——失败路径草稿与
   * 附件原地保留可改后重发；用户在发送窗口期新输入的内容不覆盖（仅清与
   * 所发原文相同的草稿）。ql-20260826-010：精确比对改 trim 比对——handleSend
   * 发送的是 input.trim()，粘贴多行文本带尾随换行时 prev !== prompt 永不清空，
   * 已发送消息残留在输入框并被草稿持久化放大（切换会话/刷新回显）。
   * ql-20260901-002：/team 轮发的是原始输入（与草稿同文），t === prompt 直接
   * 对上；parseTeamCommand 比对保留兼容（旧版本发送剥前缀文本的语义残渣，
   * 对上即清无副作用）。
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
    // task-05（FR-06）：发送成功清空 @ 联想选中（与 clearAttachments 同时机；
    // 绑定已随本次请求上送，残留会错绑到下一条消息）。
    setPendingMentions({});
  }, []);

  /**
   * 空闲路径直发（占位轮 + injectSession）。
   * 关键时序（design §3.4「inject 成功 → currentRunId = run_id」）：进入本函数
   * 即同步置占位 currentRunId（placeholder id），inject 响应到达后替换为真实
   * run_id——两步都在 resolve 之前完成。若等 SSE turn_started 才置位，发送
   * 窗口期把下一条也发出，同一 turn 连发两条破坏串行。
   * ql-20260825-011：响应 queued=true（发送瞬间上一轮尚未终结的竞态）→ 撤
   * 占位轮 + 刷队列（消息转服务端排队条目）；发送中被打断（interruptDuringSend
   * 置位）→ run 已创建则立即补发 interruptSession 真停（消息已回退输入框）。
   */
  const sendFromQueue = useCallback(
    async (prompt: string, attachmentIds: string[]) => {
      // task-03（R-01）：预会话态无会话可 inject——sessionActive=false 时 hook
      // 不投递，此处防御性短路（对齐 dialog 版 ?? "" + status 守卫先例）。
      if (!sessionId) return;
      const placeholderId = `__pending_inject_${Date.now()}__`;
      inflightSendRef.current = { placeholderId, prompt };
      // ql-20260821-002：占位轮合成标记行——与 handleSend 入队侧逐字同构
      // （后端落库标记行同款，真实日志到达后无感接管）；kind/name 查
      // attachmentMetaRef（D-004，入队时已登记，兜底值仅防御异常路径）。
      // ql-20260824-004：无附件时经 joinAttachmentMarkers 原样返回正文，
      // 不再拼出前导换行（气泡 whitespace-pre-wrap 渲染出文字上方空行）。
      const markerLines = attachmentIds
        .map((id) => {
          const meta = attachmentMetaRef.current.get(id);
          return `[附件:${id}|${meta?.kind ?? "file"}|${meta?.name ?? id}]`;
        })
        .join("\n");
      const displayPrompt = joinAttachmentMarkers(markerLines, prompt);
      setTurnState((prev) => ({
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
            // task-09（FR-02）：live 计时锚点 = 本地发送占位时刻（空段数组 =
            // 状态条/思考占位立即生效，SSE run_id 到达后原位接管不重计）。
            segments: [],
            turnStartedAt: Date.now(),
          },
        ],
      }));
      try {
        const resp = await injectSession(sessionId, prompt, {
          // 2026-08-20 task-12：附件引用（空数组不进 body，保持既有 payload 形态）。
          ...(attachmentIds.length > 0 ? { attachment_ids: attachmentIds } : {}),
          // ql-20260825-004：每轮注入携带当前页面上下文（有值才带，零回归）。
          ...(pageContextOverride ? { page_context: pageContextOverride } : {}),
          // task-05（FR-06 / D-003）：@ 联想绑定字段（有值才带，缺省零变化）。
          ...mentionBindOptions(pendingMentions),
        });
        if (inflightSendRef.current?.placeholderId !== placeholderId) {
          // 发送窗口期被「打断本轮」回退：占位轮已移除、消息已回输入框。
          // run 已创建 → 立即补发打断真停（run 未建/已完则 409 忽略）。
          if (resp.run_id) {
            try {
              await interruptSession(sessionId);
            } catch {
              /* NO_CURRENT_RUN：run 已完结，无需处理 */
            }
          }
          return;
        }
        if (resp.queued) {
          // 竞态入队：上一轮尚未终结 → 撤占位轮，消息转服务端排队条目。
          setTurnState((prev) => ({
            currentRunId: null,
            turns: prev.turns.filter((t) => t.runId !== placeholderId),
          }));
          setErrorMsg(null);
          void qc.invalidateQueries({ queryKey: ["agentSessionQueue", sessionId] });
          onSendSettled(prompt, attachmentIds);
          return;
        }
        setTurnState((prev) => ({
          currentRunId: resp.run_id,
          turns: prev.turns.map((t) =>
            t.runId === placeholderId
              ? { ...t, runId: resp.run_id!, status: "running" }
              : t,
          ),
        }));
        setErrorMsg(null);
        onSendSettled(prompt, attachmentIds);
      } catch (err) {
        const apiErr = err as ApiError;
        if (inflightSendRef.current?.placeholderId === placeholderId) {
          setTurnState((prev) => ({
            currentRunId: null,
            turns: prev.turns.filter((t) => t.runId !== placeholderId),
          }));
          setErrorMsg(errMessage(apiErr, "发送失败"));
        }
      } finally {
        if (inflightSendRef.current?.placeholderId === placeholderId) {
          inflightSendRef.current = null;
        }
      }
    },
    [sessionId, pageContextOverride, pendingMentions, qc, onSendSettled],
  );

  /**
   * 忙轮路径（ql-20260825-011）：直接 POST inject——后端忙轮自动入服务端排队。
   * 不插占位轮（派发由后端在 run 终态后自动触发，SSE turn_started 自然建轮）。
   * 失败（满员 409 / 离线）：errorMsg 提示，草稿与附件保留在输入框可改后重发。
   */
  const sendToServerQueue = useCallback(
    async (prompt: string, attachmentIds: string[]) => {
      if (!sessionId) return;
      try {
        const resp = await injectSession(sessionId, prompt, {
          ...(attachmentIds.length > 0 ? { attachment_ids: attachmentIds } : {}),
          ...(pageContextOverride ? { page_context: pageContextOverride } : {}),
          // task-05（FR-06 / D-003）：忙轮排队路径同样带绑定字段（后端 binder
          // 插入点在排队早退分支之前，design §4.2——漏带则该场景静默失效）。
          ...mentionBindOptions(pendingMentions),
        });
        setErrorMsg(null);
        void qc.invalidateQueries({ queryKey: ["agentSessionQueue", sessionId] });
        onSendSettled(prompt, attachmentIds);
        if (!resp.queued && resp.run_id) {
          // 竞态直发：发送瞬间上一轮终结 → 后端已开新 run（SSE 会建轮）。
        }
      } catch (err) {
        const apiErr = err as ApiError;
        setErrorMsg(errMessage(apiErr, "发送失败"));
      }
    },
    [sessionId, pageContextOverride, pendingMentions, qc, onSendSettled],
  );

  // 2026-08-31-session-queue-ux（task-09）：补 refresh（SSE queue_changed 即时
  // 刷新，FR-03）与三操作方法（FR-04 重排 / FR-05 立即发送 / FR-06 编辑）——
  // MessageQueueBar 三回调直接透传，API 失败静默已由 hook 内 catch 承担。
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
    // task-03（R-01）：预会话态不发队列查询（enabled 守卫）。
    sessionId: sessionId ?? "",
    sessionActive,
  });

  // ── 操作 ───────────────────────────────────────────────────────────────
  // task-11：团队弹层开关（打开时清旧错误；objective 预填 /team 指令文本）。
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

  // ── task-07 Phase 5（FR-06 / D-004@v2）：autoTeamOpen 一次性通道 ──────────
  // PPM 项目页「发起团队」→ 宿主把 store.autoTeamIntent 经 autoTeamOpen prop 在
  // 预会话挂载拍送达（下一拍即复位）——按挂载初值快照消费，ref 保证只消费一次
  //（用户关弹层/prop 翻转均不重复触发）。ppm_project 上下文：getProject 解析
  // 项目名预填「分析项目 X 当前迭代风险并给出建议」（弹层内可修改）；解析失败/
  // 非 ppm_project 降级空目标，弹层照开（仅预会话——真会话不自动开弹层）。
  const autoTeamAtMountRef = useRef(autoTeamOpen === true);
  const autoTeamConsumedRef = useRef(false);
  useEffect(() => {
    if (sessionId || !autoTeamAtMountRef.current || autoTeamConsumedRef.current) {
      return;
    }
    autoTeamConsumedRef.current = true;
    const ctx = preContext?.pageContext;
    if (ctx?.page_key !== "ppm_project") {
      openTeamPopover(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      let objective: string | null = null;
      try {
        const project = await getProject(ctx.project_id);
        const name = project.project_name?.trim() || project.project_code || "";
        if (name) objective = `分析项目 ${name} 当前迭代风险并给出建议`;
      } catch {
        // 项目名解析失败 → 空目标降级（弹层照开，目标可手填）。
      }
      if (!cancelled) openTeamPopover(objective);
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, preContext, openTeamPopover]);

  /**
   * task-11：弹层确认 → POST /sessions/{id}/team-mission 预建（triggerSessionTeamMission）。
   * 成功：关弹层 + 刷新 mission 列表（TeamTaskBlock/chip 即时呈现）+ objective
   * 回填输入框（「就绪，随下条消息发出」——CC-09 首条 inject 回填 mission objective）。
   * 失败：弹层保持打开，行内中文文案提示（409 活跃冲突/403 项目权限/422 参数）。
   * ql-20260826-010：回填文本前置 /team 指令——裸 objective 纯文本发给 agent 时
   * 常被当普通聊天回复不派发分身；/team 前缀让主控轮明确收到团队指令语义。
   * 刷新 mission 在回填前 await——回填时 activeTeamMission 已就位，紧接发送
   * 不会被 /team 拦截重开弹层（拦截放行见 handleSend）。
   */
  const handleTeamTrigger = useCallback(
    async (payload: TeamMissionTriggerRequest) => {
      // task-03（R-01）：预会话态无会话可挂 mission（team 行为会话绑定）。
      if (!sessionId) return;
      setTeamTriggering(true);
      setTeamError(null);
      try {
        // ql-20260828-009-4a13：更新指派语义——已有活跃 mission 时先取消再派
        //（chip 点击进来的「重新指派」；直发场景旧 mission 终态自然跳过）。
        const activeId = teamMissions.find((m) =>
          isActiveTeamMission(m.status),
        )?.mission_id;
        if (activeId) await cancelTeamMission(activeId);
        await triggerSessionTeamMission(sessionId, payload);
        closeTeamPopover();
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
    [sessionId, teamMissions, refreshTeamMissions, closeTeamPopover],
  );

  /**
   * ql-20260828-009-4a13：chip × 真取消——cancelTeamMission(活跃 mission) 后
   * 刷新列表（chip 消失、TeamTaskBlock 状态收敛 cancelled）；失败行内回显。
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
   * task-13（FR-05/D-010@v1）：预会话弹层确认——**不走** handleTeamTrigger
   *（无 sessionId 可挂 mission，triggerSessionTeamMission 不可用）：payload
   * 暂存 state（含主 agent 选择器落定的 orchestrator_workspace_id——task-12
   * 弹层组件内类型交集运行时携带，弹层 onTrigger prop 仍窄化为
   * TeamMissionTriggerRequest，此处按 lib 侧 create 块类型断言还原；task-14
   * gen:types 后 SessionCreateTeamMission 已收敛为生成版
   * TeamMissionCreateBlock，断言精确 → 宽松结构安全）+ 关弹层 + objective
   * 回填输入框（非空时），等首句随 create 上送（handlePreSessionSend）。
   * ql-20260826-010：回填前置 /team 指令（同 handleTeamTrigger——首句带团队
   * 指令语义，预会话无拦截回路，直接随 create 上送）。
   */
  const handlePreTeamTrigger = useCallback(
    (payload: TeamMissionTriggerRequest) => {
      setPreTeamMission(payload as SessionCreateTeamMission);
      setInput(
        payload.objective ? `/team ${payload.objective.trim()}` : "/team",
      );
      closeTeamPopover();
    },
    [closeTeamPopover],
  );

  /**
   * task-03（D-102）：预会话首句创建——发送动作触发 createSession（后端 prompt
   * 首句约束由发送满足，零协议改动）。复用 dialog idle 先例（:2359-2421）但两处
   * 改造（Grill X-02）：① 传 runtime_id（机器+引擎已定）而非 dialog 的 provider；
   * ② 成功后才清空输入（dialog 现状先清后建、失败输入即丢）——失败保留输入 +
   * 内联错误可重试（R-02），不切真会话态。成功经 onPreSessionCreated 上报父层
   * （父层切 sessionId → 本组件状态机自然接管，门户接线归 task-06）。
   * ql-20260825-001：首句附件随 create 上送（后端补 attachment_ids 契约——标记
   * 行回显/session_id 回填/SESSION_INJECT attachments 均在后端 create 路径）；
   * 附件非空允许空 prompt（D-7 看图说话对齐）。失败保留附件可重试（R-02 同义）。
   */
  const handlePreSessionSend = useCallback(
    async (prompt: string, attachmentIds: string[]) => {
      if (!preContext || preCreating) return;
      setPreCreating(true);
      setPreError(null);
      // task-05（FR-05）：@ 联想选中与入口锁定上下文合并——同字段单值，@ 选中
      // （用户显式最新选择，组件内「同类型后选覆盖先选」语义的延伸）优先，
      // preContext（change/quicklog 入口 X-13 契约）兜底；缺省回落既有语义。
      const createChangeId = pendingMentions.change?.id ?? preContext.changeId ?? null;
      const createQuickId = pendingMentions.quick?.ql_id ?? preContext.quickId ?? null;
      // task-06（FR-02）：PPM 同语义合并——@ 选中 ppmItem 优先、preContext.ppmItem
      // （task-05 入口锁定通道）兜底，成对单值上送。
      const createPpmItem = pendingMentions.ppmItem ?? preContext.ppmItem ?? null;
      try {
        const resp = await createSession({
          runtime_id: preContext.runtimeId,
          prompt,
          manual_approval: true,
          ask_user_only: true,
          ...(preContext.workspaceId
            ? { workspace_id: preContext.workspaceId }
            : {}),
          ...(createChangeId ? { change_id: createChangeId } : {}),
          // task-11（2026-08-25-session-spec-binding / FR-06）：quicklog 入口
          // quickId 随首句上送 quicklog_id（对齐 change_id 展开形态；后端创建
          // 即落 quicklog_session_links 绑定，缺省不进请求体零回归）。
          ...(createQuickId ? { quicklog_id: createQuickId } : {}),
          // task-05（2026-08-28-session-ppm-task-binding / FR-04）+ task-06（@ 联想
          // 合并）：PPM 任务/问题 kind+id 成对上送（与 change_id/quicklog_id 并列；
          // 后端创建即落 ppm_item_session_links 绑定 + 注入【PPM 任务/问题上下文】
          // 前导，缺省不进请求体零回归）。
          ...(createPpmItem
            ? {
                ppm_item_kind: createPpmItem.kind,
                ppm_item_id: createPpmItem.id,
              }
            : {}),
          // ql-20260823-008：预会话配置条暂存值随首句落为会话初始配置。
          ...(preProviderId ? { llm_provider_id: preProviderId } : {}),
          ...(preProfileId ? { agent_profile_id: preProfileId } : {}),
          // D-002@v1：预会话级联模型随首句携带（""=跟随供应商配置不传）。
          ...(preModelId ? { model: preModelId } : {}),
          // task-13（FR-05/D-009@v2）：弹层确认暂存的团队 payload 随首句上送
          //（有值才带；后端 create 路径预建 mission，objective 空时以首句回填）。
          ...(preTeamMission ? { team_mission: preTeamMission } : {}),
          // 2026-08-25-unified-floating-session task-06（FR-5/D-006）：悬浮入口
          // 页面上下文随首句上送（有值才带；后端服务端回查注入前导，缺省零回归）。
          ...(preContext.pageContext
            ? { page_context: preContext.pageContext }
            : {}),
          // ql-20260825-001：首句附件（有值才带）。
          ...(attachmentIds.length > 0 ? { attachment_ids: attachmentIds } : {}),
        });
        // R-02：成功才清空（失败路径输入保留在 catch 之外，可原地重试——
        // 暂存 team payload 同语义：失败保留，重试仍携带）。
        setInput("");
        setPendingAttachments([]);
        clearAttachmentsRef.current?.();
        // task-13：成功清空暂存（mission 已随 create 预建，再发不重复上送）。
        setPreTeamMission(null);
        // task-05（FR-05）：成功清空 @ 联想选中（绑定已随首句上送；失败保留
        // 可随原地重试再携带，与输入/附件 R-02 语义一致）。
        setPendingMentions({});
        onPreSessionCreated?.(resp);
      } catch (err) {
        setPreError(errMessage(err, "创建会话失败，请重试"));
      } finally {
        setPreCreating(false);
      }
    },
    [
      preContext,
      preCreating,
      pendingMentions,
      onPreSessionCreated,
      preProviderId,
      preProfileId,
      preModelId,
      preTeamMission,
    ],
  );

  // task-03（design §3.3 状态机）：发送 = 统一 enqueue。active 且无 currentRun
  // 时 hook 立即投递（行为等效原直发）；running / reconnecting / pending 时排队，
  // 由 hook 在 turn_completed / status→active 后自动投递。原直发路径（restoring/
  // running 禁发守卫 + 409 回填输入）删除——失败语义改由 D-003 队头 failed +
  // 重试/删除承载。
  const handleSend = useCallback(() => {
    const prompt = input.trim();
    // 2026-08-20 task-12（D-7）：附件非空允许空文本（看图说话）；纯文本仍守卫。
    // ql-20260825-007：D-7 对齐——附件非空豁免空文本（看图说话）；纯文本仍要求非空。
    // 空文本静默（发送按钮本已禁用）；超长/队满 toast 明示（ql-20260903-014：
    // 旧版一律静默 return，按钮亮着却毫无反应，用户以为软件坏了）。
    if (!prompt && pendingAttachments.length === 0) return;
    if (prompt.length > MAX_PROMPT_LEN) {
      notify.warning(
        `单条消息最长 ${MAX_PROMPT_LEN} 字（当前 ${prompt.length} 字），请精简后再发送`,
      );
      return;
    }
    const teamCmd = parseTeamCommand(prompt);
    const hasActiveMission = teamMissions.some((m) => isActiveTeamMission(m.status));
    // task-03（D-102）：预会话首句 → createSession 直发（不走队列——无既有
    // session 可附着，R2 先例）。
    // ql-20260825-001（D-7 对齐）：附件非空允许空 prompt（看图说话）；首句
    // 附件随 create 上送（此前被静默丢弃——回显缺失的根因）。
    // ql-20260901-002：/team 前缀不再剥离——发原始输入（消息气泡/回放显示
    // "/team 目标"，对齐 /sillyspec:quick 等技能指令的显示形态）；裸 /team
    // 无可发内容不发送。派发层剥离归后端（service._strip_team_command_prefix）。
    if (!sessionId) {
      // 裸 /team（无目标文本）无可发内容不发送；带附件可发（D-7 看图说话，
      // 后端剥离后空文本+附件走附件豁免轮）。
      if ((!prompt || teamCmd === "") && pendingAttachments.length === 0) return;
      void handlePreSessionSend(prompt, pendingAttachments.map((a) => a.id));
      return;
    }
    // task-11（D-004 四路等价）：/team 前缀拦截——不直接发送，弹层确认后目标文本
    // 随下条消息发出（objective 预填去前缀文本）。仅 Claude 会话且可发消息时拦截。
    // ql-20260826-010：已有活跃 mission（弹层确认预建/R-07 单活跃）时放行直发——
    // 确认后回填的 /team 指令若再被拦截会陷入「弹层⇄回填」死循环，且该轮本就
    // 该走主控轮 briefing 注入派发分身。
    // provider-abstraction task-11：引擎门控收敛查 ProviderCaps（subagent 键，
    // 团队派工能力；null/未知引擎 false 不拦截，与原 === "claude" 等价）。
    if (
      teamCmd !== null &&
      !hasActiveMission &&
      getProviderCaps(sessionEngine ?? "").subagent &&
      !ended &&
      machineOnline
    ) {
      openTeamPopover(teamCmd || null);
      setInput("");
      // task-05：拦截清空输入的同点位清空 @ 联想选中（拦截不发送，残留选中
      // 会错绑到下一条消息；/team 拦截语义本身零改动）。
      setPendingMentions({});
      return;
    }
    // ql-20260901-002：/team 是平台 UI 指令，agent 永不接收其字面前缀——但
    // 剥离收口到**后端派发层**（service._strip_team_command_prefix，create
    // dispatch_prompt / inject SESSION_INJECT 组装点）：前端发原始输入，消息
    // 气泡与历史回放显示 "/team 目标"（对齐 /sillyspec:quick 等技能指令的显示
    // 形态，ql-20260826-013 前端剥离导致气泡丢前缀）。拦截弹层语义零改动；
    // 裸 /team 无可发内容不发送（同预会话守卫）。
    if ((!prompt || teamCmd === "") && pendingAttachments.length === 0) return;
    // design §3.3：仅终态（ended/failed）与离线禁发；running / reconnecting /
    // pending 不再拦截（忙轮入服务端排队，ql-20260825-011）。
    // task-10：suspended 挂起禁发（daemon 不在线，发也必失败；输入框本已禁用，
    // 此处为发送路径防御性兜底）。
    if (!session || ended || suspended || !machineOnline) return;
    if (isQueueFull) {
      // D-002 满员拒收：草稿与附件保留。placeholder 提示打字即不可见，改 toast 明示。
      notify.warning(
        `排队消息已达上限（${QUEUE_MAX_PENDING} 条），请等待派发或先删除排队消息`,
      );
      return;
    }
    const attachmentIds = pendingAttachments.map((a) => a.id);
    // D-004：登记附件元数据（投递只携带 ids）——先登记再发送，保证占位轮可查。
    for (const a of pendingAttachments) {
      attachmentMetaRef.current.set(a.id, { kind: a.kind, name: a.name });
    }
    // ql-20260825-011：忙轮 → 服务端排队（无占位轮，后端 run 终态后派发）；
    // 空闲 → 占位轮直发。草稿与附件改为发送成功后清（onSendSettled）。
    if (running) {
      void sendToServerQueue(prompt, attachmentIds);
      return;
    }
    void sendFromQueue(prompt, attachmentIds);
  }, [input, sessionId, session, ended, suspended, machineOnline, running, isQueueFull, pendingAttachments, notify, sendToServerQueue, sendFromQueue, sessionEngine, openTeamPopover, handlePreSessionSend, teamMissions]);

  const handleInterrupt = useCallback(async () => {
    // task-03（R-01）：预会话态无可打断轮（按钮本就禁用，防御性短路）。
    if (!sessionId || !session || session.status !== "active" || !turnState.currentRunId) return;
    const localRunId = turnState.currentRunId;
    // ql-20260825-011：发送中（inject 在途，占位 id）打断——消息回退输入框；
    // 请求不 abort（后端可能已建 run），响应到达后由 sendFromQueue 对真实
    // run 补发 interruptSession 真停（见其 inflight 不匹配分支）。
    if (localRunId.startsWith("__pending_inject_")) {
      const inflight = inflightSendRef.current;
      if (inflight && inflight.placeholderId === localRunId) {
        inflightSendRef.current = null; // 标记已打断（响应侧据此走补发打断分支）
        setTurnState((prev) => ({
          ...prev,
          currentRunId: null,
          turns: prev.turns.filter((t) => t.runId !== localRunId),
        }));
        // 回退消息：不覆盖用户在发送窗口期新输入的内容。
        setInput((prev) => (prev === "" ? inflight.prompt : prev));
      }
      return;
    }
    setTurnState((prev) => ({
      ...prev,
      turns: prev.turns.map((t) =>
        t.runId === localRunId ? { ...t, status: "interrupting" } : t,
      ),
    }));
    try {
      await interruptSession(sessionId);
      // turn 终态由 SSE turn_completed 决定；session 仍 active。
    } catch (err) {
      const apiErr = err as ApiError;
      const isNoCurrentRun =
        apiErr instanceof ApiError &&
        apiErr.status === 409 &&
        apiErr.code === "DAEMON_SESSION_NO_CURRENT_RUN";
      if (isNoCurrentRun) {
        setTurnState((prev) => ({
          currentRunId: null,
          turns: prev.turns.map((t) =>
            t.runId === localRunId && (t.status === "interrupting" || t.status === "running")
              ? { ...t, status: "killed" }
              : t,
          ),
        }));
      } else {
        setTurnState((prev) => ({
          ...prev,
          turns: prev.turns.map((t) =>
            t.runId === localRunId && t.status === "interrupting"
              ? { ...t, status: "running" }
              : t,
          ),
        }));
        setErrorMsg(errMessage(apiErr, "打断失败"));
      }
    }
  }, [session, turnState.currentRunId, sessionId]);

  const handleReopen = useCallback(async () => {
    // task-03（R-01）：预会话态无会话可重开（入口本就不渲染，防御性短路）。
    if (!sessionId) return;
    setReopening(true);
    try {
      await reopenSession(sessionId);
      await qc.invalidateQueries({ queryKey: ["agentSessionDetail", sessionId] });
      onSessionListRefresh?.();
    } catch (err) {
      // task-08（FR-09）：reopen 409 先查本组件中文映射表，命中不透传后端英文
      // 原文（notify.error 传 Error 才会被 errMessage 取出 message）。
      const apiErr = err as ApiError;
      const zh =
        apiErr instanceof ApiError ? REOPEN_ERROR_ZH[apiErr.code] : undefined;
      if (zh) {
        notify.error(new Error(zh));
      } else {
        notify.error(err, "重新开启失败");
      }
    } finally {
      setReopening(false);
    }
  }, [sessionId, qc, onSessionListRefresh, notify]);

  const handleResend = useCallback(
    async (prompt: string) => {
      // task-03（R-01）：预会话态无失败轮可重发（防御性短路）。
      if (!sessionId || !session || session.status !== "active") return;
      if (!machineOnline || turnState.currentRunId) return;
      // ql-20260821-002：占位轮/历史轮 prompt 含附件标记行——重发前剥离
      // （附件不随重发复活，仅回填原文）。
      const trimmed = parseAttachmentMarkers(prompt).text.trim();
      if (!trimmed || trimmed.length > MAX_PROMPT_LEN) return;
      const placeholderId = `__pending_inject_${Date.now()}__`;
      setTurnState((prev) => ({
        currentRunId: placeholderId,
        turns: [
          ...prev.turns,
          {
            runId: placeholderId,
            turn: null,
            prompt: trimmed,
            output: "",
            status: "pending",
            seenLogIds: new Set(),
            inputTokens: null,
            outputTokens: null,
            ctxTokens: null,
            errorDetail: null,
            processItems: [],
            // task-09（FR-02）：同 handleSend——live 锚点 = 本地重发占位时刻。
            segments: [],
            turnStartedAt: Date.now(),
          },
        ],
      }));
      try {
        // task-05（R-7 取舍）：重发不携带 mentions——@ 文本保留在重发原文中
        // 仅作提示，绑定需用户重新选择（草稿恢复同语义，design §3.4）。
        const resp = await injectSession(sessionId, trimmed);
        const runId = resp.run_id;
        if (resp.queued || !runId) {
          // ql-20260825-011：重发瞬间已被占用（竞态）→ 撤占位轮转服务端排队。
          setTurnState((prev) => ({
            currentRunId: null,
            turns: prev.turns.filter((t) => t.runId !== placeholderId),
          }));
          setErrorMsg(null);
          void qc.invalidateQueries({ queryKey: ["agentSessionQueue", sessionId] });
          return;
        }
        setTurnState((prev) => ({
          currentRunId: runId,
          turns: prev.turns.map((t) =>
            t.runId === placeholderId
              ? { ...t, runId: runId, status: "running" }
              : t,
          ),
        }));
        setErrorMsg(null);
      } catch (err) {
        const apiErr = err as ApiError;
        setTurnState((prev) => ({
          currentRunId: null,
          turns: prev.turns.filter((t) => t.runId !== placeholderId),
        }));
        setErrorMsg(errMessage(apiErr, "重新发送失败"));
      }
    },
    [session, machineOnline, turnState.currentRunId, sessionId],
  );

  // ql-20260903-026：行级 memo props 稳定化——内联箭头每次渲染新引用会击穿
  // TurnTimeline 内 TurnRow 的 memo（流式 delta 期间父树每次重渲染）。
  const timelineOnResend = useCallback(
    (prompt: string) => {
      void handleResend(prompt);
    },
    [handleResend],
  );
  // ql-20260904-010：错误卡「切换供应商」不再整页跳 /settings——会话页底部本就有
  // 「只影响本会话」的供应商配置条（SessionConfigBar），改为定位它并打开供应商
  // 下拉（signal 递增触发）。ref 用于视口外时滚入视野（面板底部常驻可见，
  // scrollIntoView nearest 为无害兜底）。会话已结束/机器离线/引擎锁定时配置条
  // 无法切换，给出事实性提示而非点击无响应。
  const configBarWrapRef = useRef<HTMLDivElement>(null);
  const [configProviderSignal, setConfigProviderSignal] = useState(0);
  const timelineOnSwitchProvider = useCallback(() => {
    if (ended || !machineOnline) {
      notify.warning("会话已结束或机器离线，无法切换供应商");
      return;
    }
    if (session?.provider && session.provider !== "claude") {
      notify.warning("当前引擎不支持会话级供应商切换");
      return;
    }
    setConfigProviderSignal((v) => v + 1);
    configBarWrapRef.current?.scrollIntoView({
      block: "nearest",
      behavior: "smooth",
    });
    // deps 取原始值（布尔/字符串）：session 轮询换引用不重建回调（TurnRow memo
    // props 稳定，ql-20260903-026）。
  }, [ended, machineOnline, session?.provider, notify]);

  const handleDialogResolved = useCallback((requestId: string) => {
    setPendingRequests((prev) => prev.filter((r) => r.request_id !== requestId));
  }, []);

  // ── task-09（FR-04）：子代理目录跳转定位（原型 jumpTo 的面板侧实现）────────
  // 三动作：切「进度」视图（子代理块只在 all 视图渲染）→ 展开对应子代理块 →
  // scrollIntoView 居中。SubagentBlockView（task-05）未暴露 data-segment-id DOM
  // 锚点且不在本卡允许路径——采用最小侵入方案：双 rAF 等「进度」视图段线提交后，
  // 在面板根内按子代理块容器类名（rounded-[10px] + indigo 系）圈定候选，头部
  // 名称归一匹配（规则镜像 SubagentBlockView 名称派生；目录侧 120 字截断按前缀
  // 容忍）。命中：折叠块模拟点击头部展开 + 滚动居中；未命中只完成视图切换不报错。
  const handleJumpToSubagent = useCallback(
    (segmentId: string) => {
      setViewMode("all");
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const root = panelRef.current;
          if (!root) return;
          let expected: string | null = null;
          for (const t of displayTurns) {
            const seg = findSegmentById(t.segments, segmentId);
            if (seg) {
              expected = subagentBlockNameOf(seg);
              break;
            }
          }
          if (!expected) return;
          const norm = (s: string) => s.replace(/\s+/g, " ").trim();
          const want = norm(expected);
          const blocks = Array.from(root.querySelectorAll<HTMLElement>("div")).filter(
            (el) =>
              el.classList.contains("rounded-[10px]") &&
              el.classList.contains("border-indigo-200") &&
              el.classList.contains("bg-indigo-50"),
          );
          for (const block of blocks) {
            const nameEl = block.querySelector<HTMLElement>(".truncate.font-semibold");
            if (!nameEl) continue;
            const got = norm(nameEl.textContent ?? "");
            const nameHit =
              got === want || (want.length >= 120 && got.startsWith(want));
            if (!nameHit) continue;
            // 展开折叠块：子代理块首子元素即头部（运行中默认展开，无 aria-expanded=false）。
            const header = block.firstElementChild;
            if (
              header instanceof HTMLElement &&
              header.getAttribute("aria-expanded") === "false"
            ) {
              header.click();
            }
            if (typeof block.scrollIntoView === "function") {
              block.scrollIntoView({ behavior: "smooth", block: "center" });
            }
            return;
          }
        });
      });
    },
    [displayTurns],
  );

  // ── 渲染 ───────────────────────────────────────────────────────────────
  // task-03（D-101）：预会话空态——与真会话同构（同面板头 / 时间线容器 / 输入
  // 区结构，用户硬约束"不要独立页面"），仅内容空 + 多锁定上下文行（原型
  // startPre：.ctx-line + .empty-hint）。会话作用域查询/effect 已在上方逐项
  // null 守卫（R-01：detailQuery 轮询 / SSE 建流 / dialogs 恢复 / 队列投递 /
  // team missions）；配置条与团队触发行同构挂载（团队行 task-13 解禁，随首句
  // 创建生效）。
  if (!sessionId) {
    // task-14（FR-08 辅半）：纯空文本禁点不在本条件追加——空内容判断收口在共享
    // SessionInputBar 发送按钮（!value.trim() 且无附件，D-7 附件例外维持）+
    // handleSend 双守卫；本 disabled 同时禁 textarea，并入 trim 判断会在空输入
    // 时锁死输入框无法打字。
    const { preSendingDisabled, prePlaceholder, preTeamButtonDisabled, preTeamButtonTitle } =
      derivePreSessionChrome({
        preContext,
        preMachineOnline,
        sessionWorkspaceArchived,
        preEngine,
      });
    // task-07 Phase 5（FR-06 / D-004@v2）：ppm_project 页面上下文 → 弹层项目
    // 预选 id（「发起团队」入口自动开弹层时项目/工作区随上下文预选）。
    const pageProjectId = resolvePageProjectId(preContext);
    return (
      <section
        ref={panelRef}
        className={mobile ? PANEL_ROOT_CLS_MOBILE : PANEL_ROOT_CLS_DESKTOP}
        aria-label="会话面板"
        data-variant={variant}
        data-testid="session-pre-session-panel"
      >
        {/* 面板头（同构）：新会话标题 + 机器/工作区 chips + 打断按钮（禁用）。 */}
        <header
          className={mobile ? PANEL_HEADER_CLS_MOBILE : PANEL_HEADER_CLS_DESKTOP}
        >
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-semibold text-foreground">
              新会话
            </span>
            {preMachineName && (
              <span className="hidden shrink-0 items-center gap-1 rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[11px] text-muted-foreground sm:inline-flex">
                <Monitor aria-hidden className="h-3 w-3" />
                {preMachineName}
              </span>
            )}
            {preWorkspaceName && (
              <span className="hidden shrink-0 items-center gap-1 rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[11px] text-muted-foreground sm:inline-flex">
                <FolderOpen aria-hidden className="h-3 w-3" />
                {preWorkspaceName}
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {/* task-09：子代理目录（空 turns 返回 null，同构占位）。 */}
            <SubagentCatalog turns={[]} onJumpTo={handleJumpToSubagent} />
            <Button
              size="small"
              icon={<Ban className="h-3 w-3" />}
              disabled
              title="发送第一句话创建会话后可用"
            >
              打断本轮
            </Button>
          </div>
        </header>

        {/* 锁定上下文行（D-104 完全只读：纯文本 span，无任何可交互元素）。
            图标统一 lucide 线性（2026-08-23-sessions-page-style：🧩→Puzzle /
            📂→FolderOpen / 🖥→Monitor / ⚡→Bot / 🔒→Lock）。 */}
        <div
          data-testid="pre-session-context"
          aria-label="预会话上下文（已锁定）"
          className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-border bg-muted/30 px-4 py-2 text-xs text-muted-foreground"
        >
          {preContext?.changeId && (
            <span className="inline-flex items-center gap-1">
              <Puzzle aria-hidden className="h-3 w-3" />
              {preChangeName ?? "—"}
            </span>
          )}
          {/* task-11（FR-06）：快速修复锁定行——展示形态对齐变更行（⚡→Zap）。 */}
          {preContext?.quickId && (
            <span className="inline-flex items-center gap-1">
              <Zap aria-hidden className="h-3 w-3" />
              {preQuicklogName ?? "—"}
            </span>
          )}
          {/* task-05（FR-04）：PPM 任务/问题锁定行——中文名 + 条目标题（入口
              行内已带，零额外请求；缺省回退 id 短码），形态对齐变更/快速修复行
              （📋→ClipboardList，纯文本 D-104）。 */}
          {preContext?.ppmItem && (
            <span
              className="inline-flex items-center gap-1"
              data-testid="pre-session-ppm-chip"
            >
              <ClipboardList aria-hidden className="h-3 w-3" />
              {preContext.ppmItem.kind === "plan_task" ? "PPM 任务" : "PPM 问题"}
              {" · "}
              {preContext.ppmItem.title?.trim() ||
                `#${preContext.ppmItem.id.slice(0, 8)}`}
            </span>
          )}
          {/* task-06（FR-02）：@ 联想选中的 PPM 条目 chip——「PPM 任务/问题 · 标题」
              （原型场景 2 mentions-bar），随首句 create 上送（handlePreSessionSend
              合并优先级高于上方入口锁定行）；与入口锁定同一条目时去重不重复挂。 */}
          {pendingMentions.ppmItem &&
            (pendingMentions.ppmItem.kind !== preContext?.ppmItem?.kind ||
              pendingMentions.ppmItem.id !== preContext?.ppmItem?.id) && (
              <span
                className="inline-flex items-center gap-1"
                data-testid="pre-session-mention-ppm-chip"
              >
                <ClipboardList aria-hidden className="h-3 w-3" />
                {pendingMentions.ppmItem.kind === "plan_task" ? "PPM 任务" : "PPM 问题"}
                {" · "}
                {pendingMentions.ppmItem.title?.trim() ||
                  `#${pendingMentions.ppmItem.id.slice(0, 8)}`}
              </span>
            )}
          <span className="inline-flex items-center gap-1">
            <FolderOpen aria-hidden className="h-3 w-3" />
            {preContext?.workspaceId
              ? (preWorkspaceName ?? "未命名工作区")
              : "不指定（非工作区）"}
          </span>
          <span className="inline-flex items-center gap-1">
            <Monitor aria-hidden className="h-3 w-3" />
            {preMachineName ?? "—"}
          </span>
          <span className="inline-flex items-center gap-1">
            <Bot aria-hidden className="h-3 w-3" />
            {preAgentLabel ?? "—"}
          </span>
          <span
            className="ml-auto inline-flex shrink-0 items-center gap-1"
            title="上下文已锁定，创建会话后不可更换"
          >
            <Lock aria-hidden className="h-3 w-3" />
            上下文已锁定 · 创建会话后不可更换
          </span>
        </div>

        {/* 空时间线（同构容器类名 + 原型 .empty-hint 文案）。 */}
        <div
          data-testid="turn-timeline-scroll"
          className="min-h-0 flex-1 overflow-y-auto bg-background px-5 py-5"
        >
          <div className="flex h-full min-h-[260px] flex-col items-center justify-center text-center">
            <p className="text-sm font-medium text-foreground">
              发送第一句话开始对话
            </p>
            <p className="mt-1 max-w-[260px] text-[11px] text-muted-foreground">
              第一句话发送时创建会话 · 供应商与档案可在会话内随时切换
            </p>
          </div>
        </div>

        {/* 输入区（同构）：ctx 用量行 + 完整输入（含附件，引擎门控同构 D-6）。 */}
        <div className="flex shrink-0 flex-col bg-card">
          <div className="px-5 pt-3">
            <CtxUsageBar
              usedTokens={null}
              roleMapping={null}
              fallbackModel={null}
              providerId={preProviderId || null}
            />
          </div>
          {/* task-13（FR-05/D-009@v2）：预会话团队触发行解禁——门控与真会话
              同构（claude 引擎 + 所选机器在线）；弹层确认后 payload 暂存
              （handlePreTeamTrigger，含主 agent 选择器的 orchestrator_workspace_id），
              首句 create 随 team_mission 上送（后端预建归 task-09）。
              ql-20260827-020：派团队入口移入 SessionInputBar ＋ 菜单，本行仅留
              弹层挂载（预会话无 chip/错误常态不渲染）。 */}
          <TeamTriggerRow
            activeWorkers={null}
            onCancelMission={() => {}}
            onChipClick={() => {
              // ql-20260828-012-4425：待生效 chip 点击回显暂存 payload。
              const p = preTeamMission;
              if (!p) {
                openTeamPopover(null);
                return;
              }
              const objective = p.objective?.trim() || null;
              openTeamPopover(objective, {
                objective,
                projectId: p.project_id ?? null,
                scopeWorkspaceIds: p.scope_workspace_ids ?? null,
                budgetUsd: p.budget_usd ?? null,
                // 弹层确认写入的 payload 反向回读（handlePreTeamTrigger 断言
                // 暂存），结构同源 as 收窄（SessionCreateTeamMission 宽松 dict）。
                mainAgentConfig:
                  (p.main_agent_config as MainAgentConfig | null) ?? null,
                workerPreset:
                  (p.worker_preset as WorkerPresetItem[] | null) ?? null,
              });
            }}
            pendingTeam={preTeamMission !== null}
            onRemovePendingTeam={() => {
              // 放弃暂存配置；输入框仍是弹层回填的 /team 指令时一并清空
              //（用户编辑过则保留——发送会走 /team 拦截重开弹层，语义自洽）。
              setPreTeamMission(null);
              setInput((prev) => (/^\/team(\s|$)/.test(prev.trim()) ? "" : prev));
            }}
            popoverOpen={teamPopover.open}
            popoverInitial={teamPopover.initial}
            preSession
            workspaceId={preContext?.workspaceId ?? null}
            workspaceName={preWorkspaceName}
            defaultObjective={teamPopover.objective}
            defaultProjectId={pageProjectId}
            submitting={false}
            errorText={null}
            onTrigger={handlePreTeamTrigger}
            onClose={closeTeamPopover}
          />
          <SessionInputBar
            value={input}
            onChange={setInput}
            onSend={handleSend}
            disabled={preSendingDisabled}
            placeholder={prePlaceholder}
            creating={preCreating}
            attachmentsDisabled={preAttachmentsDisabled}
            multimodalDowngraded={false}
            onAttachmentsChange={setPendingAttachments}
            registerClearAttachments={(fn) => {
              clearAttachmentsRef.current = fn;
            }}
            // task-05（FR-05/FR-08）：@ 联想回传与数据源工作区（预会话用锁定
            // 上下文的工作区，无则 @ 联想禁用）。
            onMentionsChange={setPendingMentions}
            workspaceId={preContext?.workspaceId ?? null}
            // ql-20260827-020：＋ 菜单派团队入口（门控口径同原触发行按钮）。
            onTeamTrigger={() => openTeamPopover(null)}
            teamTriggerDisabled={preTeamButtonDisabled}
            teamTriggerTitle={preTeamButtonTitle}
          />
          {/* ql-20260823-008：配置控件条同构挂载（provisional 暂存模式）——
              供应商/档案可选暂存随首句生效（task-09 起配置条仅此两块）。 */}
          <div className="px-5 pb-3">
            <SessionConfigBar
              sessionId=""
              provisional
              running={false}
              ended={false}
              agentProfileId={preProfileId || null}
              llmProviderId={preProviderId || null}
              configSnapshot={null}
              engine={preEngine}
              onProvisionalSwitch={(field, value) => {
                if (field === "llm_provider_id") setPreProviderId(value);
                else setPreProfileId(value);
              }}
              // D-002@v1：模型暂存专用回调（onProvisionalSwitch 二分收值会误写档案）。
              onProvisionalModelSwitch={setPreModelId}
            />
          </div>
          {/* R-02：创建失败内联错误（输入保留在上框，点发送即重试）。 */}
          {preError && (
            <p
              role="alert"
              aria-label="创建会话错误"
              className="mx-5 mb-3 rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive"
            >
              {preError}（输入已保留，可直接重试）
            </p>
          )}
        </div>
      </section>
    );
  }
  if (detailQuery.isError) {
    return (
      <div className="m-6 rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive" aria-label="会话详情加载失败">
        加载会话详情失败：{errMessage(detailQuery.error, "未知错误")}
        <Button
          size="small"
          className="ml-3"
          onClick={() => void detailQuery.refetch()}
        >
          重新加载
        </Button>
      </div>
    );
  }
  if (!session) {
    return (
      <div className="flex h-full items-center justify-center" data-testid="session-detail-loading">
        <Spin />
      </div>
    );
  }

  // task-03（design §3.3 状态机）：输入禁用态只看终态与离线——
  //   旧：ended || restoring || running || !machineOnline → 禁用；
  //   新：ended || !machineOnline → 禁用；running（currentRunId 有值）/
  //       reconnecting / pending 保持可输入，消息入队等待自动投递（D-001）。
  // task-10（design A5/A6 / 原型⑤）：suspended 挂起禁用输入——daemon 不在线，
  // 恢复由 daemon 重启自动完成（D-001），用户无需（也无法）在此期间发消息。
  // 队满（D-002）不禁输入但 handleSend 阻止提交，提示由 placeholder 承载。
  // task-07（2026-08-23-agent-activity-sessions design §3.4 / Grill P2）：纯日志
  // 主体判定——origin=tool_report 且 turn_count===0（未继续过对话）→ 输入框
  // placeholder 引导继续（首条消息懒激活派发，D-002）。
  const isToolReportBody =
    session.origin === "tool_report" && session.turn_count === 0;
  // task-14（FR-08 辅半）：纯空文本禁点不在本条件追加——空内容判断收口在共享
  // SessionInputBar 发送按钮（!value.trim() 且无附件，D-7 附件例外维持）+
  // handleSend 入口守卫（下方 !prompt && 附件空 return）；本 disabled 同时禁
  // textarea，并入 trim 判断会在空输入时锁死输入框无法打字。
  const sendingDisabled = ended || suspended || !machineOnline || sessionWorkspaceArchived;
  const placeholder = deriveSessionPlaceholder({
    sessionWorkspaceArchived,
    ended,
    suspended,
    machineOnline,
    isToolReportBody,
    isQueueFull,
    restoring,
    running,
  });

  const interruptDisabled =
    session.status !== "active" || !turnState.currentRunId || !machineOnline;

  // task-11：团队入口派生——引擎门控（D-003 一期 Claude 专属；provider-abstraction
  // task-11 收敛查 ProviderCaps subagent 键，与原 === "claude" 等价）+ 活跃 chip
  //（R-07 单活跃约束，取首个活跃 mission；chip 收回按 mission id 记忆）。
  const { teamButtonDisabled, teamButtonTitle } = deriveTeamButtonState(
    sessionEngine,
    ended,
    machineOnline,
  );
  // ql-20260828-009-4a13：dismissed 收起记忆下线——chip 常驻至 mission 终态。
  const { activeTeamMission, teamChipWorkers } =
    findActiveTeamMissionChip(teamMissions);

  // ql-20260815-011：无真实标题不渲染占位「未命名会话」，只留 id 短码。
  const title = session.title?.trim() || "";
  // task-10（design A6）：suspended「已挂起」（default 阶，对齐原型⑤ muted
  // pill）；词表外未知值兜底「未知状态」（default 阶，不崩溃、不误标恢复中）。
  const statusBadge = deriveStatusBadge(session.status);

  // task-14（design §5.4）：会话主体条件提升为变量——mobile 外包横向滚动容器
  // （PANEL_BODY_WRAP_CLS_MOBILE），desktop 原样直挂（DOM 结构/props 零变化）。
  // 触顶自动加载接线（hooks 在 handleLoadEarlier 旁无条件区，见该处注释）：
  // 渲染期把时间线滚动容器查询器注入 ref。
  scrollElQueryRef.current = () => timelineScrollEl();

  const sessionBody = isToolReportBody ? (
    <AgentLogSessionBody sessionId={session.id} />
  ) : (
    <>
      {/* quick（2026-09-02 触顶自动加载迭代）：原「加载更早消息」按钮改滚动
          触发——时间线触顶（scrollTop ≤ 48px）自动拉更早一页 prepend；
          hasEarlier=false（到头）后触顶不再发起请求。加载中顶部行内提示。 */}
{renderHistoryAndLocalReport({
        historyLoading,
        isToolReportActivated,
        localReportTurns,
        localReportOpen,
        onToggleLocalReport: () => setLocalReportOpen((v) => !v),
      })}
      <TurnTimeline
        turns={dialogTurns}
        viewMode={viewMode}
        errorMsg={errorMsg}
        sessionStatus={deriveTimelineSessionStatus(ended, session.status === "failed", restoring)}
        pendingRequests={pendingRequests}
        dialogHistory={dialogHistory}
        onDialogResolved={handleDialogResolved}
        onResend={timelineOnResend}
        onSwitchProvider={timelineOnSwitchProvider}
        hasOnlineProvider={machineOnline}
        emptyProviderLabel={providerLabelOf(session.provider)}
      />
    </>
  );

  return (
    <section
      ref={panelRef}
      className={mobile ? PANEL_ROOT_CLS_MOBILE : PANEL_ROOT_CLS_DESKTOP}
      aria-label="会话面板"
      data-variant={variant}
    >
      {/* 面板头：标题 + 会话 id 短码（点击复制，ql-20260815-010）+ 状态 + 视图切换 + 打断/结束。
          task-14（design §5.4）：mobile 保留核心（标题/运行状态/视图切换/打断），
          次要 chrome（#id 复制、机器/工作区徽标、后台/子代理目录）收纳进 ⋯ 菜单。 */}
      <header
        className={mobile ? PANEL_HEADER_CLS_MOBILE : PANEL_HEADER_CLS_DESKTOP}
      >
        <div className="flex min-w-0 items-center gap-2">
          {title && (
            <span className="truncate text-sm font-semibold text-foreground">
              {title}
            </span>
          )}
          {/* 会话 id 短码：点击复制完整 id（排障/引用入口），notify 反馈。
              mobile 收纳进 ⋯ 菜单（见头部右侧）。 */}
          {!mobile && (
            <button
              type="button"
              aria-label="复制会话 ID"
              title={`点击复制会话 ID：${session.id}`}
              onClick={() => {
                void navigator.clipboard
                  ?.writeText(session.id)
                  .then(() => notify.success("已复制会话 ID"))
                  .catch(() => notify.error(new Error("复制失败")));
              }}
              className="shrink-0 cursor-pointer rounded px-1 py-0.5 font-mono text-[10.5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              #{session.id.slice(0, 8)}
            </button>
          )}
          <Badge status={statusBadge.status} text={statusBadge.text} />
          {/* task-10（FR-05 / D-002@v2）：平台共享会话徽标——会话档案 ∈ active
              共享智能体生效列表时显示（仅显示不改行为；文案「平台共享」非「只读」）。 */}
          {isPlatformSharedSession && (
            <span
              data-testid="session-platform-shared-badge"
              title="本会话使用平台共享智能体——读平台源码不受限，写操作限制在共享输出目录"
              className="inline-flex shrink-0 items-center rounded-full border border-brand-300 bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700"
            >
              平台共享
            </span>
          )}
          {!mobile && machineName && (
            <span className="hidden shrink-0 items-center gap-1 rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[11px] text-muted-foreground sm:inline-flex">
              <Monitor aria-hidden className="h-3 w-3" />
              {machineName}
            </span>
          )}
          {!mobile && workspaceName && (
            <span className="hidden shrink-0 items-center gap-1 rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[11px] text-muted-foreground sm:inline-flex">
              <FolderOpen aria-hidden className="h-3 w-3" />
              {workspaceName}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* ql-20260826-010：后台活动目录——bash/后台任务/团队任务收编头部下拉
              （原三段常驻消息流与输入区之间挤占聊天窗口）。mobile 再收纳进 ⋯ 菜单。 */}
          {!mobile && (
            <>
              <ActivityCatalog
                bashProgress={bashProgress}
                agentTasks={agentTasks}
                missions={teamMissions}
                workspaceId={
                  session.workspace_id ?? preContext?.workspaceId ?? null
                }
                onRefreshMissions={() => {
                  void refreshTeamMissions();
                }}
                onOpenWorkerSession={(subSessionId) => {
                  setWorkerSessionId(subSessionId);
                }}
              />
              {/* task-09（FR-04 / Grill X-09）：子代理目录——仅 page 模式头部挂载
                  （dialog 模式不挂）；无子代理段时组件返回 null 不占位。 */}
              <SubagentCatalog
                turns={displayTurns}
                onJumpTo={handleJumpToSubagent}
              />
            </>
          )}
          {turnState.turns.length > 0 && (
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
                  onClick={() => changeViewMode(m)}
                  className={cn(
                    "rounded-full px-2.5 py-1 text-[11px] leading-none transition-colors",
                    viewMode === m
                      ? "bg-card font-medium text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {/* task-09：「全部」改「进度」（段模型语义：完整段时间线）。 */}
                  {m === "conversation" ? "对话" : "进度"}
                </button>
              ))}
            </div>
          )}
          {/* quick（2026-09-02）：会话内搜索——icon 展开输入浮层，回车 q 查询
              （limit=100）结果列表展示（点击条目关闭；清空/再点 icon 收起恢复）。 */}
          <div className="relative shrink-0">
            <button
              type="button"
              aria-label="搜索会话记录"
              aria-expanded={searchOpen}
              title="搜索会话记录"
              data-testid="session-search-toggle"
              onClick={() => (searchOpen ? resetSessionSearch() : setSearchOpen(true))}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Search aria-hidden className="h-4 w-4" />
            </button>
            {searchOpen && (
              <div
                data-testid="session-search-popover"
                className="absolute right-0 top-full z-30 mt-1 w-[380px] max-w-[min(380px,calc(100vw-2rem))] rounded-md border border-border bg-card p-2 shadow-lg"
              >
                <Input
                  data-testid="session-search-input"
                  aria-label="搜索会话记录"
                  placeholder="输入关键词，回车搜索（最多 100 条）"
                  size="small"
                  autoFocus
                  value={searchTerm}
                  disabled={searching}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  onPressEnter={() => void handleSessionSearch()}
                />
                {searching && (
                  <div className="flex justify-center py-3">
                    <Spin size="small" />
                  </div>
                )}
                {!searching && searchResults && (
                  <div
                    data-testid="session-search-results"
                    className="mt-1.5 max-h-80 overflow-y-auto"
                  >
                    <p className="px-1 pb-1 text-[11px] text-muted-foreground">
                      {searchResults.length > 0
                        ? `「${searchTerm.trim()}」命中 ${searchResults.length} 条${
                            searchResults.length >= 100 ? "（仅前 100 条）" : ""
                          }——点击条目关闭`
                        : `未找到匹配「${searchTerm.trim()}」的记录`}
                    </p>
                    {searchResults.map((log) => {
                      const text = searchResultText(log);
                      return (
                        <button
                          key={log.id}
                          type="button"
                          data-testid="session-search-result-item"
                          onClick={resetSessionSearch}
                          className="block w-full rounded px-1.5 py-1.5 text-left transition-colors hover:bg-muted/60"
                        >
                          <span className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
                            <span className="shrink-0 rounded bg-muted px-1 py-px font-semibold">
                              {searchResultLabel(log)}
                            </span>
                            <span className="shrink-0">
                              {log.timestamp
                                ? new Date(log.timestamp).toLocaleString("zh-CN", {
                                    month: "2-digit",
                                    day: "2-digit",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                    hour12: false,
                                  })
                                : ""}
                            </span>
                          </span>
                          <span className="mt-0.5 line-clamp-2 block text-xs leading-5 text-foreground">
                            {highlightSearchHit(text, searchTerm.trim())}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
          <Button
            size="small"
            icon={<Ban className="h-3 w-3" />}
            disabled={interruptDisabled}
            onClick={() => void handleInterrupt()}
            title="打断本轮（session 保持 active）"
          >
            打断本轮
          </Button>
          {/* task-14（design §5.4）：mobile ⋯ 菜单——次要 chrome 收纳（#id 复制/
              机器/工作区徽标/后台目录/子代理目录），组件与回调逻辑与 desktop
              原位版本逐字共用（纯渲染层搬迁，无逻辑分叉）。 */}
          {mobile && (
            <div className="relative shrink-0">
              <button
                type="button"
                aria-label="更多操作"
                aria-expanded={mobileMoreOpen}
                title="更多操作：复制会话 ID / 机器与工作区 / 后台任务 / 子代理目录"
                onClick={() => setMobileMoreOpen((v) => !v)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <MoreHorizontal aria-hidden className="h-4 w-4" />
              </button>
              {mobileMoreOpen && (
                <div
                  data-testid="session-mobile-more-menu"
                  className="absolute right-0 top-full z-30 mt-1 w-60 space-y-2 rounded-md border border-border bg-card p-2 shadow-lg"
                >
                  <button
                    type="button"
                    aria-label="复制会话 ID"
                    title={`点击复制会话 ID：${session.id}`}
                    onClick={() => {
                      void navigator.clipboard
                        ?.writeText(session.id)
                        .then(() => notify.success("已复制会话 ID"))
                        .catch(() => notify.error(new Error("复制失败")));
                    }}
                    className="flex w-full shrink-0 cursor-pointer items-center gap-2 rounded px-1 py-1 font-mono text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    #{session.id.slice(0, 8)} · 复制会话 ID
                  </button>
                  {machineName && (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[11px] text-muted-foreground">
                      <Monitor aria-hidden className="h-3 w-3" />
                      {machineName}
                    </span>
                  )}
                  {workspaceName && (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[11px] text-muted-foreground">
                      <FolderOpen aria-hidden className="h-3 w-3" />
                      {workspaceName}
                    </span>
                  )}
                  <div className="flex flex-col items-start gap-1 border-t border-border pt-2">
                    <ActivityCatalog
                      bashProgress={bashProgress}
                      agentTasks={agentTasks}
                      missions={teamMissions}
                      workspaceId={
                        session.workspace_id ?? preContext?.workspaceId ?? null
                      }
                      onRefreshMissions={() => {
                        void refreshTeamMissions();
                      }}
                      onOpenWorkerSession={(subSessionId) => {
                        setWorkerSessionId(subSessionId);
                      }}
                    />
                    <SubagentCatalog
                      turns={displayTurns}
                      onJumpTo={handleJumpToSubagent}
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      {/* 2026-08-29-session-usage-stats task-04（FR-02 / 原型场景一 / D-001@v1）：
          会话累计用量条——page 模式挂会话头部下方（分隔信息条）；session 已
          narrow 非 null（预会话/加载/错误态上方已提前 return，天然满足「有
          sessionId 才渲染」）。refreshSignal 挂 onTurnCompleted 轮终态递增
          （usageRefresh，R-04：组件自取数，不引入 react-query）。 */}
      <SessionUsageBar sessionId={session.id} refreshSignal={usageRefresh} />

      {/* task-10 / design A5+A6（原型⑤）：suspended 挂起横幅（info 色，双主题
          token 阶）。挂起时后台状态权威（backend 已判定 daemon 离线超时/优雅
          停止），复用本横幅位替代下方「离线只读」通用横幅——文案更具体（自动
          恢复 + 24h GC 上限副行），不与通用离线横幅叠加重复。 */}
      {suspended && (
        <div
          role="status"
          aria-live="polite"
          data-session-banner="suspended"
          className={cn(
            "border-b border-info/30 bg-info/10 px-5 py-2 text-xs text-info",
            mobile && "px-3",
          )}
        >
          <div className="flex items-center gap-2">
            <PauseCircle aria-hidden className="h-3.5 w-3.5 shrink-0" />
            <span className="flex-1">会话已挂起——守护进程在线后将自动恢复，也可点「继续对话」立即恢复</span>
            {/* quick 风险审查修（2026-09-01）：横幅承诺的手动入口此前不存在——
                唯一 reopen 按钮只在 ended/恢复超时横幅渲染、输入框又被 suspended
                禁用，用户按指引找不到可点的东西。补真按钮接 handleReopen
                （backend reopen 本就接受 suspended，canResumeSession 已放开）。 */}
            <Button
              size="small"
              data-testid="suspended-resume-button"
              loading={reopening}
              onClick={() => void handleReopen()}
            >
              继续对话
            </Button>
          </div>
          <p className="ml-[22px] mt-0.5 text-[11px] leading-4 text-info/80">
            历史消息完整保留，可在上方继续浏览；挂起超过 24 小时才会被标记为失败
          </p>
        </div>
      )}
      {/* 离线只读横幅（2026-07-31-offline-session-readonly 语义；task-14：mobile
          padding 收敛 px-3）；task-10：suspended 已有专属挂起横幅时不再叠加。 */}
      {!machineOnline && !suspended && (
        <div
          className={cn(
            "flex items-center gap-2 border-b border-amber-300 bg-amber-50 px-5 py-2 text-xs text-amber-800",
            mobile && "px-3",
          )}
        >
          <TriangleAlert aria-hidden className="h-3.5 w-3.5 shrink-0" />
          <span>
            会话所属机器{machineName ? `（${machineName}）` : ""}当前离线 —— 可浏览历史消息，暂不能继续对话；机器恢复在线后可继续。
          </span>
        </div>
      )}
      {/* task-09 / design A6（原型②③④）：连接状态横幅 + 运行轮看门狗提示。
          断线重连中 warning 常驻（第 N 次尝试）；恢复 success 2s 自动消失；
          看门狗长时间无响应仅提示对账中，不伪造终态（终态以 backend 数据经
          resync 刷新为准）。 */}
      <StreamConnectionBanner
        connStatus={connGuard.connStatus}
        attempt={connGuard.reconnectAttempt}
        mobile={mobile}
      />
      {connGuard.stalledHint && <TurnStalledWatchdogBanner mobile={mobile} />}
      {/* 已结束/失败横幅 + 重新开启（原型 .ended-banner）；task-08：reconnecting
          本地计时 >240s（DS-5）复用同位置同款入口，超时场景文案区分，onClick 与
          ended 同一 handleReopen（不复制回调）。 */}
      {(ended || reconnectTimedOutBanner) && (
        <div
          className={cn(
            "flex items-center justify-between gap-2 border-b border-border bg-muted/40 px-5 py-2 text-xs text-muted-foreground",
            mobile && "px-3",
          )}
        >
          <span>
            {ended
              ? `会话已${session.status === "failed" ? "失败" : "结束"} —— 可浏览历史消息`
              : "会话恢复超时 —— 可重新开启，或等待自动恢复"}
          </span>
          <Button size="small" loading={reopening} onClick={() => void handleReopen()}>
            重新开启
          </Button>
        </div>
      )}

      {/* ql-20260904-021：本地 Agent 日志收纳顶部——原对话流尾部气泡条目
          （streamFooter 挂载）改面板级折叠栏，挂横幅之下、会话主体之上，
          点击展开明细，不再挤占聊天窗口（同 ql-20260826-010 后台目录收纳
          动机）。无上报时组件返回 null 不占位；纯 tool_report 主体
          （AgentLogSessionBody 即日志条目流）不重复挂载。 */}
      {!isToolReportBody && (
        <AgentLogCard sessionId={session.id} mobile={mobile} />
      )}

      {/* task-08（2026-09-04-session-task-execution-panel / FR-01 / D-004@v1）：
          任务执行折叠面板——横幅之下、会话主体之上的横向信息条层级（AgentLogCard
          同层）。desktop / mobile 两 variant 共用本渲染路径（对照 AgentLogCard
          单挂载先例；组件自适应容器宽度，折叠条常驻空数据显示 0 计数）。运行中
          区数据与头部 ActivityCatalog 同源（agentTasks / bashProgress /
          teamMissions 既有内存态，不新建 state / SSE）；实时事件经 taskPanelRef
          由上方 onAgentTaskStatus 分发注入。 */}
      <TaskExecutionPanel
        ref={taskPanelRef}
        sessionId={session.id}
        runningTasks={agentTasks.filter((t) => t.status === "running")}
        bashProgress={bashProgress}
        teamMissions={teamMissions}
        workspaceId={session.workspace_id ?? preContext?.workspaceId ?? null}
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

      {/* 会话主体（task-07 / 2026-08-23-agent-activity-sessions design §3.4）：
          - origin=tool_report 且 turn_count===0（未继续过对话）→ 本地 Agent
            日志条目流即会话主体（AgentLogSessionBody），输入区保留在下方
            （首条消息懒激活派发，D-002）；
          - 其余会话（chat / 已激活 tool_report 继续对话后）→ 正常对话流
            （task-13 共享子组件；弹窗与新页面同构复用。gap-fix：turns 用
            displayTurns）；关联本会话的日志改走顶部折叠栏（AgentLogCard，
            ql-20260904-021，见上方挂载；streamFooter 注入口保留但暂无消费方）。
          - task-14：mobile 外包横向滚动容器（表格等横向内容不撑破竖屏视口）。 */}
      {mobile ? (
        <div className={PANEL_BODY_WRAP_CLS_MOBILE}>
          {/* contents 包裹保布局零变化（子元素仍直接参与外层 flex/scroll），
              仅提供滚动监听挂载点（触顶自动加载）。 */}
          <div ref={bodyWrapCallbackRef} className="contents">
            {sessionBody}
          </div>
        </div>
      ) : (
        <div ref={bodyWrapCallbackRef} className="contents">
          {sessionBody}
        </div>
      )}

      {/* task-11：会话团队任务块（TeamTaskBlock）——ql-20260826-010 起收编进头部
          ActivityCatalog 下拉（原常驻区挤占聊天窗口）；取消/分身子会话交互经
          ActivityCatalog props 透传，活跃期间父层 5s 轮询刷新不变（终态停止）。 */}

      {/* task-09：plan 模式待确认卡片——planPending 存在时渲染，用户操作后 onSubmitted 清除。 */}
      {planPending && (
        <div className="shrink-0 border-t border-border bg-card px-5 py-3">
          <PlanApprovalCard
            sessionId={sessionId}
            runId={planPending.runId}
            summary={planPending.summary}
            requestedAt={planPending.requestedAt}
            onSubmitted={() => setPlanPending(null)}
          />
        </div>
      )}
      {/* task-09：bash 命令进度卡片 + verify P1 后台 Agent 任务卡——ql-20260826-010
          起收编进头部 ActivityCatalog 下拉（原「进度」视图常驻区挤占聊天窗口），
          详情点头部「后台」展开。此处仅保留一行「后台任务仍在运行」提示
          （无活跃 turn 且有 running 任务时会话不能提前标记完成）。 */}
      {turnState.currentRunId == null && agentTasks.some((t) => t.status === "running") && (
        <p className="shrink-0 px-5 pb-1 pt-2 text-xs font-medium text-brand-700">
          后台任务仍在运行，会话未结束（详情见头部「后台」）
        </p>
      )}

      {/* 输入区：ctx 用量行 + 输入框 + 配置控件条（原型 .input-zone） */}
      <div className="flex shrink-0 flex-col bg-card">
        <div className="px-5 pt-3">
          <CtxUsageBar
            usedTokens={usedTokens}
            roleMapping={ctxRoleMapping}
            fallbackModel={ctxFallbackModel}
            windowOverride={session?.ctx_window_tokens ?? null}
            onWindowOverrideChange={handleCtxWindowOverrideChange}
            providerId={session.llm_provider_id ?? null}
          />
        </div>
        {/* task-03（design §3.2）：排队消息条——输入框上方水平 chips（空队列组件
            自返回 null 不占位）。onRemove 顺带清理附件元数据镜像（D-004），防
            删除条目后残留；onRetry 仅用户触发（D-003，hook 内 failed→pending 后
            条件满足即投递）。
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
            // ql-20260828-012-4425：chip 点击回显活跃 mission 配置（占位符/
            // 指令前缀目标过滤为空——编辑语义让用户重填或保留）。
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
          workspaceId={session.workspace_id ?? null}
          workspaceName={workspaceName}
          defaultObjective={teamPopover.objective}
          popoverInitial={teamPopover.initial}
          submitting={teamTriggering}
          errorText={teamError}
          onTrigger={(payload) => {
            void handleTeamTrigger(payload);
          }}
          onClose={closeTeamPopover}
        />
        <SessionInputBar
          value={input}
          onChange={setInput}
          onSend={handleSend}
          disabled={sendingDisabled}
          placeholder={placeholder}
          creating={false}
          // 2026-08-20 task-12：附件门控（D-6 codex 禁用；FR-10 降级提示）与回传。
          attachmentsDisabled={attachmentsDisabled}
          multimodalDowngraded={multimodalDowngraded}
          onAttachmentsChange={setPendingAttachments}
          registerClearAttachments={(fn) => {
            clearAttachmentsRef.current = fn;
          }}
          // task-05（FR-06/FR-08）：@ 联想回传与数据源工作区（真会话用会话自身
          // 工作区，预会话锁定上下文兜底——父层切 sessionId 后 preContext 可能
          // 仍在，会话 workspace_id 缺省时回落，避免 @ 联想无数据）。
          onMentionsChange={setPendingMentions}
          workspaceId={session.workspace_id ?? preContext?.workspaceId ?? null}
          // ql-20260827-020：＋ 菜单派团队入口（门控口径同原触发行按钮）。
          onTeamTrigger={() => openTeamPopover(null)}
          teamTriggerDisabled={teamButtonDisabled}
          teamTriggerTitle={teamButtonTitle}
        />
        <div ref={configBarWrapRef} className="px-5 pb-3">
          <SessionConfigBar
            sessionId={sessionId}
            running={running}
            ended={ended || !machineOnline}
            agentProfileId={session.agent_profile_id ?? null}
            llmProviderId={session.llm_provider_id ?? null}
            configSnapshot={session.config_snapshot ?? null}
            engine={session.provider ?? null}
            // ql-20260904-010：错误卡「切换供应商」定位到本配置条（打开供应商下拉）。
            providerOpenSignal={configProviderSignal}
            onSwitched={() => {
              // 切换成功 → 刷新会话详情（三列快照）+ 左侧列表 chips + runsMeta
              // （立即显示新 whoLine，不等重进页面）。F7：mountedRef 守卫——
              // 渲染作用域回调等不到 effect 的 cancelled，卸载后迟到快照不再
              // setState。
              void qc.invalidateQueries({ queryKey: ["agentSessionDetail", sessionId] });
              onSessionListRefresh?.();
              void listSessionRuns(sessionId)
                .then((runs) => {
                  if (mountedRef.current) {
                    setRunsMeta(new Map(runs.map((r) => [r.id, r])));
                  }
                })
                .catch(() => {});
            }}
          />
        </div>
      </div>

      {/* task-14：分身会话浮层——复用 SessionPanel（dialog/attach 形态）打开分身
          子会话；引擎信息取主控会话（分身派发自同一 claude 主控，D-003 门控
          上游已保证），在线性沿用主控机器判定。 */}
      {workerSessionId != null && (
        <WorkerSessionOverlay
          subSessionId={workerSessionId}
          onClose={() => {
            setWorkerSessionId(null);
          }}
          machines={machines}
          llmProviders={llmProviders}
        />
      )}
    </section>
  );
}
