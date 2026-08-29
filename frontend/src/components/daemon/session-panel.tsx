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
 *   - task-05（2026-08-26-session-input-mention / FR-05 / FR-06 / FR-08）：三个
 *     SessionInputBar 渲染点接 onMentionsChange + workspaceId（@ 联想数据源），
 *     可输入态 placeholder 追加 MENTION_PLACEHOLDER_HINT；page 与 dialog 各自
 *     持有 pendingMentions，七个发送组装点位随请求上送（预会话/首句 create 带
 *     change_id/quicklog_id，四个 inject 点位带 bind_change_key/bind_quick_id，
 *     page 重发不带 R-7）；发送成功清空、草稿不持久化（design §3.3/§3.4）。
 *   - task-09（2026-08-29-daemon-platform-resilience / design A6）：连接横幅 +
 *     运行轮看门狗（page / dialog 共用 useStreamConnectionGuard）——streamSession
 *     handlers 经 tapStreamHandlers 包装注入 onStatusChange（reconnecting 横幅
 *     「第 N 次尝试」/ reconnected 2s 自动消失）与看门狗活动时间；turn running
 *     90s 无事件对账（getAgentSession + listSessionRuns），run 终态走
 *     connection.resync() 既有 DB 缺口同步路径刷新，不本地伪造终态。
 *   - task-10（同变更 / design A5+A6 / 原型⑤⑥）：suspended 挂起会话展示——
 *     page 模式（浮窗第三个消费方同构复用）info 横幅「会话已挂起——守护进程
 *     不在线…」+ 输入禁用（placeholder 等待恢复文案）+ 低频轮询驱动
 *     suspended → reconnecting → active 翻转；dialog attach 轮询对挂起不误报
 *     「恢复失败」。reconnecting 恢复中展示复用既有逻辑（badge「恢复中」/
 *     placeholder「恢复会话中…」/ 240s 超时横幅，原型⑥不重复加）。
 *     类型过渡：lib/daemon.ts AgentSessionStatus 尚未含 suspended（task-11
 *     收口），本组件字符串比较/局部断言过渡，不改 lib。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Ban,
  Bot,
  CheckCircle2,
  ClipboardList,
  FolderOpen,
  Hourglass,
  Lock,
  MessageSquareText,
  Monitor,
  MoreHorizontal,
  PauseCircle,
  Plus,
  Puzzle,
  RefreshCw,
  Square,
  TriangleAlert,
  Users,
  Zap,
} from "lucide-react";
import { Badge, Button, Spin, Tag } from "antd";

import { AgentModelInput } from "@/components/AgentModelInput";
import { buildErrorLogItem } from "@/components/agent-log/normalize";
import {
  applyLogToSegments,
  createEmptyAssembledTurn,
  extractPreambleText,
  finishTurn,
  transferAssemblerInternals,
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
  joinAttachmentMarkers,
  parseAttachmentMarkers,
  runTerminalTurnStatus,
} from "@/components/daemon/runtime-session-helpers";
import {
  SessionInputBar,
  type SessionInputMentions,
} from "@/components/daemon/session-input-bar";
import { MessageQueueBar } from "@/components/daemon/message-queue-bar";
import { useMessageQueue } from "@/hooks/use-message-queue";
import { logsToTurns } from "@/components/daemon/runtime-session-helpers";
import { CtxUsageBar } from "@/components/sessions/ctx-usage-bar";
// task-10（2026-08-28-daemon-agent-share / FR-05）：useActiveSharedAgents 也从
// 本模块取（hook 定义随 SessionConfigBar 落地，会话头「平台共享」徽标数据源）。
import {
  SessionConfigBar,
  useActiveSharedAgents,
} from "@/components/sessions/session-config-bar";
import { SubagentCatalog } from "@/components/sessions/subagent-catalog";
import { ApiError } from "@/lib/api";
import type { MainAgentConfig, WorkerPresetItem } from "@/lib/agent";
import { useNotify } from "@/lib/errors";
import { isActiveTeamMission } from "@/components/daemon/team-task-block";
import { ActivityCatalog, type AgentTaskEntry } from "@/components/daemon/activity-catalog";
import {
  TeamTriggerPopover,
  type TeamTriggerInitialConfig,
} from "@/components/daemon/team-trigger-popover";
import {
  AgentLogCard,
  AgentLogSessionBody,
} from "@/components/daemon/agent-log-card";
import { PlanApprovalCard } from "@/components/daemon/plan-approval-card";
import { type BashChunkItem } from "@/components/daemon/bash-progress-card";
import type {
  PlanModeEnteredEvent,
  PlanSummary,
  BashStatusEvent,
  BashChunkEvent,
  AgentTaskStatusEvent,
} from "@/lib/daemon";
import {
  type LlmProviderRead,
  type LlmProviderRoleMapping,
} from "@/lib/api/llm-providers";
import { listWorkspaces } from "@/lib/workspaces";
// task-07 Phase 5（FR-06 / D-004@v2）：autoTeamOpen 预填 objective 的项目名解析。
import { getProject } from "@/lib/ppm/project";
import { getChange } from "@/lib/changes";
// task-11（2026-08-25-session-spec-binding / FR-06）：quickId 标题解析数据源。
import { getQuicklogDetail } from "@/lib/quicklog";
import {
  cancelTeamMission,
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
  maxLogTimestamp,
  PROVIDER_META,
  reopenSession,
  streamSession,
  type DaemonMachineRead,
  type InteractiveProvider,
  type SessionCreateResponse,
  type SessionCreateTeamMission,
  type SessionDialogRead,
  type SessionPermissionRequest,
  type SessionRunRead,
  type SessionStreamConnection,
  type SessionStreamEnvelope,
  type SessionStreamHandlers,
  type SessionStreamStatus,
  type PpmItemKind,
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
  /**
   * 快速修复入口传入（task-11 / 2026-08-25-session-spec-binding FR-06）：ql_id
   * 短码（D-001 自然键，前端不校验存在性只透传——条目行允许后到），随首句
   * createSession 上送 quicklog_id 落 quicklog_session_links 绑定。quicklog 级
   * 隐含 workspace，调用方须显式双传（对齐 changeId X-13 契约）。
   */
  quickId?: string | null;
  /**
   * PPM 任务/问题入口传入（task-05 / 2026-08-28-session-ppm-task-binding /
   * FR-04 / D-001@v1）：悬浮宿主经 store pendingPpmItem 挂起位构造（入口
   * requestNewSession 会清 preContext，不能直传）。kind+id 随首句 createSession
   * 上送 ppm_item_kind/ppm_item_id 落 ppm_item_session_links 绑定（后端注入
   * 【PPM 任务/问题上下文】前导归 task-03）；title 为入口行内已有条目名（任务
   * content / 问题 pro_desc），仅预会话上下文行展示，缺省回退 id 短码。缺省
   * 零回归（对齐 changeId/quickId 语义）。
   */
  ppmItem?: { kind: PpmItemKind; id: string; title?: string | null } | null;
  /** 目标 runtime id（首句 createSession 的 runtime_id）。 */
  runtimeId: string;
  /**
   * 悬浮入口页面上下文（2026-08-25-unified-floating-session task-06 / FR-5 /
   * D-006）：可选，缺省零回归；有值时随首句 createSession 上送 page_context
   * （后端服务端白名单回查注入【页面上下文】前导）。门户三入口不传。
   */
  pageContext?:
    | { page_key: "ppm_project"; project_id: string }
    | { page_key: "generic_page"; route_key: string }
    | { page_key: "workspace"; workspace_id: string; tab_key?: string };
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

  /** task-14（2026-08-26-mobile-workspace-page / design §5.4 §7 / FR-07 / FR-11）：
   *  视口样式变体，缺省 "desktop"（既有调用点不传 → 行为零变化）。仅 page 分支
   *  渲染层消费——mobile 只调整布局类（面板满宽贴屏/padding 收敛）与次要 chrome
   *  收纳（#id 复制、机器/工作区徽标、后台/子代理目录进 ⋯ 菜单），核心操作
   *  （发消息/SSE 流式/打断/结束/视图切换）原位保留；dialog 分支不消费 variant
   *  （渲染零分叉）；mode（宿主形态）与 variant（视口样式）双维度正交（design
   *  §5.5 防漂移锚点）。SSE 建流/断线 resync/消息队列/中断/结束/装配器一律共用，
   *  variant 不进入任何数据/effect/回调逻辑分支。 */
  variant?: "desktop" | "mobile";

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

  /**
   * task-07 Phase 5（2026-08-28-session-ppm-task-binding / FR-06 / D-004@v2）：
   * 预会话自动开派团队弹层意图——悬浮宿主把 store.autoTeamIntent 经本 prop 一次
   * 性送达（仅预会话挂载消费一次：按挂载初值快照，prop 后续翻转不重复触发）。
   * ppm_project 页面上下文时预填「分析项目 <项目名> 当前迭代风险并给出建议」
   *（getProject 解析项目名，失败/无上下文降级空目标，弹层内可修改）。缺省
   * false 零回归（门户三入口/真会话不自动开弹层）。〔prop〕
   */
  autoTeamOpen?: boolean;

  /** page 可选：预会话首句创建成功上报（task-03）。父层据此切换 sessionId →
   *  面板状态机自然接管（门户接线归 task-06）。〔prop〕 */
  onPreSessionCreated?: (_resp: SessionCreateResponse) => void;

  /** 悬浮宿主每轮注入页面上下文（ql-20260825-004）：从 URL 实时派生，
   *  随每轮 injectSession 上送后端，服务端回查注入【页面上下文】前导。 */
  pageContextOverride?:
    | { page_key: "ppm_project"; project_id: string }
    | { page_key: "generic_page"; route_key: string }
    | { page_key: "workspace"; workspace_id: string }
    | null;

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
        autoTeamOpen={props.autoTeamOpen}
        onPreSessionCreated={props.onPreSessionCreated}
        pageContextOverride={props.pageContextOverride}
        variant={props.variant ?? "desktop"}
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

/* ── task-14（2026-08-26-mobile-workspace-page / design §5.4）：variant 布局类 ──
 * desktop 字面量与改动前逐字一致（回归锚：__tests__/session-panel-variant.test.tsx
 * 断言不传 variant 时 className 不变）；mobile 仅满宽贴屏（去圆角/边框）+ padding
 * 收敛——逻辑零分叉，variant 只出现在 JSX className/显隐条件。 */

/** 面板根容器（page 模式真会话/预会话两个渲染点共用）。 */
const PANEL_ROOT_CLS_DESKTOP =
  "flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card";
const PANEL_ROOT_CLS_MOBILE =
  "flex h-full min-h-0 w-full flex-col overflow-hidden bg-card";

/** 面板头（两渲染点共用）。 */
const PANEL_HEADER_CLS_DESKTOP =
  "flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-2";
const PANEL_HEADER_CLS_MOBILE =
  "flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2";

/**
 * mobile 会话主体外包层：TurnTimeline / AgentLogSessionBody 自带纵向滚动容器
 * （min-h-0 flex-1 overflow-y-auto），外包 flex 列容器不破坏高度链；任意变体
 * 选择器给 markdown 表格补横向滚动容器（design §5.4：横向内容不撑破竖屏视口；
 * markdown pre 已有 overflow-x-auto、ARGS_PRE_CLS pre 已 wrap，表格是缺口），
 * 并锁外层横向溢出（防整条时间线被宽表格横向拖走）。desktop 无外包层（DOM
 * 结构零变化）。
 */
const PANEL_BODY_WRAP_CLS_MOBILE =
  "flex min-h-0 flex-1 flex-col " +
  "[&_.wmde-markdown_table]:!block [&_.wmde-markdown_table]:!max-w-full " +
  "[&_.wmde-markdown_table]:!overflow-x-auto " +
  "[&_[data-testid='turn-timeline-scroll']]:overflow-x-hidden";

const MAX_PROMPT_LEN = 8000;

/* ── task-05（2026-08-26-session-input-mention）：@ 联想接线共享常量与组装 ──── */

/**
 * FR-08：输入框联想能力提示——追加在三个渲染点「可正常输入」态 placeholder
 * 尾部（与 Enter/Shift+Enter 按键提示同括号同「 · 」分隔）；禁用/排队/恢复等
 * 状态文案不追加（彼时提示语义已让位于状态说明）。
 */
const MENTION_PLACEHOLDER_HINT = "/ 唤起技能 · @ 关联变更";

/**
 * task-05（FR-06 / D-003）：@ 联想选中 → inject 绑定字段条件展开（有值才带，
 * 缺省展开为空对象不进请求体，保后端零行为差异；bind_change_key = 变更自然键、
 * bind_quick_id = 快速修复短码，后端 binder 幂等写 M:N link，不注入 prompt）。
 * page 与 dialog 的全部四个 inject 发送点位共用本组装。
 * task-06（2026-08-28-session-ppm-task-binding / FR-02）：扩展
 * bind_ppm_item_kind/bind_ppm_item_id 成对追问绑定（对齐 bind_change_key 模式；
 * 后端 binder 幂等写 ppm_item_session_links，只追加 link 不注入前导——对齐
 * quicklog 行为，重复选择追问绑定幂等）。
 */
function mentionBindOptions(m: SessionInputMentions): {
  bind_change_key?: string;
  bind_quick_id?: string;
  bind_ppm_item_kind?: PpmItemKind;
  bind_ppm_item_id?: string;
} {
  return {
    ...(m.change ? { bind_change_key: m.change.change_key } : {}),
    ...(m.quick ? { bind_quick_id: m.quick.ql_id } : {}),
    ...(m.ppmItem
      ? {
          bind_ppm_item_kind: m.ppmItem.kind,
          bind_ppm_item_id: m.ppmItem.id,
        }
      : {}),
  };
}

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

/**
 * task-10（2026-08-29-daemon-platform-resilience / design A5+A6）：suspended
 * 挂起期间会话详情轮询间隔。挂起窗口以小时计（24h GC 上限），复用 pending/
 * reconnecting 的 1.5s 高频轮询浪费；daemon 重启 recover（suspended →
 * reconnecting → active，D-001 自动恢复）的翻转靠该轮询驱动——SSE 只推
 * 轮次事件，会话级状态变化无推送。15s 兼顾翻转及时性与请求量。
 */
const SUSPENDED_SESSION_REFETCH_MS = 15_000;

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
 *
 * ql-20260828-009-4a13：轮询条件扩展 hasRunningTurn——原仅 hasActive 时轮询，
 * mission 迟到场景（主控轮运行中 dispatch 建 mission / 弹层确认晚于面板挂载
 * 首拉）下 hasActive=false 轮询不启动，chip 永不出现（用户实测首次派团队无
 * 标签的根因）；会话有进行中轮时主控随时可能建 mission，纳入轮询消除盲区。
 */
function useSessionTeamMissions(
  sessionId: string | null,
  hasRunningTurn = false,
) {
  const [missions, setMissions] = useState<TeamMissionSummary[]>([]);
  // F7（2026-08-25）：异步回写守卫——refresh 同时被 effect（挂载/切会话/轮询）与
  // 外部回调（dialog 派团队后手动刷新）调用，effect 作用域 cancelled 覆盖不全，
  // 用 hook 级 aliveRef 等价守卫：卸载后迟到的列表响应不再 setState。
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);
  const refresh = useCallback(async () => {
    if (!sessionId) return;
    try {
      const items = await listSessionTeamMissions(sessionId);
      if (!aliveRef.current) return;
      setMissions(items);
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
    if (!sessionId || (!hasActive && !hasRunningTurn)) return;
    const timer = window.setInterval(() => {
      void refresh();
    }, TEAM_MISSION_POLL_MS);
    return () => window.clearInterval(timer);
  }, [sessionId, hasActive, hasRunningTurn, refresh]);
  return { missions, refresh };
}

/**
 * task-11：输入区上方团队触发行（原型 §01 .team-trigger-row + §02 弹层锚点），
 * page/dialog 两模式共用：活跃状态 chip（可关闭收回）+ TeamTriggerPopover 挂载
 * （relative 锚点 + absolute bottom-full，同 SessionConfigBar 浮层风格）+ 触发
 * 错误提示（409/403/422 中文文案）。纯受控：API 调用/弹层开关归父层（本组件
 * 不含团队业务状态）。
 *
 * ql-20260827-020：「派团队」按钮迁入 SessionInputBar ＋ 功能菜单——本行只保留
 * chip / 错误文案 / 弹层挂载，三者皆空时整行不渲染（原按钮位不再占一行）。
 */
interface TeamTriggerRowProps {
  /** 活跃 mission 分身数（chip 文案「团队进行中 · N 分身」）；null = 隐藏。 */
  activeWorkers: number | null;
  /**
   * ql-20260828-009-4a13：chip × 改真取消——调父层 cancelTeamMission(活跃
   * mission) + 刷新（原 onDismissChip 仅收起提示条、mission 仍在，用户以为
   * 删了再派却 409；收起记忆 teamChipDismissedId 一并下线）。
   */
  onCancelMission: () => void;
  /** 取消在途（× 禁用防重复提交）。 */
  cancelling?: boolean;
  /**
   * ql-20260828-009-4a13：chip 主体点击——打开派团队弹层更新指派（父层
   * openTeamPopover；确认时 handleTeamTrigger 前置取消活跃 mission）。
   */
  onChipClick: () => void;
  /**
   * ql-20260828-009-4a13：存在活跃 mission（弹层提示「确认后取消并重新指派」，
   * 透传 TeamTriggerPopover.hasActiveMission）。
   */
  hasActiveMission?: boolean;
  /**
   * ql-20260828-011-1ec7：预会话待生效 chip——弹层确认后 preTeamMission 已
   * 暂存（随首句创建落库 D-009），无会话无 mission 期间以此反馈「已配置」。
   */
  pendingTeam?: boolean;
  /** 待生效 chip × ——放弃暂存的团队配置（同时清回填的 /team 输入框）。 */
  onRemovePendingTeam?: () => void;
  /** 弹层开关（父层 state）。 */
  popoverOpen: boolean;
  /**
   * task-13（FR-05）：预会话实例——true 时透传弹层 preSession（渲染主 agent
   * 选择器 + 确认按钮文案「派团队（随首句创建生效）」+ payload 追加
   * orchestrator_workspace_id，task-12 组件契约）；缺省 false 弹层零变化。
   */
  preSession?: boolean;
  /** 会话绑定工作区（弹层 scope 默认「当前工作区」数据源）。 */
  workspaceId: string | null;
  workspaceName: string | null;
  /** 目标预填（/team 指令文本 /「用团队分析」提示句）。 */
  defaultObjective: string | null;
  /**
   * task-07 Phase 5（FR-06 / D-004@v2）：项目预选 id（ppm_project 页面上下文
   * 派生，仅预会话实例传）——弹层 projectId 初值 + scopeMode=project + 关联
   * 工作区自动预选；缺省弹层行为零变化。
   */
  defaultProjectId?: string;
  /** triggerSessionTeamMission 在途（确认按钮禁用）。 */
  submitting: boolean;
  /** 触发错误文案（弹层保持打开时行内展示）。 */
  errorText: string | null;
  /** ql-20260828-012-4425：编辑回显初始配置（chip 点击派生，透传弹层）。 */
  popoverInitial?: TeamTriggerInitialConfig | null;
  onTrigger: (payload: TeamMissionTriggerRequest) => void;
  onClose: () => void;
}

function TeamTriggerRow({
  activeWorkers,
  onCancelMission,
  cancelling = false,
  onChipClick,
  hasActiveMission = false,
  pendingTeam = false,
  onRemovePendingTeam,
  popoverOpen,
  preSession = false,
  workspaceId,
  workspaceName,
  defaultObjective,
  defaultProjectId,
  submitting,
  errorText,
  popoverInitial,
  onTrigger,
  onClose,
}: TeamTriggerRowProps) {
  // ql-20260827-020：按钮迁走后按需渲染——无 chip / 无错误 / 弹层未开时不占位
  //（弹层仍以本行为锚点，开层时行随之出现）。
  if (activeWorkers === null && !pendingTeam && !errorText && !popoverOpen) {
    return null;
  }
  return (
    <div className="relative flex shrink-0 flex-wrap items-center gap-2 border-t border-border bg-card px-5 pb-1.5 pt-2">
      {activeWorkers !== null && (
        <span
          data-testid="team-active-chip"
          title="点击可更新团队指派（确认后取消当前任务重新派发）"
          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-brand-300 bg-brand-50 px-2.5 py-0.5 text-[11.5px] font-medium text-brand-700"
        >
          <Users aria-hidden className="h-3.5 w-3.5" />
          <button
            type="button"
            onClick={onChipClick}
            className="rounded-full px-0.5 py-0 transition-colors hover:text-brand-800"
          >
            团队进行中 · {activeWorkers} 分身
          </button>
          <button
            type="button"
            aria-label="取消团队任务"
            title="取消当前团队任务（分身停止，进度保留在会话记录）"
            onClick={onCancelMission}
            disabled={cancelling}
            className="ml-0.5 rounded-full px-1 leading-none text-brand-500 transition-colors hover:bg-brand-100 hover:text-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {cancelling ? "…" : "×"}
          </button>
        </span>
      )}
      {/* ql-20260828-011-1ec7：预会话待生效 chip——虚线边框区分「进行中」实线；
          mission 随首句创建落库（D-009），此处反馈配置已暂存。 */}
      {pendingTeam && (
        <span
          data-testid="team-pending-chip"
          title="点击可修改团队配置（随首条消息创建会话时生效）"
          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-dashed border-brand-400 bg-brand-50/60 px-2.5 py-0.5 text-[11.5px] font-medium text-brand-700"
        >
          <Users aria-hidden className="h-3.5 w-3.5" />
          <button
            type="button"
            onClick={onChipClick}
            className="rounded-full px-0.5 py-0 transition-colors hover:text-brand-800"
          >
            团队已配置 · 随首句创建生效
          </button>
          <button
            type="button"
            aria-label="放弃团队配置"
            title="放弃本次团队配置（不随首条消息创建团队）"
            onClick={onRemovePendingTeam}
            className="ml-0.5 rounded-full px-1 leading-none text-brand-500 transition-colors hover:bg-brand-100 hover:text-brand-700"
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
          initialConfig={popoverInitial ?? undefined}
          defaultProjectId={defaultProjectId}
          preSession={preSession}
          submitting={submitting}
          hasActiveMission={hasActiveMission}
          onTrigger={onTrigger}
          onClose={onClose}
        />
      )}
    </div>
  );
}

/**
 * task-14（2026-08-25-team-subsession-governance / FR-08 / design §5.E）：分身
 * 会话浮层——TeamTaskBlock 分身行（有 sub_session_id）点击后，以浮层复用
 * SessionPanel（mode=dialog、sessionId=分身 sub_session_id、attach 续聊形态）
 * 打开该分身子会话；实时流与追问全走面板既有链路（constraints：不新建分身
 * 专用面板/流渲染组件，流与追问逻辑零复制）。page/dialog 两模式共用；关闭
 * 只卸浮层——主控面板常驻不动（流/输入 state 原样保留，验收「关闭返回主控」）。
 *
 * 嵌套安全：worker 子会话非 mission 锚定会话，listSessionTeamMissions 对其
 * 恒空（后端按 AgentMission.session_id 直查），浮层面板不会再渲染团队块，
 * 无递归嵌套。样式走 AI-Native 双主题 token（brand-* 语义阶 + shadow-lg
 * 主题投影，FRONTEND_PAGE_STYLE §0.5 铁律）；黑色半透明遮罩为中性色（同
 * workspace-member-add-dialog 既有浮层惯例）。
 */
interface WorkerSessionOverlayProps {
  /** 分身子会话 id（TeamTaskBlock onOpenWorkerSession 上抛）。 */
  subSessionId: string;
  /** 关闭浮层（返回主控面板）。 */
  onClose: () => void;
  /** dialog 模式 SessionPanel 必需 props（按消费方上下文透传，见接口注释）。 */
  providers: string[];
  defaultProvider: string;
  model?: string | null;
  onModelChange?: (next: string | null) => void;
  hasOnlineProvider: boolean;
}

function WorkerSessionOverlay({
  subSessionId,
  onClose,
  providers,
  defaultProvider,
  model,
  onModelChange,
  hasOnlineProvider,
}: WorkerSessionOverlayProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="分身会话"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 md:p-8"
    >
      <div className="flex h-full min-h-0 w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-border bg-card shadow-lg">
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
          <span className="text-sm font-semibold text-foreground">分身会话</span>
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
            #{subSessionId.slice(0, 8)}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭分身会话"
            className="shrink-0 rounded-md border border-border px-2.5 py-0.5 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            返回主控
          </button>
        </div>
        {/* key 按分身会话驱动整体 remount（R6 同款契约：切换分身即重建建流）。 */}
        <div className="min-h-0 flex-1">
          <SessionPanel
            key={subSessionId}
            mode="dialog"
            sessionId={subSessionId}
            providers={providers}
            defaultProvider={defaultProvider}
            model={model}
            onModelChange={onModelChange}
            hasOnlineProvider={hasOnlineProvider}
          />
        </div>
      </div>
    </div>
  );
}

/* ── task-09 / design A6（2026-08-29-daemon-platform-resilience）：连接横幅 + 运行轮看门狗（page / dialog 共用） ── */

/** 运行轮看门狗：turn running 且 90s 无新日志 / SSE 事件 → 首次对账。 */
const TURN_WATCHDOG_FIRST_MS = 90_000;
/** 看门狗复核间隔：首次触发后每 30s 一轮。 */
const TURN_WATCHDOG_INTERVAL_MS = 30_000;
/** 连续 N 轮对账仍 running 且 SSE 断开 → 显示「本轮长时间无响应」提示。 */
const TURN_WATCHDOG_HINT_ROUNDS = 3;
/** 「连接已恢复」横幅自动消失时长（design A6：约 2 秒）。 */
const RECONNECTED_BANNER_MS = 2_000;

/**
 * 看门狗判定 run 终态的词表（lib/daemon.ts streamSession 内 TERMINAL_RUN_STATUSES
 * 同款五值）。不复用 runTerminalTurnStatus——它对 completed 返回 null（只映射失败族）。
 */
const WATCHDOG_TERMINAL_RUN_STATUSES: ReadonlySet<string | null> = new Set([
  "completed",
  "failed",
  "killed",
  "cancelled",
  "interrupted",
]);

interface StreamConnectionGuard {
  /** SSE 连接状态（onStatusChange 驱动；live = 无横幅）。 */
  connStatus: SessionStreamStatus;
  /** 当前重连尝试次数（reconnecting 横幅「第 N 次尝试」）。 */
  reconnectAttempt: number;
  /** 看门狗提示：本轮长时间无响应，正在与平台核对（不伪造终态，原型④）。 */
  stalledHint: boolean;
  /**
   * streamSession handlers 装配 tap：每个事件回调触发即推进看门狗活动时间 +
   * 连续轮次归零，并注入 onStatusChange 驱动横幅。原 handler 逐字透传（后兼容，
   * 不改既有事件语义）。
   */
  tapStreamHandlers: (handlers: SessionStreamHandlers) => SessionStreamHandlers;
}

/**
 * task-09 / design A6：连接状态横幅 + 运行轮看门狗（page / dialog 共用 hook）。
 *
 * - 横幅：onStatusChange('reconnecting', N) → warning 常驻「正在重连…（第 N 次）」；
 *   'reconnected' → success「连接已恢复，正在同步…」2s 自动消失（期间转 live 同样收起）。
 * - 看门狗：currentRunId 非空（turn running）且 90s 无事件 → getAgentSession +
 *   listSessionRuns 对账；此后每 30s 复核一轮，连续 3 轮仍 running 且 SSE 断开 →
 *   stalledHint（accent 提示，不伪造终态）。对账发现 run 已终态 → 走既有 resync
 *   路径（connection.resync()，streamSession DB 缺口同步合成 turn_completed）刷新
 *   轮次；发现会话非 active → onSessionReconciled（page：invalidate 详情查询）。
 * - 清理：轮终态（currentRunId 清空）/ 会话切换 / 卸载即停看门狗计时器。
 */
function useStreamConnectionGuard(opts: {
  sessionId: string | null;
  currentRunId: string | null;
  getConnection: () => SessionStreamConnection | null;
  /** 对账发现会话非 active（failed/ended 等）时回调（可选）。 */
  onSessionReconciled?: (status: string) => void;
}): StreamConnectionGuard {
  const [connStatus, setConnStatus] = useState<SessionStreamStatus>("live");
  const [reconnectAttempt, setReconnectAttempt] = useState(1);
  const [stalledHint, setStalledHint] = useState(false);

  const lastActivityRef = useRef(Date.now());
  const sseDownRef = useRef(false);
  const roundsRef = useRef(0);
  const watchdogTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  // 看门狗 timer / SSE 回调闭包读 ref（避免重建计时器 / 捕获过期 props）。
  const sessionIdRef = useRef(opts.sessionId);
  const currentRunIdRef = useRef(opts.currentRunId);
  const getConnectionRef = useRef(opts.getConnection);
  const onSessionReconciledRef = useRef(opts.onSessionReconciled);

  useEffect(() => {
    sessionIdRef.current = opts.sessionId;
    currentRunIdRef.current = opts.currentRunId;
    getConnectionRef.current = opts.getConnection;
    onSessionReconciledRef.current = opts.onSessionReconciled;
  });

  // 卸载清理（含 StrictMode 双挂载重锚）；轮终态清理在下方看门狗 effect 的
  // 「无运行轮」分支与 cleanup。
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (watchdogTimerRef.current) {
        clearTimeout(watchdogTimerRef.current);
        watchdogTimerRef.current = null;
      }
      if (bannerTimerRef.current) {
        clearTimeout(bannerTimerRef.current);
        bannerTimerRef.current = null;
      }
    };
  }, []);

  // 会话切换：状态复位（横幅 / 提示 / 连续轮次不跨会话残留）。
  useEffect(() => {
    setConnStatus("live");
    setStalledHint(false);
    roundsRef.current = 0;
    sseDownRef.current = false;
    lastActivityRef.current = Date.now();
    if (bannerTimerRef.current) {
      clearTimeout(bannerTimerRef.current);
      bannerTimerRef.current = null;
    }
  }, [opts.sessionId]);

  // 看门狗对账（每轮执行）。终态一律以 backend 数据为准：run 终态走既有 resync
  // 路径刷新（不本地伪造 turn 状态）；会话非 active 仅回调消费方刷新详情。
  const reconcileRef = useRef<() => void>(() => {});
  useEffect(() => {
    reconcileRef.current = () => {
      const sid = sessionIdRef.current;
      const rid = currentRunIdRef.current;
      if (!sid || !rid) return;
      void (async () => {
        try {
          const [detail, runs] = await Promise.all([
            getAgentSession(sid),
            listSessionRuns(sid),
          ]);
          if (!mountedRef.current) return;
          if (sid !== sessionIdRef.current || rid !== currentRunIdRef.current) {
            return; // 对账窗口内轮次/会话已切换：丢弃过期结果
          }
          const run = runs.find((r) => r.id === rid);
          if (run && WATCHDOG_TERMINAL_RUN_STATUSES.has(run.status)) {
            getConnectionRef.current()?.resync?.();
          }
          if (detail.status !== "active") {
            onSessionReconciledRef.current?.(detail.status);
          }
        } catch {
          /* 对账失败静默：看门狗下一轮再兜 */
        }
      })();
    };
  });

  // 运行轮看门狗主体：90s 首查、每 30s 复核；任一 SSE 事件（tapStreamHandlers）
  // 推进活动时间并归零连续轮次；轮终态 / 预会话态停表并清提示。
  useEffect(() => {
    if (!opts.sessionId || !opts.currentRunId) {
      if (watchdogTimerRef.current) {
        clearTimeout(watchdogTimerRef.current);
        watchdogTimerRef.current = null;
      }
      roundsRef.current = 0;
      setStalledHint(false);
      return;
    }
    lastActivityRef.current = Date.now();
    const tick = () => {
      watchdogTimerRef.current = null;
      if (Date.now() - lastActivityRef.current >= TURN_WATCHDOG_FIRST_MS) {
        roundsRef.current += 1;
        reconcileRef.current();
        if (roundsRef.current >= TURN_WATCHDOG_HINT_ROUNDS && sseDownRef.current) {
          setStalledHint(true);
        }
      }
      watchdogTimerRef.current = setTimeout(tick, TURN_WATCHDOG_INTERVAL_MS);
    };
    watchdogTimerRef.current = setTimeout(tick, TURN_WATCHDOG_FIRST_MS);
    return () => {
      if (watchdogTimerRef.current) {
        clearTimeout(watchdogTimerRef.current);
        watchdogTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.sessionId, opts.currentRunId]);

  const tapStreamHandlers = useCallback(
    (handlers: SessionStreamHandlers): SessionStreamHandlers => {
      const wrapped: Record<string, unknown> = { ...handlers };
      for (const key of Object.keys(handlers)) {
        const fn = (handlers as unknown as Record<string, unknown>)[key];
        if (typeof fn !== "function") continue;
        wrapped[key] = (...args: unknown[]) => {
          // 任一事件回调触发 = SSE 有新事件：活动时间推进 + 连续轮次归零。
          lastActivityRef.current = Date.now();
          roundsRef.current = 0;
          setStalledHint(false);
          (fn as (...a: unknown[]) => void)(...args);
        };
      }
      wrapped.onStatusChange = (status: SessionStreamStatus, attempt?: number) => {
        if (status === "reconnecting") {
          sseDownRef.current = true;
          if (bannerTimerRef.current) {
            clearTimeout(bannerTimerRef.current);
            bannerTimerRef.current = null;
          }
          setReconnectAttempt(attempt ?? 1);
          setConnStatus("reconnecting");
          return;
        }
        sseDownRef.current = false;
        if (bannerTimerRef.current) {
          clearTimeout(bannerTimerRef.current);
          bannerTimerRef.current = null;
        }
        setConnStatus(status === "reconnected" ? "reconnected" : "live");
        if (status === "reconnected") {
          // 原型③：恢复横幅 2s 自动消失（期间收到实时事件转 live 亦收起）。
          bannerTimerRef.current = setTimeout(() => {
            bannerTimerRef.current = null;
            setConnStatus((prev) => (prev === "reconnected" ? "live" : prev));
          }, RECONNECTED_BANNER_MS);
        }
      };
      return wrapped as unknown as SessionStreamHandlers;
    },
    [],
  );

  return { connStatus, reconnectAttempt, stalledHint, tapStreamHandlers };
}

/**
 * task-09 / design A6（原型②③）：连接状态横幅。reconnecting = warning 常驻
 * 「正在重连…（第 N 次尝试）」；reconnected = success「连接已恢复，正在同步…」
 * 2s 自动消失（useStreamConnectionGuard 内计时）。复用「离线只读」横幅样式位
 * （border-b + 12px 文案 + 图标，warning 同 amber 阶；success 走 emerald 阶）。
 */
function StreamConnectionBanner(props: {
  connStatus: SessionStreamStatus;
  attempt: number;
  mobile?: boolean;
}) {
  if (props.connStatus === "reconnecting") {
    return (
      <div
        role="status"
        aria-live="polite"
        data-conn-banner="reconnecting"
        className={cn(
          "flex items-center gap-2 border-b border-amber-300 bg-amber-50 px-5 py-2 text-xs text-amber-800",
          props.mobile && "px-3",
        )}
      >
        <TriangleAlert aria-hidden className="h-3.5 w-3.5 shrink-0" />
        <span>
          实时连接已断开，正在重连…（第 {props.attempt} 次尝试）—— 已发送的消息不会丢失，恢复后将自动同步错过的内容
        </span>
      </div>
    );
  }
  if (props.connStatus === "reconnected") {
    return (
      <div
        role="status"
        aria-live="polite"
        data-conn-banner="reconnected"
        className={cn(
          "flex items-center gap-2 border-b border-emerald-300 bg-emerald-50 px-5 py-2 text-xs text-emerald-800",
          props.mobile && "px-3",
        )}
      >
        <CheckCircle2 aria-hidden className="h-3.5 w-3.5 shrink-0" />
        <span>连接已恢复，正在同步断线期间的消息…（同步完成后此提示自动消失）</span>
      </div>
    );
  }
  return null;
}

/**
 * task-09 / design A6（原型④）：运行轮看门狗提示——本轮长时间无响应仅提示
 * 「正在与平台核对」，不伪造终态（终态以 backend 数据经 resync 刷新为准）。
 * accent 色走 brand 主题阶（border-brand-200 bg-brand-50 text-brand-700，
 * runtimes 页 info 徽标同款组合）。
 */
function TurnStalledWatchdogBanner(props: { mobile?: boolean }) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-watchdog-hint="true"
      className={cn(
        "flex items-center gap-2 border-b border-brand-200 bg-brand-50 px-5 py-2 text-xs text-brand-700",
        props.mobile && "px-3",
      )}
    >
      <Hourglass aria-hidden className="h-3.5 w-3.5 shrink-0" />
      <span>
        本轮长时间无响应，正在与平台核对…（核对期间无需操作；若确认已中断，轮次会按平台数据更新，会话仍可继续）
      </span>
    </div>
  );
}

function SessionPanelPage({
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
  const workspaceName = useMemo(() => {
    if (!session?.workspace_id) return null;
    const ws = workspacesQuery.data?.items.find((w) => w.id === session.workspace_id);
    // ql-20260825-011：别名优先（先例 workspace-switcher / workspace-card）。
    return ws ? (ws.display_alias ?? ws.name) : null;
  }, [session?.workspace_id, workspacesQuery.data]);

  // ql-20260829-011：归档区存量会话只读——后端 inject/interrupt 已 409，输入栏
  // 置灰 + 占位提示恢复路径（预会话态兜底 preContext.workspaceId 同判）。
  const sessionWorkspaceArchived = useMemo(() => {
    const wsId = session?.workspace_id ?? preContext?.workspaceId ?? null;
    if (!wsId) return false;
    const ws = workspacesQuery.data?.items.find((w) => w.id === wsId);
    return ws?.status === "archived";
  }, [session?.workspace_id, preContext?.workspaceId, workspacesQuery.data]);

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
  const isPlatformSharedSession = useMemo(() => {
    const profileId = session?.agent_profile_id;
    if (!profileId) return false;
    return activeSharedAgents.some((a) => a.agent_profile_id === profileId);
  }, [activeSharedAgents, session?.agent_profile_id]);

  // ── 实时 turn 状态机（对齐 interactive-session-panel 的 SSE 处理）───────
  const [turnState, setTurnState] = useState<TurnState>(INITIAL_TURN_STATE);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
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

    // ql-20260827-018：历史预取改 await **先回灌再建流**——原并行时活跃会话
    // SSE 先到建 turn，回灌条件（prev.turns 空）不满足 → 历史被整体丢弃，
    // 旧轮内容永久缺失（「有时加载不出来」根因；dialog 模式 establishStream
    // 同款竞态先例）。建流缺口（历史快照 → SSE 订阅间发布的事件）由
    // streamSession cursor 首连缺口同步增量补齐，不再依赖「SSE 抢先订阅」。
    const establish = async (): Promise<void> => {
      let streamCursor: string | undefined;
      let initialSync = false;
      try {
        const logs = await getAgentSessionLogs(sessionId);
        if (cancelled) return;
        streamCursor = maxLogTimestamp(logs);
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
  // 上下文行快速修复名（task-11 / FR-06）：quicklog 入口加显——title 回退
  // ql_id 短码（查询中/失败均显短码，不显 —：变更行回退 change_key 的同构）。
  const preQuicklogName = useMemo(() => {
    if (!preContext?.quickId) return null;
    return preQuicklogQuery.data?.title ?? preContext.quickId;
  }, [preContext?.quickId, preQuicklogQuery.data]);
  // 附件门控（D-6 引擎门控同构）：预会话无会话实体，按目标 runtime 引擎判定。
  const preAttachmentsDisabled = preEngine !== "claude";

  const status = session?.status ?? null;
  const ended = status === "ended" || status === "failed";
  const restoring = status === "pending" || status === "reconnecting";
  // task-10（design A5/A6 / 原型⑤）：suspended 挂起态——后端 status 词表已含
  // 该值（task-05），lib/daemon.ts AgentSessionStatus 联合尚未收口（task-11），
  // 此处字符串比较过渡（不改 lib）。挂起会话只读浏览 + info 横幅，daemon 重启
  // 后自动恢复（D-001）。
  const suspended = (status as string | null) === "suspended";
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
        // task-08（FR-01 / D-003）：ctx 历史回填（SessionRunRead.ctx_tokens，
        // 历史 run 无 ctx 列值 → null → 环未知态）。
        ctxTokens: t.ctxTokens ?? meta.ctx_tokens ?? null,
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

  // CtxUsageBar：环分子（task-08 / FR-01 改口径）= displayTurns 逆序第一个非 null
  // 的 ctxTokens（最近一次模型调用提示词大小，瞬时量；SSE 实时 + runsMeta 历史回填
  // 两路写入）+ 分母派生（会话供应商 role mapping one_m → fallback model，D-014）。
  // 旧口径「Σ 各轮 inputTokens」把跨调用可加的计费量当瞬时量，环永远虚高封顶
  // （design §1.1 失真根因），已废弃；全 null（历史会话 / 旧 daemon）→ null，
  // 环渲染未知态（D-003，CtxUsageRing usedTokens 可空）。
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
    () =>
      displayTurns.reduceRight(
        (found: number | null, t) => found ?? t.ctxTokens ?? null,
        null,
      ),
    [displayTurns],
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
   * ql-20260826-013：再加 /team 前缀剥离比对——发送的是剥前缀的
   * effectivePrompt，草稿仍带 "/team " 前缀（弹层确认回填），对上即清。
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
          setErrorMsg(apiErr instanceof ApiError ? apiErr.message : "发送失败");
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
        setErrorMsg(apiErr instanceof ApiError ? apiErr.message : "发送失败");
      }
    },
    [sessionId, pageContextOverride, pendingMentions, qc, onSendSettled],
  );

  const { queue, removeEntry, retryEntry, isQueueFull } = useMessageQueue({
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
        setPreError(err instanceof ApiError ? err.message : "创建会话失败，请重试");
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
    if ((!prompt && pendingAttachments.length === 0) || prompt.length > MAX_PROMPT_LEN) return;
    const teamCmd = parseTeamCommand(prompt);
    const hasActiveMission = teamMissions.some((m) => isActiveTeamMission(m.status));
    // task-03（D-102）：预会话首句 → createSession 直发（不走队列——无既有
    // session 可附着，R2 先例）。
    // ql-20260825-001（D-7 对齐）：附件非空允许空 prompt（看图说话）；首句
    // 附件随 create 上送（此前被静默丢弃——回显缺失的根因）。
    // ql-20260826-013：预会话无拦截回路，/team 前缀直接剥离随首句上送（裸
    // /team 剥后无内容 → 不发）。
    if (!sessionId) {
      const prePrompt = teamCmd !== null ? teamCmd : prompt;
      if (!prePrompt && pendingAttachments.length === 0) return;
      void handlePreSessionSend(
        prePrompt,
        pendingAttachments.map((a) => a.id),
      );
      return;
    }
    // task-11（D-004 四路等价）：/team 前缀拦截——不直接发送，弹层确认后目标文本
    // 随下条消息发出（objective 预填去前缀文本）。仅 Claude 会话且可发消息时拦截。
    // ql-20260826-010：已有活跃 mission（弹层确认预建/R-07 单活跃）时放行直发——
    // 确认后回填的 /team 指令若再被拦截会陷入「弹层⇄回填」死循环，且该轮本就
    // 该走主控轮 briefing 注入派发分身。
    if (
      teamCmd !== null &&
      !hasActiveMission &&
      sessionEngine === "claude" &&
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
    // ql-20260826-013：/team 是平台 UI 指令，永不作为 agent 消息原文——拦截弹层
    // 外的放行路径（活跃 mission 主控轮直发 / 非拦截引擎）统一剥离前缀发送。
    // 原文直达 Claude Code 会被当 slash command 报「Unknown command: /team」
    //（会话 2eac7c91 实证，主控轮三连空转）；主控派发靠 mission briefing 服务端
    // 注入，不依赖字面前缀。
    const effectivePrompt = teamCmd !== null ? teamCmd : prompt;
    if (!effectivePrompt && pendingAttachments.length === 0) return; // 裸 /team 无可发内容
    // design §3.3：仅终态（ended/failed）与离线禁发；running / reconnecting /
    // pending 不再拦截（忙轮入服务端排队，ql-20260825-011）。
    // task-10：suspended 挂起禁发（daemon 不在线，发也必失败；输入框本已禁用，
    // 此处为发送路径防御性兜底）。
    if (!session || ended || suspended || !machineOnline) return;
    if (isQueueFull) return; // D-002 满员拒收：提示见 placeholder，草稿与附件保留
    const attachmentIds = pendingAttachments.map((a) => a.id);
    // D-004：登记附件元数据（投递只携带 ids）——先登记再发送，保证占位轮可查。
    for (const a of pendingAttachments) {
      attachmentMetaRef.current.set(a.id, { kind: a.kind, name: a.name });
    }
    // ql-20260825-011：忙轮 → 服务端排队（无占位轮，后端 run 终态后派发）；
    // 空闲 → 占位轮直发。草稿与附件改为发送成功后清（onSendSettled）。
    if (running) {
      void sendToServerQueue(effectivePrompt, attachmentIds);
      return;
    }
    void sendFromQueue(effectivePrompt, attachmentIds);
  }, [input, sessionId, session, ended, suspended, machineOnline, running, isQueueFull, pendingAttachments, sendToServerQueue, sendFromQueue, sessionEngine, openTeamPopover, handlePreSessionSend, teamMissions]);

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
  // team missions）；配置条与团队触发行同构挂载（团队行 task-13 解禁，随首句
  // 创建生效）。
  if (!sessionId) {
    // task-14（FR-08 辅半）：纯空文本禁点不在本条件追加——空内容判断收口在共享
    // SessionInputBar 发送按钮（!value.trim() 且无附件，D-7 附件例外维持）+
    // handleSend 双守卫；本 disabled 同时禁 textarea，并入 trim 判断会在空输入
    // 时锁死输入框无法打字。
    const preSendingDisabled =
      !preContext || !preMachineOnline || sessionWorkspaceArchived;
    const prePlaceholder = sessionWorkspaceArchived
      ? "工作区已归档，会话只读。恢复请到工作区详情把状态改回「活跃」"
      : !preContext
        ? "请先选择机器与智能体…"
        : !preMachineOnline
          ? "机器离线，输入不可用…"
          : `发送第一句话开始对话…（Enter 发送 · Shift+Enter 换行 · ${MENTION_PLACEHOLDER_HINT}）`;
    // task-13（FR-05）：预会话团队门控——与真会话同构（:1771 附近
    // teamButtonDisabled/teamButtonTitle 先例）：引擎 claude（D-003 一期专属）
    // + 所选机器在线；机器列表找不到不武断判离线（preMachineOnline 语义
    // 保持）。tooltip 按未满足原因更新，可用时提示首句创建会话即预建团队任务。
    const preTeamEngineOk = preEngine === "claude";
    const preTeamButtonDisabled = !preContext || !preTeamEngineOk || !preMachineOnline;
    const preTeamButtonTitle = !preContext
      ? "请先选择机器与智能体"
      : !preTeamEngineOk
        ? "团队需要 Claude 引擎"
        : !preMachineOnline
          ? "所选机器离线，无法派团队"
          : "派团队：首句创建会话时预建团队任务";
    // task-07 Phase 5（FR-06 / D-004@v2）：ppm_project 页面上下文 → 弹层项目
    // 预选 id（「发起团队」入口自动开弹层时项目/工作区随上下文预选）。
    const pageProjectId =
      preContext?.pageContext?.page_key === "ppm_project"
        ? preContext.pageContext.project_id
        : undefined;
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
  const placeholder = sessionWorkspaceArchived
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
  // ql-20260828-009-4a13：dismissed 收起记忆下线——chip 常驻至 mission 终态。
  const teamChipWorkers = activeTeamMission
    ? activeTeamMission.workers.length
    : null;

  // ql-20260815-011：无真实标题不渲染占位「未命名会话」，只留 id 短码。
  const title = session.title?.trim() || "";
  // task-10（design A6）：suspended「已挂起」（default 阶，对齐原型⑤ muted
  // pill）；词表外未知值兜底「未知状态」（default 阶，不崩溃、不误标恢复中）。
  const statusBadge =
    session.status === "active"
      ? { status: "processing" as const, text: "活跃" }
      : session.status === "ended"
        ? { status: "default" as const, text: "已结束" }
        : session.status === "failed"
          ? { status: "error" as const, text: "已失败" }
          : (session.status as string) === "suspended"
            ? { status: "default" as const, text: "已挂起" }
            : session.status === "pending" || session.status === "reconnecting"
              ? { status: "warning" as const, text: "恢复中" }
              : { status: "default" as const, text: "未知状态" };

  // task-14（design §5.4）：会话主体条件提升为变量——mobile 外包横向滚动容器
  // （PANEL_BODY_WRAP_CLS_MOBILE），desktop 原样直挂（DOM 结构/props 零变化）。
  const sessionBody = isToolReportBody ? (
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
            <span>会话已挂起——守护进程不在线，重新启动后会话将自动恢复</span>
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

      {/* 会话主体（task-07 / 2026-08-23-agent-activity-sessions design §3.4）：
          - origin=tool_report 且 turn_count===0（未继续过对话）→ 本地 Agent
            日志条目流即会话主体（AgentLogSessionBody），输入区保留在下方
            （首条消息懒激活派发，D-002）；
          - 其余会话（chat / 已激活 tool_report 继续对话后）→ 正常对话流
            （task-13 共享子组件；弹窗与新页面同构复用。gap-fix：turns 用
            displayTurns），尾部挂仅关联本会话的折叠日志条目（AgentLogCard
            sessionId 关联；D-004：workspace 级旧挂载已移除，streamFooter
            注入口保留复用）。
          - task-14：mobile 外包横向滚动容器（表格等横向内容不撑破竖屏视口）。 */}
      {mobile ? (
        <div className={PANEL_BODY_WRAP_CLS_MOBILE}>{sessionBody}</div>
      ) : (
        sessionBody
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
        <div className="px-5 pb-3">
          <SessionConfigBar
            sessionId={sessionId}
            running={running}
            ended={ended || !machineOnline}
            agentProfileId={session.agent_profile_id ?? null}
            llmProviderId={session.llm_provider_id ?? null}
            configSnapshot={session.config_snapshot ?? null}
            engine={session.provider ?? null}
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
          providers={sessionEngine != null ? [sessionEngine] : []}
          defaultProvider={sessionEngine ?? ""}
          hasOnlineProvider={machineOnline}
        />
      )}
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
 * task-10（design A5/A6）：suspended——attach 目标会话处于挂起态（daemon 不
 * 在线）。SessionUiStatus 无此值（turn-timeline 词表不扩），挂起展示由本标志
 * 独立承载：info 横幅 + 输入禁用；attach 轮询不把它计为恢复失败（挂起窗口
 * 以小时计，超出 15s 轮询上限是常态），daemon 重启转 reconnecting/active 后
 * 自动收敛。
 */
interface SessionDialogView {
  sessionId: string | null;
  status: SessionUiStatus;
  /** task-10：attach 目标会话挂起中（backend status === 'suspended'）。 */
  suspended: boolean;
  currentRunId: string | null;
  turns: SessionTurnView[];
  errorMsg: string | null;
  terminatingAt: string | null;
}

const INITIAL_DIALOG_VIEW: SessionDialogView = {
  sessionId: null,
  status: "idle",
  suspended: false,
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
    editPatch: env.edit_patch ?? null,
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
  const view: AssembledTurn = {
    segments:
      turn.segments ?? bootstrapLegacySegments(turn.output, turn.processItems ?? []),
    output: turn.output,
    processItems: turn.processItems ?? [],
    turnStartedAt: turn.turnStartedAt ?? null,
    seenLogIds: turn.seenLogIds,
  };
  // F7：视图与 turn 的 segments 同源（segments 有值时同引用），转移装配器增量
  // 内部状态（投影 cell / 段 id 索引），保持 O(1) 增量链跨视图不断链。
  transferAssemblerInternals(view, turn as AssembledTurn);
  return view;
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
    if (item.kind === "file") {
      // agent-file-upload-mcp：file 过程项反投影回 file 段（字段一一对应）
      return {
        kind: "file",
        id: `legacy:file:${i}`,
        fileId: item.fileId,
        name: item.name,
        size: item.size,
        mime: item.mime,
        description: item.description ?? "",
        ts: item.ts ?? null,
      };
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

  // ── task-09 / design A6：连接横幅 + 运行轮看门狗（共用 hook；dialog 无
  // react-query——会话级对账不挂 invalidate，轮级终态经 resync 合成事件收敛）。──
  const connGuard = useStreamConnectionGuard({
    sessionId: view.sessionId,
    currentRunId: view.currentRunId,
    getConnection: () => streamConnRef.current,
  });

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
   * 空白不比对会导致已发送消息残留输入框）。ql-20260826-013：加 /team 前缀
   * 剥离比对（同 page——发送剥前缀文本、草稿带前缀，对上即清）。
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
  const { queue, removeEntry, retryEntry, isQueueFull, refresh: refreshQueue } =
    useMessageQueue({
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
        const logs = await getAgentSessionLogs(sessionId);
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
          errorMsg: apiErr instanceof ApiError ? apiErr.message : "追问失败",
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
          errorMsg: apiErr instanceof ApiError ? apiErr.message : "发送失败",
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
      (!prompt && pendingAttachments.length === 0) ||
      prompt.length > MAX_PROMPT_LEN
    ) {
      return;
    }
    if (!hasOnlineProvider) return;
    if (offlineReadOnly) return;
    if (view.status === "ended" || view.status === "failed") return;
    if (view.status === "creating" || view.status === "ending") return;
    // task-10（design A5）：挂起禁发——daemon 不在线，发也必失败；输入框本已
    // 禁用，此处为发送路径防御性兜底（恢复由 daemon 重启自动完成，D-001）。
    if (view.suspended) return;
    if (isQueueFull) return; // D-002 满员拒收

    // task-11（D-004 四路等价）：/team 前缀拦截——不发送，弹层确认后目标随下条
    // 消息发出（objective 预填去前缀文本）。仅 Claude 引擎且已有 active 会话时
    // 拦截（idle 无会话可挂 mission / 非 active 原路发送）。
    // ql-20260826-010：已有活跃 mission（弹层确认预建）时放行直发——确认后
    // 回填的 /team 指令若再被拦截会陷入「弹层⇄回填」死循环（同 page 模式）。
    const teamCmd = parseTeamCommand(prompt);
    const hasActiveMission = teamMissions.some((m) => isActiveTeamMission(m.status));
    if (
      teamCmd !== null &&
      !hasActiveMission &&
      provider === "claude" &&
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

    // ql-20260826-013：/team 是平台 UI 指令不进 agent 消息——拦截弹层外的放行
    // 路径（idle 首句 / 活跃 mission 直发 / 非拦截引擎）统一剥离前缀发送，防
    // Claude Code 当 slash command 报「Unknown command: /team」（会话 2eac7c91
    // 实证）；裸 /team 剥后无内容 → 不发。
    const effectivePrompt = teamCmd !== null ? teamCmd : prompt;
    if (!effectivePrompt && pendingAttachments.length === 0) return;

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
            prompt: effectivePrompt,
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
          prompt: effectivePrompt,
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
        const msg = err instanceof ApiError ? err.message : "创建会话失败";
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
      await sendToServerQueue(effectivePrompt, attachmentIds);
      return;
    }
    try {
      await submitFollowup(effectivePrompt, attachmentIds);
    } catch {
      /* errorMsg 已写入 view（占位轮回滚），此路径不向上抛 */
    }
  }, [input, hasOnlineProvider, offlineReadOnly, view.status, view.suspended, view.sessionId, view.currentRunId, isQueueFull, provider, changeId, workspaceId, pendingMentions, establishStream, onSessionCreated, sendToServerQueue, submitFollowup, openTeamPopover, pendingAttachments, teamMissions]);

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
  const attachmentsDisabled = provider !== "claude" || !view.sessionId;
  const attachmentsDisabledTitle =
    provider === "claude" && !view.sessionId
      ? "发送首条消息创建会话后可添加附件"
      : undefined;

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
          attach 轮询持续观察，daemon 重启转 reconnecting/active 后自动收敛。 */}
      {view.suspended ? (
        <div
          role="status"
          aria-live="polite"
          data-session-banner="suspended"
          className="border-b border-info/30 bg-info/10 px-5 py-2 text-xs text-info"
        >
          <div className="flex items-center gap-2">
            <PauseCircle aria-hidden className="h-3.5 w-3.5 shrink-0" />
            <span>会话已挂起——守护进程不在线，重新启动后会话将自动恢复</span>
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

      {/* 排队消息条（design §3.2 / 目标 3：dialog 与 page 共用；空队列组件自返回
          null 不占位）。ql-20260825-007：条目可带附件（📎 数展示），onRemove 顺带
          清理附件元数据镜像防残留（镜像 page 模式）；onRetry 仅用户触发（D-003，
          hook 内 failed→pending 后条件满足即投递）。 */}
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
      />

      {/* task-14：分身会话浮层——复用 SessionPanel（dialog/attach 形态）打开分身
          子会话；dialog 必需 props 按本面板透传（模型覆盖受控对共用父级 state）。 */}
      {workerSessionId != null && (
        <WorkerSessionOverlay
          subSessionId={workerSessionId}
          onClose={() => {
            setWorkerSessionId(null);
          }}
          providers={providers}
          defaultProvider={defaultProvider}
          model={model}
          onModelChange={onModelChange}
          hasOnlineProvider={hasOnlineProvider}
        />
      )}
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
      // task-08（FR-01）：unknown run 首建 turn 同步携带 ctx（tokens 事件到达
      // 早于 turn_started 时 upsert 走此分支）；null = 未知。
      ctxTokens: env.ctx_tokens ?? null,
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
  const view: AssembledTurn = {
    segments: turn.segments ?? [],
    output: turn.output,
    processItems: turn.processItems ?? [],
    turnStartedAt: turn.turnStartedAt ?? null,
    seenLogIds: turn.seenLogIds,
  };
  // F7：同 assembledViewOf——转移增量内部状态，segments 有值时同源同引用。
  transferAssemblerInternals(view, turn as AssembledTurn);
  return view;
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
    editPatch: env.edit_patch ?? null,
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

/* ── ql-20260825-011：输入框草稿按会话持久化（刷新/切换会话不丢）────────── */

/** 预会话态（无 sessionId）的草稿固定键。 */
const SESSION_DRAFT_PRE_KEY = "__pre__";

function sessionDraftLsKey(sessionId: string | null): string {
  return `sillyhub.sessions.draft.${sessionId ?? SESSION_DRAFT_PRE_KEY}`;
}

/** 挂载/切换会话回读草稿（SSR 或读取失败返回空串）。 */
function readSessionDraft(sessionId: string | null): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(sessionDraftLsKey(sessionId)) ?? "";
  } catch {
    return "";
  }
}

/** 每次输入变化写入（隐私模式等写入失败静默）。 */
function writeSessionDraft(sessionId: string | null, draft: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(sessionDraftLsKey(sessionId), draft);
  } catch {
    /* 静默容错 */
  }
}

/* ── bash 进度卡片状态归约（page / dialog 两模式共用，2026-08-25 修复）────── */

/** BashProgressCard 聚合状态（bash_status + bash_chunk 事件归约产物）。 */
export interface BashProgressState {
  runId: string;
  command: string;
  status: "running" | "completed" | "failed";
  exitCode?: number | null;
  elapsedMs?: number | null;
  chunks: BashChunkItem[];
}

/** chunks 环形截断上限：条数（后端 100ms/8KB 节流下 600 条已覆盖长跑输出窗口）。 */
const BASH_CHUNKS_MAX_COUNT = 600;
/** chunks 环形截断上限：累计 content 字节（约 256KB，防数 MB 输出常驻内存）。 */
const BASH_CHUNKS_MAX_BYTES = 256 * 1024;

/** chunk content 的 UTF-8 字节长度近似（BMP 内 1~3 字节/字符，与 TextEncoder 一致）。 */
function bashChunkBytes(content: string): number {
  let bytes = 0;
  for (let i = 0; i < content.length; i++) {
    const code = content.charCodeAt(i);
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : 3;
  }
  return bytes;
}

/**
 * bash_status 归约：按「新命令开始」判定是否重置 chunks。
 *
 * P1 修复：同一 run 内第二条 bash 命令（runId 不变、command 变化）不能沿用上一
 * 条的输出 chunks——含 is_final 的旧 chunk 会让新命令 spinner 被提前终止
 * （bash-progress-card 的 isRunning = status==="running" && 无 is_final chunk）、
 * 输出拼接错乱。新命令判定 = runId / command 任一变化，或同命令 status 从终态
 * 翻回 running（重跑兜底）。
 */
export function applyBashStatusEvent(
  prev: BashProgressState | null,
  event: Pick<
    BashStatusEvent,
    "run_id" | "command" | "status" | "exit_code" | "elapsed_ms"
  >,
): BashProgressState {
  const isNewCommand =
    !prev ||
    prev.runId !== event.run_id ||
    prev.command !== event.command ||
    (prev.status !== "running" && event.status === "running");
  return {
    runId: event.run_id,
    command: event.command,
    status: event.status,
    exitCode: event.exit_code,
    elapsedMs: event.elapsed_ms,
    chunks: isNewCommand ? [] : prev.chunks,
  };
}

/**
 * bash_chunk 归约：追加输出片段 + 环形截断。
 *
 * P1 修复：裸 `[...prev.chunks, chunk]` 无上限，长跑命令可数 MB 常驻内存且每次
 * 触发全量重拼。截断策略：超条数上限先裁尾保最近 N 条；再超字节预算从头部丢弃
 * 整条 chunk（保底留最后一条，防全空）。is_final 语义：最后一条 is_final 不丢
 * （卡片靠它提前停 spinner；权威收敛仍由 bash_status 终态事件兜底）。
 */
export function appendBashChunk(
  prev: BashProgressState,
  chunk: BashChunkItem,
): BashProgressState {
  let chunks = [...prev.chunks, chunk];
  if (chunks.length > BASH_CHUNKS_MAX_COUNT) {
    chunks = chunks.slice(chunks.length - BASH_CHUNKS_MAX_COUNT);
  }
  let bytes = 0;
  for (const c of chunks) bytes += bashChunkBytes(c.content);
  let start = 0;
  while (chunks.length - start > 1 && bytes > BASH_CHUNKS_MAX_BYTES) {
    const head = chunks[start]!;
    // 保最后一条 is_final：丢弃它会破坏「is_final 到达停 spinner」语义。
    if (head.is_final && !chunks.slice(start + 1).some((c) => c.is_final)) break;
    bytes -= bashChunkBytes(head.content);
    start += 1;
  }
  return start > 0 ? { ...prev, chunks: chunks.slice(start) } : { ...prev, chunks };
}

/* ── 后台 Agent 任务状态归约（task-12 / 2026-08-27-background-subagent-progress）── */

/**
 * agent_task_status 归约（page / dialog 两模式共用，对齐 bash 先例收口到底部）：
 * 按 task_id upsert，扩展字段（工具名 / summary / tokens / 走秒锚点）事件未带
 * （null）时保留旧值——服务端累计量只增不减，心跳缺字段不回退；running 心跳
 * 推进「最后活跃」锚点；终态事件到达即定格（记 terminalAt + 服务端 elapsed），
 * 此后迟到的 running 心跳不复活转圈（终态为吸收态，后到终态允许覆盖定格数据）；
 * 最近 6 条截断语义与原实现一致（终态保留供回看，会话结束由调用方清空）。
 */
export function applyAgentTaskStatusEvent(
  prev: AgentTaskEntry[],
  event: AgentTaskStatusEvent,
): AgentTaskEntry[] {
  const now = Date.now();
  const idx = prev.findIndex((t) => t.taskId === event.task_id);
  const existing = idx >= 0 ? (prev[idx] ?? null) : null;
  // 终态定格：已定格（completed / failed / stopped）的卡片忽略迟到 running 心跳。
  if (existing && existing.status !== "running" && event.status === "running") {
    return prev;
  }
  const next: AgentTaskEntry = {
    taskId: event.task_id,
    taskName: event.task_name,
    status: event.status,
    progress: event.progress,
    message: event.message,
    // FR-04 扩展字段：事件缺省（null / undefined）时沿用旧值（首见任务为 null）。
    isAsync: event.async ?? existing?.isAsync ?? null,
    lastToolName: event.last_tool_name ?? existing?.lastToolName ?? null,
    summary: event.summary ?? existing?.summary ?? null,
    elapsedMs: event.elapsed_ms ?? existing?.elapsedMs ?? null,
    totalTokens: event.total_tokens ?? existing?.totalTokens ?? null,
    toolUses: event.tool_uses ?? existing?.toolUses ?? null,
    // 走秒校准锚点：elapsed_ms 到达即重置；首见任务记 startedAt 兜底（无服务端
    // 时长时卡片走 startedAt 起本地走秒）。
    elapsedSyncedAt:
      event.elapsed_ms != null ? now : existing?.elapsedSyncedAt ?? null,
    startedAt: existing?.startedAt ?? now,
    // 「最后活跃」锚点：running 心跳推进，终态定格后不再更新（卡片据此判 >5min
    // 沉默；终态本身不触发警示）。
    lastActivityAt:
      event.status === "running" ? now : existing?.lastActivityAt ?? null,
    terminalAt: event.status === "running" ? existing?.terminalAt ?? null : now,
  };
  if (idx === -1) return [...prev, next].slice(-6);
  const copy = [...prev];
  copy[idx] = next;
  return copy;
}

