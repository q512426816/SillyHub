---
schema_version: 1
doc_type: module-card
module_id: components-daemon
author: qinyi
created_at: 2026-08-18 01:45:00
updated_at: 2026-08-26 19:45:00
---

# Daemon 运行时交互组件（components-daemon）

## 定位
Daemon 运行时 / 机器 / 会话交互组件（`components/daemon/`，13 源文件 + 十余套测试）。三块职责：
① 运行时管理页展示（machine-card 手风琴机器卡 + runtime-card 运行时卡 + helpers 格式化件）；
② 会话交互（session-panel 共享双模式面板【2026-08-21-session-message-queue 起，sessions 页与弹窗统一实现 + useMessageQueue 排队；2026-08-22-session-panel-unify 起适配层已删、chrome 统一 antd】、runtime-session-dialog 统一弹窗、
turn-timeline 消息流、session-input-bar 输入区、session-list-layout 公共列表）；
③ 辅助件（remote-folder-picker 远程目录浏览器、session-log-sanitize 日志清洗、
runtime-session-helpers 纯函数）。2026-07-11-unify-runtime-session-dialog 起 runtimes
弹窗与变更会话（ChangeSessionSection）共用同一套组件，杜绝两套样式分叉。

## 契约摘要
- 共享与平台共享（2026-08-28-daemon-agent-share）：`shared-machines-section`（「共享给我的」
  虚线卡：共享人/来源工作区/在线态，操作仅「会话」且锁**在线 runtime_id**，无修改类入口 FR-03）；
  `platform-shared-agents-card`（admin-only 管理卡：档案/runtime/源码工作区/writable_dir 四字段
  创建 + 生效列表/停用）；session-panel 会话头「平台共享」徽标（agent_profile_id ∈ active 共享
  档案前端判定，D-004@v2 用户自选——悬浮回退链零改动）。
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
  - 预会话态（2026-08-23-sessions-workspace-hub task-03/07，仅 page 分支）：page 模式
    `sessionId=null` + `preContext` → 与真会话**同构**的空态（不防御性 return null），
    渲染锁定上下文行（工作区名/变更名/机器·智能体）+ 输入框；首句发送触发
    `createSession` 原地接管（D-101/D-102），成功经 `onPreSessionCreated(resp)` 上报
    父层（父层切 sessionId → 状态机自然接管），**失败保留输入 + 内联错误可重试**
    （R-02，成功才清输入——dialog idle 先清后建的丢输入行为不复用）；首句只发文本
    （createSession 契约无 attachment_ids）。
    - `SessionPreContext`（导出）：`{ workspaceId: string | null, changeId?: string | null, runtimeId: string }`——入口/组头「＋」解析产物；机器+引擎经 runtimeId 已定（创建后不可换）；change 入口调用方须显式双传 workspaceId+changeId（X-13）。
    - null 守卫清单（R-01，预会话态全 effect 停发）：不请求会话详情（detailQuery enabled 守卫 + queryFn 窄化双保险）、无会话级 viewMode 持久化键、不建 SSE 流/不预取历史（getAgentSessionLogs/listSessionRuns 零调用）、消息队列不激活不投递、团队 mission 不挂载、会话作用域操作对齐 dialog 版守卫。
    - change 变更名查询（task-07/D-106）：preContext 双传时 getChange 解析变更名（enabled 守卫，真会话/非 change 预会话停请求；title 缺省回退 change_key）。
  - dialog 模式：自旧 interactive-session-panel 逐段搬运（idle createSession 直发/
    attach 轮询 1.5s×10/legacy 反投影/provider+model 选择器/团队分析/offlineReadOnly）。
  - 两模式追问统一走 `useMessageQueue`（hooks-message-queue 模块）：running/
    reconnecting/pending 输入保持可用、消息排队，turn_completed / 恢复 active 后
    自动投递；inject 失败（含 409 TURN_CONFLICT）队头 failed + 重试/删除（D-001~D-004）。
  - 消息生命周期：首条 `createSession` → 追问 `injectSession`（排队调度）→
    `interruptSession` → `endSession`；单条 `streamSession` SSE 贯穿，envelope
    run_id 区分 turn。
  - 历史回看一致性（ql-20260822-010）：displayTurns 富集时按 runsMeta run 快照
    回补终态（`runTerminalTurnStatus`：failed→failed+errorDetail（无详情兜底
    「运行失败（无详情）」）、interrupted/cancelled→killed）——logsToTurns 一律
    completed 的伪态不再遮蔽失败轮；viewMode（对话/进度）按会话 localStorage
    持久化（page 模式，挂载 effect 回读防 hydration mismatch；dialog 无刷新
    恢复场景不持久化）。
  - 流式渲染热路径（ql-20260903-025）：displayTurns 富集加**身份稳定守卫**——
    补齐字段与原值全一致时返回原对象（流式 delta 只 path-copy 改一个 turn，
    其余 turn 引用不变，下游 MarkdownText/段级 memo 才能命中；此前每 delta
    全量 clone 击穿一切 memo）；turn-timeline prompt 附件标记解析按内容缓存
    （FIFO 500）；dialog establishStream 回放拉取对齐 page 分页口径
    （limit=HISTORY_PAGE_SIZE，弹窗无触顶入口、更早历史去会话页）。遗留：
    listSessionRuns 无 limit 全量（含 system_prompt 快照）需后端加 limit 参数
    配合，未在本批。
  - ql-20260826-010 三项行为修正（两模式同步）：
    ① 发送成功清草稿改 **trim 比对**（`onSendSettled`：`prev.trim() === prompt`）——
    handleSend 发的是 `input.trim()`，粘贴带尾随空白时精确比对永不清空，已发送
    消息残留输入框并被草稿持久化放大；发送窗口期新输入仍不覆盖（trim 不等即保留）。
    ② 派团队弹层确认后输入框回填 **前置 /team 指令**（`/team <objective>`，空目标
    裸 `/team`）——裸 objective 纯文本常被主控 agent 当普通聊天不派发分身；
    回填前 await mission 刷新，activeTeamMission 已就位。
    ③ `/team` 前缀拦截在**已有活跃 mission 时放行直发**（handleSend 判
    `teamMissions.some(isActiveTeamMission)`）——否则确认回填的 /team 再发送
    会被拦截重开弹层死循环；无活跃 mission 时拦截弹层行为不变。
    ④ ql-20260826-013：/team 是**平台 UI 指令，永不作为 agent 消息原文**——拦截
    弹层外的所有放行路径（预会话首句 / 活跃 mission 主控轮直发 / 非拦截引擎）
    统一剥离前缀发送（effectivePrompt），裸 /team 剥后无内容不发送；原文直达
    Claude Code 会被当 slash command 报「Unknown command: /team」（会话
    2eac7c91 实证，主控轮空转不派发）。onSendSettled 草稿清空同步加
    parseTeamCommand 剥离比对（带前缀草稿 vs 剥离后发送文本对上即清）。
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
  pending→default，色走 token 零手写）。滚动容器贴底跟随（ql-20260822-010）：
  onScroll 维护距底 <80px ref，仅贴底时随 turns 更新滚底（上滚读历史不被拉回），
  新增 pending 轮（用户刚发送）例外强制回底。
  回到底部悬浮按钮 + 新消息计数（ql-20260903-023，照群聊同款）：离开底部出现，
  离开期间新增轮显示「N 条新消息」；锚定守卫按**末轮身份**（渲染期从 turns 计算，
  不经 ref——更新不触发重渲染会滞后）判断——仅触顶翻页 prepend（末轮不变）
  不计入；组件根新增 relative 包装层承载按钮定位（flex 角色与原滚动容器等价，
  variant 回归锚已同步）。
  「加载更早」prepend 伪 runId 规则（ql-20260903-002）：logsToTurns 每次调用的
  `__attach_history_N__` 从 1 重新编号，prepend 的每页 turn **全量**加 `#e<全量数字
  游标>` 后缀防跨页撞 React key（多 run 会话更早页的不同 run 与当前窗口必撞）；
  realRunId 保持原值——SSE 实时增量与孤儿 run 补建按 realRunId 匹配，upsertTurn
  对 realRunId 命中取**最末**块（prepend 的同 run 更早段在数组头部，首中会把
  流式输出写进历史块、当前尾部块停滞）。
  「加载更早」换会话竞态守卫（ql-20260903-018）：请求在途切换会话时，新会话
  effect 使 sessionEpochRef 自增并 abort 在途请求，响应携带的发起纪元不过校验
  即丢弃——旧会话历史不再 prepend 进新会话时间线串台；触顶滚动监听不再按
  isToolReportBody 早退（渲染期镜像 + effect 依赖缺翻转维度 → tool_report 会话
  聊首句后监听永不挂载），改常驻挂载靠监听器自身 data-testid 过滤。
- `SessionInputBar`（`session-input-bar.tsx`）：输入区（发送=antd primary、📎=
  antd text，2026-08-22-session-panel-unify；chips 删除为原生 button）。
  ql-20260826-010：胶囊上缘高度拖拽手柄（mousedown+document mousemove 实时
  调高，clamp 44px~min(480,视口60%)，`sillyhub.sessions.inputBarHeight` 全局
  持久化，双击恢复默认清键；挂载懒读回显）。
- `ActivityCatalog`（`activity-catalog.tsx`，ql-20260826-010）：头部「后台 ▾」
  下拉（与 SubagentCatalog 同款开合交互），收编原三段
  常驻区——Bash 命令进度卡（BashProgressCard）/ 后台 Agent 任务卡
  （AgentTaskCard）/ 会话团队任务块（TeamTaskBlock，取消与分身子会话经 props
  透传父层）；三源全空返回 null 零占位；运行中触发按钮带脉冲点。
  ql-20260826-014：收起判定改 **containment**（mousedown 落点在根容器 ref 外
  才收，Escape 收起）——原「document click 一律收 + 内部 stopPropagation 拦截」
  在真实浏览器事件时序下有误关风险（点团队块「展开」整个下拉被关，用户实测
  反馈）；目录内任意深度点击（含块展开/滚动条）一律不收。session-panel
  两模式头部挂载（page 在 SubagentCatalog 旁、dialog 在视图切换 tab 前），
  原消息流与输入区之间的三段常驻 JSX 已删（仅保留一行「后台任务仍在运行」
  提示，无活跃 turn 且有 running 任务时显示）。配套：TeamTaskBlock 移除
  「active→终态过渡自动收敛折叠」（5s 轮询送达终态时正被用户查看会被强制
  收起——「点开就被关」的另一来源；终态默认折叠仍由挂载初始态保证）。
- `SessionListLayout`（`session-list-layout.tsx`）：公共会话列表（2026-08-22-workspace-sessions-portal 起消费面随 ChangeSessionSection 退役收敛，现仅 runtimes 弹窗使用）；调用方 fetch 后 map 成 `SessionListEntry`
  （id/title/statusBadge/secondaryText/lastActiveAt）传入；`onDelete` 可选
  （runtimes 传删除按钮）；title 空回退 shortId。
- `MachineCard`（`machine-card.tsx`）：受控手风琴机器卡（expanded 由 page 持有）；
  usageByRuntime 由 page 注入（不在卡内拉用量）；展开体内嵌 RuntimeCard 网格；
  内联 `ACTIVE_SESSION_STATUSES`（与 helpers 集合等值，因 allowed_paths 不能 import）。
  - 「升级 daemon」按钮已是最新态（ql-20260902-002/004）：`machine.build_id` 与
    `latestVersion.latest_build_id` 都已知且相等 → 按钮禁用但**保留原文案
    「升级 daemon」**（用户反馈：置灰态不换字），title 显示「已是最新 <build_id>」
    ——daemon 侧同版本自更新是静默 no-op（preflight 同版本直接返回不写状态），
    前置拦截避免「下发成功却无进度」的误导；任一侧未知不比较保持可点。
  - 「升级 sillyspec」按钮**刻意不按已最新置灰**（ql-20260902-004）：
    sillyspec_latest_version 是 daemon 周期探测上报的滞后值，探测间隔内 npm
    发新版会误锁入口；已最新的真正版本门在 daemon 侧 requestManualUpgrade
    （点击时现探 npm，已最新 no-op）。
  - sillyspec UI 三件（2026-08-31-machine-sillyspec-version）：① meta 行 daemon 版本后
    徽标三形态——最新常色 / 落后 warning「当前 → 最新」+「有新版本」/ 未安装
    destructive（落后判定 = version 与 latest 都已知且本地 < latest，本地
    `compareSemver` 逐段比较不引库；latest 未知不比较按常色）；② 按钮组「升级
    sillyspec」五态——离线 / running / deferred / 本地 upgrading 禁用（title 说明
    原因），未安装换文案「安装 sillyspec」、失败后换「重试升级」，落后/未安装/
    升级中/失败 warning 高亮；props 增可选 `onUpgradeSillySpec` + `upgradingSillySpec`
    （page 注入，缺省按钮渲染但点击无动作）；③ sillyspec_update 四态横幅（pending
    横幅后独立 `data-machine-sillyspec-banner` 槽位，色阶走主题语义 token）：
    running=info 旋转 / deferred=warning（机器忙排队，每 30s 复查）/ success=success
    （副行渲染 backend 盖的 since 完成时刻）/ failed=destructive（error 摘要）；
    state 未知或 null 不渲染。三字段消费兄弟语义（旧后端无字段 → undefined 按未
    安装、无横幅，零回归）。
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
  `resumeDisabledTitle` / `runTerminalTurnStatus`（run 快照终态→failed/killed 修正，
  ql-20260822-010）/ `logsToTurns`（历史日志按 run_id 分组转 SessionTurnView[]
  预填 attach 面板；内容级去重收窄：预过滤仅 user_input/reply 防御性去重 +
  装配器 `seenTextDedup:false`，与实时路径 log_id 去重语义对齐，不误删同轮重复
  工具输出）/ `InteractiveSessionChatSection` / `SessionHistoryView`
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
  （session-panel-dialog×3 / session-panel-pre-session / runtime-session-dialog×3 /
  turn-timeline-session-input-bar /
  session-list-layout / runtime-card×2 / machine-card / remote-folder-picker /
  runtime-session-helpers / session-log-sanitize 等）。
- 会话日志渲染前须经 session-log-sanitize 清洗分类，勿绕过直写渲染逻辑。
- `runtime-session-helpers.tsx` 顶层 import 链含 next/navigation，测试须 mock
  （runtime-session-helpers.test.tsx 头注释为证）。
- SUPPORTED_SESSION_PROVIDERS = ["claude","codex"] 在 dialog 分支与
  sessions/pre-session-picker（NewSessionForm 删除后接棒，2026-08-23-sessions-
  workspace-hub）两处内联，扩展 provider 两处同步。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
