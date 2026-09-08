---
author: qinyi
created_at: 2026-09-08 00:24:19
change: 2026-09-07-arch-large-file-split
task: task-13 (wave3-preflight-session-panel-and-lib-daemon-export-baseline)
---

# Wave3 前置对账基线——session-panel 7 符号 + lib/daemon 全量导出面清单

> 实测对象：worktree `C:\Users\qinyi\IdeaProjects\multi-agent-platform\.sillyspec\.runtime\worktrees\2026-09-07-arch-large-file-split`
> （HEAD = a4eee1fe2，已 merge main 4e01d1d44，merge commit = 3efb3ec0b）。
> 全部数字为 2026-09-08 00:2x 在 worktree `frontend/` 下 grep 实测，非 scan 快照。
> 用途：task-14（session-panel 目录化）/ task-15（lib/daemon 目录化）的 index 再导出逐项对账底单，防漏导破坏 D-006（现有测试零修改）。

## 0. 概览与设计基线勘误

| 指标 | 设计/任务卡基线 | 本次实测（post-merge） | 差异归因 |
|---|---|---|---|
| session-panel.tsx 行数 | 6620 | 6620 | 一致；merge 对该文件零改动 |
| session-panel 导出符号数 | 7 | **7** | 一致 |
| lib/daemon.ts 行数 | 4090 | **4111** | merge +21 行（见 §2.1） |
| lib/daemon.ts 导出数 | 187 | **188** | **+1 新增导出 `getSillySpecConflictCompare`（L307）** |
| `vi.mock("@/lib/daemon"` 计数 | 55 | **56**（56 文件各 1 处） | merge 新增 conflict-compare-modal.test.tsx:53；pre-merge 实测恰为 55/55（`git grep -c` @ 3efb3ec0b^1），设计数字本身无误 |
| `from "@/lib/daemon"` import 语句/文件 | 140 / 133 | **141 / 134** | 同上 +1（conflict-compare-modal.test.tsx 导入 getSillySpecConflictCompare） |
| session-panel 引用文件 | 24 | **24 静态 import 文件**（另 +1 处 typeof 动态类型导入、6 处 vi.mock 站点，见 §3.3） | 一致（设计口径=静态 import 文件） |
| 「全部 mock 为 importOriginal 展开覆写」假设 | —— | **不成立**：56 处中仅 11 处用 importOriginal（其中 1 处为挑拣非展开），45 处为整体替换（§3.2） | 兼容结论不变：两种形态目录化后均零修改可过 |

**merge 4e01d1d44 对两文件的全部影响**（`git diff 3efb3ec0b^1 3efb3ec0b -- frontend/src/lib/daemon.ts frontend/src/components/daemon/session-panel.tsx`）：

- lib/daemon.ts：单 hunk `@@ -295,6 +295,27 @@`，+21/-0，仅新增一个导出函数 `getSillySpecConflictCompare`（注释标注来源 2026-09-07-conflict-diff-compare task-07）。导出面 187→188，无删除、无改名。
- session-panel.tsx：零改动（6620 行与设计一致；merge 改过若干 session-panel 相关测试文件内容，但未动本文件）。

## 1. session-panel.tsx 全量导出清单（7 符号）

文件：`frontend/src/components/daemon/session-panel.tsx`（6620 行，无 default export，无 namespace 消费）。
可复现命令（worktree `frontend/` 下）：`grep -n "^export" src/components/daemon/session-panel.tsx`

原始输出（2026-09-08 实测）：

```text
230:export interface SessionPreContext {
269:export interface SessionPanelProps {
382:export function SessionPanel(props: SessionPanelProps) {
6530:export interface BashProgressState {
6563:export function applyBashStatusEvent(
6593:export function appendBashChunk(
6619:export { applyAgentTaskStatusEvent } from "./agent-task-store";
```

### 1.1 逐条：行号 / 符号 / 种类 / 消费方

| # | 行号 | 符号 | 种类 | 外部消费方（从本模块导入） |
|---|---|---|---|---|
| 1 | 230 | `SessionPreContext` | interface（type-only 导入为主） | 3 文件：`src/components/sessions/sessions-portal.tsx:93`、`src/app/m/workspaces/[id]/sessions/page.tsx:46`（均 `import { SessionPanel, type SessionPreContext }`）、`src/components/daemon/__tests__/session-panel-pre-session.test.tsx:40`。（`src/stores/floating-session.ts:27` 仅注释提及，非导入） |
| 2 | 269 | `SessionPanelProps` | interface | **0 个外部导入方**（仅本文件内部消费）。仍必须再导出——导出面等同性要求（surface identity），且未来宿主可能按名导入 |
| 3 | 382 | `SessionPanel` | function（React 组件，page/dialog 双模式分发器） | 22 文件：6 源码 + 16 测试（明细 §1.2） |
| 4 | 6530 | `BashProgressState` | interface | **1 文件（type-only）**：`src/components/daemon/__tests__/session-panel-bash-progress.test.ts:19`。⚠️ `src/components/daemon/activity-catalog.tsx:43` 仅注释提及（「BashProgressState 子集」），非导入——勿误记为第二消费方。**漏导该符号即破坏 D-006（设计 X-03 已点名）** |
| 5 | 6563 | `applyBashStatusEvent` | function（bash 进度归约器） | 1 文件：session-panel-bash-progress.test.ts:20 |
| 6 | 6593 | `appendBashChunk` | function（bash 进度归约器） | 1 文件：session-panel-bash-progress.test.ts:15 |
| 7 | 6619 | `applyAgentTaskStatusEvent` | **再导出**（`export { ... } from "./agent-task-store"`） | 1 文件：`src/components/daemon/__tests__/agent-task-card-lifecycle.test.tsx:35`（从本模块导入）。注意 `src/hooks/use-session-tasks.ts:32` 直连 `@/components/daemon/agent-task-store`，**不经**本模块——再导出链仅此 1 个消费方，但测试零修改要求必须保留再导出 |

### 1.2 SessionPanel 的 22 个导入文件明细

源码 6：`src/components/daemon/runtime-session-helpers.tsx:10`、`src/components/floating/floating-session-host.tsx:40`、`src/components/group-chat/member-panel.tsx:54`、`src/components/sessions/sessions-portal.tsx:93`、`src/app/m/workspaces/[id]/sessions/page.tsx:46`、`src/app/m/workspaces/[id]/sessions/[sid]/page.tsx:25`。
测试 16（15 个 `../session-panel` 相对导入 + 1 个别名导入）：session-panel-connection:73 / ctx-tokens:22 / dialog-attachments:30 / dialog-offline:31 / dialog:19 / history-race:13 / platform-shared:21 / pre-session:40 / prompt:20 / provider-caps:24 / team:32 / session-usage-panel-mount:87 / variant:26 / session-suspended-display:84 / ux-fixes:17（以上相对路径）+ session-panel-dialog-changeid:16（别名 `@/components/daemon/session-panel`）。

## 2. lib/daemon.ts 全量导出清单（188 条）

文件：`frontend/src/lib/daemon.ts`（4111 行，无 default export）。
可复现命令：`grep -n "^export" src/lib/daemon.ts`（`grep -c "^export"` = **188**）。

种类统计：`export interface` 55 · `export type` 40 · `export async function` 80 · `export function` 7 · `export const` 6（PROVIDER_META、MIN_VERSIONS、RECONNECT_BACKOFF_MS、PERMANENT_SSE_ERROR_STATUSES、AGENT_SESSIONS_TREE_FETCH_LIMIT、AgentSessionListResponseSchema）· `export {}` 再导出 0（本文件无跨文件再导出）。合计 188。

### 2.1 merge 新增（仅 1 条）

| 行号 | 符号 | 种类 | 归属域 | 消费方 |
|---|---|---|---|---|
| 307 | `getSillySpecConflictCompare` | async function（GET /api/daemon/machines/{instance_id}/sillyspec-conflicts/{change}/compare） | machines | `src/components/changes/conflict-compare-modal.tsx:33`（实现消费）+ `src/components/changes/__tests__/conflict-compare-modal.test.tsx:56`（mock 覆写） |

### 2.2 按资源域分组逐条清单（行号 = daemon.ts 实测行号）

> 归域原则：按设计 §5 Wave 3 的 9 域划分；模糊归属符号在表后「归域备注」说明。**无论归哪个域文件，index.ts 必须全量再导出 188 条**——归域只影响文件位置，不影响导出面。

**runtimes.ts（25 条）**

| 行号 | 符号 | 种类 |
|---|---|---|
| 14 | OwnerRead | interface |
| 20 | DaemonRuntimeRead | interface |
| 42 | listDaemonRuntimes | async function |
| 422 | DaemonRuntimeListParams | interface |
| 431 | DaemonRuntimeListResponse | interface |
| 438 | UpdateDaemonRuntimeInput | interface |
| 442 | listDaemonRuntimesPage | async function |
| 450 | updateDaemonRuntime | async function |
| 464 | updateRuntimeAllowedRoots | async function |
| 518 | getDaemonRuntime | async function |
| 524 | disableDaemonRuntime | async function |
| 533 | enableDaemonRuntime | async function |
| 546 | deleteDaemonRuntime | async function |
| 560 | DaemonVersionInfo | interface |
| 568 | getDaemonVersion | async function |
| 579 | triggerDaemonSelfUpdate | async function |
| 591 | PROVIDER_META | const |
| 610 | MIN_VERSIONS | const |
| 621 | isVersionBelow | function |
| 3906 | RuntimeUsageWindow | type |
| 3913 | RuntimeUsageSummary | interface |
| 3925 | RuntimeUsagePoint | interface |
| 3935 | RuntimeUsageItem | interface |
| 3948 | RuntimeUsageResponse | interface |
| 3963 | getRuntimesUsage | async function |

**machines.ts（17 条，含新增 1 条）**

| 行号 | 符号 | 种类 | 备注 |
|---|---|---|---|
| 52 | DaemonInstanceProviderItem | interface | 归域备注 2 |
| 58 | DaemonInstanceRead | interface | 归域备注 2 |
| 74 | listDaemonInstances | async function | 归域备注 2 |
| 89 | MachinePendingUpdate | interface | |
| 109 | DaemonMachineRead | interface | |
| 173 | DaemonMachineListParams | interface | |
| 189 | DaemonMachineListResponse | interface | |
| 199 | DaemonMachineUpdate | interface | |
| 207 | listDaemonMachines | async function | |
| 219 | updateDaemonMachine | async function | |
| 233 | triggerMachineSelfUpdate | async function | |
| 251 | triggerMachineSillySpecUpdate | async function | |
| 270 | triggerMachineSillySpecResolve | async function | |
| 289 | triggerMachineSillySpecGhostCleanup | async function | |
| 307 | getSillySpecConflictCompare | async function | ★ merge 4e01d1d44 新增 |
| 323 | triggerMachineCleanup | async function | |
| 338 | deleteDaemonMachine | async function | |

**shared-agents.ts（10 条）**

| 行号 | 符号 | 种类 |
|---|---|---|
| 360 | SharedAgentView | type（OpenAPI 别名） |
| 362 | SharedAgentActiveView | type（OpenAPI 别名） |
| 364 | SharedAgentCreateRequest | type（OpenAPI 别名） |
| 366 | SharedAgentCreateResponse | type（OpenAPI 别名） |
| 370 | SharedMachineView | type（OpenAPI 别名） |
| 373 | fetchSharedAgents | async function |
| 378 | fetchSharedAgentsActive | async function |
| 386 | createSharedAgent | async function |
| 400 | setSharedAgentEnabled | async function |
| 414 | deleteSharedAgent | async function |

**dir.ts（5 条）**

| 行号 | 符号 | 种类 |
|---|---|---|
| 477 | DirEntry | interface |
| 482 | ListDirResponse | interface |
| 490 | listDir | async function |
| 505 | ListRootsResponse | interface |
| 509 | listRoots | async function |

**session-queue.ts（8 条 = 6 函数 + 2 类型）**

| 行号 | 符号 | 种类 |
|---|---|---|
| 1068 | SessionQueueEntry | interface |
| 1088 | fetchSessionQueue | async function |
| 1096 | deleteSessionQueueEntry | async function |
| 1107 | retrySessionQueueEntry | async function |
| 1121 | QueueDispatchNowResponse | interface |
| 1131 | reorderSessionQueue | async function |
| 1146 | updateSessionQueueEntry | async function |
| 1163 | dispatchNowSessionQueueEntry | async function |

**sessions.ts（49 条）**

| 行号 | 符号 | 种类 |
|---|---|---|
| 650 | SessionPermissionRequest | interface |
| 707 | SessionPermissionResolved | interface |
| 720 | respondSessionPermission | async function |
| 913 | submitPlanResponse | async function |
| 946 | fetchPendingDialogs | async function |
| 955 | SessionDialogRead | type（OpenAPI 别名） |
| 964 | fetchSessionDialogHistory | async function |
| 982 | listWorkspaceDialogs | async function |
| 996 | InteractiveProvider | type |
| 1018 | SessionCreateRequest | type |
| 1035 | PpmItemKind | type |
| 1047 | SessionCreateTeamMission | type（归域备注 5） |
| 1049 | SessionCreateResponse | interface |
| 1057 | SessionInjectResponse | interface |
| 1173 | SessionControlResponse | interface |
| 1183 | createSession | async function |
| 1240 | SessionInjectOptions | type |
| 1258 | injectSession | async function |
| 1323 | interruptSession | async function |
| 1335 | endSession | async function |
| 2278 | AgentSessionStatus | type |
| 2293 | AgentSessionConfigSnapshot | interface |
| 2311 | AgentSessionRead | type |
| 2322 | AgentSessionListResponse | type |
| 2335 | AGENT_SESSIONS_TREE_FETCH_LIMIT | const |
| 2338 | AgentSessionListParams | interface |
| 2383 | listAgentSessions | async function |
| 2416 | ChangeSessionAuthor | interface |
| 2422 | AgentSessionListItem | interface |
| 2437 | listChangeSessions | async function |
| 2453 | listQuicklogSessions | async function |
| 2470 | listItemSessions | async function |
| 2486 | listWorkspaceAgentSessions | async function |
| 2500 | deleteAgentSession | async function |
| 2509 | archiveAgentSession | async function |
| 2517 | unarchiveAgentSession | async function |
| 2528 | updateSessionCtxWindow | async function |
| 3672 | SessionReopenResponse | interface |
| 3681 | reopenSession | async function |
| 3694 | getAgentSession | async function |
| 3709 | SessionUsageModelItem | interface |
| 3728 | SessionUsageRead | interface |
| 3739 | getSessionUsage | async function |
| 3761 | getAgentSessionLogs | async function |
| 3789 | maxLogTimestamp | function（归域备注 6） |
| 3810 | SessionRunRead | interface |
| 3854 | listSessionRuns | async function |
| 3872 | AgentSessionTaskRead | type（OpenAPI 别名） |
| 3881 | listSessionTasks | async function |

**session-sse.ts（24 条）**

| 行号 | 符号 | 种类 |
|---|---|---|
| 757 | parseSessionPermissionEvent | function |
| 1346 | SessionEventKind | type |
| 1360 | PlanSummary | interface |
| 1367 | PlanModeEnteredEvent | interface |
| 1376 | BashStatusEvent | interface |
| 1387 | BashChunkEvent | interface |
| 1406 | AgentTaskStatusEvent | interface |
| 1426 | SessionStreamEnvelope | interface |
| 1537 | SessionStreamStatus | type |
| 1539 | SessionStreamHandlers | interface |
| 1605 | SessionStreamConnection | interface |
| 1625 | RECONNECT_BACKOFF_MS | const |
| 1633 | PERMANENT_SSE_ERROR_STATUSES | const |
| 1693 | streamSession | function（490 行单体） |
| 2181 | subscribeAgentSessionsEvents | function |
| 2973 | GroupChatStreamEnvelope | interface |
| 3012 | GroupChatTypingEvent | interface |
| 3032 | GroupChatPresenceEvent | interface |
| 3040 | GroupChatStreamHandlers | interface |
| 3069 | GroupReplayLogEntry | interface |
| 3106 | streamGroupChat | function |
| 3393 | ShadowSessionStreamHandlers | interface |
| 3421 | streamShadowSession | function |
| 3892 | AgentSessionListResponseSchema | const（zod schema） |

**group-chat.ts（42 条）**

| 行号 | 符号 | 种类 |
|---|---|---|
| 2548 | GroupChatRead | type（OpenAPI 别名） |
| 2554 | GroupChatDetailRead | type（OpenAPI 别名） |
| 2557 | GroupMemberDetailRead | type（OpenAPI 别名） |
| 2560 | GroupChatListItemRead | type（OpenAPI 别名） |
| 2563 | GroupChatCreate | type（OpenAPI 别名） |
| 2565 | GroupChatUpdate | type（OpenAPI 别名） |
| 2567 | GroupMemberRead | type（OpenAPI 别名） |
| 2569 | GroupMemberCreate | type（OpenAPI 别名） |
| 2571 | GroupMemberUpdate | type（OpenAPI 别名） |
| 2573 | GroupMemberAgentConfig | type（OpenAPI 别名） |
| 2576 | GroupMemberUserCreate | type（OpenAPI 别名） |
| 2583 | GroupChatCreateRead | type（OpenAPI 别名） |
| 2589 | GroupMemberAddRead | type（OpenAPI 别名） |
| 2595 | GroupMemberInterruptRead | type（OpenAPI 别名） |
| 2601 | GroupPinnedRequest | type（OpenAPI 别名） |
| 2606 | GroupChatPinnedRead | type（OpenAPI 别名） |
| 2632 | listGroupChats | async function |
| 2647 | getGroupChat | async function |
| 2660 | createGroupChat | async function |
| 2670 | updateGroupChat | async function |
| 2681 | endGroupChat | async function |
| 2699 | archiveGroupChat | async function |
| 2710 | unarchiveGroupChat | async function |
| 2721 | deleteGroupChat | async function |
| 2732 | addGroupMember | async function |
| 2743 | updateGroupMember | async function |
| 2755 | removeGroupMember | async function |
| 2766 | resetGroupMemberMemory | async function |
| 2782 | interruptGroupMember | async function |
| 2803 | pinGroupMessage | async function |
| 2814 | unpinGroupMessage | async function |
| 2830 | markGroupRead | async function |
| 2845 | GroupMessageSendRead | type（OpenAPI 别名） |
| 2847 | GroupMessageSendRequest | type（OpenAPI 别名） |
| 2855 | GroupMessageAttachmentSummary | interface |
| 2869 | GroupMessageReplySnapshot | interface |
| 2892 | sendGroupMessage | async function |
| 2910 | GroupDirectMessageRead | type（OpenAPI 别名） |
| 2913 | GroupDirectMessageRequest | type（OpenAPI 别名） |
| 2927 | sendGroupDirectMessage | async function |
| 2945 | GroupTypingRequest | type（OpenAPI 别名） |
| 2953 | sendGroupTyping | async function |

**team-missions.ts（8 条）**

| 行号 | 符号 | 种类 |
|---|---|---|
| 3987 | TeamMissionStatus | type |
| 4001 | TeamMissionWorkerSummary | interface |
| 4022 | TeamWorkspaceRef | interface |
| 4038 | TeamMissionSummary | interface |
| 4062 | TeamMissionTriggerRequest | interface |
| 4076 | triggerSessionTeamMission | async function |
| 4091 | listSessionTeamMissions | async function |
| 4105 | cancelTeamMission | async function |

**合计：25 + 17 + 10 + 5 + 8 + 49 + 24 + 42 + 8 = 188 ✓（逐条不抽样，行号可与 `grep -n "^export" src/lib/daemon.ts` 原始输出逐行对上）**

### 2.3 归域备注（模糊符号判定，供 task-15 裁决；index 全量再导出后归域不影响兼容）

1. **OwnerRead（L14）**：被 DaemonRuntimeRead（L32）与 DaemonMachineRead（L127）双域引用的共享类型。建议定义在 runtimes.ts（首发消费链），machines.ts 经 `import type` 引用即可。
2. **DaemonInstanceProviderItem / DaemonInstanceRead / listDaemonInstances（L52/58/74）**：daemon 实体（GET /api/daemon/instances），设计 9 域无独立桶。建议随 machines.ts（同为实例级资源、消费方 workspace-daemon-switcher 与 machine 域同族）；也可单独成节——不影响 index 面。
3. **getSillySpecConflictCompare（L307）**：machine 路径端点（/api/daemon/machines/{instance_id}/sillyspec-conflicts/...），归 machines.ts。
4. **Group 流四类型 + streamGroupChat / streamShadowSession（L2973–3421）**：设计明示归 session-sse.ts（「streamSession + streamGroupChat/streamShadowSession/subscribeAgentSessionsEvents + parse* + 重连常量 + zod」），纯 group CRUD/消息/typing 留 group-chat.ts。
5. **SessionCreateTeamMission（L1047）**：create session 请求字段类型（components["schemas"]["TeamMissionCreateBlock"] 别名），归 sessions.ts，非 team-missions.ts。
6. **maxLogTimestamp（L3789）**：日志纯函数，归 sessions.ts。⚠️ 它是唯一被 mock「挑拣真实实现」依赖的符号（§3.2 形态 B），目录化后必须真实可导出。
7. **AgentSessionListResponseSchema（L3892，zod）**：设计明示归 session-sse.ts（「zod schema」）。

## 3. vi.mock 基线与引用计数

### 3.1 计数（可复现命令）

```bash
# 在 worktree frontend/ 下：
grep -rn 'vi\.mock("@/lib/daemon"' src | wc -l        # = 56（双引号闭合形态；单引号形态 = 0）
grep -rln 'vi\.mock("@/lib/daemon"' src | wc -l        # = 56 个文件，每文件 1 处
grep -rn 'from "@/lib/daemon"' src | wc -l             # = 141 条静态 import 语句
grep -rln 'from "@/lib/daemon"' src | wc -l            # = 134 个文件
grep -rn 'import("@/lib/daemon")' src | wc -l          # = 55 处动态 import()（几乎全为 importOriginal 泛型里的类型位表达式）
grep -rn 'import \* as .* from "@/lib/daemon"' src | wc -l  # = 0（无 namespace 导入）
grep -rn 'vi\.mock.*session-panel' src | wc -l          # = 6（对 session-panel 本身的 mock）
grep -rln 'vi\.importActual' src | wc -l               # 相关 mock 文件内 importActual = 0
```

注意：粗 grep `vi.mock("@/lib/daemon`（不带闭合引号）会命中 `@/lib/daemon-audit`（1 处，runtimes/[id]/audit/page.test.tsx:49），计数会虚涨到 57——对账必须用闭合引号形态。

### 3.2 56 处 mock 形态分解（关键勘误：并非全部 importOriginal）

| 形态 | 计数 | 说明 | 目录化后的兼容性 |
|---|---|---|---|
| A：`async (importOriginal) => ({ ...(await importOriginal<...>()), 覆写… })` 展开覆写 | 10 | 真实模块展开为底、覆写个别函数 | importOriginal() 解析到 index.ts，展开真实面 → index 全量再导出即零修改 |
| B：importOriginal 挑拣真实实现（非全展开） | 1 | `src/app/(dashboard)/sessions/__tests__/page.test.tsx:113`：仅 `maxLogTimestamp: actual.maxLogTimestamp` 取真实，其余（PROVIDER_META 等）全 mock | 依赖 maxLogTimestamp 真实可导出（在 188 清单内，归 sessions 域） |
| C：`async () => ({ … })` 整体替换 | 30 | 不触真实模块 | 天然兼容 |
| D：`() => ({ … })` 同步对象工厂整体替换 | 15 | 不触真实模块 | 天然兼容 |

形态 A/B 的 11 个文件（vi.mock 行号）：
`src/app/(dashboard)/sessions/__tests__/page.test.tsx:113`（B）、`src/components/changes/detail/__tests__/change-sessions-card.test.tsx:21`、`src/components/changes/__tests__/conflict-compare-modal.test.tsx:53`（★ merge 新增）、`src/components/changes/__tests__/platform-sync-section.test.tsx:60`、`src/components/changes/__tests__/quicklog-sessions-card.test.tsx:22`、`src/components/daemon/__tests__/agent-log-card.test.tsx:88`、`src/components/daemon/__tests__/plan-approval-card.test.tsx:13`、`src/components/daemon/__tests__/remote-folder-picker.test.tsx:24`、`src/components/group-chat/__tests__/group-chat-panel.test.tsx:102`、`src/components/sessions/__tests__/session-config-bar.test.tsx:67`、`src/components/workspace/__tests__/changes-overview-card.test.tsx:36`。

形态 C 的 30 个文件：runtimes/__tests__/page.test.tsx:81、runtimes/__tests__/page-usage.test.tsx:73、runtimes/page.test.tsx:64、workspaces/[id]/page.test.tsx:102、workspaces/__tests__/page.test.tsx:110、m/workspaces/__tests__/page.m-workspaces.test.tsx:42、workspace-config-card.test.tsx:132、changes/__tests__/quicklog-drawer.test.tsx:34、daemon/__tests__/{session-panel-history-race:37, session-panel-ctx-tokens:61, session-panel-dialog-attachments:84, session-panel-dialog-changeid:41, session-panel-dialog:77, session-panel-connection:68, session-panel-pre-session:89, session-panel-platform-shared:55, session-panel-dialog-offline:26, platform-shared-agents-card:64, session-suspended-display:79, session-usage-panel-mount:82, session-panel-provider-caps:62, session-panel-team:72, session-panel-ux-fixes:52, task-execution-panel:50, session-usage-bar:44, session-panel-prompt:54, session-panel-variant:61}、mobile/mobile-change-detail.test.tsx:89、mobile/mobile-session-list.test.tsx:43、__tests__/workspace-scan-dialog.test.tsx:23。

形态 D 的 15 个文件：workspaces/[id]/changes/[cid]/__tests__/{page-last-signal:41, page-team-toggle:51}、daemon/__tests__/{turn-timeline-dialog-minimize:33, team-task-block:29}、floating/floating-session-host.test.tsx:234、sessions/__tests__/{sessions-portal:173, session-list-panel:105}、__tests__/{delete-change-confirm:101, workspace-daemon-switcher:21, workspace-path-picker:17, workspace-access-guide:17}、hooks/__tests__/{use-session-tasks:28, use-message-queue:33}、lib/__tests__/{use-daemon-machines:17, workspace-daemon-status:23}。

（10 + 1 + 30 + 15 = 56 ✓；文件路径前缀省略 `src/`，同域多文件用花括号缩写，行号为 vi.mock 行。）

### 3.3 session-panel 引用文件计数

| 引用形态 | 计数 | 明细 |
|---|---|---|
| 静态 import（设计口径「24 个引用文件」） | **24 文件** | 别名 `@/components/daemon/session-panel` 8 文件（§1.1/§1.2 所列 6 源码 + agent-task-card-lifecycle.test:35 + session-panel-dialog-changeid.test:16）；相对 `../session-panel` 16 文件（components/daemon/__tests__/ 下 15 个 SessionPanel 导入 + bash-progress.test 导入 3 个 bash 符号） |
| typeof 动态类型导入 | 1 处 | `src/components/sessions/__tests__/sessions-portal.test.tsx:313`：`typeof import("@/components/daemon/session-panel")` |
| vi.mock 站点（桩替换 SessionPanel，宿主接线测试） | 6 处 | m/workspaces/[id]/sessions/[sid]/__tests__/page.m-session-chat.test.tsx:39、m/workspaces/[id]/sessions/__tests__/page.m-sessions.test.tsx:122、floating/floating-session-host.test.tsx:24、group-chat/__tests__/member-panel.test.tsx:149、sessions/__tests__/pre-session-picker.test.tsx:41、sessions/__tests__/sessions-portal.test.tsx:311 |

## 4. index 再导出保底结论（task-14 / task-15 对账底单）

### 4.1 session-panel/index.tsx 必须再导出的符号全集（7 条，缺一即破坏 D-006）

```ts
// session-panel/index.tsx —— 7 符号全量再导出（SessionPanel 本体可定义于此或由 page/dialog 文件导入转发）
export { SessionPanel };                              // L382，22 文件消费
export type { SessionPanelProps };                    // L269，0 外部消费（面等同性保留）
export type { SessionPreContext };                    // L230，3 文件消费
export type { BashProgressState };                    // L6530，bash-progress.test 消费（X-03 红线）
export { applyBashStatusEvent, appendBashChunk };     // L6563/L6593，bash-progress.test 消费
export { applyAgentTaskStatusEvent } from "../agent-task-store";  // L6619 再导出链，相对路径 ./ → ../
```

要点：
- 3 个 bash 符号按设计归 turn-state.ts、SessionPreContext/Props 随组件侧，但**无论内部怎么拆，index 面恒为上述 7 条**。
- `applyAgentTaskStatusEvent` 再导出语句的相对路径必须从 `"./agent-task-store"` 改为 `"../agent-task-store"`（文件入目录后层级 +1）——这是拆分中**唯一一处允许也必须改写的导出语句字面**，语义不变。
- 无 default export、无 namespace 导入消费 → 无额外兼容面。
- `__tests__` 下的 `../session-panel` 相对导入解析到目录 index，webpack/vitest 目录解析天然支持，测试零改动。

### 4.2 lib/daemon/index.ts 必须再导出的符号全集（188 条）

- 形态：`export * from "./runtimes"` 等 9 个域文件星号再导出即可覆盖全量（已核对 188 条符号无跨域重名，星号聚合无冲突；task-15 落地时以 `grep -c "^export"` 对各域文件求和 = 188 复核）。
- 明细即 §2.2 九张表逐条（runtimes 25 / machines 17 / shared-agents 10 / dir 5 / session-sse 24 / sessions 49 / session-queue 8 / group-chat 42 / team-missions 8）。
- 星号再导出对 type-only 符号（55 interface + 40 type）同样生效（TS `export *` 含类型）。
- 无 default export、无 namespace 导入 → 无 default 兜底需求。
- 验收口径（task-15）：拆分后 `frontend/` 下跑与 §3.1 相同的 grep 计数应得 141 import / 134 文件 / 56 mock 全部零改动；并补一条面等同性检查（例：对任一消费符号如 `getSillySpecConflictCompare`、`maxLogTimestamp`、`BashProgressState` 的 type-check 通过）。

### 4.3 机制约束（目录化操作顺序，两文件同规则）

- **文件优先于目录**：`daemon.ts` 与 `daemon/index.ts` 并存时，`@/lib/daemon` 解析到 `daemon.ts`（bundler/vitest resolve 文件优先）。因此：
  1. 可先分步落域文件（`daemon/runtimes.ts` 等，无 index、无人引用，随搬随测域内单测）；
  2. **最后一步必须原子切换**：同 commit 内「新增 daemon/index.ts + 删除 daemon.ts」，不得出现 index 与旧文件并存的中间提交。session-panel 同理。
- `importOriginal<typeof import("@/lib/daemon")>()`（11 处形态 A/B mock）在目录化后类型位与运行位都解析 index.ts，全量再导出即满足。
- 45 处整体替换 mock（形态 C/D）不触真实模块面，天然零影响。

## 5. 附录：lib/daemon.ts 原始 grep 输出

`grep -n "^export" src/lib/daemon.ts`（2026-09-08 实测，188 行，行号与 §2.2 表逐条对应）：

```text
14:export interface OwnerRead {
20:export interface DaemonRuntimeRead {
42:export async function listDaemonRuntimes(): Promise<DaemonRuntimeRead[]> {
52:export interface DaemonInstanceProviderItem {
58:export interface DaemonInstanceRead {
74:export async function listDaemonInstances(): Promise<DaemonInstanceRead[]> {
89:export interface MachinePendingUpdate {
109:export interface DaemonMachineRead {
173:export interface DaemonMachineListParams {
189:export interface DaemonMachineListResponse {
199:export interface DaemonMachineUpdate {
207:export async function listDaemonMachines(
219:export async function updateDaemonMachine(
233:export async function triggerMachineSelfUpdate(
251:export async function triggerMachineSillySpecUpdate(
270:export async function triggerMachineSillySpecResolve(
289:export async function triggerMachineSillySpecGhostCleanup(
307:export async function getSillySpecConflictCompare(
323:export async function triggerMachineCleanup(
338:export async function deleteDaemonMachine(instanceId: string): Promise<void> {
360:export type SharedAgentView = components["schemas"]["SharedAgentView"];
362:export type SharedAgentActiveView = components["schemas"]["SharedAgentActiveView"];
364:export type SharedAgentCreateRequest = components["schemas"]["SharedAgentCreateRequest"];
366:export type SharedAgentCreateResponse =
370:export type SharedMachineView = components["schemas"]["SharedMachineView"];
373:export async function fetchSharedAgents(): Promise<SharedAgentView[]> {
378:export async function fetchSharedAgentsActive(): Promise<SharedAgentActiveView[]> {
386:export async function createSharedAgent(
400:export async function setSharedAgentEnabled(
414:export async function deleteSharedAgent(grantId: string): Promise<void> {
422:export interface DaemonRuntimeListParams {
431:export interface DaemonRuntimeListResponse {
438:export interface UpdateDaemonRuntimeInput {
442:export async function listDaemonRuntimesPage(
450:export async function updateDaemonRuntime(
464:export async function updateRuntimeAllowedRoots(
477:export interface DirEntry {
482:export interface ListDirResponse {
490:export async function listDir(
505:export interface ListRootsResponse {
509:export async function listRoots(
518:export async function getDaemonRuntime(
524:export async function disableDaemonRuntime(
533:export async function enableDaemonRuntime(
546:export async function deleteDaemonRuntime(
560:export interface DaemonVersionInfo {
568:export async function getDaemonVersion(): Promise<DaemonVersionInfo> {
579:export async function triggerDaemonSelfUpdate(
591:export const PROVIDER_META: Record<
610:export const MIN_VERSIONS: Record<string, string> = {
621:export function isVersionBelow(version: string, minVersion: string): boolean {
650:export interface SessionPermissionRequest {
707:export interface SessionPermissionResolved {
720:export async function respondSessionPermission(
757:export function parseSessionPermissionEvent(
913:export async function submitPlanResponse(
946:export async function fetchPendingDialogs(
955:export type SessionDialogRead = components["schemas"]["SessionDialogRead"];
964:export async function fetchSessionDialogHistory(
982:export async function listWorkspaceDialogs(
996:export type InteractiveProvider = "claude" | "codex";
1018:export type SessionCreateRequest = Omit<
1035:export type PpmItemKind = NonNullable<
1047:export type SessionCreateTeamMission = components["schemas"]["TeamMissionCreateBlock"];
1049:export interface SessionCreateResponse {
1057:export interface SessionInjectResponse {
1068:export interface SessionQueueEntry {
1088:export async function fetchSessionQueue(sessionId: string): Promise<SessionQueueEntry[]> {
1096:export async function deleteSessionQueueEntry(
1107:export async function retrySessionQueueEntry(
1121:export interface QueueDispatchNowResponse {
1131:export async function reorderSessionQueue(
1146:export async function updateSessionQueueEntry(
1163:export async function dispatchNowSessionQueueEntry(
1173:export interface SessionControlResponse {
1183:export async function createSession(
1240:export type SessionInjectOptions = Omit<
1258:export async function injectSession(
1323:export async function interruptSession(
1335:export async function endSession(
1346:export type SessionEventKind =
1360:export interface PlanSummary {
1367:export interface PlanModeEnteredEvent {
1376:export interface BashStatusEvent {
1387:export interface BashChunkEvent {
1406:export interface AgentTaskStatusEvent {
1426:export interface SessionStreamEnvelope {
1537:export type SessionStreamStatus = "reconnecting" | "reconnected" | "live";
1539:export interface SessionStreamHandlers {
1605:export interface SessionStreamConnection {
1625:export const RECONNECT_BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 30000];
1633:export const PERMANENT_SSE_ERROR_STATUSES = new Set([401, 403, 404]);
1693:export function streamSession(
2181:export function subscribeAgentSessionsEvents(opts: {
2278:export type AgentSessionStatus =
2293:export interface AgentSessionConfigSnapshot {
2311:export type AgentSessionRead = Omit<
2322:export type AgentSessionListResponse = Omit<
2335:export const AGENT_SESSIONS_TREE_FETCH_LIMIT = 500;
2338:export interface AgentSessionListParams {
2383:export async function listAgentSessions(
2416:export interface ChangeSessionAuthor {
2422:export interface AgentSessionListItem {
2437:export async function listChangeSessions(
2453:export async function listQuicklogSessions(
2470:export async function listItemSessions(
2486:export async function listWorkspaceAgentSessions(
2500:export async function deleteAgentSession(sessionId: string): Promise<void> {
2509:export async function archiveAgentSession(sessionId: string): Promise<void> {
2517:export async function unarchiveAgentSession(sessionId: string): Promise<void> {
2528:export async function updateSessionCtxWindow(
2548:export type GroupChatRead = components["schemas"]["GroupChatRead"];
2554:export type GroupChatDetailRead =
2557:export type GroupMemberDetailRead =
2560:export type GroupChatListItemRead =
2563:export type GroupChatCreate = components["schemas"]["GroupChatCreate"];
2565:export type GroupChatUpdate = components["schemas"]["GroupChatUpdate"];
2567:export type GroupMemberRead = components["schemas"]["GroupMemberRead"];
2569:export type GroupMemberCreate = components["schemas"]["GroupMemberCreate"];
2571:export type GroupMemberUpdate = components["schemas"]["GroupMemberUpdate"];
2573:export type GroupMemberAgentConfig =
2576:export type GroupMemberUserCreate =
2583:export type GroupChatCreateRead =
2589:export type GroupMemberAddRead =
2595:export type GroupMemberInterruptRead =
2601:export type GroupPinnedRequest = components["schemas"]["GroupPinnedRequest"];
2606:export type GroupChatPinnedRead =
2632:export async function listGroupChats(
2647:export async function getGroupChat(
2660:export async function createGroupChat(
2670:export async function updateGroupChat(
2681:export async function endGroupChat(groupId: string): Promise<GroupChatRead> {
2699:export async function archiveGroupChat(groupId: string): Promise<void> {
2710:export async function unarchiveGroupChat(groupId: string): Promise<void> {
2721:export async function deleteGroupChat(groupId: string): Promise<void> {
2732:export async function addGroupMember(
2743:export async function updateGroupMember(
2755:export async function removeGroupMember(
2766:export async function resetGroupMemberMemory(
2782:export async function interruptGroupMember(
2803:export async function pinGroupMessage(
2814:export async function unpinGroupMessage(groupId: string): Promise<void> {
2830:export async function markGroupRead(groupId: string): Promise<void> {
2845:export type GroupMessageSendRead = components["schemas"]["GroupMessageSendRead"];
2847:export type GroupMessageSendRequest =
2855:export interface GroupMessageAttachmentSummary {
2869:export interface GroupMessageReplySnapshot {
2892:export async function sendGroupMessage(
2910:export type GroupDirectMessageRead =
2913:export type GroupDirectMessageRequest =
2927:export async function sendGroupDirectMessage(
2945:export type GroupTypingRequest = components["schemas"]["GroupTypingRequest"];
2953:export async function sendGroupTyping(
2973:export interface GroupChatStreamEnvelope extends SessionStreamEnvelope {
3012:export interface GroupChatTypingEvent {
3032:export interface GroupChatPresenceEvent {
3040:export interface GroupChatStreamHandlers {
3069:export interface GroupReplayLogEntry extends AgentRunLogEntry {
3106:export function streamGroupChat(
3393:export interface ShadowSessionStreamHandlers {
3421:export function streamShadowSession(
3672:export interface SessionReopenResponse {
3681:export async function reopenSession(
3694:export async function getAgentSession(
3709:export interface SessionUsageModelItem {
3728:export interface SessionUsageRead {
3739:export async function getSessionUsage(
3761:export async function getAgentSessionLogs(
3789:export function maxLogTimestamp(logs: AgentRunLogEntry[]): string | undefined {
3810:export interface SessionRunRead {
3854:export async function listSessionRuns(
3872:export type AgentSessionTaskRead = components["schemas"]["AgentSessionTaskRead"];
3881:export async function listSessionTasks(
3892:export const AgentSessionListResponseSchema = z.object({
3906:export type RuntimeUsageWindow = "1d" | "7d" | "30d";
3913:export interface RuntimeUsageSummary {
3925:export interface RuntimeUsagePoint {
3935:export interface RuntimeUsageItem {
3948:export interface RuntimeUsageResponse {
3963:export async function getRuntimesUsage(
3987:export type TeamMissionStatus =
4001:export interface TeamMissionWorkerSummary {
4022:export interface TeamWorkspaceRef {
4038:export interface TeamMissionSummary {
4062:export interface TeamMissionTriggerRequest {
4076:export async function triggerSessionTeamMission(
4091:export async function listSessionTeamMissions(
4105:export async function cancelTeamMission(missionId: string): Promise<void> {
```

## 6. 对账结论

1. session-panel 7 符号清单与设计 §5 Wave 3 完全一致（BashProgressState 已逐条入账，唯一消费方 bash-progress.test:19 type-only）。
2. lib/daemon.ts 导出面 = **188 条**（设计 187 + merge 新增 1：getSillySpecConflictCompare），九域分组逐条无抽样；index.ts `export *` 聚合即可保底。
3. vi.mock = **56 处 / 56 文件**（设计 55 + merge 新增 conflict-compare-modal）；**仅 11 处 importOriginal**（10 展开 + 1 挑拣 maxLogTimestamp），45 处整体替换——「全部 importOriginal 展开覆写」的预设不成立，但目录化 + 全量再导出对全部 4 种形态均零修改兼容。
4. 引用计数：lib/daemon 141 条 import / 134 文件（设计 140/133 + merge 1/1）；session-panel 24 静态 import 文件（与设计一致）+ 1 typeof 动态类型导入 + 6 vi.mock 站点。
5. 两文件零改动（纯只读对账）；唯一写盘 = 本文档。
