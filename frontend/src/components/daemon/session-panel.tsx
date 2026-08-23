"use client";

/**
 * SessionPanel —— /sessions 页与 /runtimes 弹窗共享的会话面板（task-05 /
 * 2026-08-21-session-message-queue）。
 *
 * 依据：
 *   - changes/2026-08-21-session-message-queue/design.md §2 D-005（组件统一策略：
 *     从 sessions/page.tsx 提取共享 SessionPanel，mode 区分全页/弹窗）、§3.2；
 *   - changes/2026-08-21-session-message-queue/diff-analysis.md §4（props 接口
 *     草案 + 闭包依赖显式化归属决策表）、§6 风险清单 R1-R10——尤其 R4：
 *     react-query 调用（detailQuery / workspacesQuery / useQueryClient）全部收在
 *     「page 模式才渲染的内部子组件 SessionPanelPage」里，dialog 渲染路径零
 *     useQuery/useQueryClient 调用（3 套弹窗测试无 QueryClientProvider）。
 *
 * 结构：
 *   - 对外导出 SessionPanel：按 mode 分发，两个分支在渲染层互斥（本函数不调用
 *     任何 hook）。page 模式渲染内部子组件 SessionPanelPage（自 sessions/page.tsx
 *     页内 SessionPanel 整块搬运，行为零回归；task-03 / 2026-08-23-sessions-
 *     workspace-hub 新增：sessionId=null 预会话空态——与真会话同构渲染 +
 *     会话作用域 effect null 守卫清单（R-01）+ 首句 createSession（D-102，成功
 *     后父层切 sessionId 状态机自然接管，失败保留输入可重试 R-02））；dialog
 *     模式渲染内部子组件 SessionPanelDialog（自 interactive-session-panel.tsx
 *     逐段搬运 + 队列化改造，见下）；task-07 将把 interactive-session-panel.tsx
 *     改为薄适配层透传 mode="dialog"（diff-analysis §5 替换策略，本文件为其
 *     渲染主体）；
 *   - dialog 分支（task-05 第二步）：SSE 建流 / attach 轮询 1.5s×10 / initialTurns
 *     预填 + legacy 反投影（R1/D13）/ provider·model 选择器头部 / 新建·结束·
 *     团队分析按钮 / offlineReadOnly / 终止中横幅等 chrome 与状态机自 ISP 搬运；
 *     发送入口按 design §3.3 统一队列化——idle 首条 createSession 直发（R2：
 *     creating 态无既有 session 可附着，且 createSession 成功切 sessionId 会触发
 *     hook 清队，排队必丢），active / reconnecting 追问走 useMessageQueue 排队
 *     投递（D-001，投递条件 view.status==="active" && !view.currentRunId，R2），
 *     409 TURN_CONFLICT 旧「回填输入框」语义改由队头 failed + 重试/删除承载
 *     （D-003 有意变更，diff-analysis §5.2-2；弹窗测试旧禁用断言由 task-08/09
 *     同步更新，非回归）；dialog 渲染路径零 react-query（R4）、runsMeta 派生链
 *     不启用——turns 原样喂 TurnTimeline（R7）、附件能力关闭（R3）；
 *   - 会话态 100% 组件内部（R6：4 个 dialog 消费方依赖 key 重挂载清 SSE/轮询/
 *     队列，不得外提到组件外或模块级）；
 *   - SSE → upsertTurn → 共享装配器 → TurnTimeline / SessionInputBar /
 *     MessageQueueBar 主干与模块级辅助函数（upsertTurn / asAssembled /
 *     applyEnvelopeToTurn / deriveTurnTerminalStatus 等）两模式共用
 *     （diff-analysis §4.3 归属：〔内部〕模块级函数；upsertTurn 以 PAGE 版为
 *     基底保留 healToRunning，R1——对 dialog attach 竞态同样成立）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Ban,
  MessageSquareText,
  Plus,
  RefreshCw,
  Square,
  Users,
} from "lucide-react";
import { Badge, Button, Spin, Tag } from "antd";

import { AgentModelInput } from "@/components/AgentModelInput";
import { buildErrorLogItem } from "@/components/agent-log/normalize";
import {
  applyLogToSegments,
  createEmptyAssembledTurn,
  finishTurn,
  type AssembledTurn,
  type AssemblerLogInput,
  type TurnSegment,
} from "@/components/daemon/session-log-assembler";
import {
  TurnTimeline,
  type SessionProcessItem,
  type SessionTurnView,
  type SessionUiStatus,
  type TurnUiStatus,
} from "@/components/daemon/turn-timeline";
import type { AttachmentRead } from "@/lib/api/session-attachments";
import {
  parseAttachmentMarkers,
  runTerminalTurnStatus,
} from "@/components/daemon/runtime-session-helpers";
import { SessionInputBar } from "@/components/daemon/session-input-bar";
import { MessageQueueBar } from "@/components/daemon/message-queue-bar";
import { useMessageQueue } from "@/hooks/use-message-queue";
import { logsToTurns } from "@/components/daemon/runtime-session-helpers";
import { CtxUsageBar } from "@/components/sessions/ctx-usage-bar";
import { SessionConfigBar } from "@/components/sessions/session-config-bar";
import { SubagentCatalog } from "@/components/sessions/subagent-catalog";
import { ApiError } from "@/lib/api";
import { useNotify } from "@/lib/errors";
import { TeamTaskBlock, isActiveTeamMission } from "@/components/daemon/team-task-block";
import { TeamTriggerPopover } from "@/components/daemon/team-trigger-popover";
import {
  AgentLogCard,
  AgentLogSessionBody,
} from "@/components/daemon/agent-log-card";
import {
  type LlmProviderRead,
  type LlmProviderRoleMapping,
} from "@/lib/api/llm-providers";
import { listWorkspaces } from "@/lib/workspaces";
import { getChange } from "@/lib/changes";
import {
  createSession,
  endSession,
  fetchPendingDialogs,
  fetchSessionDialogHistory,
  getAgentSession,
  getAgentSessionLogs,
  injectSession,
  interruptSession,
  listSessionRuns,
  listSessionTeamMissions,
  triggerSessionTeamMission,
  PROVIDER_META,
  reopenSession,
  streamSession,
  type DaemonMachineRead,
  type InteractiveProvider,
  type SessionCreateResponse,
  type SessionDialogRead,
  type SessionPermissionRequest,
  type SessionRunRead,
  type SessionStreamConnection,
  type SessionStreamEnvelope,
  type TeamMissionSummary,
  type TeamMissionTriggerRequest,
} from "@/lib/daemon";
import { cn } from "@/lib/utils";

/**
 * 预会话上下文（task-03 / 2026-08-23-sessions-workspace-hub design §7）：
 * 入口/组头「＋」的解析产物，SessionPanel 空态渲染（锁定上下文行）与首句
 * createSession 共用。机器+引擎经 runtimeId 已定（绑定优先/D-005 回退/筛选
 * tab/浮层选择），创建后不可换（D-004@v2）。
 */
export interface SessionPreContext {
  /** null = 非工作区分组（不指定工作区）。 */
  workspaceId: string | null;
  /** 变更入口独立页传入（change 级隐含 workspace，调用方须显式双传，X-13）。 */
  changeId?: string | null;
  /** 目标 runtime id（首句 createSession 的 runtime_id）。 */
  runtimeId: string;
}

/**
 * 共享会话面板 props（diff-analysis.md §4.2 草案逐字落地，task-07 适配层按此编写）。
 * 归属标注沿用草案：〔prop〕外部注入/受控；〔内部〕组件自持（见 §4.3 决策表）。
 */
export interface SessionPanelProps {
  /** 模式："page" = /sessions 全页；"dialog" = 弹窗/内嵌（原 InteractiveSessionPanel 场景）。
   *  必填不设默认值，强制两个调用点显式声明，避免 task-06/07 过渡期出现第三种
   *  隐式形态。 */
  mode: "page" | "dialog";

  // ── 会话标识（两模式共用）──────────────────────────────────────────
  /** page 模式：选中的既有会话 id（父级同时用作 key）；null = 预会话空态
   *  （task-03 / D-101：与真会话同构，首句发送才 createSession 原地接管）。
   *  dialog 模式：null = idle 新建（首条消息走 createSession，原 attachSessionId
   *  为 undefined 的语义）；非 null = attach 续聊（原 attachSessionId）。
   *  〔prop〕会话 identity 必须外部驱动——两面板现状都由父级选中态决定，
   *  且 useMessageQueue 按 sessionId 切换清队。 */
  sessionId: string | null;

  // ── page 模式专属数据注入──────────────────────────────────────────
  /** page 必需：机器列表。离线判定（machineOnline）+ 头部机器名 + whoLine agentName
   *  兜底。〔prop〕页面级数据（useDaemonMachines 在页面取），面板不自持——弹窗侧
   *  无此概念（用 hasOnlineProvider/offlineReadOnly 表达在线性）。 */
  machines?: DaemonMachineRead[];

  /** page 必需：LLM 供应商实体列表（原 sessions 页 providers）。CtxUsageBar 分母派生 +
   *  多模态降级启发式 + whoLine providerName 解析。〔prop〕同上页面级 react-query
   *  数据（staleTime 30s）。与 dialog 的 providers（string[] 引擎名）是两回事，
   *  故改名消歧（diff-analysis §4.1 命名消歧）。 */
  llmProviders?: LlmProviderRead[];

  /** page 可选：会话终态 / 配置切换 / session_ended 后刷新左侧列表。
   *  〔prop〕纯回调。 */
  onSessionListRefresh?: () => void;

  /** page 可选：预会话上下文（task-03）。sessionId=null 时用于渲染锁定上下文行
   *  与首句 createSession（runtime_id 必需；workspace_id/change_id 条件下发）。
   *  change 入口须显式双传 workspaceId + changeId（X-13）。〔prop〕 */
  preContext?: SessionPreContext;

  /** page 可选：预会话首句创建成功上报（task-03）。父层据此切换 sessionId →
   *  面板状态机自然接管（门户接线归 task-06）。〔prop〕 */
  onPreSessionCreated?: (_resp: SessionCreateResponse) => void;

  // ── dialog 模式专属（对应 InteractiveSessionPanelProps）────────────
  /** dialog 必需：在线引擎名列表（claude/codex）。〔prop〕消费方从 runtimes 派生
   *  （4 个渲染点同源逻辑），面板不自持。 */
  providers?: string[];
  /** dialog 必需：默认引擎。〔prop〕内部 provider state 的初值 + 失联回退目标
   *  （回退 effect 保留为 dialog 内部逻辑）。 */
  defaultProvider?: string;
  /** dialog 必需：模型覆盖，受控于父级。〔prop〕父级 useState 持有。 */
  model?: string | null;
  /** dialog 必需：模型覆盖变更回调。〔prop〕同上受控对。 */
  onModelChange?: (next: string | null) => void;
  /** dialog 必需：是否有在线 provider（输入/选择器禁用 + 徽标）。〔prop〕消费方派生。 */
  hasOnlineProvider?: boolean;
  /** dialog 可选：attach 预填 turns（消费方先拉 logs 再 mount）。
   *  〔prop〕一次性初始值，仅 mount 时读取。 */
  initialTurns?: SessionTurnView[];
  /** dialog 可选：createSession 成功上报（父级写 URL ?session= / 刷新列表）。〔prop〕。 */
  onSessionCreated?: (sessionId: string) => void;
  /** dialog 可选：面板重置回 idle / end 成功上报（父级清 URL / 清选中 / 刷新）。〔prop〕。 */
  onSessionReset?: () => void;
  /** dialog 可选：createSession 绑定 change 上下文。〔prop〕仅 change-session-section 传。 */
  changeId?: string;
  /** dialog 可选：createSession 绑定 workspace + team 按钮显隐开关。〔prop〕2/4 消费方传。 */
  workspaceId?: string;
  /** dialog 可选：团队任务上报。〔prop〕task-11 起语义 = 触发弹层确认后
   *  triggerSessionTeamMission 预建成功的 mission_id 上报（父级可挂 TeamProgress）；
   *  当前无消费方传，保留透传位（design D-005 明确要求 team 可选透传）。 */
  onTeamMissionCreated?: (missionId: string) => void;
  /** dialog 可选：离线只读（禁 4 操作 + 不建 SSE + 横幅）。〔prop〕仅 runtime-session-dialog 传。 */
  offlineReadOnly?: boolean;

  // ── 视图控制（两模式共用；不传则组件内部自持）──────────────────────
  /** 可选受控：消息视图模式。〔prop〕dialog 模式适配层不传（内部 useState 同款）。
   *  受控-可选模式：传入 onViewModeChange 即受控。 */
  viewMode?: "conversation" | "all";
  /** 配套变更回调（与 viewMode 成对传或成对不传）。〔prop〕 */
  onViewModeChange?: (mode: "conversation" | "all") => void;
}

/**
 * 对外组件：按 mode 分发（page / dialog 两分支均已激活）。
 *
 * 本函数不调用任何 hook——mode 分支在渲染层互斥，保证 dialog 渲染路径零
 * react-query 调用（R4）；key 重挂载契约由父级 key 驱动本组件整体 remount（R6）。
 */
export function SessionPanel(props: SessionPanelProps) {
  if (props.mode === "page") {
    // task-03（D-101）：sessionId=null = 预会话空态——不再防御性 return null，
    // 改为渲染与真会话同构的空态（首句发送才 createSession 原地接管，用户硬
    // 约束"不要独立页面"）；非 null 语义不变（父级选中态驱动）。
    return (
      <SessionPanelPage
        sessionId={props.sessionId}
        machines={props.machines ?? []}
        llmProviders={props.llmProviders ?? []}
        onSessionListRefresh={props.onSessionListRefresh}
        preContext={props.preContext}
        onPreSessionCreated={props.onPreSessionCreated}
      />
    );
  }
  // dialog 模式（原 InteractiveSessionPanel 场景，ISP 逐段搬运 + 队列化改造，
  // 见文件头「dialog 分支」段）：sessionId 非 null = attach 续聊（原 attachSessionId），
  // null = idle 新建（首条消息 createSession 直发）。task-07 适配层按 §5.1 映射表
  // 透传全部 dialog props 到本分支（attachSessionId ?? null 归一）。
  return <SessionPanelDialog {...props} />;
}

/* ────────────────────── page 模式内部子组件（含 react-query，R4） ────────────────────── */

/** page 模式窄化 props（外层 SessionPanel 已归一可选 props，见分发处）。 */
interface SessionPanelPageProps {
  /** task-03：null = 预会话空态（同构渲染 + 全 effect null 守卫，R-01）。 */
  sessionId: string | null;
  machines: DaemonMachineRead[];
  llmProviders: LlmProviderRead[];
  /** 会话终态 / 配置切换后刷新左侧列表。 */
  onSessionListRefresh?: () => void;
  /** 预会话上下文（sessionId=null 时渲染锁定上下文行 + 首句 createSession）。 */
  preContext?: SessionPreContext;
  /** 预会话首句创建成功上报（父层切 sessionId → 状态机自然接管）。 */
  onPreSessionCreated?: (_resp: SessionCreateResponse) => void;
}

const MAX_PROMPT_LEN = 8000;

/**
 * task-08（2026-08-21-session-reopen-resume / FR-09）：重新开启 409 错误码 → 中文
 * 文案映射。后端 reopen 409 的 message 是英文原文（DaemonSessionNotActive 等
 * AppError 子类），errMessage 默认透传 err.message——errors.ts 不在本卡
 * allowed_paths，映射收敛在本组件（handleReopen notify 前查表，未命中回退既有
 * 行为）。错误码对齐 backend/app/modules/daemon/session/service.py:188-256（含
 * task-04 新增的空 cwd 码 HTTP_409_DAEMON_SESSION_NO_CWD，DS-7）。
 */
const REOPEN_ERROR_ZH: Record<string, string> = {
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
const RECONNECT_TIMEOUT_MS = 240_000;

/** turn 状态（currentRunId 只指向 pending/running/interrupting turn）。 */
interface TurnState {
  turns: SessionTurnView[];
  currentRunId: string | null;
}

const INITIAL_TURN_STATE: TurnState = { turns: [], currentRunId: null };

/* ────────────────────── task-11（2026-08-22-team-session-unify）：会话内团队触发（page/dialog 共用） ────────────────────── */

/** 活跃 mission 轮询间隔（design §5 Phase 3：活跃 5s 轮询、终态停止）。 */
const TEAM_MISSION_POLL_MS = 5000;

/**
 * /team 指令前缀解析（D-004 四路等价）：命中返回去前缀目标文本（可空串），
 * 未命中返回 null（普通消息原路发送）。仅匹配整条指令——"/teams" 之类不误伤。
 */
function parseTeamCommand(prompt: string): string | null {
  const m = /^\/team(?:\s+([\s\S]*))?$/.exec(prompt);
  return m ? (m[1] ?? "").trim() : null;
}

/** triggerSessionTeamMission 错误 → 中文文案（409 单活跃冲突 / 403 项目维度权限 / 422 参数）。 */
function teamTriggerErrorText(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 409) return "已有进行中的团队任务，等它完成或取消后再派";
    if (err.status === 403) return "无权限派发团队（项目维度仅项目经理可用）";
    if (err.status === 422) return `派发参数有误：${err.message}`;
    return err.message;
  }
  return "派团队失败，请稍后重试";
}

/**
 * task-11：会话团队任务列表（GET /sessions/{id}/team-missions）+ 活跃 5s 轮询。
 * 纯 fetch + setInterval（不用 react-query——R4：团队入口在 dialog 渲染路径同样
 * 挂载，dialog 分支零 react-query 铁律覆盖至此）；拉取失败静默（任务块非关键
 * 路径，不阻断会话主流程，下轮轮询/取消刷新自愈）。
 */
function useSessionTeamMissions(sessionId: string | null) {
  const [missions, setMissions] = useState<TeamMissionSummary[]>([]);
  const refresh = useCallback(async () => {
    if (!sessionId) return;
    try {
      setMissions(await listSessionTeamMissions(sessionId));
    } catch {
      /* 列表拉取失败不阻断 */
    }
  }, [sessionId]);
  useEffect(() => {
    setMissions([]);
    if (sessionId) void refresh();
  }, [sessionId, refresh]);
  const hasActive = missions.some((m) => isActiveTeamMission(m.status));
  useEffect(() => {
    if (!sessionId || !hasActive) return;
    const timer = window.setInterval(() => {
      void refresh();
    }, TEAM_MISSION_POLL_MS);
    return () => window.clearInterval(timer);
  }, [sessionId, hasActive, refresh]);
  return { missions, refresh };
}

/**
 * task-11：输入区上方团队触发行（原型 §01 .team-trigger-row + §02 弹层锚点），
 * page/dialog 两模式共用：派团队按钮（引擎门控 + tooltip）+ 活跃状态 chip（可
 * 关闭收回）+ TeamTriggerPopover 挂载（relative 锚点 + absolute bottom-full，
 * 同 SessionConfigBar 浮层风格）+ 触发错误提示（409/403/422 中文文案）。
 * 纯受控：API 调用/弹层开关归父层（本组件不含团队业务状态）。
 */
interface TeamTriggerRowProps {
  /** 派团队按钮禁用（引擎非 claude / 无会话 / 终态 / 离线等，由父层合成）。 */
  disabled: boolean;
  /** 按钮 tooltip（引擎门控时固定「团队需要 Claude 引擎」）。 */
  tooltip: string;
  /** 活跃 mission 分身数（chip 文案「团队进行中 · N 分身」）；null = 隐藏。 */
  activeWorkers: number | null;
  /** chip 关闭（只收回提示条，不取消任务——TeamTaskBlock 仍展示进展）。 */
  onDismissChip: () => void;
  /** 弹层开关（父层 state）。 */
  popoverOpen: boolean;
  /** 会话绑定工作区（弹层 scope 默认「当前工作区」数据源）。 */
  workspaceId: string | null;
  workspaceName: string | null;
  /** 目标预填（/team 指令文本 /「用团队分析」提示句）。 */
  defaultObjective: string | null;
  /** triggerSessionTeamMission 在途（确认按钮禁用）。 */
  submitting: boolean;
  /** 触发错误文案（弹层保持打开时行内展示）。 */
  errorText: string | null;
  onOpen: () => void;
  onTrigger: (payload: TeamMissionTriggerRequest) => void;
  onClose: () => void;
}

function TeamTriggerRow({
  disabled,
  tooltip,
  activeWorkers,
  onDismissChip,
  popoverOpen,
  workspaceId,
  workspaceName,
  defaultObjective,
  submitting,
  errorText,
  onOpen,
  onTrigger,
  onClose,
}: TeamTriggerRowProps) {
  return (
    <div className="relative flex shrink-0 flex-wrap items-center gap-2 border-t border-border bg-card px-5 py-2">
      <button
        type="button"
        onClick={onOpen}
        disabled={disabled}
        title={tooltip}
        className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-violet-300 bg-violet-50/60 px-2.5 text-[12px] font-semibold text-violet-700 hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Users className="h-3.5 w-3.5" aria-hidden />
        派团队
      </button>
      {activeWorkers !== null && (
        <span
          data-testid="team-active-chip"
          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-violet-300 bg-violet-50 px-2.5 py-0.5 text-[11.5px] font-medium text-violet-700"
        >
          <span aria-hidden>👥</span>团队进行中 · {activeWorkers} 分身
          <button
            type="button"
            aria-label="收起团队状态提示"
            onClick={onDismissChip}
            className="ml-0.5 rounded-full px-1 leading-none text-violet-500 hover:bg-violet-100 hover:text-violet-700"
          >
            ×
          </button>
        </span>
      )}
      {errorText && (
        <p role="alert" className="min-w-0 flex-1 truncate text-[11px] text-destructive">
          {errorText}
        </p>
      )}
      {popoverOpen && (
        <TeamTriggerPopover
          workspaceId={workspaceId}
          workspaceName={workspaceName}
          defaultObjective={defaultObjective}
          submitting={submitting}
          onTrigger={onTrigger}
          onClose={onClose}
        />
      )}
    </div>
  );
}

function SessionPanelPage({
  sessionId,
  machines,
  llmProviders,
  onSessionListRefresh,
  preContext,
  onPreSessionCreated,
}: SessionPanelPageProps) {
  const qc = useQueryClient();
  const notify = useNotify();

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
    refetchInterval: (query) => {
      const st = query.state.data?.status;
      return st === "pending" || st === "reconnecting" ? 1500 : false;
    },
  });
  const session = detailQuery.data ?? null;

  // ── 工作区名称解析（面板头部显示）─────────────────────────────────────────
  const workspacesQuery = useQuery({
    queryKey: ["workspaces", "session-panel"],
    queryFn: () => listWorkspaces({ limit: 100 }),
    staleTime: 60_000,
  });
  const workspaceName = useMemo(() => {
    if (!session?.workspace_id) return null;
    return (
      workspacesQuery.data?.items.find((ws) => ws.id === session.workspace_id)
        ?.name ?? null
    );
  }, [session?.workspace_id, workspacesQuery.data]);

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

  // ── 实时 turn 状态机（对齐 interactive-session-panel 的 SSE 处理）───────
  const [turnState, setTurnState] = useState<TurnState>(INITIAL_TURN_STATE);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [pendingRequests, setPendingRequests] = useState<
    SessionPermissionRequest[]
  >([]);
  const [dialogHistory, setDialogHistory] = useState<SessionDialogRead[]>([]);
  // gap-fix（FR-07 / FR-08）：run 级轮次快照（id → SessionRunRead），attach 时
  // 预取 + 每轮 turn_completed 后刷新，供 whoLine 注入与历史 usage 回填。
  const [runsMeta, setRunsMeta] = useState<Map<string, SessionRunRead>>(new Map());
  const [viewMode, setViewMode] = useState<"conversation" | "all">("conversation");
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

  // ── task-03（2026-08-23-sessions-workspace-hub）：预会话首句创建态 ────────
  // creating 在途（发送按钮 spinner + 防重复提交）；失败内联错误（R-02：输入
  // 保留可重试，不切真会话态）。dialog idle 先例是"先清输入再建、失败即丢"，
  // 这里改为成功后才清空（Grill X-02）。
  const [preCreating, setPreCreating] = useState(false);
  // ql-20260823-008：预会话供应商/档案暂存——SessionConfigBar provisional 模式
  // 点选暂存（无会话不 inject），首句 createSession 携带（""=不指定/本机默认不传）。
  const [preProviderId, setPreProviderId] = useState("");
  const [preProfileId, setPreProfileId] = useState("");
  const [preError, setPreError] = useState<string | null>(null);

  // ── task-11（2026-08-22-team-session-unify）：会话内团队触发 + TeamTaskBlock ──
  // 任务列表/轮询共用 hook；弹层开关与预填、触发在途、错误文案、chip 收回为面板态。
  const { missions: teamMissions, refresh: refreshTeamMissions } =
    useSessionTeamMissions(sessionId);
  const [teamPopover, setTeamPopover] = useState<{ open: boolean; objective: string | null }>({
    open: false,
    objective: null,
  });
  const [teamTriggering, setTeamTriggering] = useState(false);
  const [teamError, setTeamError] = useState<string | null>(null);
  const [teamChipDismissedId, setTeamChipDismissedId] = useState<string | null>(null);

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

  // ── SSE 建流 + 历史预取（sessionId 驱动，切换会话即重建）────────────────
  // gap-fix（FR-07/FR-08）：runs 快照拉取失败不阻断——whoLine 不注入、历史
  // usage 走实时 SSE 路径，与 logs 预取同一容错语义。
  const refreshRunsMeta = useCallback((id: string) => {
    void listSessionRuns(id)
      .then((runs) => {
        setRunsMeta(new Map(runs.map((r) => [r.id, r])));
      })
      .catch(() => {
        /* 快照拉取失败不阻断主流程 */
      });
  }, []);

  useEffect(() => {
    // task-03（R-01）：预会话态不建流/不预取历史（getAgentSessionLogs /
    // listSessionRuns 均零调用）。首句创建成功后父层切 sessionId，本 effect 随
    // 依赖变化自然接管；string→null 时上方 cleanup 已 close 旧流。
    if (!sessionId) return;
    let cancelled = false;
    setTurnState(INITIAL_TURN_STATE);
    setErrorMsg(null);
    setPendingRequests([]);
    setRunsMeta(new Map());
    fetchedErrorRunIdsRef.current.clear();
    currentRunIdRef.current = null;
    // task-03：随队列清空（hook 同按 sessionId 切换清队）一并丢弃附件元数据镜像。
    attachmentMetaRef.current.clear();

    // 预取历史 logs 回灌（防 SSE 订阅前 daemon publish 丢事件）；已有实时
    // turn 时不覆盖（SSE 先到时保留）。
    void getAgentSessionLogs(sessionId)
      .then((logs) => {
        if (cancelled) return;
        const restored = logsToTurns(logs);
        setTurnState((prev) => {
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
      })
      .catch(() => {
        /* 历史拉取失败不阻断 SSE */
      });

    // gap-fix：attach 并发拉 run 级轮次快照（whoLine + 历史 usage 数据源）。
    void listSessionRuns(sessionId)
      .then((runs) => {
        if (cancelled) return;
        setRunsMeta(new Map(runs.map((r) => [r.id, r])));
      })
      .catch(() => {
        /* 快照拉取失败不阻断 SSE */
      });

    streamRef.current = streamSession(sessionId, {
      onTurnStarted: (env) => {
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
      onLog: (env) => {
        // user_input 是用户消息（attach 历史/占位 turn 已作 prompt），不进 output
        // （装配器内同语义双保险）。task-09（FR-05）：其余日志归一喂共享装配器，
        // 分类 / override 撤回 / tool 配对 / 子代理归属一律依赖装配器导出。
        if (env.channel === "user_input") return;
        setTurnState((prev) =>
          upsertTurn(
            prev,
            env,
            (turn) => applyEnvelopeToTurn(turn, env),
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
              };
            },
            { clearCurrentRun: env.run_id! },
          ),
        );

        // gap-fix（D-008@v1）：每轮终态后刷新 run 快照——本轮 whoLine/usage 由
        // run 行（dispatch 冻结）注入，切换配置后的下一轮跟随新快照。
        refreshRunsMeta(sessionId);

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
              const item = buildErrorLogItem(matched?.error_detail ?? null);
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
            }),
            {},
          ),
        );
      },
      onSessionEnded: () => {
        // streamSession 内部已 close；收口本地态 + 刷新详情/列表。
        setTurnState((prev) => ({ ...prev, currentRunId: null }));
        setPendingRequests([]);
        streamRef.current = null;
        void qc.invalidateQueries({ queryKey: ["agentSessionDetail", sessionId] });
        onSessionListRefresh?.();
      },
      onError: () => {
        // 不伪造终态；浏览器携 Last-Event-ID 自动重连。
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
          prev.filter((r) => r.request_id !== resolved.request_id),
        );
      },
    });

    return () => {
      cancelled = true;
      streamRef.current?.close();
      streamRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

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
  const machineHit = useMemo(() => {
    if (!session?.runtime_id) return null;
    return (
      machines.find((m) => (m.runtimes ?? []).some((r) => r.id === session.runtime_id)) ??
      null
    );
  }, [machines, session?.runtime_id]);
  // 找不到所属机器（列表分页外/已删除）不武断判离线。
  const machineOnline = machineHit ? machineHit.status === "online" : true;
  const machineName = machineHit
    ? machineHit.display_alias?.trim() || machineHit.hostname
    : session?.config_snapshot?.machine_name ?? null;

  // ── task-03（D-101）：预会话派生（preContext → 上下文行 + 输入门控）──────
  // 与真会话的 machineHit/machineOnline 同构：runtimeId 反查所属机器与引擎；
  // 找不到机器（列表分页外/已删除）不武断判离线（既有 machineOnline 同语义）。
  const preRuntimeHit = useMemo(
    () =>
      preContext
        ? (machines
            .flatMap((m) => m.runtimes ?? [])
            .find((r) => r.id === preContext.runtimeId) ?? null)
        : null,
    [machines, preContext],
  );
  const preMachine = useMemo(
    () =>
      preContext
        ? (machines.find((m) =>
            (m.runtimes ?? []).some((r) => r.id === preContext.runtimeId),
          ) ?? null)
        : null,
    [machines, preContext],
  );
  const preMachineName = preMachine
    ? preMachine.display_alias?.trim() || preMachine.hostname
    : null;
  const preMachineOnline = preMachine ? preMachine.status === "online" : true;
  const preEngine = preRuntimeHit?.provider ?? null;
  const preAgentLabel = preEngine
    ? (PROVIDER_META[preEngine]?.label ?? preEngine)
    : null;
  // 上下文行工作区名（与真会话 workspaceName 同源 workspacesQuery；预会话态
  // 该 query 仍启用——页面级数据，非会话作用域）。
  const preWorkspaceName = useMemo(() => {
    const wsId = preContext?.workspaceId ?? null;
    if (!wsId) return null;
    return workspacesQuery.data?.items.find((ws) => ws.id === wsId)?.name ?? null;
  }, [preContext, workspacesQuery.data]);
  // 上下文行变更名（task-07 / D-106）：change 入口加显——title 回退 change_key，
  // 查询中/失败显 —（FRONTEND_PAGE_STYLE 空值统一）。
  const preChangeName = useMemo(() => {
    if (!preContext?.changeId) return null;
    return preChangeQuery.data?.title ?? preChangeQuery.data?.change_key ?? null;
  }, [preContext?.changeId, preChangeQuery.data]);
  // 附件门控（D-6 引擎门控同构）：预会话无会话实体，按目标 runtime 引擎判定。
  const preAttachmentsDisabled = preEngine !== "claude";

  const status = session?.status ?? null;
  const ended = status === "ended" || status === "failed";
  const restoring = status === "pending" || status === "reconnecting";
  const running = turnState.currentRunId != null;
  // task-03（design §3.3）：队列投递条件之一——后端 inject 守卫 status=active
  // （D-001），reconnecting/pending 期间只排队不投递。
  const sessionActive = status === "active";

  // ── 2026-08-20 task-12：附件门控派生（D-6 引擎 / FR-10 D-9 多模态降级）────
  const sessionEngine = session?.provider ?? null;
  const attachmentsDisabled = sessionEngine !== "claude";
  // 会话实际生效供应商（会话绑定优先；本机默认/未选 → null = 能力未知）。
  const effectiveProvider = useMemo(
    () =>
      llmProviders.find(
        (p) => p.id === (session?.llm_provider_id ?? null),
      ) ?? null,
    [llmProviders, session?.llm_provider_id],
  );
  const multimodalDowngraded = useMemo(() => {
    if (!effectiveProvider) return false;
    if (effectiveProvider.multimodal === "false") return true;
    if (effectiveProvider.multimodal === "true") return false;
    // auto：前端同源启发式（backend capability.py 权威；此处仅提示条预览）。
    const model = effectiveProvider.model ?? effectiveProvider.default_fallback_model ?? "";
    const lowered = model.toLowerCase();
    return !/(vision|vl|glm-[34]\.\d+v|gpt-4o|gpt-4\.1|gpt-5|claude|gemini|qwen-vl|doubao-seed)/.test(
      lowered,
    );
  }, [effectiveProvider]);

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
    () =>
      machines.flatMap((m) => m.runtimes ?? []).find(
        (r) => r.id === session?.runtime_id,
      ) ?? null,
    [machines, session?.runtime_id],
  );
  const agentDisplayName = useMemo(() => {
    const fromSnapshot = session?.config_snapshot?.agent_name?.trim();
    if (fromSnapshot) return fromSnapshot;
    const fromRuntime =
      runtimeHit?.display_alias?.trim() || runtimeHit?.name?.trim() || null;
    if (fromRuntime) return fromRuntime;
    return session
      ? (PROVIDER_META[session.provider]?.label ?? session.provider)
      : "";
  }, [session, runtimeHit]);

  // 按 run 快照补 whoLine / 历史 usage：只补缺（?? 链），实时 SSE 值优先；
  // run 快照缺失（拉取失败 / 占位 turn）原样返回——whoLine 不渲染（零回归）。
  const displayTurns = useMemo(() => {
    if (runsMeta.size === 0) return turnState.turns;
    const enriched = turnState.turns.map((t) => {
      const meta = runsMeta.get(t.realRunId ?? t.runId);
      if (!meta) return t;
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
                  buildErrorLogItem(meta.error_detail) ?? {
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
                me: meta.user_id === session?.user_id,
                at: meta.started_at ?? null,
              }
            : undefined),
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
        // ql-20260817-004：答复完成时间（finished_at 优先；运行中/旧数据 null 不显示）。
        replyAt: t.replyAt ?? meta.finished_at ?? meta.started_at ?? null,
        // task-09（FR-02）计时锚点 ?? 链：turn 已有值（live 发送占位 / 首条 log
        // timestamp 兜底）优先，run 快照 started_at 次之——attach 恢复计时不归零
        // 不重计（SSE 流中无 run_started 事件，不覆盖已有锚点）。
        turnStartedAt: t.turnStartedAt ?? parseRunStartedAt(meta.started_at),
      };
    });
    // ql-20260818-011：runsMeta 中的静默切换 run 无 SSE 事件→不在 turnState.turns
    // 中→displayTurns 迭代忽略→重进才可见。补建孤儿 turn（无 prompt/output，
    // 有 whoLine，已完成后台 run），让它们实时出现。
    const knownRunIds = new Set(turnState.turns.map((t) => t.realRunId ?? t.runId));
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
              me: meta.user_id === session?.user_id,
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
  }, [turnState.turns, runsMeta, llmProviders, agentDisplayName, session?.user_id]);

  // CtxUsageBar：累计 usage（实时 turn input_tokens 求和 + 历史轮回填，R-06 前端累计）
  // + 分母派生（会话供应商 role mapping one_m → fallback model，D-014）。
  const ctxProvider = useMemo(
    () => llmProviders.find((p) => p.id === session?.llm_provider_id) ?? null,
    [llmProviders, session?.llm_provider_id],
  );
  const ctxRoleMapping = useMemo<LlmProviderRoleMapping | null>(() => {
    const mrm = ctxProvider?.model_role_mappings;
    if (!mrm) return null;
    return mrm["sonnet"] ?? Object.values(mrm)[0] ?? null;
  }, [ctxProvider]);
  const ctxFallbackModel =
    ctxProvider?.default_fallback_model ?? ctxProvider?.model ?? null;
  const usedTokens = useMemo(
    () => displayTurns.reduce((n, t) => n + (t.inputTokens ?? 0), 0),
    [displayTurns],
  );

  // ── 消息队列（2026-08-21-session-message-queue task-03 / design §3.3）──────
  // 发送入口统一走 useMessageQueue：active 且无 currentRun 时 processQueue 立即
  // 投递（等效原「立即发送」）；running / reconnecting / pending 时入队等待
  // （D-001 前端队列等 active），turn_completed 清 currentRun / 轮询 status→active
  // 均由 hook 内 effect 自动触发投递，面板不保留第二条直发路径。

  /**
   * 队列投递回调（hook onSend，接 injectSession）。
   * 关键时序（design §3.4「inject 成功 → currentRunId = run_id」）：进入本函数
   * 即同步置占位 currentRunId（placeholder id），inject 响应到达后替换为真实
   * run_id——两步都在 resolve 之前完成。若等 SSE turn_started 才置位，hook 的
   * processQueue effect 会在 hasCurrentRun 仍为 false 的窗口期把下一条也发出，
   * 同一 turn 连发两条破坏串行。
   * 失败路径：占位轮回滚 + errorMsg 展示后继续向上抛出——hook 据此把条目标记
   * failed 留在队头（D-003），用户点重试/删除，面板不再回填输入框（旧 409 回填
   * 语义由队头 failed + 重试替代）。
   */
  const sendFromQueue = useCallback(
    async (prompt: string, attachmentIds: string[]) => {
      // task-03（R-01）：预会话态无会话可 inject——sessionActive=false 时 hook
      // 不投递，此处防御性短路（对齐 dialog 版 ?? "" + status 守卫先例）。
      if (!sessionId) return;
      const placeholderId = `__pending_inject_${Date.now()}__`;
      // ql-20260821-002：占位轮合成标记行——与 handleSend 入队侧逐字同构
      // （后端落库标记行同款，真实日志到达后无感接管）；kind/name 查
      // attachmentMetaRef（D-004，入队时已登记，兜底值仅防御异常路径）。
      const markerLines = attachmentIds
        .map((id) => {
          const meta = attachmentMetaRef.current.get(id);
          return `[附件:${id}|${meta?.kind ?? "file"}|${meta?.name ?? id}]`;
        })
        .join("\n");
      const displayPrompt = prompt ? `${markerLines}\n${prompt}` : markerLines;
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
        });
        setTurnState((prev) => ({
          currentRunId: resp.run_id,
          turns: prev.turns.map((t) =>
            t.runId === placeholderId
              ? { ...t, runId: resp.run_id, status: "running" }
              : t,
          ),
        }));
        setErrorMsg(null);
        // D-004：投递成功后清理附件元数据镜像（条目已出队，ids 不再被引用）。
        for (const id of attachmentIds) attachmentMetaRef.current.delete(id);
      } catch (err) {
        const apiErr = err as ApiError;
        setTurnState((prev) => ({
          currentRunId: null,
          turns: prev.turns.filter((t) => t.runId !== placeholderId),
        }));
        setErrorMsg(apiErr instanceof ApiError ? apiErr.message : "发送失败");
        throw err; // D-003：向上抛 → hook 标记 failed 留队头，不吞错
      }
    },
    [sessionId],
  );

  const { queue, enqueue, removeEntry, retryEntry, isQueueFull } =
    useMessageQueue({
      // task-03（R-01）：预会话态队列不激活不投递（sessionActive=false——
      // session 为 null 时 status 派生 null；对齐 dialog 版 view.sessionId ?? ""
      // + status!=="active" 先例）。
      sessionId: sessionId ?? "",
      sessionActive,
      hasCurrentRun: running,
      onSend: sendFromQueue,
    });

  // ── 操作 ───────────────────────────────────────────────────────────────
  // task-11：团队弹层开关（打开时清旧错误；objective 预填 /team 指令文本）。
  const openTeamPopover = useCallback((objective: string | null) => {
    setTeamError(null);
    setTeamPopover({ open: true, objective });
  }, []);
  const closeTeamPopover = useCallback(() => {
    setTeamError(null);
    setTeamPopover({ open: false, objective: null });
  }, []);

  /**
   * task-11：弹层确认 → POST /sessions/{id}/team-mission 预建（triggerSessionTeamMission）。
   * 成功：关弹层 + 刷新 mission 列表（TeamTaskBlock/chip 即时呈现）+ objective
   * 回填输入框（「就绪，随下条消息发出」——CC-09 首条 inject 回填 mission objective）。
   * 失败：弹层保持打开，行内中文文案提示（409 活跃冲突/403 项目权限/422 参数）。
   */
  const handleTeamTrigger = useCallback(
    async (payload: TeamMissionTriggerRequest) => {
      // task-03（R-01）：预会话态无会话可挂 mission（team 行为会话绑定）。
      if (!sessionId) return;
      setTeamTriggering(true);
      setTeamError(null);
      try {
        await triggerSessionTeamMission(sessionId, payload);
        closeTeamPopover();
        await refreshTeamMissions();
        if (payload.objective) setInput(payload.objective);
      } catch (err) {
        setTeamError(teamTriggerErrorText(err));
      } finally {
        setTeamTriggering(false);
      }
    },
    [sessionId, refreshTeamMissions, closeTeamPopover],
  );

  /**
   * task-03（D-102）：预会话首句创建——发送动作触发 createSession（后端 prompt
   * 首句约束由发送满足，零协议改动）。复用 dialog idle 先例（:2359-2421）但两处
   * 改造（Grill X-02）：① 传 runtime_id（机器+引擎已定）而非 dialog 的 provider；
   * ② 成功后才清空输入（dialog 现状先清后建、失败输入即丢）——失败保留输入 +
   * 内联错误可重试（R-02），不切真会话态。成功经 onPreSessionCreated 上报父层
   * （父层切 sessionId → 本组件状态机自然接管，门户接线归 task-06）。
   * 注：createSession 契约无 attachment_ids（R3 先例）——附件 chips 随成功清空，
   * 首句只发文本。
   */
  const handlePreSessionSend = useCallback(
    async (prompt: string) => {
      if (!preContext || preCreating) return;
      setPreCreating(true);
      setPreError(null);
      try {
        const resp = await createSession({
          runtime_id: preContext.runtimeId,
          prompt,
          manual_approval: true,
          ask_user_only: true,
          ...(preContext.workspaceId
            ? { workspace_id: preContext.workspaceId }
            : {}),
          ...(preContext.changeId ? { change_id: preContext.changeId } : {}),
          // ql-20260823-008：预会话配置条暂存值随首句落为会话初始配置。
          ...(preProviderId ? { llm_provider_id: preProviderId } : {}),
          ...(preProfileId ? { agent_profile_id: preProfileId } : {}),
        });
        // R-02：成功才清空（失败路径输入保留在 catch 之外，可原地重试）。
        setInput("");
        setPendingAttachments([]);
        clearAttachmentsRef.current?.();
        onPreSessionCreated?.(resp);
      } catch (err) {
        setPreError(err instanceof ApiError ? err.message : "创建会话失败，请重试");
      } finally {
        setPreCreating(false);
      }
    },
    [preContext, preCreating, onPreSessionCreated, preProviderId, preProfileId],
  );

  // task-03（design §3.3 状态机）：发送 = 统一 enqueue。active 且无 currentRun
  // 时 hook 立即投递（行为等效原直发）；running / reconnecting / pending 时排队，
  // 由 hook 在 turn_completed / status→active 后自动投递。原直发路径（restoring/
  // running 禁发守卫 + 409 回填输入）删除——失败语义改由 D-003 队头 failed +
  // 重试/删除承载。
  const handleSend = useCallback(() => {
    const prompt = input.trim();
    // 2026-08-20 task-12（D-7）：附件非空允许空文本（看图说话）；纯文本仍守卫。
    if ((!prompt && pendingAttachments.length === 0) || prompt.length > MAX_PROMPT_LEN) return;
    // task-03（D-102）：预会话首句 → createSession 直发（不走队列——无既有
    // session 可附着，R2 先例）；首句必须非空（后端 prompt 首句约束）。
    if (!sessionId) {
      if (!prompt) return;
      void handlePreSessionSend(prompt);
      return;
    }
    // task-11（D-004 四路等价）：/team 前缀拦截——不直接发送，弹层确认后目标文本
    // 随下条消息发出（objective 预填去前缀文本）。仅 Claude 会话且可发消息时拦截。
    const teamCmd = parseTeamCommand(prompt);
    if (teamCmd !== null && sessionEngine === "claude" && !ended && machineOnline) {
      openTeamPopover(teamCmd || null);
      setInput("");
      return;
    }
    // design §3.3：仅终态（ended/failed）与离线禁发；running / reconnecting /
    // pending 不再拦截（入队等待，D-001）。
    if (!session || ended || !machineOnline) return;
    if (isQueueFull) return; // D-002 满员拒收：提示见 placeholder，草稿与附件保留
    const attachmentIds = pendingAttachments.map((a) => a.id);
    // ql-20260821-002：队列条目展示文本（MessageQueueBar 摘要/展开用）——附件
    // 标记行 + 原文；投递侧占位轮标记行在 sendFromQueue 依 attachmentMetaRef
    // 重建（与后端落库标记行逐字同构）。
    const markerLines = pendingAttachments
      .map((a) => `[附件:${a.id}|${a.kind}|${a.name}]`)
      .join("\n");
    const displayPrompt = prompt
      ? `${markerLines}\n${prompt}`
      : markerLines;
    // D-004：登记附件元数据（onSend 只携带 ids）——先登记再入队，保证投递时可查。
    for (const a of pendingAttachments) {
      attachmentMetaRef.current.set(a.id, { kind: a.kind, name: a.name });
    }
    if (!enqueue(prompt, attachmentIds, displayPrompt)) return; // D-002 兜底
    // 入队成功：草稿与附件 chips 即时清空（所有权移交队列条目，ids 已被引用）。
    setInput("");
    setPendingAttachments([]);
    clearAttachmentsRef.current?.();
  }, [input, sessionId, session, ended, machineOnline, isQueueFull, pendingAttachments, enqueue, sessionEngine, openTeamPopover, handlePreSessionSend]);

  const handleInterrupt = useCallback(async () => {
    // task-03（R-01）：预会话态无可打断轮（按钮本就禁用，防御性短路）。
    if (!sessionId || !session || session.status !== "active" || !turnState.currentRunId) return;
    const localRunId = turnState.currentRunId;
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
        setErrorMsg(apiErr instanceof ApiError ? apiErr.message : "打断失败");
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
            errorDetail: null,
            processItems: [],
            // task-09（FR-02）：同 handleSend——live 锚点 = 本地重发占位时刻。
            segments: [],
            turnStartedAt: Date.now(),
          },
        ],
      }));
      try {
        const resp = await injectSession(sessionId, trimmed);
        setTurnState((prev) => ({
          currentRunId: resp.run_id,
          turns: prev.turns.map((t) =>
            t.runId === placeholderId
              ? { ...t, runId: resp.run_id, status: "running" }
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
        setErrorMsg(apiErr instanceof ApiError ? apiErr.message : "重新发送失败");
      }
    },
    [session, machineOnline, turnState.currentRunId, sessionId],
  );

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
  // team missions）；team 触发行与配置条为会话绑定语义，预会话态不渲染。
  if (!sessionId) {
    const preSendingDisabled = !preContext || !preMachineOnline;
    const prePlaceholder = !preContext
      ? "请先选择机器与智能体…"
      : !preMachineOnline
        ? "机器离线，输入不可用…"
        : "发送第一句话开始对话…（Enter 发送 · Shift+Enter 换行）";
    return (
      <section
        ref={panelRef}
        className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card"
        aria-label="会话面板"
        data-testid="session-pre-session-panel"
      >
        {/* 面板头（同构）：新会话标题 + 机器/工作区 chips + 打断按钮（禁用）。 */}
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-semibold text-foreground">
              新会话
            </span>
            {preMachineName && (
              <span className="hidden shrink-0 text-[11px] text-muted-foreground sm:inline">
                🖥 {preMachineName}
              </span>
            )}
            {preWorkspaceName && (
              <span className="hidden shrink-0 rounded-sm bg-cyan-50 px-1.5 py-0.5 text-[11px] text-cyan-700 sm:inline">
                📂 {preWorkspaceName}
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
            原型 .ctx-line：📂 工作区 / 🖥 机器 / ⚡ 智能体 + 🔒 锁定提示。
            task-07（D-106）：change 入口在最前加显 🧩 变更名（仅 changeId 存在时）。 */}
        <div
          data-testid="pre-session-context"
          aria-label="预会话上下文（已锁定）"
          className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-border bg-muted/30 px-4 py-2 text-xs text-muted-foreground"
        >
          {preContext?.changeId && (
            <span>🧩 {preChangeName ?? "—"}</span>
          )}
          <span>
            📂{" "}
            {preContext?.workspaceId
              ? (preWorkspaceName ?? "未命名工作区")
              : "不指定（非工作区）"}
          </span>
          <span>🖥 {preMachineName ?? "—"}</span>
          <span>⚡ {preAgentLabel ?? "—"}</span>
          <span
            className="ml-auto shrink-0"
            title="上下文已锁定，创建会话后不可更换"
          >
            🔒 上下文已锁定 · 创建会话后不可更换
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
              usedTokens={0}
              roleMapping={null}
              fallbackModel={null}
              providerId={preProviderId || null}
            />
          </div>
          {/* ql-20260823-008：团队触发行同构挂载（置灰——agent 未运行，用户定调
              的唯一差异）；组件要求全 props，预会话给安全空值。 */}
          <TeamTriggerRow
            disabled
            tooltip="发送第一句话创建会话后可用"
            activeWorkers={null}
            onDismissChip={() => {}}
            popoverOpen={false}
            workspaceId={preContext?.workspaceId ?? null}
            workspaceName={preWorkspaceName}
            defaultObjective={null}
            submitting={false}
            errorText={null}
            onOpen={() => {}}
            onTrigger={() => {}}
            onClose={() => {}}
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
          />
          {/* ql-20260823-008：配置控件条同构挂载（provisional 暂存模式）——机器/
              智能体只读（D-104 锁定与真会话一致），供应商/档案可选暂存随首句生效。 */}
          <div className="px-5 pb-3">
            <SessionConfigBar
              sessionId=""
              provisional
              running={false}
              ended={false}
              agentProfileId={preProfileId || null}
              llmProviderId={preProviderId || null}
              configSnapshot={null}
              runtimeId={preContext?.runtimeId ?? null}
              engine={preEngine}
              onProvisionalSwitch={(field, value) => {
                if (field === "llm_provider_id") setPreProviderId(value);
                else setPreProfileId(value);
              }}
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
        加载会话详情失败：{detailQuery.error?.message ?? "未知错误"}
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
  // 队满（D-002）不禁输入但 handleSend 阻止提交，提示由 placeholder 承载。
  // task-07（2026-08-23-agent-activity-sessions design §3.4 / Grill P2）：纯日志
  // 主体判定——origin=tool_report 且 turn_count===0（未继续过对话）→ 输入框
  // placeholder 引导继续（首条消息懒激活派发，D-002）。
  const isToolReportBody =
    session.origin === "tool_report" && session.turn_count === 0;
  const sendingDisabled = ended || !machineOnline;
  const placeholder = ended
    ? "会话已结束，请新建会话"
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
              : "继续追问…（Enter 发送 · Shift+Enter 换行）";

  const interruptDisabled =
    session.status !== "active" || !turnState.currentRunId || !machineOnline;

  // task-11：团队入口派生——引擎门控（D-003 一期 Claude 专属）+ 活跃 chip
  //（R-07 单活跃约束，取首个活跃 mission；chip 收回按 mission id 记忆）。
  const teamEngineOk = sessionEngine === "claude";
  const teamButtonDisabled = !teamEngineOk || ended || !machineOnline;
  const teamButtonTitle = !teamEngineOk
    ? "团队需要 Claude 引擎"
    : ended
      ? "会话已结束，无法派团队"
      : !machineOnline
        ? "机器离线，无法派团队"
        : "派团队：当前会话智能体升级为主控，派发分身";
  const activeTeamMission =
    teamMissions.find((m) => isActiveTeamMission(m.status)) ?? null;
  const teamChipWorkers =
    activeTeamMission && activeTeamMission.mission_id !== teamChipDismissedId
      ? activeTeamMission.workers.length
      : null;

  // ql-20260815-011：无真实标题不渲染占位「未命名会话」，只留 id 短码。
  const title = session.title?.trim() || "";
  const statusBadge =
    session.status === "active"
      ? { status: "processing" as const, text: "活跃" }
      : session.status === "ended"
        ? { status: "default" as const, text: "已结束" }
        : session.status === "failed"
          ? { status: "error" as const, text: "已失败" }
          : { status: "warning" as const, text: "恢复中" };

  return (
    <section
      ref={panelRef}
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card"
      aria-label="会话面板"
    >
      {/* 面板头：标题 + 会话 id 短码（点击复制，ql-20260815-010）+ 状态 + 视图切换 + 打断/结束 */}
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          {title && (
            <span className="truncate text-sm font-semibold text-foreground">
              {title}
            </span>
          )}
          {/* 会话 id 短码：点击复制完整 id（排障/引用入口），notify 反馈。 */}
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
          <Badge status={statusBadge.status} text={statusBadge.text} />
          {machineName && (
            <span className="hidden shrink-0 text-[11px] text-muted-foreground sm:inline">
              🖥 {machineName}
            </span>
          )}
          {workspaceName && (
            <span className="hidden shrink-0 rounded-sm bg-cyan-50 px-1.5 py-0.5 text-[11px] text-cyan-700 sm:inline">
              📂 {workspaceName}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* task-09（FR-04 / Grill X-09）：子代理目录——仅 page 模式头部挂载
              （dialog 模式不挂）；无子代理段时组件返回 null 不占位。 */}
          <SubagentCatalog turns={displayTurns} onJumpTo={handleJumpToSubagent} />
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
          <Button
            size="small"
            icon={<Ban className="h-3 w-3" />}
            disabled={interruptDisabled}
            onClick={() => void handleInterrupt()}
            title="打断本轮（session 保持 active）"
          >
            打断本轮
          </Button>
        </div>
      </header>

      {/* 离线只读横幅（2026-07-31-offline-session-readonly 语义） */}
      {!machineOnline && (
        <div className="flex items-center gap-2 border-b border-amber-300 bg-amber-50 px-5 py-2 text-xs text-amber-800">
          <span aria-hidden>⚠️</span>
          <span>
            会话所属机器{machineName ? `（${machineName}）` : ""}当前离线 —— 可浏览历史消息，暂不能继续对话；机器恢复在线后可继续。
          </span>
        </div>
      )}
      {/* 已结束/失败横幅 + 重新开启（原型 .ended-banner）；task-08：reconnecting
          本地计时 >240s（DS-5）复用同位置同款入口，超时场景文案区分，onClick 与
          ended 同一 handleReopen（不复制回调）。 */}
      {(ended || reconnectTimedOutBanner) && (
        <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/40 px-5 py-2 text-xs text-muted-foreground">
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

      {/* 会话主体（task-07 / 2026-08-23-agent-activity-sessions design §3.4）：
          - origin=tool_report 且 turn_count===0（未继续过对话）→ 本地 Agent
            日志条目流即会话主体（AgentLogSessionBody），输入区保留在下方
            （首条消息懒激活派发，D-002）；
          - 其余会话（chat / 已激活 tool_report 继续对话后）→ 正常对话流
            （task-13 共享子组件；弹窗与新页面同构复用。gap-fix：turns 用
            displayTurns），尾部挂仅关联本会话的折叠日志条目（AgentLogCard
            sessionId 关联；D-004：workspace 级旧挂载已移除，streamFooter
            注入口保留复用）。 */}
      {isToolReportBody ? (
        <AgentLogSessionBody sessionId={session.id} />
      ) : (
      <TurnTimeline
        turns={displayTurns}
        viewMode={viewMode}
        errorMsg={errorMsg}
        sessionStatus={
          ended
            ? session.status === "failed"
              ? "failed"
              : "ended"
            : restoring
              ? "reconnecting"
              : "active"
        }
        pendingRequests={pendingRequests}
        dialogHistory={dialogHistory}
        onDialogResolved={handleDialogResolved}
        onResend={(prompt) => {
          void handleResend(prompt);
        }}
        onSwitchProvider={() => {
          if (typeof window !== "undefined") {
            window.location.assign("/settings");
          }
        }}
        hasOnlineProvider={machineOnline}
        emptyProviderLabel={
          PROVIDER_META[session.provider]?.label ?? session.provider
        }
        streamFooter={<AgentLogCard sessionId={session.id} />}
      />
      )}

      {/* task-11：会话团队任务块（TeamTaskBlock）——消息流末尾/输入区上方渲染会话
          mission 列表（listSessionTeamMissions created_at 倒序全部渲染、活跃在前，
          R-07 单活跃约束下至多一个活跃）；取消成功 onRefresh 重拉，活跃期间父层
          5s 轮询刷新（终态停止，见 useSessionTeamMissions）。 */}
      {teamMissions.length > 0 && (
        <div
          aria-label="会话团队任务列表"
          className="flex shrink-0 flex-col gap-1.5 border-t border-border bg-card px-5 py-2"
        >
          {[...teamMissions]
            .sort(
              (a, b) =>
                Number(isActiveTeamMission(b.status)) -
                Number(isActiveTeamMission(a.status)),
            )
            .map((m) => (
              <TeamTaskBlock
                key={m.mission_id}
                summary={m}
                onRefresh={() => {
                  void refreshTeamMissions();
                }}
              />
            ))}
        </div>
      )}

      {/* 输入区：ctx 用量行 + 输入框 + 配置控件条（原型 .input-zone） */}
      <div className="flex shrink-0 flex-col bg-card">
        <div className="px-5 pt-3">
          <CtxUsageBar
            usedTokens={usedTokens}
            roleMapping={ctxRoleMapping}
            fallbackModel={ctxFallbackModel}
            providerId={session.llm_provider_id ?? null}
          />
        </div>
        {/* task-03（design §3.2）：排队消息条——输入框上方水平 chips（空队列组件
            自返回 null 不占位）。onRemove 顺带清理附件元数据镜像（D-004），防
            删除条目后残留；onRetry 仅用户触发（D-003，hook 内 failed→pending 后
            条件满足即投递）。 */}
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
        />
        {/* task-11：输入区上方团队触发行（派团队按钮 + 活跃 chip + 配置弹层），
            原型 §01 .team-trigger-row；弹层相对本行向上弹出（§02 .team-pop）。 */}
        <TeamTriggerRow
          disabled={teamButtonDisabled}
          tooltip={teamButtonTitle}
          activeWorkers={teamChipWorkers}
          onDismissChip={() => {
            if (activeTeamMission) setTeamChipDismissedId(activeTeamMission.mission_id);
          }}
          popoverOpen={teamPopover.open}
          workspaceId={session.workspace_id ?? null}
          workspaceName={workspaceName}
          defaultObjective={teamPopover.objective}
          submitting={teamTriggering}
          errorText={teamError}
          onOpen={() => openTeamPopover(null)}
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
        />
        <div className="px-5 pb-3">
          <SessionConfigBar
            sessionId={sessionId}
            running={running}
            ended={ended || !machineOnline}
            agentProfileId={session.agent_profile_id ?? null}
            llmProviderId={session.llm_provider_id ?? null}
            configSnapshot={session.config_snapshot ?? null}
            runtimeId={session.runtime_id ?? null}
            engine={session.provider ?? null}
            onSwitched={() => {
              // 切换成功 → 刷新会话详情（三列快照）+ 左侧列表 chips + runsMeta
              // （立即显示新 whoLine，不等重进页面）。
              void qc.invalidateQueries({ queryKey: ["agentSessionDetail", sessionId] });
              onSessionListRefresh?.();
              void listSessionRuns(sessionId)
                .then((runs) => setRunsMeta(new Map(runs.map((r) => [r.id, r]))))
                .catch(() => {});
            }}
          />
        </div>
      </div>
    </section>
  );
}

/* ────────────────────── dialog 模式内部子组件（零 react-query，R4） ────────────────────── */

/** attach 模式轮询常量（ISP task-10 同款）。 */
const ATTACH_POLL_MS = 1500;
const ATTACH_POLL_TIMEOUT_MS = 15000;
const ATTACH_POLL_MAX_ATTEMPTS = Math.ceil(ATTACH_POLL_TIMEOUT_MS / ATTACH_POLL_MS); // 10

function getProviderLabel(provider: string): string {
  return PROVIDER_META[provider]?.label ?? provider;
}

/**
 * dialog 模式 view 状态机（ISP InteractiveSessionView 同款）：sessionId 由
 * createSession 成功 / attach props 写入；status 覆盖 SessionUiStatus 全态
 * （idle/creating/ending/reconnecting 为 dialog 特有，D11——page 模式状态从
 * detailQuery 派生，两机制按 mode 严格互斥，R5）。terminatingAt（lease 终止
 * 观测窗口，D5）非空时显示「终止中…」横幅，onSessionEnded 清空。
 */
interface SessionDialogView {
  sessionId: string | null;
  status: SessionUiStatus;
  currentRunId: string | null;
  turns: SessionTurnView[];
  errorMsg: string | null;
  terminatingAt: string | null;
}

const INITIAL_DIALOG_VIEW: SessionDialogView = {
  sessionId: null,
  status: "idle",
  currentRunId: null,
  turns: [],
  errorMsg: null,
  terminatingAt: null,
};

/**
 * SSE envelope → 装配器归一输入（ISP toAssemblerLogInput 同款；与 page 模式
 * applyEnvelopeToTurn 的内联归一同构——归属字段驼峰化、可选缺省归一 null）。
 */
function toAssemblerLogInput(env: SessionStreamEnvelope): AssemblerLogInput {
  return {
    logId: env.log_id,
    channel: env.channel,
    content: env.content,
    timestamp: env.timestamp,
    segmentId: env.segment_id ?? null,
    stale: env.stale ?? null,
    parentToolUseId: env.parent_tool_use_id ?? null,
    subagentType: env.subagent_type ?? null,
    depth: env.depth ?? null,
    toolKind: env.tool_kind ?? null,
  };
}

/**
 * dialog turn → 装配器视角（ISP assembledViewOf 同款，R1/D13）：segments 缺省
 * （第三方构造的 initialTurns 旧形状 turn）先把 legacy 字段反投影为段序列再入
 * 装配器——装配器的 output / processItems 投影从段树重算，不反投影会把既有
 * output 清空。反投影内容等价：processItems 依序映射 + output 尾挂单一 text 段。
 * 正常路径（本面板占位 turn / logsToTurns 历史 turn）segments 均有值，不触发。
 */
function assembledViewOf(turn: SessionTurnView): AssembledTurn {
  return {
    segments:
      turn.segments ?? bootstrapLegacySegments(turn.output, turn.processItems ?? []),
    output: turn.output,
    processItems: turn.processItems ?? [],
    turnStartedAt: turn.turnStartedAt ?? null,
    seenLogIds: turn.seenLogIds,
  };
}

/**
 * legacy 字段反投影（assembledViewOf 的 segments 缺省分支专用，ISP 同款）：tool
 * 项的 toolName / primary 无源置 null（渲染按 R-07 原样显示 raw，内容保全优先）。
 * id 用 legacy: 前缀防与装配器派生 id 撞车。
 */
function bootstrapLegacySegments(
  output: string,
  items: SessionProcessItem[],
): TurnSegment[] {
  const segments: TurnSegment[] = items.map((item, i): TurnSegment => {
    if (item.kind === "thinking") {
      return {
        kind: "thinking",
        id: `legacy:thinking:${i}`,
        text: item.text,
        streaming: false,
        ts: item.ts ?? null,
      };
    }
    if (item.kind === "stderr") {
      return { kind: "stderr", id: `legacy:stderr:${i}`, text: item.text, ts: item.ts ?? null };
    }
    return {
      kind: "tool",
      id: `legacy:tool:${i}`,
      raw: item.raw,
      result: item.result,
      status: item.status,
      toolName: null,
      primary: null,
      startedAt: item.ts ?? null,
      endedAt: null,
      children: [],
      subagentType: null,
    };
  });
  if (output) {
    segments.push({
      kind: "text",
      id: "legacy:text",
      text: output,
      streaming: false,
      startedAt: null,
    });
  }
  return segments;
}

/**
 * dialog 版 upsert 入口：复用共享 upsertTurn（PAGE 基底 + healToRunning，R1——
 * 它覆盖 attach 竞态日志迟到场景，对 dialog attach 同样成立），把 view 的
 * turns / currentRunId 子集映射回 view（其余 view 字段不动）。
 */
function upsertDialogTurn(
  prev: SessionDialogView,
  env: SessionStreamEnvelope,
  apply: (_turn: SessionTurnView) => SessionTurnView,
  opts: UpsertOpts,
): SessionDialogView {
  return {
    ...prev,
    ...upsertTurn({ turns: prev.turns, currentRunId: prev.currentRunId }, env, apply, opts),
  };
}

function SessionPanelDialog(props: SessionPanelProps) {
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
  const [view, setView] = useState<SessionDialogView>(INITIAL_DIALOG_VIEW);
  // task-11（2026-08-22-team-session-unify）：会话内团队触发——弹层开关/预填、
  // 触发在途、错误文案、chip 收回；mission 列表 + 活跃 5s 轮询走共用 hook
  //（旧 teamAnalyzing/teamMissionId（createMission 直发）随「用团队分析」改造下线）。
  const { missions: teamMissions, refresh: refreshTeamMissions } =
    useSessionTeamMissions(view.sessionId);
  const [teamPopover, setTeamPopover] = useState<{ open: boolean; objective: string | null }>({
    open: false,
    objective: null,
  });
  const [teamTriggering, setTeamTriggering] = useState(false);
  const [teamError, setTeamError] = useState<string | null>(null);
  const [teamChipDismissedId, setTeamChipDismissedId] = useState<string | null>(null);
  // AskUserQuestion / 普通 permission_request 待答卡片队列。仅渲染 dialog_kind
  // 存在的（AskUserDialogCard）；普通工具审批卡在本面板不展示（/runtimes 页的
  // PermissionApprovalsPanel 负责）。
  const [pendingRequests, setPendingRequests] = useState<SessionPermissionRequest[]>([]);
  // AskUserQuestion 问答历史（pending+answered），独立于实时卡片——卡片回答后
  // 即移除、failed/ended 会话不渲染卡片，历史靠 GET /dialogs/history 恢复展示。
  const [dialogHistory, setDialogHistory] = useState<SessionDialogRead[]>([]);
  // 消息视图模式：「对话」（默认）只显用户消息 + agent 答复正文；「进度」追加
  // thinking/工具调用/stderr 过程项（v2 段模型下为完整段时间线）。dialog 适配层
  // 不传 viewMode 受控对（diff-analysis §5.1），内部自持。
  const [viewMode, setViewMode] = useState<"conversation" | "all">("conversation");
  const streamConnRef = useRef<SessionStreamConnection | null>(null);
  // attach 模式轮询句柄（unmount / 转出 attach 模式时清理）。
  const attachPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 已拉取过 error_detail 的 failed run_id 集合，防 SSE 重连重发 turn_completed
  // 触发重复 listSessionRuns（同一 failed run 只拉一次）。
  const fetchedErrorRunIdsRef = useRef<Set<string>>(new Set());

  // 当在线 provider 变化且当前选中的不再可用，回退到默认。
  useEffect(() => {
    if (providers.length > 0 && !providers.includes(provider)) {
      setProvider(providers[0] ?? defaultProvider);
    }
  }, [providers, provider, defaultProvider]);

  // SSE 连接由 sessionId 驱动：createSession 成功后建立唯一 SSE，贯穿整个会话。
  const establishStream = useCallback(async (sessionId: string) => {
    // 防御：已有连接不重建（inject 不重建 EventSource）。
    if (streamConnRef.current) return;
    // prefetch 先回灌历史（防 SSE 订阅前 daemon publish 丢事件）。必须 await 先
    // 于 SSE 建连：否则 SSE 收到 turn_started 建空 turn 后 prev.turns 非空，
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
          setView((prev) => upsertDialogTurn(prev, env, (turn) => ({
            ...turn,
            turn: env.turn ?? turn.turn,
            // pending → running（首 turn 从 createSession 占位转正）；
            // 已终态保持终态，不被 SSE 重连重发覆盖。
            status: turn.status === "pending" ? "running" : turn.status,
          }), { setCurrentRun: env.run_id! }));
        },
        onLog: (env) => {
          // channel=user_input 是用户消息（attach 时 initialTurns 已作 prompt），
          // 不追加到 agent output，避免 prompt 气泡与 output 气泡重复。
          if (env.channel === "user_input") return;
          setView((prev) => {
            // 日志内容处理走共享装配器（归一 + 增量回写）。无内容变化（重复
            // log_id / 分类丢弃 / override 无匹配段）时装配器原引用返回 → turn
            // 原样（引用相等短路，R1——segments 缺省的旧形状 turn 不被切到 v2
            // 渲染路径）。
            return upsertDialogTurn(prev, env, (turn) => {
              const assembled = assembledViewOf(turn);
              const next = applyLogToSegments(assembled, toAssemblerLogInput(env));
              if (next === assembled) return turn;
              return { ...turn, ...next };
            }, {});
          });
        },
        onTurnCompleted: (env) => {
          const terminal = deriveTurnTerminalStatus(env);
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
          // R7：dialog 模式不刷新 runsMeta（whoLine / 孤儿 turn 派生链不启用，
          // turns 原样喂 TurnTimeline——ISP 现状）。
        },
        onTokens: (env) => {
          // 执行中实时累积 token：按 run_id upsert 到对应 turn，UI 立刻刷新计数。
          setView((prev) => upsertDialogTurn(prev, env, (turn) => ({
            ...turn,
            inputTokens: env.input_tokens ?? turn.inputTokens,
            outputTokens: env.output_tokens ?? turn.outputTokens,
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
          streamConnRef.current = null;
        },
        onError: () => {
          // 不伪造 session/run 终态；浏览器携 Last-Event-ID 自动重连。
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
      },
    );

    // fetchPendingDialogs 从 establishStream 解耦为独立 effect（见下方
    // [view.sessionId] effect），避免恢复链路与建流链路绑定。
  }, []);

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
          // ended 会话 attach（无法 reopen 的老会话）→ 转只读 ended 态，显示
          // initialTurns 历史，不卡轮询。
          stop();
          setView((prev) => ({ ...prev, status: "ended", errorMsg: null, terminatingAt: null }));
        } else {
          // pending/reconnecting：terminating_at 可能已带，先更新以便尽早显示
          //「终止中…」横幅。
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
   */
  const submitFollowup = useCallback(
    async (prompt: string): Promise<void> => {
      const sid = view.sessionId;
      if (!sid) return;
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
            // 装配化初始形状 + live 计时锚点（本地发送占位时刻），带 segments
            // 即走 TurnTimeline v2 段模型渲染 + 内置轮级状态条。
            segments: [],
            turnStartedAt: Date.now(),
          },
        ],
      }));
      try {
        const resp = await injectSession(sid, prompt);
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
        // 移除未被接受的占位 turn；currentRunId 清空（inject 失败，无运行中 turn）。
        setView((prev) => ({
          ...prev,
          currentRunId: null,
          turns: prev.turns.filter((t) => t.runId !== placeholderId),
          errorMsg: apiErr instanceof ApiError ? apiErr.message : "追问失败",
        }));
        throw err; // D-003：向上抛 → 调用方按路径处理（见函数头注释）
      }
    },
    [view.sessionId],
  );

  /**
   * 队列投递回调（hook onSend，R2）：失败向上抛 → hook 标记 failed 留队头
   * （D-003）。dialog 无附件（R3：createSession 无 attachment_ids 入参、
   * SessionInputBar 不传附件 props），attachmentIds 恒为空数组（对齐 hook 契约）。
   */
  const sendFromQueue = useCallback(
    async (prompt: string, _attachmentIds: string[]): Promise<void> => {
      await submitFollowup(prompt);
    },
    [submitFollowup],
  );

  // 消息队列（design §3.3 / R2）：投递条件 = view.status === "active" &&
  // !view.currentRunId（hook 内即此判断）；idle / creating 首条消息绕过队列直发
  // createSession（handleSend idle 分支）。reconnecting 期间入队，attach 轮询转
  // active 后 hook effect 自动投递（D-001）。sessionId 切换（attach → create /
  // 新建重置）时 hook 清队——排队消息属于原会话。
  const { queue, enqueue, removeEntry, retryEntry, isQueueFull } =
    useMessageQueue({
      sessionId: view.sessionId ?? "",
      sessionActive: view.status === "active",
      hasCurrentRun: view.currentRunId != null,
      onSend: sendFromQueue,
    });

  // ── task-11：会话内团队触发（弹层开关 + 预建回调，语义同 page 模式）──────
  const openTeamPopover = useCallback((objective: string | null) => {
    setTeamError(null);
    setTeamPopover({ open: true, objective });
  }, []);
  const closeTeamPopover = useCallback(() => {
    setTeamError(null);
    setTeamPopover({ open: false, objective: null });
  }, []);

  /**
   * 弹层确认 → triggerSessionTeamMission 预建；成功刷新 mission 列表 +
   * onTeamMissionCreated 上报（透传位保留，父级可挂 TeamProgress）+ objective
   * 回填输入框；失败弹层保持打开，行内中文文案（409/403/422）。
   */
  const handleTeamTrigger = useCallback(
    async (payload: TeamMissionTriggerRequest) => {
      const sid = view.sessionId;
      if (!sid) return;
      setTeamTriggering(true);
      setTeamError(null);
      try {
        const summary = await triggerSessionTeamMission(sid, payload);
        closeTeamPopover();
        onTeamMissionCreated?.(summary.mission_id);
        await refreshTeamMissions();
        if (payload.objective) setInput(payload.objective);
      } catch (err) {
        setTeamError(teamTriggerErrorText(err));
      } finally {
        setTeamTriggering(false);
      }
    },
    [view.sessionId, refreshTeamMissions, closeTeamPopover, onTeamMissionCreated],
  );

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
    // R3：dialog 无附件，空文本一律拦截（ISP 现状；page 模式的「附件非空允许空
    // 文本」分支不适用）。
    if (!prompt || prompt.length > MAX_PROMPT_LEN) return;
    if (!hasOnlineProvider) return;
    if (offlineReadOnly) return;
    if (view.status === "ended" || view.status === "failed") return;
    if (view.status === "creating" || view.status === "ending") return;
    if (isQueueFull) return; // D-002 满员拒收

    // task-11（D-004 四路等价）：/team 前缀拦截——不发送，弹层确认后目标随下条
    // 消息发出（objective 预填去前缀文本）。仅 Claude 引擎且已有 active 会话时
    // 拦截（idle 无会话可挂 mission / 非 active 原路发送）。
    const teamCmd = parseTeamCommand(prompt);
    if (
      teamCmd !== null &&
      provider === "claude" &&
      view.sessionId &&
      view.status === "active"
    ) {
      openTeamPopover(teamCmd || null);
      setInput("");
      return;
    }

    // 首 turn：createSession（绕过队列直发，R2）
    if (view.status === "idle") {
      setInput("");
      setView({
        ...INITIAL_DIALOG_VIEW,
        status: "creating",
        turns: [
          {
            runId: "__pending_create__",
            turn: null,
            prompt,
            output: "",
            status: "pending",
            seenLogIds: new Set(),
            inputTokens: null,
            outputTokens: null,
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
        const msg = err instanceof ApiError ? err.message : "创建会话失败";
        setView({
          ...INITIAL_DIALOG_VIEW,
          status: "idle",
          errorMsg: msg,
        });
      }
      return;
    }

    // 后续 turn（active / reconnecting）：入队等待投递（空附件——R3）。
    if (!enqueue(prompt, [], prompt)) return; // D-002 兜底
    // 入队成功：清草稿（page 模式同款语义；队满失败时草稿保留）。
    setInput("");
  }, [input, hasOnlineProvider, offlineReadOnly, view.status, view.sessionId, isQueueFull, provider, changeId, workspaceId, establishStream, onSessionCreated, enqueue, openTeamPopover]);

  // 失败轮次「重新发送」——复用 submitFollowup 重新提交该 turn 的 prompt。受
  // turn 级串行 / active 守卫；retryable=false 的错误由 RunErrorItem 隐藏按钮
  // （onResend 仅在 retryable 时渲染），故点击时必为可重试错误。不走队列
  //（用户已显式点击，等价 retry 语义）。
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

  // 「切换供应商」— 跳设置页。用 window.location.assign 做整页跳转（非
  // next/navigation useRouter）：后者需在每个渲染本组件的测试文件单独 vi.mock，
  // 整页跳转零 mock 依赖、零回归（page 模式内联同款逻辑）。
  const handleSwitchProvider = useCallback(() => {
    if (typeof window !== "undefined") {
      window.location.assign("/settings");
    }
  }, []);

  // interrupt：只收敛 currentRun（session 保持 active）。
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
          errorMsg: apiErr instanceof ApiError ? apiErr.message : "打断失败",
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
        errorMsg: apiErr instanceof ApiError ? apiErr.message : "结束会话失败，请重试",
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
  const sendingDisabled =
    view.status === "ended" ||
    view.status === "failed" ||
    !hasOnlineProvider ||
    offlineReadOnly;

  const interruptDisabled =
    view.status !== "active" || !view.currentRunId ||
    view.turns.some((t) => t.runId === view.currentRunId && t.status === "interrupting") ||
    offlineReadOnly; // 离线只读禁用打断
  const endDisabled = view.status !== "active" || offlineReadOnly; // 离线只读禁用结束

  // task-11：团队入口派生——引擎门控（provider state 即面板现有引擎信息源，
  // D-003 一期 Claude 专属）+ 活跃 chip（R-07 单活跃约束，取首个活跃 mission）。
  const teamEngineOk = provider === "claude";
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
  const teamChipWorkers =
    activeTeamMission && activeTeamMission.mission_id !== teamChipDismissedId
      ? activeTeamMission.workers.length
      : null;

  // 占位文案（队列化语义，与 page 模式同构的优先级链）：终态 / 离线 / 队满 →
  // 提示；reconnecting / creating / ending / running → 排队或过渡提示（running 的
  // 「等待本轮完成…」旧禁用文案改为排队文案——有意行为变更，diff-analysis
  // §5.2-2）；idle / active 空闲 → 常规输入提示（active 用 page 同款文案）。
  const placeholder =
    view.status === "ended" || view.status === "failed"
      ? "会话已结束，请新建会话"
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
                    ? "继续追问…（Enter 发送 · Shift+Enter 换行）"
                    : "输入首条消息创建会话";

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-card">
      {offlineReadOnly ? (
        <div className="flex items-center gap-2 border-b border-amber-300 bg-amber-50 px-5 py-2 text-xs text-amber-800">
          <span aria-hidden>⚠️</span>
          <span>运行时离线，当前为只读浏览（发送/打断/结束/新建已禁用），重连后自动恢复。</span>
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
        onResend={(prompt) => {
          void handleResend(prompt);
        }}
        onSwitchProvider={handleSwitchProvider}
        hasOnlineProvider={hasOnlineProvider}
        emptyProviderLabel={getProviderLabel(provider)}
      />

      {/* task-11：会话团队任务块（TeamTaskBlock）——消息流末尾/输入区上方渲染会话
          mission 列表（倒序全部渲染、活跃在前）；取消成功 onRefresh 重拉，活跃期间
          5s 轮询刷新（终态停止）。 */}
      {teamMissions.length > 0 && (
        <div
          aria-label="会话团队任务列表"
          className="flex shrink-0 flex-col gap-1.5 border-t border-border bg-card px-5 py-2"
        >
          {[...teamMissions]
            .sort(
              (a, b) =>
                Number(isActiveTeamMission(b.status)) -
                Number(isActiveTeamMission(a.status)),
            )
            .map((m) => (
              <TeamTaskBlock
                key={m.mission_id}
                summary={m}
                onRefresh={() => {
                  void refreshTeamMissions();
                }}
              />
            ))}
        </div>
      )}

      {/* 排队消息条（design §3.2 / 目标 3：dialog 与 page 共用；空队列组件自返回
          null 不占位）。dialog 附件能力关闭（R3），条目无附件元数据镜像可清，
          onRemove 直通；onRetry 仅用户触发（D-003，hook 内 failed→pending 后条件
          满足即投递）。 */}
      <MessageQueueBar
        entries={queue}
        onRemove={removeEntry}
        onRetry={(id) => {
          void retryEntry(id);
        }}
      />

      {/* task-11：输入区上方团队触发行（派团队按钮 + 活跃 chip + 配置弹层），
          原型 §01 .team-trigger-row；弹层相对本行向上弹出（§02 .team-pop）。 */}
      <TeamTriggerRow
        disabled={teamButtonDisabled}
        tooltip={teamButtonTitle}
        activeWorkers={teamChipWorkers}
        onDismissChip={() => {
          if (activeTeamMission) setTeamChipDismissedId(activeTeamMission.mission_id);
        }}
        popoverOpen={teamPopover.open}
        workspaceId={workspaceId ?? null}
        workspaceName={null}
        defaultObjective={teamPopover.objective}
        submitting={teamTriggering}
        errorText={teamError}
        onOpen={() => openTeamPopover(null)}
        onTrigger={(payload) => {
          void handleTeamTrigger(payload);
        }}
        onClose={closeTeamPopover}
      />

      {/* 输入区共享子组件。R3：dialog 不传附件 props（createSession 无
          attachment_ids 入参——附件会「上传成功但发不出去」），与 ISP 现状一致。 */}
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

/* ────────────────────── SSE turn 状态机辅助（task-09：只留组装胶水，日志内容处理走装配器；两模式共用，diff-analysis §4.3 归属〔内部〕模块级函数） ────────────────────── */

const TERMINAL_TURN_STATUSES: ReadonlySet<TurnUiStatus> = new Set([
  "completed",
  "failed",
  "killed",
]);

interface UpsertOpts {
  setCurrentRun?: string;
  clearCurrentRun?: string;
}

/**
 * 按 env.run_id upsert turn；unknown run id 先建无 prompt turn。
 * 终态幂等：已终态的 turn 不被后续事件覆盖（log 事件例外——turn_completed 可能
 * 先于 log 到达，output 尚未追加）。
 */
function upsertTurn(
  prev: TurnState,
  env: SessionStreamEnvelope,
  apply: (_turn: SessionTurnView) => SessionTurnView,
  opts: UpsertOpts,
): TurnState {
  const runId = env.run_id;
  if (!runId) return prev;
  // ql-20260817-007：attach 历史 turn 的 key 是伪 id（__attach_history_N__），
  // 真实 id 在 realRunId——SSE 事件按两者匹配，命中即合并到既有 turn，
  // 否则同一 run 会渲染出第二个「正在思考…」空块（新建会话输入后复现）。
  const idx = prev.turns.findIndex(
    (t) => t.runId === runId || t.realRunId === runId,
  );
  let turns: SessionTurnView[];
  if (idx === -1) {
    // task-09：新建 turn 用装配器空产物初始化（segments/output/processItems/
    // seenLogIds 同源一致）；turnStartedAt 起始 null，由首条 log timestamp 兜底
    // 写入、displayTurns 再按 run 快照 started_at 补（attach 恢复锚点）。
    const empty = createEmptyAssembledTurn();
    const newTurn: SessionTurnView = {
      runId,
      turn: env.turn ?? null,
      prompt: "",
      output: empty.output,
      status: "running",
      seenLogIds: empty.seenLogIds,
      inputTokens: env.input_tokens ?? null,
      outputTokens: env.output_tokens ?? null,
      errorDetail: null,
      processItems: empty.processItems,
      segments: empty.segments,
      turnStartedAt: empty.turnStartedAt,
    };
    turns = [...prev.turns, apply(newTurn)];
  } else {
    // attach 竞态修复（ql-20260820-007）防御分支：主修正位于历史回灌处；若某条
    // 路径仍漏改（当前 run 的日志持续流入而轮卡终态），log 分支自愈翻回 running。
    // 真正完成的 run 其 currentRunId 已被 onTurnCompleted 清空，不会误翻。
    const healToRunning = env.event === "log" && prev.currentRunId === runId;
    turns = prev.turns.map((t, i) => {
      if (i !== idx) return t;
      if (env.event !== "log" && TERMINAL_TURN_STATUSES.has(t.status)) return t;
      const next = apply(t);
      if (healToRunning && TERMINAL_TURN_STATUSES.has(next.status)) {
        return { ...next, status: "running" };
      }
      return next;
    });
  }
  let currentRunId = prev.currentRunId;
  if (opts.setCurrentRun) currentRunId = opts.setCurrentRun;
  if (opts.clearCurrentRun && currentRunId === opts.clearCurrentRun) {
    currentRunId = null;
  }
  return { turns, currentRunId };
}

/**
 * task-09（FR-05）：SessionTurnView → AssembledTurn 收窄视图（组装胶水）。
 * SessionTurnView 的段模型字段可选（task-06 过渡期双路径），装配器要求全量形状
 * ——缺失按空值兜底；装配产物字段与 SessionTurnView 同名，调用方经
 * `{ ...turn, ...next }` 回填（其余 turn 级字段不动）。
 */
function asAssembled(turn: SessionTurnView): AssembledTurn {
  return {
    segments: turn.segments ?? [],
    output: turn.output,
    processItems: turn.processItems ?? [],
    turnStartedAt: turn.turnStartedAt ?? null,
    seenLogIds: turn.seenLogIds,
  };
}

/**
 * task-09（FR-05）：单条 SSE log envelope 归一为 AssemblerLogInput 喂共享装配器
 * applyLogToSegments（替代原 applyLogToTurn 副本——分类 / override 撤回 / tool
 * 配对 / 子代理归属一律依赖装配器导出，本文件不重写；partial 段起点 Map 随副本
 * 一并删除，装配器按段 id 前缀路由撤回）。产出段序列 + 兼容投影（output /
 * processItems）+ 计时锚点兜底（首条 log timestamp）+ log_id 去重集合。
 */
function applyEnvelopeToTurn(
  turn: SessionTurnView,
  env: SessionStreamEnvelope,
): SessionTurnView {
  const input: AssemblerLogInput = {
    logId: env.log_id,
    channel: env.channel,
    content: env.content,
    timestamp: env.timestamp,
    segmentId: env.segment_id ?? null,
    stale: env.stale ?? null,
    parentToolUseId: env.parent_tool_use_id ?? null,
    subagentType: env.subagent_type ?? null,
    depth: env.depth ?? null,
    toolKind: env.tool_kind ?? null,
  };
  return { ...turn, ...applyLogToSegments(asAssembled(turn), input) };
}

/** run 快照 started_at（ISO）→ ms；缺失 / 非法 → null（displayTurns 计时锚点 ?? 链次优源）。 */
function parseRunStartedAt(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/** DFS 全 turn 段树找 id 匹配段（子代理目录跳转的名称定位用，嵌套 children 递归）。 */
function findSegmentById(
  segments: TurnSegment[] | undefined,
  id: string,
): TurnSegment | null {
  if (!segments) return null;
  for (const s of segments) {
    if (s.id === id) return s;
    if (s.kind === "tool" || s.kind === "subagent_stub") {
      const inner = findSegmentById(s.children, id);
      if (inner) return inner;
    }
  }
  return null;
}

/**
 * 子代理块头部展示名（DOM 名称匹配用）——规则镜像 turn-segment-views
 * SubagentBlockView：tool 段 primary ?? subagentType ?? 「子代理」；stub 段
 * subagentType ?? 「子代理」（stub 无 primary）。
 */
function subagentBlockNameOf(seg: TurnSegment): string | null {
  if (seg.kind === "tool") {
    return seg.primary?.trim() || seg.subagentType || "子代理";
  }
  if (seg.kind === "subagent_stub") {
    return seg.subagentType || "子代理";
  }
  return null;
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

/* ── ql-20260822-010：会话视图模式（对话/进度）按会话持久化 ──────────────── */

/** localStorage key（先例 NEW_SESSION_MACHINE_LS_KEY 同 sillyhub.sessions 前缀）。 */
function viewModeLsKey(sessionId: string): string {
  return `sillyhub.sessions.viewMode.${sessionId}`;
}

/** 挂载回读：仅识别 "all"，其余/缺失/SSR 无 window 一律默认 "conversation"。 */
function readPersistedViewMode(sessionId: string): "conversation" | "all" {
  if (typeof window === "undefined") return "conversation";
  try {
    return window.localStorage.getItem(viewModeLsKey(sessionId)) === "all"
      ? "all"
      : "conversation";
  } catch {
    return "conversation";
  }
}

/** 切换时写入（隐私模式等写入失败静默，不阻断切换本身）。 */
function writePersistedViewMode(
  sessionId: string,
  m: "conversation" | "all",
): void {
  try {
    window.localStorage.setItem(viewModeLsKey(sessionId), m);
  } catch {
    /* 静默容错 */
  }
}
