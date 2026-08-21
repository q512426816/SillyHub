# diff-analysis：sessions 页面板 vs interactive-session-panel（task-04 产出）

- 变更：2026-08-21-session-message-queue（design §2 D-005 组件统一策略、§3.2 修改文件）
- 分析日期：2026-08-21
- 被分析源码（worktree，含 Wave 1 已落地的消息队列集成）：
  - **[PAGE]** `frontend/src/app/(dashboard)/sessions/page.tsx`（1473 行；页内局部 `SessionPanel` 位于 209-1305）
  - **[ISP]** `frontend/src/components/daemon/interactive-session-panel.tsx`（1312 行）
- 消费方（ISP 的 4 个渲染点）：
  - `frontend/src/components/daemon/runtime-session-dialog.tsx:338-350`
  - `frontend/src/components/daemon/runtime-session-helpers.tsx:117-128`（`InteractiveSessionChatSection`）
  - `frontend/src/components/workspace-session-section.tsx:253-265`
  - `frontend/src/components/changes/change-session-section.tsx:212-225`
- 下文行号均指 worktree 版本；`page.tsx:N` / `isp:N` 为缩写。

---

## 1. 共同逻辑清单（提取 SessionPanel 时应整体搬走的部分）

| # | 共同逻辑 | [PAGE] 锚点 | [ISP] 锚点 | 备注 |
|---|---|---|---|---|
| C1 | 单条 `streamSession` SSE 贯穿会话，8 个事件回调（onTurnStarted / onLog / onTurnCompleted / onTokens / onSessionEnded / onError / onPermissionRequest / onPermissionResolved） | page.tsx:354-479 | isp:345-505（`establishStream`） | PAGE 由 `useEffect([sessionId])` 驱动建流；ISP 由 `establishStream` 回调 + attach effect（isp:509-545）/ createSession 成功（isp:830）触发。建流前都先 `getAgentSessionLogs` 预取回灌防丢事件（page.tsx:318-342 / isp:351-363） |
| C2 | `upsertTurn` turn 状态机：runId/realRunId 双键匹配（防 attach 历史 turn 双渲染）、unknown run 先建空 turn、终态幂等（log 事件例外）、setCurrentRun/clearCurrentRun | page.tsx:1325-1381 | isp:1260-1312 | 结构同源；微差见 §6 风险 R1（PAGE 多 `healToRunning` 自愈分支 page.tsx:1364-1371；ISP 用 `opts.bypassTerminal \|\| env.event === "log"` isp:1302 等价表达） |
| C3 | `deriveTurnTerminalStatus`（status/exit_code → completed/failed/killed） | page.tsx:1464-1472 | isp:142-150 | 两份逐字相同 |
| C4 | SSE log 喂共享装配器：envelope → `AssemblerLogInput` 归一 + `applyLogToSegments` 增量回写；`user_input` channel 跳过不进 output | page.tsx:369-381, 1389-1397, 1406-1423 | isp:376-394, 158-171, 185-194 | 归一函数两份相同（page `applyEnvelopeToTurn` / isp `toAssemblerLogInput`）。ISP 版多两处防御：legacy turn 反投影 `bootstrapLegacySegments`（isp:196-242，`initialTurns` 第三方可传旧形状）与装配器引用相等短路（isp:390-391） |
| C5 | turn_completed 终态收敛：`finishTurn` 清段 streaming 标记 + 终态 + token 写入 | page.tsx:383-407 | isp:395-416 | PAGE 无条件 finishTurn（page.tsx:392）；ISP 仅 `turn.segments !== undefined` 时（isp:403-404） |
| C6 | 失败轮结构化错误详情拉取：`listSessionRuns` + `buildErrorLogItem` + `fetchedErrorRunIdsRef` 同 run 只拉一次 | page.tsx:281, 413-439 | isp:325, 418-450 | 两份几乎逐字相同 |
| C7 | inject 占位轮：`__pending_inject_${Date.now()}__` 占位 runId → pending turn（segments:[] + turnStartedAt:Date.now()）→ inject 响应替换真实 run_id / 失败回滚移除 | page.tsx:761-823（`sendFromQueue`，Wave 1 队列投递侧）、931-982（`handleResend`） | isp:703-762（`submitFollowup`，handleSend 追问分支与 handleResend 共用） | 差异：PAGE 支持附件 ids + 标记行合成（page.tsx:767-773）；失败语义 PAGE 向上抛给队列标 failed（page.tsx:819），ISP 409 TURN_CONFLICT 回填 input（isp:745-758） |
| C8 | interrupt 处理：本地置 interrupting → `interruptSession` → 409 `DAEMON_SESSION_NO_CURRENT_RUN` 特判翻 killed / 其它错误回 running + errorMsg | page.tsx:868-907 | isp:876-925 | ISP 多一处 REST 返回 `current_run_id` 不一致时提示「等待 SSE 同步」（isp:887-893）；PAGE 的 `interruptDisabled` 含 `!machineOnline`（page.tsx:1086-1087） |
| C9 | 失败轮「重新发送」handleResend（active + 无 currentRun 守卫 → 重新 inject） | page.tsx:931-982 | isp:855-863 | PAGE 版先 `parseAttachmentMarkers` 剥离附件标记行（page.tsx:937） |
| C10 | AskUser 待答卡 `pendingRequests`：SSE permission 事件按 `dialog_kind` 过滤 + request_id 去重；`handleDialogResolved` 本地移除（双保险） | page.tsx:263-265, 466-478, 984-986 | isp:311, 485-499, 971-975 | 逻辑逐字相同 |
| C11 | pending dialogs + 问答历史 REST 恢复：`fetchPendingDialogs` 合并去重 + `fetchSessionDialogHistory` | page.tsx:490-518 | isp:633-677 | 逐字相同（PAGE 按 `[sessionId]`、ISP 按 `[view.sessionId]` 触发） |
| C12 | `TurnTimeline` 组装（turns / viewMode / errorMsg / sessionStatus / pendingRequests / dialogHistory / onDialogResolved / onResend / onSwitchProvider / hasOnlineProvider / emptyProviderLabel） | page.tsx:1209-1237 | isp:1205-1219 | 入参派生源不同：PAGE `displayTurns` + detail 状态（page.tsx:1213-1221）；ISP `view.turns` + `view.status`（含 idle/creating/ending）。`onSwitchProvider` 两边同款 `window.location.assign("/settings")`（page.tsx:1228-1232 / isp:869-873） |
| C13 | `SessionInputBar` 组装（value/onChange/onSend/disabled/placeholder/creating） | page.tsx:1266-1280 | isp:1222-1231 | PAGE 多附件四件套 props（见 §2）；disabled/placeholder 派生逻辑不同（见 §2/§3） |
| C14 | viewMode「对话/进度」二态切换 UI（role=tablist 圆角 pill，有消息时才出现） | page.tsx:1145-1169 | isp:1090-1113 | JSX 逐字相同（含「进度」文案） |
| C15 | `MAX_PROMPT_LEN = 8000` 输入长度守卫 + input 草稿 state | page.tsx:104, 271, 839-842 | isp:130, 302, 766-767 | — |
| C16 | onSessionEnded：清 currentRunId + 清 pendingRequests + close 流引用 | page.tsx:455-462 | isp:461-473 | ISP 额外置 `status:"ended"` + 清 `terminatingAt`；PAGE 额外 invalidate detail + `onSessionListRefresh`（差异归 §2/§3） |

---

## 2. 差异清单

### 2.1 [PAGE] sessions 页特有（SessionPanel 提取来源侧）

| # | 差异点 | 锚点 | 说明 |
|---|---|---|---|
| P1 | 页面级左栏/骨架：`SessionListPanel`（筛选+虚拟滚动+删除）+ `NewSessionForm`（四选择器新建）+ PageContainer/PageHeader | page.tsx:135-205 | 属于页面 wrapper，**不进 SessionPanel**；「新建会话」按钮 = `setSelectedSessionId(null)`（page.tsx:165-168），无 ISP 的 handleNewSession 语义（不结束当前会话） |
| P2 | 会话详情 react-query：`detailQuery`（getAgentSession，pending/reconnecting 1.5s 轮询） | page.tsx:235-243 | PAGE 的会话状态唯一来源（status/current_run_id/config_snapshot）；ISP 用内部 view 状态机 + attach 轮询（§3 D3） |
| P3 | 工作区名称解析（workspacesQuery） | page.tsx:247-258 | 头部 📂 chip（page.tsx:1135-1139） |
| P4 | 机器在线判定：machines prop → machineHit/machineOnline/machineName | page.tsx:140, 185-190, 547-558 | PAGE 用「机器是否在线」做输入/打断禁用与离线横幅（page.tsx:1183-1190）；ISP 用 `hasOnlineProvider`（provider 维度） |
| P5 | runs 快照 whoLine 体系：`runsMeta`（Map<runId, SessionRunRead>）、attach 并发预取 + 每轮 turn_completed 刷新、`displayTurns` 渲染期注入（sender/whoLine/历史 usage/replyAt/turnStartedAt ?? 链）、孤儿 turn 补建 + 时间戳排序 | page.tsx:269, 295-303, 344-352, 411, 615-724 | ISP 完全没有（turns 原样喂 TurnTimeline）；依赖 `listSessionRuns` + providers + machines + session.user_id |
| P6 | `CtxUsageBar` + 分母派生（ctxProvider/ctxRoleMapping/ctxFallbackModel/usedTokens） | page.tsx:728-742, 1240-1247 | 依赖 LlmProviderRead[]（llm_provider_id / model_role_mappings / default_fallback_model） |
| P7 | `SessionConfigBar`（会话内切换 agent profile / LLM 供应商 / runtime / 引擎）+ onSwitched 刷新链 | page.tsx:1281-1301 | 依赖 detail 的 config_snapshot / agent_profile_id / llm_provider_id / runtime_id / provider |
| P8 | **消息队列（Wave 1 刚落地）**：`useMessageQueue` + `sendFromQueue` + `MessageQueueBar` + `attachmentMetaRef` 附件元数据镜像 + handleSend 统一 enqueue | page.tsx:66-67, 290, 744-831, 1253-1265 | 发送唯一路径：active 且无 currentRun 立即投递；running/reconnecting/pending 排队（D-001）；终态/离线才禁输入（page.tsx:1073-1084） |
| P9 | 附件体系：pendingAttachments / clearAttachmentsRef / `attachmentsDisabled`（仅 claude）/ `multimodalDowngraded`（供应商能力启发式）/ SessionInputBar 附件 props / 入队标记行 `[附件:id\|kind\|name]` | page.tsx:273-274, 568-589, 847-865, 1266-1280 | ISP 无任何附件逻辑（SessionInputBar 未传附件 props，isp:1222-1231；inject 调用无 attachment_ids，isp:731） |
| P10 | 重新开启（reopen）：`handleReopen` + 409 中文映射表 + reconnecting 本地 240s 超时计时 + 横幅 | page.tsx:114-131, 591-613, 909-929, 1191-1205 | ISP 无 reopen（其消费方在选中前自行 reopen，见 runtime-session-dialog.tsx:217-226） |
| P11 | attach 竞态修复：`currentRunIdRef` 镜像 + 历史回灌重放修正 + detail 到达修正 effect | page.tsx:281-285, 320-337, 521-544 | ISP 对应物是 attach 轮询里的 `detail.current_run_id` 回填（isp:573-581），机制不同 |
| P12 | `SubagentCatalog` 子代理目录 + `handleJumpToSubagent`（切「进度」视图 + DOM 定位展开滚动） | page.tsx:1144, 988-1043, 1432-1461 | 仅本页头部挂载（注释明说 runtimes 弹窗不挂，page.tsx:1142-1143）；需要 `setViewMode("all")` 能力（props 接口必须暴露 viewMode 控制，见 §4） |
| P13 | 会话 id 短码点击复制 + 标题/状态徽标/机器名头部 | page.tsx:1089-1139 | ISP 头部是「交互式会话」+ provider 选择器（§3 D8） |
| P14 | 无「结束会话」「新建会话」按钮 | page.tsx:1100-1304（头部仅打断） | 会话终止/新建由页面级入口承担 |
| P15 | onSessionEnded 时 `qc.invalidateQueries(["agentSessionDetail"])` + `onSessionListRefresh?.()` | page.tsx:460-461 | 依赖 react-query 与父回调 |
| P16 | 输入禁用/占位文案新语义（队列版）：仅 `ended \|\| !machineOnline` 禁用；running/restoring/队满各有排队提示文案 | page.tsx:1068-1084 | ISP 是旧语义：running/reconnecting/creating/ending 全禁用（isp:1022-1030, 1038-1046）——统一后 dialog 模式将被队列语义替换（design 目标 1/4） |

### 2.2 [ISP] interactive-session-panel 特有（弹窗上下文侧）

| # | 差异点 | 锚点 | 说明 |
|---|---|---|---|
| D1 | 首条消息 createSession 流程：idle → creating 占位 turn（`__pending_create__`）→ `createSession({provider, prompt, manual_approval:true, ask_user_only:true, change_id?, workspace_id?})` → 替换 run_id + 建流 + `onSessionCreated` | isp:779-842 | 依赖 provider 内部 state（isp:301）与 props providers/defaultProvider/changeId/workspaceId；失败回 idle + errorMsg（isp:833-840） |
| D2 | attach 续聊：`attachSessionId` + `initialTurns` 预填 + reconnecting 态 | isp:244-256, 509-545 | 消费方先拉 logs 再 setSelectedId，key 重 mount 时 initialTurns 即完整（runtime-session-dialog.tsx:200-229） |
| D3 | attach 轮询：1.5s 间隔 × 10 次（15s 超时）`getAgentSession`，active → 恢复 currentRunId/terminatingAt；failed/ended/超时 → 只读终态 | isp:133-135, 549-626 | 替代 PAGE 的 react-query refetchInterval 轮询（P2） |
| D4 | `onSessionCreated` / `onSessionReset` 父级回调 | isp:261-266, 832, 943, 965 | 消费方用于写/清 URL `?session=` 与刷新列表（见 §3 矩阵） |
| D5 | terminatingAt「终止中…」横幅（lease 终止观测窗口） | isp:105-119, 565-601, 1060-1069 | attach 轮询从 detail 读 `terminating_at`（cast 读取，isp:569-570）；onSessionEnded 清空 |
| D6 | 「结束会话」按钮 + handleEnd（endSession → close 流 → ended + `onSessionReset`） | isp:928-953, 1188-1198 | PAGE 无（P14） |
| D7 | 「新建会话」按钮 + handleNewSession（不断会话，仅断流重置 idle + `onSessionReset`） | isp:956-966, 1133-1143 | — |
| D8 | provider/model 选择器头部：`<select>` providers + `AgentModelInput`（model/onModelChange 受控于父级）+ providers 数量徽标 + 在线回退 effect | isp:332-336, 1070-1201, 1150-1175, 1144-1146 | active/creating/ending 期间禁用选择 |
| D9 | team 团队分析：teamAnalyzing/teamMissionId 内部态 + `handleAnalyzeWithTeam`（createMission mode=team + session_id + arch/verify worker 预设）+「用团队分析」按钮（仅 workspaceId 存在时） | isp:306-307, 340-342, 981-1019, 1114-1132 | `onTeamMissionCreated` prop（isp:276）**当前无任何消费方传入**（4 个渲染点均未传，见 §3） |
| D10 | `offlineReadOnly` 离线只读：不建 SSE 直接 initialTurns 只读渲染、禁 4 操作（新建/发送/打断/结束）、顶部横幅 | isp:283, 509-528, 1030, 1035-1036, 1050-1055 | 仅 runtime-session-dialog 传（按 live runtime status 派生，runtime-session-dialog.tsx:169-170, 349） |
| D11 | view 状态机含 `idle/creating/ending/reconnecting` 状态（SessionUiStatus） | isp:105-128, 303 | PAGE 无这些态（状态从 detail 派生，page.tsx:560-566）；TurnTimeline 的 sessionStatus 入参两版取值域不同 |
| D12 | submitFollowup 失败 409 `DAEMON_SESSION_TURN_CONFLICT` → `setInput(prompt)` 回填草稿 | isp:745-758 | PAGE 对应语义已被队列 D-003「failed 留队头 + 重试」取代（page.tsx:819）——统一后需择一（见 §6 R2） |
| D13 | legacy turn 反投影 `bootstrapLegacySegments`（segments 缺省的 initialTurns 旧形状防御） | isp:185-242 | PAGE 的 `asAssembled` 无此分支（page.tsx:1389-1397 直接空数组兜底）；保留原因：initialTurns 是公共 prop，第三方可传旧形状 |
| D14 | interrupt 的 REST `current_run_id` 不一致提示 | isp:887-893 | PAGE 无 |
| D15 | upsertTurn 的 `requireRunId/bypassTerminal` opts 声明 | isp:1236-1244 | `requireRunId` 实际未在函数体内使用（死选项）；`bypassTerminal` 与 PAGE 的 `env.event !== "log"` 判断等价 |
| D16 | 类型 re-export（`SessionTurnView` 等自 turn-timeline） | isp:94-103 | runtime-session-helpers.tsx:10 / change-session-section.tsx:19-21 / workspace-session-section.tsx:22-25 从本文件 import 类型——**文件保留时必须保留此 re-export** |

---

## 3. 消费方 props 矩阵

4 个渲染点实际传入的 props（✓ = 传入；表格外均未传）：

| prop | runtime-session-dialog.tsx:338-350 | runtime-session-helpers.tsx:117-128（ChatSection） | workspace-session-section.tsx:253-265 | change-session-section.tsx:212-225 |
|---|---|---|---|---|
| key（重 mount 清状态） | ✓ `selectedId ?? new-${runtimeId}`（:339） | ✓ `attachSession?.id ?? "live"`（:118） | ✓ `activeSessionId ?? "new"`（:254） | ✓ `activeSessionId ?? "new"`（:213） |
| providers: string[] | ✓（:340） | ✓（:119） | ✓（:255） | ✓（:213→:214） |
| defaultProvider | ✓（:341） | ✓（:120） | ✓（:256） | ✓ |
| model / onModelChange | ✓（:342-343，父级 useState） | ✓（:121-122） | ✓（:257-258） | ✓ |
| hasOnlineProvider | ✓（:344） | ✓（:123） | ✓（:259） | ✓ |
| attachSessionId | ✓ `selectedId ?? undefined`（:345） | ✓ `attachSession?.id`（:124） | ✓（:261） | ✓（:221） |
| initialTurns | ✓ `logsToTurns(logs)`（:346） | ✓（:125） | ✓ `turns`（:262） | ✓（:222） |
| onSessionCreated | ✓ reloadSessions（:347） | ✓ 写 URL ?session=（:126） | ✓ reloadSessions（:263） | ✓ reloadSessions |
| onSessionReset | ✓ 清选中+刷新（:348） | ✓ 清 URL ?session=（:127） | ✓ 清选中（:264） | ✓ 清选中 |
| changeId | ✗ | ✗ | ✗ | ✓（:219） |
| workspaceId | ✗ | ✗ | ✓（:260） | ✓（:220） |
| offlineReadOnly | ✓ `runtimeOffline`（:349） | ✗ | ✗ | ✗ |
| onTeamMissionCreated | ✗ | ✗ | ✗ | ✗（**无任何消费方使用**） |

弹窗模式必需集（适配层必须完整支持的 props）：`providers / defaultProvider / model / onModelChange / hasOnlineProvider / attachSessionId / initialTurns / onSessionCreated / onSessionReset`（9 项全部消费方都传）；条件项：`changeId`（1/4）、`workspaceId`（2/4，同时是 team 按钮显隐开关）、`offlineReadOnly`（1/4）。

另：ISP 的 3 套专属测试 `frontend/src/components/daemon/__tests__/interactive-session-panel{,-offline,-changeid}.test.tsx` 直接 `render(<InteractiveSessionPanel {...props} />)`（interactive-session-panel.test.tsx:159），**无 QueryClientProvider 包装**；对模块本身的 vi.mock 有 1 处（`frontend/src/components/__tests__/workspace-session-section.test.tsx:28`，替身 `<div data-testid="session-panel" />`）。生产侧根 layout 的 `AppProviders` 已全局包 QueryClientProvider（frontend/src/lib/providers.tsx:15-20），故 react-query 仅在测试环境构成约束（见 §6 R4）。

---

## 4. SessionPanel props 接口草案（task-05 实现依据）

### 4.1 设计原则

1. **来源**：以 [PAGE] 的页内 SessionPanel（page.tsx:209-1305）为提取主体（它已含 Wave 1 队列），弹窗差异全部用 props + `mode` 条件分支吸收——与 design D-005 步骤 2 一致。
2. **命名消歧**：两面板都有 `providers` 但类型不同（PAGE 是 `LlmProviderRead[]` 供应商实体，ISP 是 `string[]` 引擎名）。草案把 page 侧改名为 `llmProviders`，`providers` 保留给 dialog 侧（旧名兼容，适配层零改名）。
3. **归属三分法**（每项标注）：〔prop〕外部注入/受控；〔内部〕组件自持 state/hook（两模式共用逻辑）；〔mode 条件〕仅某模式启用的内部逻辑/渲染。
4. **key 重挂载契约保留**：4 个消费方都靠 `key` 重 mount 清 SSE/轮询/队列（§3 矩阵），SessionPanel 不得把任何会话态提升到组件外或模块级。

### 4.2 TypeScript 定义（逐字段含归属决策）

```typescript
import type { DaemonMachineRead, SessionRunRead } from "@/lib/daemon";
import type { LlmProviderRead } from "@/lib/api/llm-providers";
import type { SessionTurnView } from "@/components/daemon/turn-timeline";

export interface SessionPanelProps {
  /** 模式："page" = /sessions 全页；"dialog" = 弹窗/内嵌（原 InteractiveSessionPanel 场景）。
   *  〔prop〕默认 "dialog" 还是 "page" 建议不设默认值（必填），强制两个调用点显式声明，
   *  避免 task-06/07 过渡期出现第三种隐式形态。 */
  mode: "page" | "dialog";

  // ── 会话标识（两模式共用）──────────────────────────────────────────
  /** page 模式：必填，选中的既有会话 id（父级同时用作 key）。
   *  dialog 模式：null = idle 新建（首条消息走 createSession，原 attachSessionId
   *  为 undefined 的语义）；非 null = attach 续聊（原 attachSessionId）。
   *  〔prop〕会话 identity 必须外部驱动——两面板现状都由父级选中态决定（page.tsx:185-191 /
   *  isp:339-345），且 useMessageQueue 按 sessionId 切换清队（use-message-queue.ts:117-122）。 */
  sessionId: string | null;

  // ── page 模式专属数据注入──────────────────────────────────────────
  /** page 必需：机器列表。离线判定（machineOnline）+ 头部机器名 + whoLine agentName
   *  兜底（page.tsx:547-558, 618-634）。
   *  〔prop〕页面级数据（useDaemonMachines 在页面取，page.tsx:140），面板不自持——
   *  弹窗侧无此概念（用 hasOnlineProvider/offlineReadOnly 表达在线性）。 */
  machines?: DaemonMachineRead[];

  /** page 必需：LLM 供应商实体列表（原 sessions 页 providers）。CtxUsageBar 分母派生 +
   *  多模态降级启发式 + whoLine providerName 解析（page.tsx:143-148, 572-589, 728-742）。
   *  〔prop〕同上页面级 react-query 数据（staleTime 30s，page.tsx:143-147）。与 dialog 的
   *  providers（string[] 引擎名）是两回事，故改名消歧。 */
  llmProviders?: LlmProviderRead[];

  /** page 可选：会话终态 / 配置切换 / session_ended 后刷新左侧列表。
   *  〔prop〕纯回调，page.tsx:151-153, 190 现有透传。 */
  onSessionListRefresh?: () => void;

  // ── dialog 模式专属（对应 InteractiveSessionPanelProps，isp:244-284）────
  /** dialog 必需：在线引擎名列表（claude/codex）。〔prop〕消费方从 runtimes 派生
   *  （4 个渲染点同源逻辑），面板不自持。 */
  providers?: string[];
  /** dialog 必需：默认引擎。〔prop〕内部 provider state 的初值 + 失联回退目标
   *  （isp:301, 332-336 的回退 effect 保留为 dialog 内部逻辑）。 */
  defaultProvider?: string;
  /** dialog 必需：模型覆盖，受控于父级。〔prop〕父级 useState 持有（§3 矩阵 4/4）。 */
  model?: string | null;
  /** dialog 必需：模型覆盖变更回调。〔prop〕同上受控对。 */
  onModelChange?: (next: string | null) => void;
  /** dialog 必需：是否有在线 provider（输入/选择器禁用 + 徽标）。〔prop〕消费方派生。 */
  hasOnlineProvider?: boolean;
  /** dialog 可选：attach 预填 turns（消费方先拉 logs 再 mount，runtime-session-dialog.tsx:200-212）。
   *  〔prop〕一次性初始值，仅 mount 时读取（isp:543 注释）。 */
  initialTurns?: SessionTurnView[];
  /** dialog 可选：createSession 成功上报（父级写 URL ?session= / 刷新列表）。〔prop〕isp:832。 */
  onSessionCreated?: (sessionId: string) => void;
  /** dialog 可选：面板重置回 idle / end 成功上报（父级清 URL / 清选中 / 刷新）。〔prop〕isp:943, 965。 */
  onSessionReset?: () => void;
  /** dialog 可选：createSession 绑定 change 上下文。〔prop〕仅 change-session-section 传（§3）。 */
  changeId?: string;
  /** dialog 可选：createSession 绑定 workspace + team 按钮显隐开关。〔prop〕2/4 消费方传。 */
  workspaceId?: string;
  /** dialog 可选：团队分析 mission 创建上报。〔prop〕当前无消费方传，保留透传位
   *  （design D-005 明确要求 team 可选透传）。 */
  onTeamMissionCreated?: (missionId: string) => void;
  /** dialog 可选：离线只读（禁 4 操作 + 不建 SSE + 横幅）。〔prop〕仅 runtime-session-dialog 传。 */
  offlineReadOnly?: boolean;

  // ── 视图控制（两模式共用；不传则组件内部自持）──────────────────────
  /** 可选受控：消息视图模式。〔prop〕page 模式需要——SubagentCatalog 跳转要外部
   *  setViewMode("all")（page.tsx:997）；dialog 模式可完全不传（内部 useState，
   *  isp:319 同款）。受控-可选模式：传入 onViewModeChange 即受控。 */
  viewMode?: "conversation" | "all";
  /** 配套变更回调（与 viewMode 成对传或成对不传）。〔prop〕 */
  onViewModeChange?: (mode: "conversation" | "all") => void;
}
```

### 4.3 非 props 项归属决策（显式化「page 闭包状态」的去向）

sessions 页 SessionPanel 目前从 page 闭包/自身拿的全部状态，提取后逐项归属：

| 依赖项 | 现锚点 | 归属 | 理由 |
|---|---|---|---|
| turnState / errorMsg / input | page.tsx:261-271 | 〔内部〕 | 两面板同构（C1/C2/C15），无需外部控制 |
| pendingRequests / dialogHistory / handleDialogResolved | page.tsx:263-266, 984-986 | 〔内部〕 | 两面板逻辑逐字相同（C10/C11），TurnTimeline 所需入参由 SessionPanel 内部喂；design §2 提到的「pendingRequests/onDialogResolved 覆盖 askUserDialog 场景」在实现层即「SessionPanel 内部保留这套逻辑并传给 TurnTimeline」，**不升为 props**（无任何消费方需要外部读写，升格徒增接口面） |
| runsMeta / refreshRunsMeta / displayTurns 派生链 | page.tsx:269, 295-303, 615-724 | 〔内部〕+〔mode=page 条件〕 | 纯派生数据，输入（machines/llmProviders/session）已是 props；dialog 模式不启用（ISP 现状无 whoLine，强开会产生额外 listSessionRuns 请求，§6 R7） |
| detailQuery（react-query） | page.tsx:235-243 | 〔内部〕+〔mode=page 条件〕**且必须挂在 mode 专属子组件里** | dialog 模式的 3 套测试无 QueryClientProvider（§3），无条件调用 useQuery 会崩——page 模式才渲染含 useQuery 的内部子组件，dialog 分支零 react-query 调用（§6 R4） |
| workspacesQuery / workspaceName | page.tsx:247-258 | 〔内部〕+〔mode=page 条件〕 | 同上挂 page 子组件；dialog 头部不显示 workspace chip |
| useMessageQueue + sendFromQueue + MessageQueueBar + attachmentMetaRef | page.tsx:290, 744-831, 1253-1265 | 〔内部〕（两模式都启用） | design 目标 4：统一后 runtimes 弹窗同样获得排队能力。dialog 模式仅 idle 首条（createSession）直发不排队——creating 态本身有占位轮且无既有 session 可附着；active 后续 turn 全走队列（替换 isp:765-849 的 handleSend active 分支）。Caveat 见 §6 R2 |
| pendingAttachments / clearAttachmentsRef / attachmentsDisabled / multimodalDowngraded | page.tsx:273-274, 568-589 | 〔内部〕；dialog 模式**附件能力保持关闭** | createSession API 无 attachment_ids 参数（daemon.ts:663-675 的 body 组装），ISP 现状无附件（P9）；dialog 模式 `attachmentsDisabled = true`（或 engine!=="claude" 之外再叠加 mode 判断）保零回归（§6 R3） |
| 附件标记行合成 / parseAttachmentMarkers 剥离 | page.tsx:767-773, 847-860, 937 | 〔内部〕随队列走 | D-004 已落地逻辑，原样搬 |
| handleSend / handleInterrupt / handleResend | page.tsx:839-982 | 〔内部〕（两模式共用，dialog 分支差异在发送入口） | interrupt/resend 两面板同构（C8/C9）；send 入口 mode 分支：page=enqueue、dialog=idle→createSession / active→enqueue |
| handleReopen / REOPEN_ERROR_ZH / 240s 超时 | page.tsx:114-131, 591-613, 909-929 | 〔内部〕+〔mode=page 条件〕 | dialog 消费方在选中前已自行 reopen（runtime-session-dialog.tsx:217-226） |
| view 状态机（idle/creating/ending/reconnecting + terminatingAt） | isp:105-128, 303, 549-626 | 〔内部〕+〔mode=dialog 条件〕 | attach 轮询 + terminatingAt 横幅 + creating/ending 态全是弹窗特有（D1/D3/D5/D11）；与 page 的 detailQuery 轮询互斥实现 |
| handleEnd / handleNewSession / provider state + 回退 effect / team 按钮 + handleAnalyzeWithTeam | isp:301, 332-336, 928-966, 981-1019 | 〔内部〕+〔mode=dialog 条件〕 | 纯弹窗 chrome（D6/D7/D8/D9）；provider 内部 state 初值取 defaultProvider prop |
| SubagentCatalog + handleJumpToSubagent + findSegmentById/subagentBlockNameOf | page.tsx:988-1043, 1144, 1432-1461 | 〔内部〕+〔mode=page 条件〕 | 注释明确弹窗不挂（page.tsx:1142-1143）；需要 §4.2 的 viewMode 受控对 |
| 头部渲染（标题/短码复制/状态徽标/机器/工作区 chip） | page.tsx:1107-1180 | 〔mode=page 条件〕 | dialog 头部 = ISP 原 header（选择器 + 新建/结束/团队/打断 + 徽标，isp:1070-1201） |
| CtxUsageBar / SessionConfigBar | page.tsx:1240-1301 | 〔mode=page 条件〕 | 依赖 llmProviders 与 detail config_snapshot（P6/P7） |
| offline 横幅 | page.tsx:1183-1190（机器离线）/ isp:1050-1055（runtimeReadOnly） | 〔mode 条件〕各自保留 | 文案与触发源不同（machineOnline vs offlineReadOnly） |
| upsertTurn / deriveTurnTerminalStatus / asAssembled / applyEnvelopeToTurn | page.tsx:1309-1472 | 〔内部〕模块级函数 | 合并原则见 §6 R1：以 PAGE 版为基底，吸收 ISP 的 legacy 反投影（D13）与引用相等短路 |
| qc（useQueryClient） | page.tsx:231, 460, 913, 1294 | 〔内部〕仅 page 分支使用 | dialog 分支不得调用 useQueryClient（同 R4 理由） |

---

## 5. 替换策略确认（适配层方案）

**已确认事实**：ISP 有 4 个消费方（§3）+ 3 套专属测试（interactive-session-panel{,-offline,-changeid}.test.tsx）+ 1 处模块级 vi.mock（workspace-session-section.test.tsx:28）+ 3 个消费方从本文件 import 类型（D16）；本变更 task-07 的 allowed_paths 只含 `frontend/src/app/(dashboard)/runtimes/page.tsx` 与 `frontend/src/components/daemon/interactive-session-panel.tsx`，其余 3 个消费方文件不在可改范围。

**结论**：采纳 design D-005 统一策略第 3 步——`interactive-session-panel.tsx` 保留文件名、保留导出名 `InteractiveSessionPanel` 与 `InteractiveSessionPanelProps`（isp:244, 286）、保留 94-103 的类型 re-export，函数体改为薄适配层：透传 props 给 `<SessionPanel mode="dialog">`。4 个消费方 + 全部测试 + vi.mock 不动即通过。

### 5.1 适配层 props 映射表（旧 → 新）

| InteractiveSessionPanel 旧 prop（isp:244-284） | SessionPanel 新 prop | 映射处理 |
|---|---|---|
| `providers: string[]` | `providers?: string[]` | 直传（dialog 必需，适配层断言非空或给 `[]` 兜底） |
| `defaultProvider: string` | `defaultProvider?: string` | 直传（内部 provider state 初值） |
| `model: string \| null` | `model?: string \| null` | 直传（受控对） |
| `onModelChange: (next) => void` | `onModelChange?: (next) => void` | 直传 |
| `hasOnlineProvider: boolean` | `hasOnlineProvider?: boolean` | 直传 |
| `attachSessionId?: string` | `sessionId: string \| null` | **语义迁移**：`attachSessionId ?? null`。旧「undefined = idle 新建」→ 新「null = idle」。消费方传参不变（仍传 `selectedId ?? undefined`），适配层负责 `?? null` 归一 |
| `initialTurns?: SessionTurnView[]` | `initialTurns?: SessionTurnView[]` | 直传 |
| `onSessionCreated?: (id) => void` | `onSessionCreated?: (id) => void` | 直传 |
| `onSessionReset?: () => void` | `onSessionReset?: () => void` | 直传 |
| `changeId?: string` | `changeId?: string` | 直传 |
| `workspaceId?: string` | `workspaceId?: string` | 直传 |
| `onTeamMissionCreated?: (id) => void` | `onTeamMissionCreated?: (id) => void` | 直传（当前无消费方传） |
| `offlineReadOnly?: boolean` | `offlineReadOnly?: boolean` | 直传 |
| ——（新增） | `mode` | 适配层固定传 `"dialog"` |
| ——（新增） | `machines / llmProviders / onSessionListRefresh / viewMode / onViewModeChange` | 适配层**不传**（page 专属 / viewMode 走内部自持） |

无对应的旧 props：无（旧接口 13 个 prop 全部有落点）。

### 5.2 适配层必须保住的运行时行为（对 3 套测试的兼容清单）

1. 渲染输出：dialog 头部（选择器/按钮/徽标）、占位文案（「输入首条消息创建会话」「等待本轮完成…」→ 队列化后按 §4.3 改为排队语义，**需同步核对 3 套测试断言**）、离线横幅、终止中横幅。
2. 发送门控：idle 首条 createSession 直发（含 manual_approval/ask_user_only body）；active 追问走队列后，「running 禁发」语义变为「running 排队」——这是**有意的行为变更**（design §3.3 状态机），测试若断言旧禁用行为需按 task-08/09 计划更新。
3. key 重挂载：适配层不缓存任何会话态（全部下沉 SessionPanel 内部），消费方现有 `key={...}` 行为不变。
4. 类型导出：`export type { SessionTurnView, ... } from "./turn-timeline"` 原样保留（isp:94-103）。

---

## 6. 风险清单（提取/替换最可能出回归的点）

| # | 风险 | 锚点证据 | 缓解建议 |
|---|---|---|---|
| R1 | **SSE 处理三处微差合并选错版本**：① PAGE 独有 `healToRunning` 自愈分支（page.tsx:1364-1371）；② ISP 的 finishTurn 仅在 `segments !== undefined` 时执行（isp:403-404），PAGE 无条件（page.tsx:392）；③ ISP 装配器引用相等短路 `if (next === assembled) return turn`（isp:390-391），PAGE 无条件展开（page.tsx:1422） | §1 C2/C4/C5 | 以 PAGE 版为基底 + 吸收 ISP 两处防御（segments 缺省判断、引用相等短路）。healToRunning 保留（它覆盖 attach 竞态日志迟到场景，对 dialog attach 同样成立）。合并后跑 3 套 ISP 测试 + sessions page 测试双向验证 |
| R2 | **占位轮失败语义冲突**：ISP 409 TURN_CONFLICT 回填 input（isp:745-758）vs PAGE 队列 D-003「failed 留队头 + 重试」（page.tsx:812-820）。dialog 接队列后旧回填行为消失；且 useMessageQueue 的 `sessionActive/hasCurrentRun` 在 dialog 模式必须从 view 状态机取值（idle/creating 态不得投递），取错会出现 idle 期间自动投递（无 session 可发） | page.tsx:812-820 / isp:745-758 / use-message-queue.ts:39-50 | dialog 模式投递条件显式写为 `view.status === "active" && !view.currentRunId`；idle/creating 的首条消息绕过队列直发 createSession。行为变更点写进 task-07 说明，防被当回归修回去 |
| R3 | **附件能力外溢到弹窗**：SessionPanel 内部携带附件逻辑（P9），dialog 模式若启用，createSession 无 attachment_ids 入参（daemon.ts:663-675），附件会「上传成功但发不出去」 | daemon.ts:663-675 / isp:731 | dialog 模式 `attachmentsDisabled = true`（§4.3 已定），SessionInputBar 不传附件 props，与 ISP 现状逐字节一致 |
| R4 | **react-query 依赖炸弹窗测试**：3 套 ISP 测试直接 render 无 QueryClientProvider（interactive-session-panel.test.tsx:159）；SessionPanel 若无条件调用 useQuery/useQueryClient，适配层在测试环境直接抛错 | §3 / providers.tsx:15-20 | detailQuery/workspacesQuery/useQueryClient 全部收进「page 模式才渲染的内部子组件」，dialog 分支零 react-query hook 调用（§4.3 已定） |
| R5 | **currentRunId 恢复路径差异**：PAGE 靠 detailQuery 轮询 + currentRunIdRef 镜像 + 修正 effect（page.tsx:521-544）；ISP 靠 attach 轮询回填（isp:573-581）。统一组件内两套机制并存时，dialog 模式若误触 page 的修正 effect（session=null 直渲会跳过，但要确认）或 page 模式误触 attach 轮询，会出现双写 currentRunId | page.tsx:521-544 / isp:549-626 | 两机制用 mode 严格互斥；dialog 模式下无 detailQuery 依赖的 effect 全部跳过（session 为 null 时早退） |
| R6 | **key 重挂载契约被破坏**：4 个消费方依赖 key 变化重 mount 清 SSE/轮询/队列/团队态（§3 矩阵 + isp:680-691 unmount 清理）。若 SessionPanel 把任何状态外提（context/module 级），切会话即串话 | runtime-session-dialog.tsx:339 / workspace-session-section.tsx:254 等 | 会话态 100% 组件内部（§4.1 原则 4）；SSE/轮询清理逻辑随 sessionId effect 原样搬 |
| R7 | **runsMeta 派生链误开到 dialog**：displayTurns 的 whoLine/孤儿 turn/排序依赖 listSessionRuns 轮询刷新（page.tsx:295-303, 638-724），dialog 模式若启用会在每次 turn_completed 多打一次 runs 请求并改变 turns 顺序（孤儿 turn 补建会重排 ISP 现有顺序） | page.tsx:615-724 | mode=page 条件启用（§4.3 已定）；dialog 的 turns 原样喂 TurnTimeline（isp:1206 现状） |
| R8 | **类型 re-export / vi.mock 断链**：3 个消费方 import 类型自 ISP 文件（D16），workspace-session-section.test.tsx:28 mock 模块路径。若 task-07 删除文件或改导出名，4+2 处编译/测试失败 | isp:94-103 / workspace-session-section.test.tsx:28 | 保留文件与导出签名（§5 已定）；本变更**不删除** interactive-session-panel.tsx（design §4 文件清单的「删除」行按 D-005 第 3 步修订为「保留为适配层」，与 allowed_paths 一致） |
| R9 | **sessionEnded 副作用差异丢失**：PAGE 版 invalidate detail + 刷新列表（page.tsx:460-461）；ISP 版置 ended + 清 terminatingAt（isp:461-469）。合并时漏任一半都会表现为「结束后状态不同步」 | page.tsx:455-462 / isp:461-473 | onSessionEnded 回调体内部按 mode 分支保留两套副作用 |
| R10 | **interrupt 细差**：ISP 有 REST current_run_id 不一致提示（isp:887-893）与 interrupting 态双按钮禁用（isp:1032-1035）；PAGE 的 interruptDisabled 额外看 machineOnline（page.tsx:1086-1087）。统一后弹窗丢「等待 SSE 同步」提示、或页面出现机器离线可点打断 | isp:887-893, 1032-1035 / page.tsx:1086-1087 | interruptDisabled = mode 分支合成：`(mode==="page" ? !machineOnline : !hasOnlineProvider \|\| offlineReadOnly) \|\| status!=="active" \|\| !currentRunId`；REST 不一致提示两模式通用（无害） |

---

## 7. 一句话结论

两面板在「SSE → upsertTurn → 装配器 → TurnTimeline/SessionInputBar」主干上同源度极高（§1 C1-C16），差异集中在**数据来源层**（react-query detail + machines/llmProviders vs 内部 view 状态机 + attach 轮询）与**chrome 层**（CtxUsageBar/SessionConfigBar/SubagentCatalog vs provider 选择器/新建/结束/team/offlineReadOnly）。§4.2 的 props 草案 + §4.3 归属表可直接作为 task-05 的实现规格；§5.1 映射表可直接作为 task-07 适配层的实现规格。
