---
schema_version: 1
doc_type: module-card
module_id: components-daemon
author: qinyi
created_at: 2026-08-18 01:45:00
---

# Daemon 运行时交互组件（components-daemon）

## 定位
Daemon 运行时 / 机器 / 会话交互组件（`components/daemon/`，12 源文件 + 十余套测试）。三块职责：
① 运行时管理页展示（machine-card 手风琴机器卡 + runtime-card 运行时卡 + helpers 格式化件）；
② 会话交互（session-panel 共享双模式面板【2026-08-21-session-message-queue 起，sessions 页与弹窗统一实现 + useMessageQueue 排队；2026-08-22-session-panel-unify 起适配层已删、chrome 统一 antd】、runtime-session-dialog 统一弹窗、
turn-timeline 消息流、session-input-bar 输入区、session-list-layout 公共列表）；
③ 辅助件（remote-folder-picker 远程目录浏览器、session-log-sanitize 日志清洗、
runtime-session-helpers 纯函数）。2026-07-11-unify-runtime-session-dialog 起 runtimes
弹窗与变更会话（ChangeSessionSection）共用同一套组件，杜绝两套样式分叉。

## 契约摘要
- `RuntimeSessionDialog`（`runtime-session-dialog.tsx`）：统一会话弹窗。
  - props：`{ runtime, open, onClose, initialSessionId?, ... }`；由 page 单一
    dialogRuntime state 驱动，key 重 mount 重置内部状态；URL `?session=` 恢复点经
    initialSessionId 传入，首次加载优先 attach。
  - 二态化：selected（任意状态）→ attach 续聊；idle → 新建空白。已删
    SessionHistoryView 只读回看分支。
  - ended/failed 会话点开：先 `reopenSession` 转 reconnecting/active 再 attach
    （F-1/C-3：panel attach 轮询仅识别 active/failed，ended 直接 attach 卡超时）。
- `SessionPanel`（`session-panel.tsx`，2026-08-21-session-message-queue）：/sessions 页
  与 /runtimes 弹窗共享的会话面板，`mode: "page" | "dialog"` 渲染层分发（R4 铁律：
  react-query 三件全收 page 子组件 SessionPanelPage，dialog 渲染路径零 useQuery）。
  2026-08-22-session-panel-unify 起：**唯一直连入口**（适配层已删，4 消费方
  runtime-session-dialog / runtime-session-helpers 直接 `SessionPanel mode="dialog"` +（2026-08-22-workspace-sessions-portal 起 workspace-session-section 与 change-session-section 已退役删除，dialog 模式消费面收敛为 runtimes 弹窗侧；会话门户三入口改用 SessionsPortal + page 模式）
  `sessionId={attachSessionId ?? null}`，key 重挂载契约保持）；dialog 分支 chrome
  统一 antd（新建/团队分析默认 32px、打断 small、结束 danger、提供方徽标 Tag；
  D-304 跨区共享组件备案见该变更 design §4.B.7）。
  - page 模式：自 sessions/page.tsx 整块搬运（react-query detail 轮询/whoLine runs
    快照/CtxUsageBar/SessionConfigBar/SubagentCatalog/附件链）。
  - dialog 模式：自旧 interactive-session-panel 逐段搬运（idle createSession 直发/
    attach 轮询 1.5s×10/legacy 反投影/provider+model 选择器/团队分析/offlineReadOnly）。
  - 两模式追问统一走 `useMessageQueue`（hooks-message-queue 模块）：running/
    reconnecting/pending 输入保持可用、消息排队，turn_completed / 恢复 active 后
    自动投递；inject 失败（含 409 TURN_CONFLICT）队头 failed + 重试/删除（D-001~D-004）。
  - 消息生命周期：首条 `createSession` → 追问 `injectSession`（排队调度）→
    `interruptSession` → `endSession`；单条 `streamSession` SSE 贯穿，envelope
    run_id 区分 turn。
- ~~`InteractiveSessionPanel`（`interactive-session-panel.tsx`）~~：**已删除**
  （2026-08-22-session-panel-unify task-01）——127 行薄适配层退役，消费方直连
  `SessionPanel mode="dialog"`；其类型 re-export（turn-timeline 5 类型）由消费方
  直接 import `@/components/daemon/turn-timeline`。
- `MessageQueueBar`（`message-queue-bar.tsx`）：排队消息展示条（纯展示，接
  useMessageQueue.queue）——pending/sending/failed 三态 chip（failed 红语义边框 +
  重试/删除按钮）、40 字摘要 + 附件数、满员「队列已满（N/5）」Tag、点击展开
  displayPrompt + 失败原因；空队列不渲染。
- `TurnTimeline`（`turn-timeline.tsx`）：消息流渲染。类型 `SessionTurnView` /
  `SessionUiStatus`（idle/creating/active/ending/ended/failed/reconnecting 7 态）/
  `TurnUiStatus`（pending/running/interrupting/completed/failed/killed 6 态）/
  `SessionViewMode`（conversation|all）；复用 agent-log 的 renderers。
  TurnStatusBadge 内部渲染为 antd `Badge status`（2026-08-22-session-panel-unify：
  running/interrupting→processing、completed→success、failed/killed→error、
  pending→default，色走 token 零手写）。
- `SessionInputBar`（`session-input-bar.tsx`）：输入区（发送=antd primary、📎=
  antd text，2026-08-22-session-panel-unify；chips 删除为原生 button）。
- `SessionListLayout`（`session-list-layout.tsx`）：公共会话列表（2026-08-22-workspace-sessions-portal 起消费面随 ChangeSessionSection 退役收敛，现仅 runtimes 弹窗使用）；调用方 fetch 后 map 成 `SessionListEntry`
  （id/title/statusBadge/secondaryText/lastActiveAt）传入；`onDelete` 可选
  （runtimes 传删除按钮）；title 空回退 shortId。
- `MachineCard`（`machine-card.tsx`）：受控手风琴机器卡（expanded 由 page 持有）；
  usageByRuntime 由 page 注入（不在卡内拉用量）；展开体内嵌 RuntimeCard 网格；
  内联 `ACTIVE_SESSION_STATUSES`（与 helpers 集合等值，因 allowed_paths 不能 import）。
- `RuntimeCard`（`runtime-card.tsx`）+ `runtime-card-helpers.tsx`：运行时卡与视觉/格式
  工具——`PROVIDER_TONES`（provider 色调三件套 dot/badge/panel）、`getStatusMeta`、
  `getProviderLabel`、`ProviderBadge`、`AgentsList`、`VersionCell`、`RuntimeMeta`、
  `UsageStat`、`buildSparkSeries`、`formatRelativeTime/formatTokens/formatCost/formatCache`、
  `getCapabilityChips/getProtocol/getDisplayVersion`。
- `RemoteFolderPicker`（`remote-folder-picker.tsx`）：远程目录浏览器。基于 daemon
  `list_roots` + `list_dir` RPC；antd Tree loadData 懒加载（只显 dir 子项）+ 地址栏
  手输路径「跳转」（先探 listDir 校验，失败红条 + 禁确认）；受控
  open/onClose/onPick，树状态组件自管。
- `session-log-sanitize.ts`：`sanitizeSessionLogContent` / `classifySessionLog` /
  `isToolResultDenied` / `statusFromToolUseRaw`（→ ok|deny|running）/
  `extractDialogQA`（问答卡数据提取，DialogQA/DialogOption）。
- `runtime-session-helpers.tsx`：`shortId`（8+4 截短）/ `isActiveSession`
  （`ACTIVE_SESSION_VIEW_STATUSES` = active/pending/reconnecting）/ `canResumeSession` /
  `resumeDisabledTitle` / `logsToTurns`（历史日志按 run_id 分组转 SessionTurnView[]
  预填 attach 面板）/ `InteractiveSessionChatSection` / `SessionHistoryView`
  （遗留导出，dialog 重构后已不再用）。

## 关键逻辑
- 会话二态分流：
  ```
  if (selected) → reopen(ended/failed) + attach：logsToTurns(logs) 预填 initialTurns
  else          → idle 新建：createSession(首条消息) → injectSession(后续追问)
  ```
- turn 不变量：currentRunId 只指向 pending/running/interrupting turn，收到同 run 的
  turn_completed 后清空；SSE 重连重复 boundary 按 run_id 幂等更新已有项不新增。

## 注意事项
- 排队语义（2026-08-21-session-message-queue 起）：输入框仅终态（ended/failed）与
  离线禁用；running/reconnecting/pending 可输入、消息入队（旧「currentRun 运行中
  禁发」语义已废弃，D-002@v3 由队列等价承载 turn 级串行）。改投递条件先读
  hooks/use-message-queue.ts 头注释（D-001~D-004）。
- `isActiveSession` 判定完全依赖状态集合——新增会话状态须同步
  `ACTIVE_SESSION_VIEW_STATUSES`；MachineCard 内联等值集合两处同步。
- attach 流程涉及 SSE 连接 + 轮询到 active 的竞态，改动必须跑 `daemon/__tests__`
  （session-panel-dialog×3 / runtime-session-dialog×3 / turn-timeline-session-input-bar /
  session-list-layout / runtime-card×2 / machine-card / remote-folder-picker /
  runtime-session-helpers / session-log-sanitize 等）。
- 会话日志渲染前须经 session-log-sanitize 清洗分类，勿绕过直写渲染逻辑。
- `runtime-session-helpers.tsx` 顶层 import 链含 next/navigation，测试须 mock
  （runtime-session-helpers.test.tsx 头注释为证）。
- SUPPORTED_SESSION_PROVIDERS = ["claude","codex"] 在 dialog 与 ChangeSessionSection
  两处内联，扩展 provider 两处同步。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
