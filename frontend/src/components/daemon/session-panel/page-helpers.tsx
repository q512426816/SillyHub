/**
 * page 模式纯派生 helper 与模块常量（task-14 / 2026-09-07-arch-large-file-split：
 * SessionPanelPage 组件本体实测超 3000 行豁免线，按 design §5「内部仅再提取纯
 * 逻辑，handler 保持原位（R-03）」把渲染作用域纯派生 useMemo 体与模块常量外提至
 * 此；全部逻辑原样搬移，依赖数组逐项保留，零行为变化）。
 */

import type { SessionPreContext } from "./index";
import { parseRunStartedAt } from "./turn-state";
import type { SessionTurnView } from "@/components/daemon/turn-timeline";
import {
  buildErrorLogItem,
  buildSystemFailureItem,
} from "@/components/agent-log/normalize";
import { runTerminalTurnStatus } from "@/components/daemon/runtime-session-helpers";
import {
  type DaemonMachineRead,
  type DaemonRuntimeRead,
  type SessionRunRead,
  type AgentSessionRead,
  type SessionCreateResponse,
  type SharedAgentActiveView,
  type TeamMissionSummary,
  PROVIDER_META,
} from "@/lib/daemon";
import type {
  LlmProviderRead,
  LlmProviderRoleMapping,
} from "@/lib/api/llm-providers";
import { getProviderCaps } from "@/lib/provider-caps";
import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { isActiveTeamMission } from "@/components/daemon/team-task-block";
import { MENTION_PLACEHOLDER_HINT } from "./turn-state";
import type { listWorkspaces } from "@/lib/workspaces";
import type { getChange } from "@/lib/changes";
import type { getQuicklogDetail } from "@/lib/quicklog";

type WorkspacesData = Awaited<ReturnType<typeof listWorkspaces>>;
type ChangeData = Awaited<ReturnType<typeof getChange>>;
type QuicklogData = Awaited<ReturnType<typeof getQuicklogDetail>>;

/* ── task-14（2026-08-26-mobile-workspace-page / design §5.4）：variant 布局类 ──
 * desktop 字面量与改动前逐字一致（回归锚：__tests__/session-panel-variant.test.tsx
 * 断言不传 variant 时 className 不变）；mobile 仅满宽贴屏（去圆角/边框）+ padding
 * 收敛——逻辑零分叉，variant 只出现在 JSX className/显隐条件。 */

/** 面板根容器（page 模式真会话/预会话两个渲染点共用）。
 *  2026-09-09-sessions-visual-refresh task-07（FR-07/D-008@v1）：bg-card 改
 *  var(--glass-heavy) + backdrop-blur 玻璃化（配合 task-09 壳层极光透出，
 *  边框降透明 --border-soft）——mobile 同步。 */
export const PANEL_ROOT_CLS_DESKTOP =
  "flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border/60 bg-card/80 backdrop-blur-xl";
export const PANEL_ROOT_CLS_MOBILE =
  "flex h-full min-h-0 w-full flex-col overflow-hidden bg-card/80 backdrop-blur-xl";

/** 面板头（两渲染点共用）。task-07：玻璃头（半透 + blur，滚动内容从下方穿过）。
 *  ql-20260910-006：backdrop-blur 使头部自成层叠上下文，头部内下拉弹层（后台/
 *  子代理目录、搜索、mobile ⋯ 菜单，均 absolute z-30）的 z 值被困在头部之内，
 *  被树序在后的消息流 relative 外包层（turn-timeline 滚动区，bg-background）
 *  整体盖住——头部 relative z-20 抬到消息流之上（流内最高 z-10，弹层恢复可见；
 *  流内更高 z 的悬浮件不受影响，仍按各自 z 值参与根上下文比较）。 */
export const PANEL_HEADER_CLS_DESKTOP =
  "relative z-20 flex shrink-0 items-center justify-between gap-3 border-b border-border/60 bg-card/60 px-4 py-2 backdrop-blur-md";
export const PANEL_HEADER_CLS_MOBILE =
  "relative z-20 flex shrink-0 items-center justify-between gap-2 border-b border-border/60 bg-card/60 px-3 py-2 backdrop-blur-md";

/**
 * mobile 会话主体外包层：TurnTimeline / AgentLogSessionBody 自带纵向滚动容器
 * （min-h-0 flex-1 overflow-y-auto），外包 flex 列容器不破坏高度链；任意变体
 * 选择器给 markdown 表格补横向滚动容器（design §5.4：横向内容不撑破竖屏视口；
 * markdown pre 已有 overflow-x-auto、ARGS_PRE_CLS pre 已 wrap，表格是缺口），
 * 并锁外层横向溢出（防整条时间线被宽表格横向拖走）。desktop 无外包层（DOM
 * 结构零变化）。
 */
export const PANEL_BODY_WRAP_CLS_MOBILE =
  "flex min-h-0 flex-1 flex-col " +
  "[&_.wmde-markdown_table]:!block [&_.wmde-markdown_table]:!max-w-full " +
  "[&_.wmde-markdown_table]:!overflow-x-auto " +
  "[&_[data-testid='turn-timeline-scroll']]:overflow-x-hidden";

/**
 * task-08（2026-08-21-session-reopen-resume / FR-09）：重新开启 409 错误码 → 中文
 * 文案映射。后端 reopen 409 的 message 是英文原文（DaemonSessionNotActive 等
 * AppError 子类），errMessage 默认透传 err.message——errors.ts 不在本卡
 * allowed_paths，映射收敛在本组件（handleReopen notify 前查表，未命中回退既有
 * 行为）。错误码对齐 backend/app/modules/daemon/session/service.py:188-256（含
 * task-04 新增的空 cwd 码 HTTP_409_DAEMON_SESSION_NO_CWD，DS-7）。
 */
export const REOPEN_ERROR_ZH: Record<string, string> = {
  // 窗口内二次重开（后端 180s 恢复窗口内会话尚在恢复）
  HTTP_409_DAEMON_SESSION_NOT_ACTIVE: "会话仍在恢复中，请稍后再试",
  // agent_session_id IS NULL（创建时 SDK 握手未成功，D-004@v1）
  HTTP_409_DAEMON_SESSION_NO_AGENT_SESSION: "该会话缺少恢复凭证，无法重新开启",
  // provider 不支持 resume（非 claude/codex）
  HTTP_409_DAEMON_SESSION_RESUME_UNSUPPORTED: "该会话类型不支持重新开启",
  // 目标 runtime 无活跃 WS 连接
  HTTP_409_DAEMON_OFFLINE: "执行代理当前不在线，请先启动 daemon 后重试",
  // scan/bootstrap 会话不写 cwd，SDK resume 无法定位 transcript（DS-7）
  HTTP_409_DAEMON_SESSION_NO_CWD: "该会话缺少工作目录记录，无法重新开启",
};

/**
 * task-08（DS-5）：reconnecting 本地超时阈值。240s = 后端 180s 重开窗口 + 60s
 * 缓冲——前端按钮出现时后端必已放行 reopen；后端 180s 仍是权威校验。
 */
export const RECONNECT_TIMEOUT_MS = 240_000;

/** 触顶自动加载触发阈值（scrollTop 距顶 ≤ 该值即拉更早一页）。 */
export const LOAD_EARLIER_TRIGGER_PX = 48;

/** page 模式窄化 props（外层 SessionPanel 已归一可选 props，见分发处）。 */
export interface SessionPanelPageProps {
  /** task-03：null = 预会话空态（同构渲染 + 全 effect null 守卫，R-01）。 */
  sessionId: string | null;
  machines: DaemonMachineRead[];
  llmProviders: LlmProviderRead[];
  /** 会话终态 / 配置切换后刷新左侧列表。 */
  onSessionListRefresh?: () => void;
  /** 预会话上下文（sessionId=null 时渲染锁定上下文行 + 首句 createSession）。 */
  preContext?: SessionPreContext;
  /** task-07 Phase 5：预会话自动开派团队弹层意图（一次性，见 SessionPanelProps 注释）。 */
  autoTeamOpen?: boolean;
  /** 预会话首句创建成功上报（父层切 sessionId → 状态机自然接管）。 */
  onPreSessionCreated?: (_resp: SessionCreateResponse) => void;
  /** ql-20260825-004：每轮注入携带当前页面上下文。 */
  pageContextOverride?:
    | { page_key: "ppm_project"; project_id: string }
    | { page_key: "generic_page"; route_key: string }
    | { page_key: "workspace"; workspace_id: string }
    | null;
  /** task-14（2026-08-26-mobile-workspace-page）：视口样式变体——分发函数已归一
   *  （外层 ?? "desktop"），仅渲染层消费（见 SessionPanelProps.variant 注释）。 */
  variant: "desktop" | "mobile";
}

/**
 * 2026-09-12-session-live-display-fixes（R4）：run 快照活跃状态词表——处于这些
 * 状态的轮次正在计时，turnStartedAt 强制取快照 started_at（后端权威起点）。
 * 词表口径对齐 backend agent/model.py run 状态（pending_approval 为 team 审批轮）。
 */
const ACTIVE_RUN_STATUSES = new Set(["running", "pending", "pending_approval"]);

/**
 * 按 run 快照补 whoLine / 历史 usage（原 SessionPanelPage displayTurns useMemo 体外提）：
 * 只补缺（?? 链），实时 SSE 值优先；run 快照缺失（拉取失败 / 占位 turn）原样返回——
 * whoLine 不渲染（零回归）。
 */
export function enrichDisplayTurns(
  turns: SessionTurnView[],
  runsMeta: Map<string, SessionRunRead>,
  llmProviders: LlmProviderRead[],
  agentDisplayName: string,
  sessionUserId: string | null | undefined,
): SessionTurnView[] {
    if (runsMeta.size === 0) return turns;
    /** 单轮快照补齐（?? 链：turn 已有值优先，run 快照只补缺）。 */
    const enrichOne = (t: SessionTurnView, meta: SessionRunRead): SessionTurnView => {
      // ql-20260822-010：终态回补——历史回看轮（logsToTurns）一律 completed，run
      // 快照为 failed/interrupted/cancelled 时修正为 failed/killed 并回填
      // errorDetail，消除「聊天时红色错误卡、刷新后变已完成」的路径不一致。
      // 实时轮终态与 run 快照一致，覆盖为同值无害；errorDetail 只补缺（?? 链）。
      const terminal = runTerminalTurnStatus(meta.status);
      const terminalPatch =
                terminal === null
                  ? {}
                  : terminal === "failed"
                    ? {
                        status: "failed" as const,
                        errorDetail:
                          t.errorDetail ??
                          buildErrorLogItem(meta.error_detail) ??
                          // ql-20260831-004：系统级失败（撞闸/inject 过期等
                          // error_detail 为空）兜 failure_summary + error_code。
                          buildSystemFailureItem(meta.error_code, meta.failure_summary) ?? {
                            // 无详情兜底（先例 normalize.ts runStatus=failed 无 detail）。
                            type: "unknown" as const,
                            code: null,
                            message: "运行失败（无详情）",
                            retryable: false,
                            hint: null,
                            raw: null,
                          },
                      }
                    : { status: "killed" as const };
      return {
        ...t,
        ...terminalPatch,
        // ql-20260817-003：轮次发送者（run.user_id + sender_name；旧 run NULL 不显示）。
        sender:
          t.sender ?? (meta.user_id && meta.sender_name
            ? {
                name: meta.sender_name,
                // 会话属主 = 当前用户时显示「我」；其它用户显示真实名（共享守护进程场景）。
                me: meta.user_id === sessionUserId,
                at: meta.started_at ?? null,
              }
            : undefined),
        // 2026-09-10-auto-resume-interrupted-turn：续跑轮标记（run.metadata.
        // auto_resume_of →「自动续跑」徽标）；?? 链只补缺。
        autoResumeOf: t.autoResumeOf ?? meta.metadata?.auto_resume_of ?? null,
        whoLine: t.whoLine ?? {
          // 快照缺 name / 无快照 = 该轮未指定档案 → null（TurnTimeline 显「未指定」）
          profileName: meta.agent_profile_snapshot?.name ?? null,
          agentName: agentDisplayName,
          // llm_provider_id null（未选/已删 SET NULL）= 本机默认；有 id 但列表
          // 未命中（列表未加载完）暂 null，memo 随 llmProviders 到位自愈。
          providerName: meta.llm_provider_id
            ? (llmProviders.find((p) => p.id === meta.llm_provider_id)?.name ?? null)
            : null,
        },
        inputTokens: t.inputTokens ?? meta.input_tokens ?? null,
        outputTokens: t.outputTokens ?? meta.output_tokens ?? null,
        // task-08（FR-01 / D-003）：ctx 历史回填（SessionRunRead.ctx_tokens，
        // 历史 run 无 ctx 列值 → null → 环未知态）。
        ctxTokens: t.ctxTokens ?? meta.ctx_tokens ?? null,
        // ql-20260817-004：答复完成时间（finished_at 优先；运行中/旧数据 null 不显示）。
        replyAt: t.replyAt ?? meta.finished_at ?? meta.started_at ?? null,
        // task-09（FR-02）计时锚点：终态轮维持 ?? 链（turn 已有值优先——live 发送
        // 占位 / 首条 log timestamp 兜底，attach 恢复计时不归零不计）。
        // 2026-09-12-session-live-display-fixes（R4）：活跃轮（running/pending/
        // pending_approval）改为**快照 started_at 优先**——attach 时 logsToTurns 的
        // firstLogTimestampMs 受 limit 窗口截断（千行 run 只覆盖尾部），重连
        // initialSync 重建时窗口滑动会把锚点带走（实证：两次观察隔 11 分钟 elapsed
        // 只涨 46 秒）；run 快照是后端权威起点，活跃轮强制采用，重连不重置不漂移。
        turnStartedAt:
          terminal === null && meta.status != null && ACTIVE_RUN_STATUSES.has(meta.status)
            ? (parseRunStartedAt(meta.started_at) ?? t.turnStartedAt ?? null)
            : (t.turnStartedAt ?? parseRunStartedAt(meta.started_at)),
      };
    };
    // ql-20260903-025：身份稳定守卫——补齐字段与原值全部一致时返回**原对象**：
    // 流式 delta 只 path-copy 改变一个 turn，其余 turn 引用保持不变（下游
    // MarkdownText/段级 memo 才能命中；此前每 delta 全量 clone 击穿一切 memo，
    // 是流式卡顿主源之一）。?? 链语义逐字段镜像（turn 已有值优先），行为零变化。
    const enriched = turns.map((t) => {
      const meta = runsMeta.get(t.realRunId ?? t.runId);
      if (!meta) return t;
      const candidate = enrichOne(t, meta);
      const changed =
        candidate.status !== t.status ||
        candidate.sender !== t.sender ||
        candidate.whoLine !== t.whoLine ||
        candidate.inputTokens !== t.inputTokens ||
        candidate.outputTokens !== t.outputTokens ||
        candidate.ctxTokens !== t.ctxTokens ||
        candidate.replyAt !== t.replyAt ||
        candidate.turnStartedAt !== t.turnStartedAt ||
        candidate.errorDetail !== t.errorDetail;
      return changed ? candidate : t;
    });
    // ql-20260818-011：runsMeta 中的静默切换 run 无 SSE 事件→不在 turns
    // 中→displayTurns 迭代忽略→重进才可见。补建孤儿 turn（无 prompt/output，
    // 有 whoLine，已完成后台 run），让它们实时出现。
    const knownRunIds = new Set(turns.map((t) => t.realRunId ?? t.runId));
    const orphanTurns: SessionTurnView[] = [];
    for (const [runId, meta] of runsMeta) {
      if (knownRunIds.has(runId)) continue;
      if (meta.status !== 'completed') continue;
      orphanTurns.push({
        runId,
        turn: null,
        prompt: '',
        output: '',
        status: 'completed',
        seenLogIds: new Set(),
        inputTokens: meta.input_tokens ?? null,
        outputTokens: meta.output_tokens ?? null,
        // task-08（FR-01）：孤儿轮（无 SSE 事件的静默后台 run）同样回填 ctx。
        ctxTokens: meta.ctx_tokens ?? null,
        errorDetail: null,
        processItems: [],
        realRunId: runId,
        whoLine: {
          profileName: meta.agent_profile_snapshot?.name ?? null,
          agentName: agentDisplayName,
          providerName: meta.llm_provider_id
            ? (llmProviders.find((p) => p.id === meta.llm_provider_id)?.name ?? null)
            : null,
        },
        sender: meta.user_id && meta.sender_name
          ? {
              name: meta.sender_name,
              me: meta.user_id === sessionUserId,
              at: meta.started_at ?? null,
            }
          : undefined,
        replyAt: meta.finished_at ?? meta.started_at ?? null,
      });
    }
    // ql-20260818-011-b：按时间戳排序（孤儿 turn 不追加在末尾，与实时 turn 按时间
    // 线正确穿插——重进后 logsToTurns 已是时间序，不排序会导致切换标记堆在底部）。
    // ql-20260818-011-d：运行中轮次无 replyAt（空→0）会跑到最前面——视为「最新」
    // 用 Infinity 排末尾；有 replyAt/sender.at 的按实际时间穿插。
    const ts = (t: SessionTurnView) => {
      const raw = t.replyAt ?? t.sender?.at ?? "";
      const parsed = raw ? Date.parse(raw) : NaN;
      if (Number.isFinite(parsed)) return parsed;
      // 无时间戳：completed 孤儿 turn 排前面（0），运行中/待答排最后（Infinity）。
      return t.status === "completed" ? 0 : Infinity;
    };
    return [...enriched, ...orphanTurns].sort((a, b) => ts(a) - ts(b));
}

/**
 * quick（2026-09-02 本地 Agent 会话信息折叠）：tool_report 会话激活后 CLI 上报的
 * 历史轮（spec_strategy=platform-managed）拆为 localReportTurns，对话流主体为
 * dialogTurns；非 tool_report 会话零影响。（原 useMemo 体外提，逻辑原样。）
 */
export function splitToolReportTurns(
  isToolReportActivated: boolean,
  displayTurns: SessionTurnView[],
  runsMeta: Map<string, SessionRunRead>,
): { dialogTurns: SessionTurnView[]; localReportTurns: SessionTurnView[] } {
    if (!isToolReportActivated || !displayTurns) {
      return { dialogTurns: displayTurns, localReportTurns: [] as SessionTurnView[] };
    }
    const local: SessionTurnView[] = [];
    const dialog: SessionTurnView[] = [];
    for (const t of displayTurns) {
      const meta = runsMeta.get(t.realRunId ?? t.runId);
      if (meta?.spec_strategy === "platform-managed") local.push(t);
      else dialog.push(t);
    }
    return { dialogTurns: dialog, localReportTurns: local };
}

/** 工作区名解析（别名优先，先例 workspace-switcher / workspace-card）。 */
export function resolveWorkspaceName(
  workspaceId: string | null | undefined,
  wsData: WorkspacesData | undefined,
): string | null {
  if (!workspaceId) return null;
  const ws = wsData?.items.find((w) => w.id === workspaceId);
  return ws ? (ws.display_alias ?? ws.name) : null;
}

/** 归档区存量会话只读判定（会话绑定工作区 ?? 预会话上下文工作区，均查归档态）。 */
export function isWorkspaceArchived(
  workspaceId: string | null | undefined,
  preWorkspaceId: string | null | undefined,
  wsData: WorkspacesData | undefined,
): boolean {
  const wsId = workspaceId ?? preWorkspaceId ?? null;
  if (!wsId) return false;
  const ws = wsData?.items.find((w) => w.id === wsId);
  return ws?.status === "archived";
}

/** 平台共享会话判定：会话 agent_profile_id ∈ 活跃共享智能体列表即「平台共享」。 */
export function hasPlatformSharedProfile(
  agents: SharedAgentActiveView[],
  profileId: string | null | undefined,
): boolean {
  if (!profileId) return false;
  return agents.some((a) => a.agent_profile_id === profileId);
}

/** 会话所属机器命中（runtime_id 反查；找不到不武断判离线——列表分页外/已删除）。 */
export function findMachineHit(
  machines: DaemonMachineRead[],
  runtimeId: string | null | undefined,
): DaemonMachineRead | null {
  if (!runtimeId) return null;
  return (
    machines.find((m) => (m.runtimes ?? []).some((r) => r.id === runtimeId)) ?? null
  );
}

/** 预会话目标 runtime 命中（preContext.runtimeId 反查引擎行）。 */
export function findPreRuntimeHit(
  machines: DaemonMachineRead[],
  runtimeId: string | null | undefined,
): DaemonRuntimeRead | null {
  if (!runtimeId) return null;
  return machines.flatMap((m) => m.runtimes ?? []).find((r) => r.id === runtimeId) ?? null;
}

/** 预会话目标机器命中（preContext.runtimeId 反查所属机器）。 */
export function findPreMachine(
  machines: DaemonMachineRead[],
  runtimeId: string | null | undefined,
): DaemonMachineRead | null {
  if (!runtimeId) return null;
  return (
    machines.find((m) => (m.runtimes ?? []).some((r) => r.id === runtimeId)) ?? null
  );
}

/** 预会话机器/引擎展示标签（原派生态段常量外提，逻辑原样）。 */
export function derivePreMachineLabels(
  preMachine: DaemonMachineRead | null,
  preRuntimeHit: DaemonRuntimeRead | null,
): {
  preMachineName: string | null;
  preMachineOnline: boolean;
  preEngine: string | null;
  preAgentLabel: string | null;
} {
  const preMachineName = preMachine
    ? preMachine.display_alias?.trim() || preMachine.hostname
    : null;
  const preMachineOnline = preMachine ? preMachine.status === "online" : true;
  const preEngine = preRuntimeHit?.provider ?? null;
  const preAgentLabel = preEngine
    ? (PROVIDER_META[preEngine]?.label ?? preEngine)
    : null;
  return { preMachineName, preMachineOnline, preEngine, preAgentLabel };
}

/** 上下文行工作区名（与真会话 workspaceName 同源 workspacesQuery；预会话态该 query 仍启用）。 */
export function resolvePreWorkspaceName(
  preContext: SessionPreContext | undefined,
  wsData: WorkspacesData | undefined,
): string | null {
  const wsId = preContext?.workspaceId ?? null;
  if (!wsId) return null;
  return wsData?.items.find((ws) => ws.id === wsId)?.name ?? null;
}

/** 上下文行变更名（task-07 / D-106）：title 回退 change_key（查询中/失败显 —）。 */
export function resolvePreChangeName(
  changeId: string | null | undefined,
  changeData: ChangeData | undefined,
): string | null {
  if (!changeId) return null;
  return changeData?.title ?? changeData?.change_key ?? null;
}

/** 上下文行快速修复名（task-11 / FR-06）：title 回退 ql_id 短码。 */
export function resolvePreQuicklogName(
  quickId: string | null | undefined,
  quicklogData: QuicklogData | undefined,
): string | null {
  if (!quickId) return null;
  return quicklogData?.title ?? quickId;
}

/**
 * 会话状态派生标志（原派生态段外提，逻辑原样）。suspended——后端 status 词表已含
 * 该值（task-05），lib/daemon.ts AgentSessionStatus 联合尚未收口（task-11），此处
 * 字符串比较过渡（不改 lib）；sessionActive——队列投递条件之一（后端 inject 守卫
 * status=active，D-001），reconnecting/pending 期间只排队不投递。
 */
export function deriveSessionStatusFlags(session: AgentSessionRead | null | undefined): {
  status: AgentSessionRead["status"] | null;
  ended: boolean;
  restoring: boolean;
  suspended: boolean;
  sessionActive: boolean;
} {
  const status = session?.status ?? null;
  const ended = status === "ended" || status === "failed";
  const restoring = status === "pending" || status === "reconnecting";
  const suspended = (status as string | null) === "suspended";
  const sessionActive = status === "active";
  return { status, ended, restoring, suspended, sessionActive };
}

/** 会话实际生效供应商（会话绑定优先；本机默认/未选 → null = 能力未知）。 */
export function findProviderById(
  llmProviders: LlmProviderRead[],
  providerId: string | null | undefined,
): LlmProviderRead | null {
  return llmProviders.find((p) => p.id === providerId) ?? null;
}

/** 多模态降级启发式（auto：模型名正则；backend capability.py 权威，此处仅提示条预览）。 */
export function isMultimodalDowngraded(
  provider: LlmProviderRead | null,
): boolean {
  if (!provider) return false;
  if (provider.multimodal === "false") return true;
  if (provider.multimodal === "true") return false;
  // auto：前端同源启发式（backend capability.py 权威；此处仅提示条预览）。
  const model = provider.model ?? provider.default_fallback_model ?? "";
  const lowered = model.toLowerCase();
  return !/(vision|vl|glm-[34]\.\d+v|gpt-4o|gpt-4\.1|gpt-5|claude|gemini|qwen-vl|doubao-seed)/.test(
    lowered,
  );
}

/** runtime 命中（runtime_id 反查引擎行，whoLine agentName 兜底链用）。 */
export function findRuntimeHitById(
  machines: DaemonMachineRead[],
  runtimeId: string | null | undefined,
): DaemonRuntimeRead | null {
  return (
    machines.flatMap((m) => m.runtimes ?? []).find((r) => r.id === runtimeId) ?? null
  );
}

/**
 * agentName 兜底链（gap-fix FR-07/FR-08）：config_snapshot.agent_name → runtime
 * 别名/名称 → 引擎 label；快照缺键如实显示，不编造。
 */
export function resolveAgentDisplayName(
  session: AgentSessionRead | null | undefined,
  runtimeHit: DaemonRuntimeRead | null,
): string {
  const fromSnapshot = session?.config_snapshot?.agent_name?.trim();
  if (fromSnapshot) return fromSnapshot;
  const fromRuntime =
    runtimeHit?.display_alias?.trim() || runtimeHit?.name?.trim() || null;
  if (fromRuntime) return fromRuntime;
  return session
    ? (PROVIDER_META[session.provider]?.label ?? session.provider)
    : "";
}

/** ctx 环分母派生：会话供应商 role mapping（one_m → fallback model，D-014）。 */
export function resolveCtxRoleMapping(
  ctxProvider: LlmProviderRead | null,
): LlmProviderRoleMapping | null {
  const mrm = ctxProvider?.model_role_mappings;
  if (!mrm) return null;
  return mrm["sonnet"] ?? Object.values(mrm)[0] ?? null;
}

/** ctx 环分子（task-08 / FR-01 改口径）：displayTurns 逆序第一个非 null ctxTokens。 */
export function latestCtxTokens(displayTurns: SessionTurnView[]): number | null {
  return displayTurns.reduceRight(
    (found: number | null, t) => found ?? t.ctxTokens ?? null,
    null,
  );
}


/** 真会话机器/在线展示派生（机器命中 + 在线判定 + 头部机器名兜底链）。 */
export function deriveMachineMeta(
  machines: DaemonMachineRead[],
  runtimeId: string | null | undefined,
  session: AgentSessionRead | null | undefined,
): { machineOnline: boolean; machineName: string | null } {
  const hit = findMachineHit(machines, runtimeId);
  const machineOnline = hit ? hit.status === "online" : true;
  const machineName = hit
    ? hit.display_alias?.trim() || hit.hostname
    : session?.config_snapshot?.machine_name ?? null;
  return { machineOnline, machineName };
}

/**
 * 预会话输入区 chrome 派生（禁用/占位/团队按钮三态；原 early-return 块内常量外提）。
 * task-14（FR-08 辅半）：纯空文本禁点不在本条件追加——空内容判断收口在共享
 * SessionInputBar 发送按钮（!value.trim() 且无附件，D-7 附件例外维持）+ handleSend
 * 双守卫；本 disabled 同时禁 textarea，并入 trim 判断会在空输入时锁死输入框无法打字。
 */
export function derivePreSessionChrome(opts: {
  preContext: SessionPreContext | undefined;
  preMachineOnline: boolean;
  sessionWorkspaceArchived: boolean;
  preEngine: string | null;
}): {
  preSendingDisabled: boolean;
  prePlaceholder: string;
  preTeamButtonDisabled: boolean;
  preTeamButtonTitle: string;
} {
  const { preContext, preMachineOnline, sessionWorkspaceArchived, preEngine } = opts;
  const preSendingDisabled =
    !preContext || !preMachineOnline || sessionWorkspaceArchived;
  const prePlaceholder = sessionWorkspaceArchived
    ? "工作区已归档，会话只读。恢复请到工作区详情把状态改回「活跃」"
    : !preContext
      ? "请先选择机器与智能体…"
      : !preMachineOnline
        ? "机器离线，输入不可用…"
        : `发送第一句话开始对话…（Enter 发送 · Shift+Enter 换行 · ${MENTION_PLACEHOLDER_HINT}）`;
  // task-13（FR-05）：预会话团队门控——引擎门控（provider-abstraction 收敛查
  // ProviderCaps subagent 键）+ 所选机器在线；tooltip 按未满足原因更新。
  const preTeamEngineOk = getProviderCaps(preEngine ?? "").subagent;
  const preTeamButtonDisabled = !preContext || !preTeamEngineOk || !preMachineOnline;
  const preTeamButtonTitle = !preContext
    ? "请先选择机器与智能体"
    : !preTeamEngineOk
      ? "团队需要 Claude 引擎"
      : !preMachineOnline
        ? "所选机器离线，无法派团队"
        : "派团队：首句创建会话时预建团队任务";
  return { preSendingDisabled, prePlaceholder, preTeamButtonDisabled, preTeamButtonTitle };
}

/** ppm_project 页面上下文 → 弹层项目预选 id（task-07 Phase 5 / FR-06 / D-004@v2）。 */
export function resolvePageProjectId(
  preContext: SessionPreContext | undefined,
): string | undefined {
  return preContext?.pageContext?.page_key === "ppm_project"
    ? preContext.pageContext.project_id
    : undefined;
}

/** 真会话输入框占位文案链（原组件内 16 行三元链外提，逻辑原样）。 */
export function deriveSessionPlaceholder(o: {
  sessionWorkspaceArchived: boolean;
  ended: boolean;
  suspended: boolean;
  machineOnline: boolean;
  isToolReportBody: boolean;
  isQueueFull: boolean;
  restoring: boolean;
  running: boolean;
}): string {
  const {
    sessionWorkspaceArchived,
    ended,
    suspended,
    machineOnline,
    isToolReportBody,
    isQueueFull,
    restoring,
    running,
  } = o;
  return sessionWorkspaceArchived
    ? "工作区已归档，会话只读。恢复请到工作区详情把状态改回「活跃」"
    : ended
      ? "会话已结束，请新建会话"
    : suspended
      ? "等待守护进程恢复后可继续对话…"
      : !machineOnline
        ? "机器离线，输入不可用…"
        : isToolReportBody
          ? "发消息继续这个会话（将派发到绑定机器的 agent）…"
          : isQueueFull
            ? "队列已满，请等待投递或删除排队消息…"
            : restoring
              ? "恢复会话中，消息将排队等待恢复完成后自动发送…"
              : running
                ? "消息将排队，等待本轮完成后自动发送…"
                : `继续追问…（Enter 发送 · Shift+Enter 换行 · ${MENTION_PLACEHOLDER_HINT}）`;
}

/** 团队入口派生（task-11：引擎门控 + 终态/离线禁用 + tooltip 按未满足原因更新）。 */
export function deriveTeamButtonState(
  sessionEngine: string | null,
  ended: boolean,
  machineOnline: boolean,
): {
  teamEngineOk: boolean;
  teamButtonDisabled: boolean;
  teamButtonTitle: string;
} {
  const teamEngineOk = getProviderCaps(sessionEngine ?? "").subagent;
  const teamButtonDisabled = !teamEngineOk || ended || !machineOnline;
  const teamButtonTitle = !teamEngineOk
    ? "团队需要 Claude 引擎"
    : ended
      ? "会话已结束，无法派团队"
      : !machineOnline
        ? "机器离线，无法派团队"
        : "派团队：当前会话智能体升级为主控，派发分身";
  return { teamEngineOk, teamButtonDisabled, teamButtonTitle };
}

/** 活跃 mission + chip 分身数（ql-20260828-009-4a13：chip 常驻至 mission 终态）。 */
export function findActiveTeamMissionChip(teamMissions: TeamMissionSummary[]): {
  activeTeamMission: TeamMissionSummary | null;
  teamChipWorkers: number | null;
} {
  const activeTeamMission =
    teamMissions.find((m) => isActiveTeamMission(m.status)) ?? null;
  const teamChipWorkers = activeTeamMission
    ? activeTeamMission.workers.length
    : null;
  return { activeTeamMission, teamChipWorkers };
}

/**
 * 会话状态徽标（task-10 design A6：suspended「已挂起」default 阶；词表外未知值
 * 兜底「未知状态」，不崩溃、不误标恢复中）。
 */
export function deriveStatusBadge(status: string): {
  status: "processing" | "default" | "error" | "warning";
  text: string;
} {
  if (status === "active") return { status: "processing", text: "活跃" };
  if (status === "ended") return { status: "default", text: "已结束" };
  if (status === "failed") return { status: "error", text: "已失败" };
  if (status === "suspended") return { status: "default", text: "已挂起" };
  if (status === "pending" || status === "reconnecting")
    return { status: "warning", text: "恢复中" };
  return { status: "default", text: "未知状态" };
}


/**
 * quick 历史加载提示 + 本地 Agent 会话信息折叠（原 SessionPanelPage sessionBody
 * JSX 内联段原样外提为**纯 JSX 工厂**（非组件，不加 fiber、DOM/元素结构零变化），
 * 行为零变化；Loader2 / local-report testid 均逐字保留）。
 */
export function renderHistoryAndLocalReport(o: {
  historyLoading: boolean;
  isToolReportActivated: boolean;
  localReportTurns: SessionTurnView[];
  localReportOpen: boolean;
  onToggleLocalReport: () => void;
}): ReactNode {
  const {
    historyLoading,
    isToolReportActivated,
    localReportTurns,
    localReportOpen,
    onToggleLocalReport,
  } = o;
  return (
    <>
      {historyLoading && (
        <div
          className="flex shrink-0 items-center justify-center gap-1.5 py-1.5 text-xs text-neutral-500"
          data-testid="session-load-earlier-hint"
        >
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          正在加载更早消息…
        </div>
      )}
      {/* quick 本地 Agent 会话信息折叠：tool_report 激活后，CLI 上报历史轮收进
          顶部小按钮（点击展开/收起），对话流只显示用户交互轮。 */}
      {isToolReportActivated && localReportTurns.length > 0 && (
        <div className="flex justify-center py-1">
          <button
            type="button"
            aria-expanded={localReportOpen}
            aria-label={localReportOpen ? "收起本地 Agent 会话信息" : "展开本地 Agent 会话信息"}
            data-testid="local-report-toggle"
            onClick={onToggleLocalReport}
            className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-3 py-0.5 text-[11px] text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground"
          >
            {localReportOpen ? "收起" : "展开"}本地 Agent 会话信息（{localReportTurns.length} 轮）
          </button>
        </div>
      )}
      {localReportOpen && (
        <div
          data-testid="local-report-block"
          className="mx-4 max-h-64 overflow-y-auto rounded-lg border border-border-weak bg-muted/40 px-3 py-2"
        >
          {localReportTurns.map((t) => (
            <div
              key={t.runId}
              className="border-b border-border-weak py-1.5 text-[12px] last:border-none"
            >
              <span className="mr-1.5 text-[11px] text-muted-foreground">CLI 上报</span>
              <span className="line-clamp-2 text-foreground/80">
                {(t.prompt || t.output || "（无内容）").slice(0, 160)}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/** TurnTimeline sessionStatus 投影（原 JSX 内联三元链外提，逻辑原样）。 */
export function deriveTimelineSessionStatus(
  ended: boolean,
  failed: boolean,
  restoring: boolean,
): "failed" | "ended" | "reconnecting" | "active" {
  if (ended) return failed ? "failed" : "ended";
  return restoring ? "reconnecting" : "active";
}

/** 引擎 label（PROVIDER_META 查表，缺省回退原值；dialog-helpers.getProviderLabel 同款）。 */
export function providerLabelOf(provider: string): string {
  return PROVIDER_META[provider]?.label ?? provider;
}
