---
author: qinyi
created_at: 2026-09-07 08:13:11
scale: large
status: draft
change: 2026-09-07-arch-large-file-split
---

# 设计文档（Design）— 三端会话域大文件架构拆分

> 本文基于 2026-09-07 对源码的实测调研（行号与簇划分为当日 grep 实测），不依赖落后 2048 commit 的 scan 快照。

## 背景

三端会话域积累了 8 个巨型文件（合计约 4.1 万行），全部集中在 daemon 会话链路：

| 端 | 文件 | 行数（2026-09-07 实测） | 核心问题 |
|---|---|---|---|
| daemon | sillyhub-daemon/src/interactive/session-manager.ts | 5438 | 单类 SessionManager 约 4900 行，18 个方法簇混居 |
| daemon | sillyhub-daemon/src/task-runner.ts | 3426 | 单类 TaskRunner 约 2350 行 + 大量本应独立的模块级工具 |
| backend | backend/app/modules/daemon/session/service.py | 7176 | 单类 SessionService 约 6200 行；create_session 单方法 1055 行 |
| backend | backend/app/modules/daemon/router.py | 5468 | 83 个端点 + 39 个内联 Pydantic 模型 + 21 个私有 helper 混居一文件 |
| backend | backend/app/modules/daemon/group/service.py | 4844 | GroupChatService 约 2800 行 + 35 个模块级 helper |
| backend | backend/app/modules/daemon/run_sync/service.py | 4055 | submit_messages 单方法 872 行；close_interactive_run 603 行 |
| frontend | frontend/src/components/daemon/session-panel.tsx | 6620 | SessionPanelPage 约 3160 行 + SessionPanelDialog 约 1760 行 |
| frontend | frontend/src/lib/daemon.ts | 4090 | 8 个资源域 API 函数 + streamSession 单函数 490 行 |

知识库（known-issues.md「daemon 三个 3000+ 行 god 文件」）已登记其为长期债且「无低风险切片路径」，建议按触碰时机渐进处理。daemon.ts 已从 2026-08-18 的 4047 行膨胀到 7711 行，债务在加速累积，需要一次有边界的系统性拆分来止住趋势。

**明确排除的文件**（在途变更 2026-09-04-conflict-resolve-entry 未提交改动正在碰，见 D-001）：sillyhub-daemon/src/daemon.ts、hub-client.ts、config.ts、protocol.ts、sillyspec-manager.ts，backend 的 protocol.py / runtime/service.py / ws_hub.py / lease/context.py。

## 设计目标

1. 8 个目标文件全部降至目标行数（D-005@v3）：**新拆出文件 ≤800 行；原文件保留的核心编排 ≤2500 行**；两项显式豁免（同 R-03 理由：闭包状态回归风险优先于行数目标）：session-panel-page.tsx ≤3000、session-panel-dialog.tsx ≤2000。
2. **行为零变化**：所有现有测试**零修改**通过——导入路径、mock 路径、组件导出面全兼容（D-006，硬验收）。
3. 顺带完成 6 项白名单轻重构，消灭已证实的跨文件重复实现（D-005）。
4. 每一步拆分可独立验收（一次搬一个方法簇、定向测试全绿再搬下一个），把「无低风险切片路径」的风险拆成最小步进。

## 非目标（Non-Goals）

- 不做 notify_* payload 的 Pydantic 化——会改 OpenAPI schema，触发 gen:types → api-types.ts 连锁，超出纯重构边界。
- 不合并 session-panel page/dialog 两模式的重复 handler 为共享 hook——闭包状态耦合高，UI 行为回归风险大，留后续变更。
- 不做 mixin / Object.assign 原型扩展式类拆分（方案 C 已否决，见 D-004）。
- 不做三端契约类型统一、不重划模块边界、不改任何对外 API/DTO/事件格式。
- 不拆测试文件；不清理与拆分无关的历史代码。
- 不碰 D-001 排除的 8 个在途变更文件。

## 拆分判断

三个子项目（daemon / backend / frontend）可独立交付、互不依赖，满足「3+ 可独立交付模块」的拆分建议线；但用户明确选择**单变更分 3 Wave**（D-003），不建 MASTER、不拆子变更。非批量模式（不是「模板 × 数据」性质，每个文件的拆分映射都需按其实际方法簇定制）。

## 总体方案

方案 A：目录化拆包 + 原路径兼容层（D-004）。三种语言的兼容层形态：

| 端 | 机制 | 导入路径变化 |
|---|---|---|
| backend Python | `session/service.py` 模块升级为 `session/service/` 同名包，`__init__.py` 聚合导出全部原公共符号 | 零变化（`from app.modules.daemon.session.service import SessionService` 原样工作） |
| daemon TypeScript | Node ESM 无目录导入（知识库坑：import 必须 `.js`），原文件保留为**瘦 facade**：类声明 + `export * from './xxx/index.js'` + 必要 re-export | 零变化（62 个 session-manager 引用方、23 个 task-runner 引用方不动；src 引用方为 cli.ts 与 daemon.ts，其余为测试） |
| frontend | bundler module resolution 支持目录导入：`session-panel.tsx → session-panel/index.tsx`、`lib/daemon.ts → lib/daemon/index.ts` | 零变化（140 条 `@/lib/daemon` import（133 文件）与 55 个 `vi.mock('@/lib/daemon')` 测试不动） |

**单类拆分手法**（SessionManager / TaskRunner / SessionService / GroupChatService / RunSyncService）：
- 已是模块级的部分（类型、常量、纯函数、鸭子读取器）→ 原样搬移到子模块，零改写。
- 类方法簇 → 方法体下沉为子模块函数或内部协作对象（如 `WriteGuardBridge`、`BackgroundTaskRegistry`），**类保留同名方法做一行委托**，公共签名不变。this 状态通过显式参数或协作对象持有传递。
- 类壳保留核心编排（构造、通知链、主循环），预计残留 1200–2500 行，不强求 ≤1000。

**monkeypatch 命名空间兼容规则**（D-007，P0——backend 现有测试含 157 处 `patch("app.modules.daemon.<mod>.<sym>")` 字符串目标：session.service 69、run_sync.service 45、group.service 33、router 10）：patch 拦截的是「原模块命名空间里的属性绑定」，因此**凡被 patch 的符号（如 get_redis、get_session_factory、get_session_readiness、group.service 命名空间里的 SessionService、_run_gate_via_delegate 等，以拆前 grep patch 字符串目标全量清单为准），子模块内不得直接 `from 原点 import 该符号` 后调用，必须经原模块命名空间延迟解析**——子模块统一 `import app.modules.daemon.session.service as _svc` 后调用 `_svc.get_redis(...)`，`__init__.py` 顶部保持 `from app.core.redis import get_redis` 绑定。patch 替换 `__init__.py` 命名空间属性时，子模块调用点在运行时经 `_svc` 解析即被拦截，既有测试零修改通过。

Wave 顺序：**Wave 1 daemon → Wave 2 backend → Wave 3 frontend**（D-003），每 Wave 结束跑该端定向测试全绿后进下一 Wave。

### Wave 1：sillyhub-daemon（2 文件 8864 行）

**session-manager.ts → `interactive/session-manager/` 包 + 瘦 facade：**

| 新模块 | 内容（方法簇 → 行号区间） | 预计行数 |
|---|---|---|
| types.ts | 全部 interface/type/常量（46–524 段：SessionManagerOptions、MainAgentMcpContext、SessionUsageTotals、BackgroundTaskInfo、RESUME_DAMAGE_PATTERNS、DEFAULT_* 等） | ~490 |
| notify-chain.ts | `_runNotifyChain`（596，单方法约 317 行）方法体下沉 | ~330 |
| permission.ts | 权限/用户对话框簇（getPermissionResolver 1014 … _buildOnUserDialogCallback 2429）+ dialogResult 收敛 helper（轻重构 6） | ~560 |
| driver-factory.ts | 驱动获取/会话创建（_getDriver 1290 … _buildDriverOptions 1683） | ~620 |
| write-guard.ts | 写守卫/策略判定簇（_wrapWithWriteGuard 1893 … _buildOnUserDialogCallback 2429 之前段）收编为 WriteGuardBridge 协作对象 | ~640 |
| usage.ts | 预算/用量簇（setBudgetTokens 2691 … _checkBudgetCutoff 2804） | ~180 |
| turn-control.ts | 注入/计划响应/中断（inject 2852 … getPendingInjectCount 3180） | ~360 |
| lifecycle.ts | 空闲扫描/终止/清理/状态查询（getIdleTimeoutSec 3188 … hasRunningTurn 3515） | ~320 |
| persistence.ts | snapshot/restore/markReconnected（3532–3883） | ~360 |
| events.ts | 结果/消息分发 + 事件转 dict（_onResult 4467 … _nextEventSeq 4942 段，纯转换部分） | ~540 |
| background-tasks.ts | 后台任务状态簇（_handleAgentTaskStatusEvent 4998 … _destroyUsageLedger 5388）收编为 BackgroundTaskRegistry | ~440 |
| helpers.ts | eventMetaOf / strOf / numOf（尾部工具） | ~30 |
| index.ts | 聚合导出 | ~40 |
| session-manager.ts（facade） | SessionManager 类声明 + 委托方法 + `export *`；类内保留构造、create/_createInternal、_runConsume、reload 簇编排 | ~2000–2500 |

**task-runner.ts → `task-runner/` 包 + 瘦 facade：**

| 新模块 | 内容 | 预计行数 |
|---|---|---|
| payload.ts | pickStr/pickNum/pickStrList/pickBudgetUsageSnapshot + intersectAllowedRoots + 轻重构 1（与 strOf/numOf 统一到 src/payload-utils.ts） | ~180 |
| change-write.ts | ChangeWriteFile/Ctx/Result/validateChangeWritePath（2696–2790） | ~120 |
| runner-types.ts | TaskStatus/SpawnOpts/RunnerHubClient/RunnerWorkspaceManager/RunnerCredentialManager/TaskRunnerResult + 常量（107–343、2792 段） | ~280 |
| skill-prompt.ts | resolveTimeout/resolveMaxRetries/isSpawnLevelFailure/buildSkillPrompt/detectSkillInvoked/mergeAdapterUsage/attachBatchModelStats/extractBudgetUsageTokens（2962–3237） | ~290 |
| render.ts | renderAgentEvent/shortLeaseId/renderTaskBoundary/echoTaskBoundary/_looksLike*（3256–3426） | ~180 |
| spawn-stream.ts | _spawnAndStream（1280，约 435 行）+ _handleLine（1714，约 220 行）方法体下沉为函数 | ~680 |
| file-mcp.ts | FILE_MCP_* 常量/fileMcpTmpPathFor/cleanupStaleFileMcpConfigs/_writeFileMcpTmpConfig | ~120 |
| index.ts | 聚合导出 | ~30 |
| task-runner.ts（facade） | TaskRunner 类声明 + 委托；类内保留 runLease 编排、心跳循环、审批处理 | ~1400–1600 |

轻重构 2：新增 `sillyhub-daemon/src/event-wire.ts`，收敛 `_eventToReportDict`（session-manager）与 `_eventToMessages`（task-runner）平行维护的 AgentEvent→wire dict 转换核心。

### Wave 2：backend（4 文件 21543 行）

**router.py → `router/` 包**（`__init__.py` 建共享 `router = APIRouter(prefix="/daemon", tags=["daemon"])`。⚠️ 挂载顺序不变量（Grill X-04 勘正）：现状是 change_write/audit/grants/group_chat 四个子路由在 router.py:469–499 include，**先于**全部 83 个端点注册（源码注释明示为刻意设计）；`__init__.py` 必须保持「先 include 四子路由、再触发端点子模块注册」的相对顺序。另一不变量：**同前缀同形状（literal vs 路径参数）的路由必须落在同一子模块并保持相对序**——现存须保序对：`/sessions/events` 先于 `/sessions/{session_id}`、`/runtimes/usage` 与 `/runtimes/page` 先于 `/runtimes/{runtime_id}`）：

| 新模块 | 端点域 | 端点数 |
|---|---|---|
| version.py | get_daemon_version / register_daemon + 版本计算 helper | 2 |
| heartbeat.py | daemon_heartbeat + 全部 DaemonHeartbeat* Pydantic 模型族 | 1 |
| runtimes.py | 11 个 runtime 端点 + _runtime_read/_build_machine_read/_shared_machine_view 读模型 helper | 11 |
| machines.py | 9 个 machine 端点 + Machine*Read 模型族 | 9 |
| lease.py | 9 个 lease 端点 | 9 |
| session_crud.py | 12 个 session CRUD/SSE 端点 + _SESSION_SSE_HEADERS | 12 |
| session_extras.py | 队列 6 + 日志/run/task/用量/team 8 端点 | 14 |
| notify_misc.py | notify_* 6 + 权限/dialog 4 + fs 2 + llm proxy 2 + ws 1 + controls 2 + skills/mcp 4 + 恢复/挂起 4 端点 + 认证三 helper | ~25 |

**session/service.py → `session/service/` 包**（`__init__.py` 导出 SessionService、get_session_readiness、dispatch_next_queued_message 及全部公共/被跨文件引用的符号——含 run_sync 正在导入的私有符号 `_apply_session_terminal_status` 等，保持原导入语句原样工作）：

| 新模块 | 内容 | 预计行数 |
|---|---|---|
| errors.py | 24 个 AppError 子类（440–737） | ~300 |
| results.py | SessionDispatchResult/SessionControlResult/SessionRecoveryResult/SuspendBatchResult/SessionReadiness 等结果对象 + get_session_readiness | ~240 |
| helpers.py | 模块级 helper（_strip_team_command_prefix … _detect_platform_profile_binding、group chain marker） | ~430 |
| create.py | create_session 单方法拆为分步函数（校验/绑定/workspace/入队/派发） | ~800 |
| attachments.py | inject 附件管线四件套（校验/装配/预装配/payload） | ~520 |
| ppm_activation.py | _materialize_ppm_attachments/_converge_failed_dispatch/_activate_tool_report_session | ~450 |
| inject.py | inject 簇核心方法体下沉（inject_session/_inject_into_session/_inject_mid_turn_into_run） | ~700 |
| inject_gates.py | _validate_inject_attachment_rows/_resolve_inject_gate/_ensure_session_workspace_writable 等校验与门控 | ~500 |
| queue.py | 队列管理 8 方法体下沉 | ~500 |
| control.py | 中断/结束/plan 响应 | ~580 |
| recovery.py | 恢复/挂起/重连 6 方法体下沉 | ~720 |
| read_model.py | 查询/列表/日志/用量方法体下沉 | ~600 |
| session_lifecycle.py | reopen/delete/archive/unarchive/end/ctx_window 生命周期方法体下沉 | ~540 |
| service/__init__.py | SessionService 类壳（方法一行委托）+ 聚合导出 | ~700 |

**group/service.py → `group/service/` 包**：mentions.py（mention 解析/广播探测，~150 行）、typing_presence.py（typing/presence Redis 层 + 5 个 publish helper 收敛点，~400 行）、timeline_reads.py（读模型三连 + DTO，~330 行）、settings.py（guardrail 校验/合并三件套，~120 行）、shadow.py（触发/影子会话簇，~600 行）、members.py（成员管理簇，~600 行）、messages.py（消息发送簇，~620 行）、crud.py（群 CRUD 簇，~640 行）、helpers.py（锁查询/通知，~250 行）、service/__init__.py（GroupChatService 类壳，~600 行）。

**run_sync/service.py → `run_sync/service/` 包**：sdk_pipeline.py（_extract_sdk_messages/_persist_agent_event/_channel_from_event_type 模块级管线，~540 行）、group_bridge.py（桥接/投影簇，~240 行）、gate.py（gate 决策簇，~250 行）、stage_team.py（stage/team 推进簇，~440 行）、submit_steps.py（submit_messages 872 行拆分步函数之解析/派发/override 段，~500 行）、submit_commit.py（之分段撤销/持久化/发布段，~400 行）、close_run_steps.py（close_interactive_run 603 行拆分步函数，~650 行）、publish.py（publish_* 模块级函数 + stamp 闭包去重，~250 行）、service/__init__.py（RunSyncService 类壳，~600 行）。

轻重构 3/4/5（backend 新增共享模块）：
- `backend/app/modules/daemon/_background_tasks.py`：`_fire_background_task` 在 SessionService 与 RunSyncService 逐字节相同（session/service.py:978 / run_sync/service.py:595 已核对）；`_on_background_task_done` 仅类名引用差异（:998 vs :615），mixin 内经 `self` 多态解析 `_background_tasks`。提取为共享 mixin。
- `backend/app/modules/daemon/event_publish.py`：统一 session/run_sync/group 四文件 5+ 处同构 Redis publish helper。
- `backend/app/modules/daemon/attachment_pipeline.py`：session 与 group 两份附件校验/装配实现收敛（保持两处调用签名不变）。

### Wave 3：frontend（2 文件 10710 行）

**session-panel.tsx → `session-panel/` 目录**（index.tsx 再导出全部现有导出面共 **7** 个符号：SessionPanel、SessionPanelProps、SessionPreContext、**BashProgressState**、applyBashStatusEvent、appendBashChunk、applyAgentTaskStatusEvent——BashProgressState 被 __tests__/session-panel-bash-progress.test.ts:19 导入，漏导即破坏 D-006；24 个引用文件零改动）：

| 新文件 | 内容 | 预计行数 |
|---|---|---|
| index.tsx | SessionPanel 分发器 + 全量再导出（7 符号） | ~60 |
| team-trigger-row.tsx | TeamTriggerRow 组件 + props | ~190 |
| worker-session-overlay.tsx | WorkerSessionOverlay 组件 | ~70 |
| use-stream-connection-guard.ts | useStreamConnectionGuard hook + 常量 | ~190 |
| connection-banners.tsx | StreamConnectionBanner + TurnStalledWatchdogBanner | ~80 |
| use-session-team-missions.ts | 团队任务轮询 hook + parseTeamCommand/teamTriggerErrorText | ~110 |
| turn-state.ts | 尾部 turn 状态机 + localStorage + bash reducer（BashProgressState/applyBashStatusEvent/appendBashChunk） | ~360 |
| search.ts | searchResult*/highlightSearchHit 纯函数 | ~50 |
| dialog-helpers.ts | getProviderLabel/toAssemblerLogInput/assembledViewOf/bootstrapLegacySegments/upsertDialogTurn | ~170 |
| session-panel-page.tsx | SessionPanelPage（内部仅再提取纯逻辑，handler 保持原位）——**显式豁免 ≤3000**（R-03） | ~2900 |
| session-panel-dialog.tsx | SessionPanelDialog + establishStream 簇——**显式豁免 ≤2000**（R-03：establishStream 闭包状态不动） | ~1650 |

**lib/daemon.ts → `lib/daemon/` 目录**（index.ts 全量再导出，140 条 import（133 文件）与 55 个 vi.mock 零改动）：

| 新文件 | 内容 |
|---|---|
| index.ts | 全量再导出 |
| runtimes.ts | runtime CRUD/版本/用量 + PROVIDER_META/MIN_VERSIONS/isVersionBelow |
| machines.ts | machine 全部函数与类型 |
| shared-agents.ts | shared agent 五函数 + OpenAPI 类型别名 |
| dir.ts | listDir/listRoots |
| session-sse.ts | streamSession（490 行单体）+ streamGroupChat/streamShadowSession/subscribeAgentSessionsEvents + parse* 事件解析 + 重连常量 + zod schema |
| sessions.ts | session CRUD/查询/权限/dialog 函数 |
| session-queue.ts | 队列六函数 |
| group-chat.ts | group CRUD/消息/typing 函数 |
| team-missions.ts | 团队任务三函数 + 类型 |

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | sillyhub-daemon/src/interactive/session-manager.ts | [W1] 5438→约2000–2500行，类壳+委托+核心编排 |
| 新增 | sillyhub-daemon/src/interactive/session-manager/types.ts | [W1] session-manager 子模块 |
| 新增 | sillyhub-daemon/src/interactive/session-manager/notify-chain.ts | [W1] session-manager 子模块 |
| 新增 | sillyhub-daemon/src/interactive/session-manager/permission.ts | [W1] session-manager 子模块 |
| 新增 | sillyhub-daemon/src/interactive/session-manager/driver-factory.ts | [W1] session-manager 子模块 |
| 新增 | sillyhub-daemon/src/interactive/session-manager/write-guard.ts | [W1] session-manager 子模块 |
| 新增 | sillyhub-daemon/src/interactive/session-manager/usage.ts | [W1] session-manager 子模块 |
| 新增 | sillyhub-daemon/src/interactive/session-manager/turn-control.ts | [W1] session-manager 子模块 |
| 新增 | sillyhub-daemon/src/interactive/session-manager/lifecycle.ts | [W1] session-manager 子模块 |
| 新增 | sillyhub-daemon/src/interactive/session-manager/persistence.ts | [W1] session-manager 子模块 |
| 新增 | sillyhub-daemon/src/interactive/session-manager/events.ts | [W1] session-manager 子模块 |
| 新增 | sillyhub-daemon/src/interactive/session-manager/background-tasks.ts | [W1] session-manager 子模块 |
| 新增 | sillyhub-daemon/src/interactive/session-manager/helpers.ts | [W1] session-manager 子模块 |
| 新增 | sillyhub-daemon/src/interactive/session-manager/index.ts | [W1] session-manager 子模块 |
| 修改 | sillyhub-daemon/src/task-runner.ts | [W1] 3426→约1400–1600行，类壳+runLease编排 |
| 新增 | sillyhub-daemon/src/task-runner/payload.ts | [W1] task-runner 子模块 |
| 新增 | sillyhub-daemon/src/task-runner/change-write.ts | [W1] task-runner 子模块 |
| 新增 | sillyhub-daemon/src/task-runner/runner-types.ts | [W1] task-runner 子模块 |
| 新增 | sillyhub-daemon/src/task-runner/skill-prompt.ts | [W1] task-runner 子模块 |
| 新增 | sillyhub-daemon/src/task-runner/render.ts | [W1] task-runner 子模块 |
| 新增 | sillyhub-daemon/src/task-runner/spawn-stream.ts | [W1] task-runner 子模块 |
| 新增 | sillyhub-daemon/src/task-runner/file-mcp.ts | [W1] task-runner 子模块 |
| 新增 | sillyhub-daemon/src/task-runner/index.ts | [W1] task-runner 子模块 |
| 新增 | sillyhub-daemon/src/payload-utils.ts | [W1] 轻重构1 统一鸭子读取器 |
| 新增 | sillyhub-daemon/src/event-wire.ts | [W1] 轻重构2 event→wire收敛 |
| 新增 | sillyhub-daemon/tests/payload-utils.test.ts | [W1] 轻重构1/2/6 定向测试（新增文件不改既有测试） |
| 新增 | sillyhub-daemon/tests/event-wire.test.ts | [W1] 轻重构1/2/6 定向测试（新增文件不改既有测试） |
| 新增 | sillyhub-daemon/tests/dialog-result.test.ts | [W1] 轻重构1/2/6 定向测试（新增文件不改既有测试） |
| 删除 | backend/app/modules/daemon/router.py | [W2] 被 router/ 包替代 |
| 新增 | backend/app/modules/daemon/router/__init__.py | [W2] 12 文件包（execute 细化），导入路径不变 |
| 新增 | backend/app/modules/daemon/router/version.py | [W2] 12 文件包（execute 细化），导入路径不变 |
| 新增 | backend/app/modules/daemon/router/heartbeat.py | [W2] 12 文件包（execute 细化），导入路径不变 |
| 新增 | backend/app/modules/daemon/router/runtimes.py | [W2] 12 文件包（execute 细化），导入路径不变 |
| 新增 | backend/app/modules/daemon/router/machines.py | [W2] 12 文件包（execute 细化），导入路径不变 |
| 新增 | backend/app/modules/daemon/router/lease.py | [W2] 12 文件包（execute 细化），导入路径不变 |
| 新增 | backend/app/modules/daemon/router/session_crud.py | [W2] 12 文件包（execute 细化），导入路径不变 |
| 新增 | backend/app/modules/daemon/router/session_queue.py | [W2] 12 文件包（execute 细化拆分），导入路径不变 |
| 新增 | backend/app/modules/daemon/router/session_insights.py | [W2] 12 文件包（execute 细化拆分），导入路径不变 |
| 新增 | backend/app/modules/daemon/router/session_team.py | [W2] team 端点独立（execute 细化），导入路径不变 |
| 新增 | backend/app/modules/daemon/router/notify.py | [W2] 12 文件包（execute 细化拆分），导入路径不变 |
| 新增 | backend/app/modules/daemon/router/gateway_misc.py | [W2] 12 文件包（execute 细化拆分），导入路径不变 |
| 新增 | backend/app/modules/daemon/router/daemon_rpc.py | [W2] rpc/ws 类端点独立（execute 细化），导入路径不变 |
| 删除 | backend/app/modules/daemon/session/service.py | [W2] 被 session/service/ 包替代 |
| 新增 | backend/app/modules/daemon/session/service/__init__.py | [W2] 14 文件包，__init__ 聚合导出含 6 私有符号+patch 规则（D-007） |
| 新增 | backend/app/modules/daemon/session/service/errors.py | [W2] 14 文件包，__init__ 聚合导出含 6 私有符号+patch 规则（D-007） |
| 新增 | backend/app/modules/daemon/session/service/results.py | [W2] 14 文件包，__init__ 聚合导出含 6 私有符号+patch 规则（D-007） |
| 新增 | backend/app/modules/daemon/session/service/helpers.py | [W2] 14 文件包，__init__ 聚合导出含 6 私有符号+patch 规则（D-007） |
| 新增 | backend/app/modules/daemon/session/service/create.py | [W2] 14 文件包，__init__ 聚合导出含 6 私有符号+patch 规则（D-007） |
| 新增 | backend/app/modules/daemon/session/service/attachments.py | [W2] 14 文件包，__init__ 聚合导出含 6 私有符号+patch 规则（D-007） |
| 新增 | backend/app/modules/daemon/session/service/ppm_activation.py | [W2] 14 文件包，__init__ 聚合导出含 6 私有符号+patch 规则（D-007） |
| 新增 | backend/app/modules/daemon/session/service/inject.py | [W2] 14 文件包，__init__ 聚合导出含 6 私有符号+patch 规则（D-007） |
| 新增 | backend/app/modules/daemon/session/service/inject_gates.py | [W2] 14 文件包，__init__ 聚合导出含 6 私有符号+patch 规则（D-007） |
| 新增 | backend/app/modules/daemon/session/service/scheduled_messages.py | [W2] D-013 和解新增（定时消息 CRUD，queue 超 800 触发独立） |
| 新增 | backend/app/modules/daemon/session/service/queue.py | [W2] 14 文件包，__init__ 聚合导出含 6 私有符号+patch 规则（D-007） |
| 新增 | backend/app/modules/daemon/session/service/control.py | [W2] 14 文件包，__init__ 聚合导出含 6 私有符号+patch 规则（D-007） |
| 新增 | backend/app/modules/daemon/session/service/recovery.py | [W2] 14 文件包，__init__ 聚合导出含 6 私有符号+patch 规则（D-007） |
| 新增 | backend/app/modules/daemon/session/service/read_model.py | [W2] 14 文件包，__init__ 聚合导出含 6 私有符号+patch 规则（D-007） |
| 新增 | backend/app/modules/daemon/session/service/session_lifecycle.py | [W2] 14 文件包，__init__ 聚合导出含 6 私有符号+patch 规则（D-007） |
| 删除 | backend/app/modules/daemon/group/service.py | [W2] 被 group/service/ 包替代 |
| 新增 | backend/app/modules/daemon/group/service/__init__.py | [W2] 10 文件包 |
| 新增 | backend/app/modules/daemon/group/service/mentions.py | [W2] 10 文件包 |
| 新增 | backend/app/modules/daemon/group/service/typing_presence.py | [W2] 10 文件包 |
| 新增 | backend/app/modules/daemon/group/service/timeline_reads.py | [W2] 10 文件包 |
| 新增 | backend/app/modules/daemon/group/service/settings.py | [W2] 10 文件包 |
| 新增 | backend/app/modules/daemon/group/service/shadow.py | [W2] 10 文件包 |
| 新增 | backend/app/modules/daemon/group/service/members.py | [W2] 10 文件包 |
| 新增 | backend/app/modules/daemon/group/service/messages.py | [W2] 10 文件包 |
| 新增 | backend/app/modules/daemon/group/service/crud.py | [W2] 10 文件包 |
| 新增 | backend/app/modules/daemon/group/service/helpers.py | [W2] 10 文件包 |
| 删除 | backend/app/modules/daemon/run_sync/service.py | [W2] 被 run_sync/service/ 包替代 |
| 新增 | backend/app/modules/daemon/run_sync/service/__init__.py | [W2] 9 文件包 |
| 新增 | backend/app/modules/daemon/run_sync/service/sdk_pipeline.py | [W2] 9 文件包 |
| 新增 | backend/app/modules/daemon/run_sync/service/group_bridge.py | [W2] 9 文件包 |
| 新增 | backend/app/modules/daemon/run_sync/service/gate.py | [W2] 9 文件包 |
| 新增 | backend/app/modules/daemon/run_sync/service/stage_team.py | [W2] 9 文件包 |
| 新增 | backend/app/modules/daemon/run_sync/service/submit_steps.py | [W2] 9 文件包 |
| 新增 | backend/app/modules/daemon/run_sync/service/submit_commit.py | [W2] 9 文件包 |
| 新增 | backend/app/modules/daemon/run_sync/service/close_run_steps.py | [W2] 9 文件包 |
| 新增 | backend/app/modules/daemon/run_sync/service/publish.py | [W2] 9 文件包 |
| 新增 | backend/app/modules/daemon/_background_tasks.py | [W2] 轻重构3 后台任务mixin |
| 新增 | backend/app/modules/daemon/event_publish.py | [W2] 轻重构4 Redis publish统一 |
| 新增 | backend/app/modules/daemon/attachment_pipeline.py | [W2] 轻重构5 附件管线收敛 |
| 新增 | backend/app/modules/daemon/tests/test_background_tasks_mixin.py | [W2] 轻重构3/4/5 定向测试（新增文件不改既有测试） |
| 新增 | backend/app/modules/daemon/tests/test_event_publish.py | [W2] 轻重构3/4/5 定向测试（新增文件不改既有测试） |
| 新增 | backend/app/modules/daemon/tests/test_attachment_pipeline.py | [W2] 轻重构3/4/5 定向测试（新增文件不改既有测试） |
| 删除 | frontend/src/components/daemon/session-panel.tsx | [W3] 被 session-panel/ 目录替代 |
| 新增 | frontend/src/components/daemon/session-panel/index.tsx | [W3] 12 文件目录（execute 细化）（.ts/.tsx 划分见总体方案） |
| 新增 | frontend/src/components/daemon/session-panel/team-trigger-row.tsx | [W3] 12 文件目录（execute 细化）（.ts/.tsx 划分见总体方案） |
| 新增 | frontend/src/components/daemon/session-panel/worker-session-overlay.tsx | [W3] 12 文件目录（execute 细化）（.ts/.tsx 划分见总体方案） |
| 新增 | frontend/src/components/daemon/session-panel/use-stream-connection-guard.ts | [W3] 12 文件目录（execute 细化）（.ts/.tsx 划分见总体方案） |
| 新增 | frontend/src/components/daemon/session-panel/connection-banners.tsx | [W3] 12 文件目录（execute 细化）（.ts/.tsx 划分见总体方案） |
| 新增 | frontend/src/components/daemon/session-panel/use-session-team-missions.ts | [W3] 12 文件目录（execute 细化）（.ts/.tsx 划分见总体方案） |
| 新增 | frontend/src/components/daemon/session-panel/turn-state.ts | [W3] 12 文件目录（execute 细化）（.ts/.tsx 划分见总体方案） |
| 新增 | frontend/src/components/daemon/session-panel/scheduled-send.tsx | [W3] D-013 和解新增（定时发送弹窗组件） |
| 新增 | frontend/src/components/daemon/session-panel/search.tsx | [W3] 12 文件目录（execute 细化）（.ts/.tsx 划分见总体方案） |
| 新增 | frontend/src/components/daemon/session-panel/dialog-helpers.ts | [W3] 12 文件目录（execute 细化）（.ts/.tsx 划分见总体方案） |
| 新增 | frontend/src/components/daemon/session-panel/session-panel-page.tsx | [W3] 12 文件目录（execute 细化）（.ts/.tsx 划分见总体方案） |
| 新增 | frontend/src/components/daemon/session-panel/page-helpers.tsx | [W3] execute 细化（page 纯派生+常量+Props 收敛，压 page 进 3000 豁免线） |
| 新增 | frontend/src/components/daemon/session-panel/session-panel-dialog.tsx | [W3] 12 文件目录（execute 细化）（.ts/.tsx 划分见总体方案） |
| 删除 | frontend/src/lib/daemon.ts | [W3] 被 lib/daemon/ 目录替代 |
| 新增 | frontend/src/lib/daemon/index.ts | [W3] 14 文件目录（execute 细化），导入路径不变 |
| 新增 | frontend/src/lib/daemon/session-stream.ts | [W3] execute 细化（session-sse 1815 行超限拆出 streamSession 单体） |
| 新增 | frontend/src/lib/daemon/group-shadow-stream.ts | [W3] execute 细化（群/影子流独立） |
| 新增 | frontend/src/lib/daemon/sse-internals.ts | [W3] execute 细化（模块私有不进 index，保 188 导出面） |
| 新增 | frontend/src/lib/daemon/session-lists.ts | [W3] execute 细化（sessions 937 行超限拆出列表只读族） |
| 新增 | frontend/src/lib/daemon/runtimes.ts | [W3] 14 文件目录（execute 细化） |
| 新增 | frontend/src/lib/daemon/machines.ts | [W3] 14 文件目录（execute 细化） |
| 新增 | frontend/src/lib/daemon/shared-agents.ts | [W3] 14 文件目录（execute 细化） |
| 新增 | frontend/src/lib/daemon/dir.ts | [W3] 14 文件目录（execute 细化） |
| 新增 | frontend/src/lib/daemon/session-sse.ts | [W3] 14 文件目录（execute 细化） |
| 新增 | frontend/src/lib/daemon/sessions.ts | [W3] 14 文件目录（execute 细化） |
| 新增 | frontend/src/lib/daemon/session-queue.ts | [W3] 14 文件目录（execute 细化） |
| 新增 | frontend/src/lib/daemon/group-chat.ts | [W3] 14 文件目录（execute 细化） |
| 新增 | frontend/src/lib/daemon/team-missions.ts | [W3] 14 文件目录（execute 细化） |

> 纯代码组织重构：**无任何对外字段、接口、DTO、响应体、事件 payload、配置键的新增或变更**——producer/consumer 数据流零变化，故清单不标数据流。所有「新增」均为从原文件搬移代码；所有「删除」均被同名包/目录替代。

## 接口定义

**零新增对外接口。** 本变更的全部接口约束是「保持既有导出面不变」：

- `SessionManager`、`TaskRunner`、`SessionService`、`GroupChatService`、`RunSyncService` 类：公共方法签名逐一保持。
- `session-manager.ts` / `task-runner.ts` facade：`export` 符号集合与现状完全一致（src 引用方为 cli.ts 与 daemon.ts，另 62/23 个引用为测试）。
- `session-panel` / `@/lib/daemon`：再导出面与现状完全一致（session-panel 侧 7 符号：SessionPanel、SessionPanelProps、SessionPreContext、BashProgressState、applyBashStatusEvent、appendBashChunk、applyAgentTaskStatusEvent）。
- backend 三个 service 包与 router 包的 `__init__.py`：导出符号 ⊇ 现有被外部引用的符号集。跨文件在用的 **6 个私有符号**全量基线（Grill X-05 实测）：`_apply_session_terminal_status`、`_send_session_end_best_effort`（run_sync/service.py:47 导入）、`_merge_lease_metadata`、`_resolve_daemon_id_for_runtime`（lease_service.py:669、agent/mcp_tools.py:1382）、`_split_group_chain_marker`、`_prepend_group_chain_marker`（test_group_direct.py:668/1359）；另有公共符号 `TERMINAL_TURN_STATUSES` 等约 38 个。
- **monkeypatch 兼容保证**：157 处 `patch("app.modules.daemon.<mod>.<sym>")` 字符串目标全部继续可拦截——被 patch 符号的子模块调用点一律经原模块命名空间延迟解析（见 §5 单类拆分手法 D-007 规则），patch 目标全量清单在 plan 阶段由 grep 生成并入任务对账。
- 轻重构 3/4/5 的共享模块仅被同类内部消费，不进入 daemon/schema.py 公共 DTO。

## 生命周期契约表

不涉及生命周期契约。本变更为纯代码组织重构：claim/heartbeat/complete/session 事件、状态机流转、协议消息格式全部零变化（既有 117+ daemon 测试与 70+ backend daemon 测试即为行为契约的守护网）。

## 数据模型

不涉及。零表结构变更、零 Alembic 迁移、零 OpenAPI schema 变化（gen:types 无需运行）。

## 兼容策略（brownfield）

- **导入兼容**：三端兼容层形态见 §5；任何现有 import 语句（含测试的 vi.mock 路径、跨模块私有符号导入）原样工作。若发现某测试必须改 import 才能通过，判定为兼容层设计失败，回炉修正而非改测试（D-006）。
- **monkeypatch 兼容**：backend 157 处 `patch("app.modules.daemon.<mod>.<sym>")` 零失效——被 patch 符号的调用点经原模块命名空间延迟解析（D-007 规则）；frontend 55 处 `vi.mock('@/lib/daemon')` 为 importOriginal 展开覆写，目录化后 mock 形状不变。
- **回退路径**：每个 Wave 每个任务独立可 revert（git 按任务提交）；facade/`__init__` 聚合层使回退不影响消费方。
- **与在途变更共存**：D-001 排除的 8 个在途文件本变更零触碰；本变更产出的 facade 保持其导入语句继续有效，conflict-resolve-entry 落地时无需感知拆分。
- **行为不变的机制保障**：类方法下沉为函数时只做「搬移 + this 改显式传参」，禁止顺手改逻辑/改异常文案/改日志格式；轻重构 6 项每项独立提交并带定向测试。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | 在途变更 conflict-resolve-entry 后续触碰 SessionManager/TaskRunner 公共面，与 facade 委托层产生合并冲突 | P1 | Wave 1 只改方法体归属不动公共签名；每任务小步提交降低冲突面；冲突发生时以「先落地者为准、后到者在包内重做」原则处理 |
| R-02 | 单类方法体下沉时 this 状态传递遗漏（隐式共享字段未显式传参）导致运行时 undefined | P0 | 每搬一个方法簇立即跑定向测试；TS 编译期类型检查兜底；协作对象持有的状态在构造处集中初始化 |
| R-03 | session-panel page/dialog 内部 handler 提取涉及闭包状态，UI 行为回归 | P1 | 只提取纯函数与低耦合 hook（搜索、turn 状态机、bash reducer）；handler 保持在组件内，宁可 session-panel-page.tsx 留 ~2900 行也不引入行为回归 |
| R-04 | backend `__init__.py` 导出面遗漏被跨文件导入的符号（6 个私有符号+约 38 个公共符号）或 patch 命名空间遗漏导致 ImportError / patch AttributeError | P0 | 拆前 grep 对账**两类目标**：① `from ...session.service import` 等全部 import 语句；② 全部 `patch("app.modules.daemon.<mod>.<sym>")` 字符串目标。生成符号清单逐项核对进 `__init__.py` / 延迟解析白名单；CI 导入即失败可快速暴露 |
| R-05 | router 拆包后子路由挂载顺序或同形状路由相对序变化导致路由匹配行为差异 | P1 | `__init__.py` 保持「先 include 四子路由（change_write/audit/grants/group_chat，对应 router.py:469–499）再注册 83 端点」；同前缀同形状路由（literal vs 参数）落同一子模块保序（`/sessions/events`→`/sessions/{session_id}`、`/runtimes/usage`+`/runtimes/page`→`/runtimes/{runtime_id}`）；拆后 diff openapi.json 应零差异 |
| R-06 | Node ESM 目录导入限制认知错误导致 facade 方案失效 | P2 | 方案已按知识库「daemon ESM import 必须 .js」条目规避（保留原文件为 facade 而非目录）；执行时首个子模块落地即验证 |
| R-07 | scan 文档漂移（落后 2048 commit）导致设计依据过时 | P2 | 本设计全部基于 2026-09-07 实测 grep；执行期若发现行号漂移，以「方法簇主题」为准而非行号 |
| R-08 | HTML 原型跳过风险 | P2 | 纯代码组织重构、界面零变化，无原型对照需求；若 verify 阶段发现 UI 回归（R-03 兜底失败）再行补齐 |

## 决策追踪

| 决策 | 覆盖位置 | 状态 |
|---|---|---|
| D-001@v1 拆分范围（8 文件 + 排除在途 8 文件） | §1 背景、§3 非目标、§6 清单 | 已落实 |
| D-002@v1 拆分+轻重构策略 | §5 总体方案（单类拆分手法）、§9 兼容策略 | 已落实 |
| D-003@v1 单变更 3 Wave | §4 拆分判断、§5 Wave 顺序 | 已落实 |
| D-004@v1 方案 A 目录化+兼容层 | §5 总体方案三端机制表 | 已落实 |
| D-005@v3 粒度目标细化（supersedes D-005@v1/v2） | §2 目标 1、§5 各表（session 包 14 文件细分、run_sync 包 9 文件自估、group 包行数自估、page ≤3000 / dialog ≤2000 双豁免） | 已落实（Grill X-02 修正 + 复审补强） |
| D-006@v1 现有测试零修改硬验收 | §2 目标 2、§7 monkeypatch 兼容保证、§9 兼容策略 | 已落实 |
| D-007@v1 monkeypatch 命名空间兼容规则 | §5 单类拆分手法、§7、§9、R-04 | 已落实（Grill X-01/B-01 P0 修正） |

无未解决决策。剩余风险见 §10。

## 自审（Self-Review）

**逐项核验：**

1. ✅ 章节齐全：背景/设计目标/非目标/拆分判断/总体方案/文件变更清单/接口定义/生命周期契约（豁免短语「不涉及生命周期契约」紧邻标题）/数据模型/兼容策略/风险登记/决策追踪/自审。
2. ✅ 行号与簇划分全部来自 2026-09-07 三路并行实测调研（Explore 代理 grep 实测），非 scan 旧快照。
3. ✅ 导出面兼容三端机制均已按各语言模块解析规则核实：Python 包替代模块同路径；Node ESM 无目录导入故留 facade 文件；webpack/bundler 目录 index 解析支持。
4. ✅ 文件变更清单与 §5 方案逐一对齐；无对外字段变动故无数据流标注需求（已在清单头部声明）。
5. ✅ 生命周期关键词（session/lease/daemon/heartbeat）在文中出现，已按规则写豁免短语；行为零变化由既有测试守护（§7.5）。
6. ✅ 风险登记 8 项含 P0 两项（R-02/R-04）及应对；原型跳过原因已记入 R-08，无静默缺位。
7. ~~自审存疑一：session-manager.ts facade 预计 2000–2500 行~~ → **已裁决（D-005@v2）**：核心编排类壳 ≤2500 为目标上限、session-panel-page.tsx 显式豁免 ≤3000（R-03 理由），豁免口径已写入 §2/§5。
8. ~~自审存疑二：backend session/service/__init__.py 类壳可能到 900 行~~ → **已消解**：方法体下沉后类壳为一行委托，实测公共方法 52 个、`__init__.py` 预计 ~700 行，在目标内。
9. **Design Grill（independent tier，独立子代理源码逐项抽查）结论已回灌**：主路线（ESM facade / Python 同名包 / bundler 目录化 / 3 Wave / 行数底数 / 在途零交集）全部源码验证通过；P0 矛盾（monkeypatch 命名空间，X-01/B-01）经 D-007 规则修正；P1（行数自相矛盾 X-02、BashProgressState 漏导 X-03）经 D-005@v2 与 §5/§7 清单补齐修正；数字勘误（83 端点 / 24 AppError / 引用计数 62·23·140·55·24）与 router 顺序声明（X-04）、轻重构 3 措辞（X-08）均已修订。
10. ✅ 决策 D-001~D-004、D-006@v1、D-005@v2、D-007@v1 全部可追踪、无悬空；非目标已明确 4 项防 scope creep。
11. ✅ 依据文档：`.sillyspec/knowledge/known-issues.md` god 文件条目、知识库 ESM 坑条目、AGENTS.md/CLAUDE.md 流程与测试规则、Design Grill 审查报告（.sillyspec/.runtime/stage-reviews/brainstorm-review-2026-09-07-081447/review.json）。

**自审结论：通过（初版 2 项存疑已由 Design Grill 交叉裁决并回灌修正，无遗留存疑）。**
