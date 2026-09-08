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
 *   - task-09（2026-08-31-session-queue-ux / FR-03/04/05/06）：队列条接线收口
 *     ——SSE queue_changed → streamSession handlers 新增 onQueueChanged →
 *     useMessageQueue.refresh()（后端入队/派发/删除/失败/重排/编辑/立即派发均
 *     即时刷新，5s 轮询降级兜底；page 模式直接闭包 refresh，dialog 模式走既有
 *     queueRefreshRef 先例避开 use-before-define）；MessageQueueBar 三回调
 *     （onReorder/onEdit/onDispatchNow）透传 hook 的 reorderEntry/editEntry/
 *     dispatchNowEntry——队列 API 失败静默由 hook 内 catch 承担，panel 层不弹
 *     错误提示；page 与 dialog 双模式同批接线。
 *   - task-08（2026-09-07-session-pin-rename-scheduled-send / FR-04 / FR-05）：
 *     定时发送——输入栏 ⏰（onSchedule 注入，仅已有 sessionId 的会话）开
 *     ScheduledSendModal（草稿预览 + 分钟级 DatePicker + 快捷项 30 分钟后/1 小时
 *     后/明早 9 点，本地时区计算）；确认 createScheduledMessage 成功 → 清草稿 +
 *     聊天流插系统提示行（TurnTimeline streamFooter 注入口，ScheduledSysHints）+
 *     递增 schedRefresh 驱动 ScheduledMessagesBar（MessageQueueBar 邻位双挂载：
 *     page / dialog）刷新。ScheduledMessagesBar 自建局部 QueryClientProvider
 *     （含 useScheduledMessages 30s 轮询）——R4 不变式不破：panel 层定时链路
 *     零 useQuery/useQueryClient，dialog 弹窗测试无 Provider 也能挂。
 *     （D-010 第二回合自 main 2ad590192 移植：弹窗/提示行在 ./scheduled-send，
 *     状态与 handler 按原归属留在 page / dialog 组件内。）
 */
//
// 目录化说明（task-14 / 2026-09-07-arch-large-file-split design §5 Wave 3）：本文件为
// session-panel 目录入口——SessionPanel 分发器与对外 7 符号导出面（对齐拆分前
// grep "^export" 清单，导入路径 @/components/daemon/session-panel 零变化）；
// page 模式渲染 ./session-panel-page，dialog 模式渲染 ./session-panel-dialog，
// 共享状态机/纯 helper 在 ./turn-state 等子模块。零行为变化。

import { SessionPanelPage } from "./session-panel-page";
import type { SessionTurnView } from "@/components/daemon/turn-timeline";
import type { LlmProviderRead } from "@/lib/api/llm-providers";
import type {
  DaemonMachineRead,
  PpmItemKind,
  SessionCreateResponse,
} from "@/lib/daemon";
import { SessionPanelDialog } from "./session-panel-dialog";
// 对外导出面（7 符号）：bash 归约三件套自 ./turn-state 再导出；
// applyAgentTaskStatusEvent 再导出链相对路径随目录层级 +1（./agent-task-store → ../agent-task-store）。
export { applyBashStatusEvent, appendBashChunk, type BashProgressState } from "./turn-state";
export { applyAgentTaskStatusEvent } from "../agent-task-store";

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
