---
author: qinyi
created_at: 2026-08-29 02:41:30
scale: large
tier: independent
---

# daemon 与平台对接稳定性优化 — 设计文档

## 背景

daemon 与平台（backend）通过 WebSocket（控制面）+ HTTP（数据面）双通道协同。用户实际使用中存在四类中断场景：网络波动、服务器重新部署（backend 进程重启，DB 保留，见 D-002）、客户端切换网络、关闭 daemon 一段时间后再重启。当前在这些场景下客户端（前端会话面板）回显与会话可用性存在系统性缺陷。

三路源码调研结论（2026-08-29，全部带文件行号证据，见变更目录 research 记录于本设计「现状证据索引」节）：

**daemon 侧**（`sillyhub-daemon/src/`）：
- WS 固定 5s 重连、无退避无 jitter（`ws-client.ts:32`）
- register 仅启动时调用一次，失败仅 warn、无运行期重试（`daemon.ts:1291-1296`）——backend 重启窗口内启动 daemon 即永久失联
- 控制消息（SESSION_INJECT/INTERRUPT/END/RESUME、PLAN_RESPONSE、PERMISSION_RESPONSE、PROVIDER_CONFIG_CHANGED、SELF_UPDATE）纯 WS 推送，onConnected 只 drain outbox（`daemon.ts:2526-2529`），断线窗口内丢失且无补拉
- outbox 仅覆盖 submitMessages；notifyRunResult/notifySessionEnd/completeLease 走 retryTerminal 3 次（约 7s）用尽即丢（`resilience/service.ts:156-170`）
- submitWithRetry 对 4xx fail-fast 不入 outbox（`resilience/service.ts:118-121`）
- PERMISSION_REQUEST 走 WS，断线即 fail-closed deny（`permission-resolver.ts:129-149`）
- 恢复链路：`_recoverSessionsOnBoot`（`daemon.ts:1311-1369`）对 recover HTTP 网络失败**删本地记录不复活**（`daemon.ts:1400-1408`）；restoreAndReconnect 后 claimToken 空串直到下一次 SESSION_INJECT（`session-manager.ts:3387-3392`），空窗期上报被 no_claim_token 丢弃

**backend 侧**（`backend/app/modules/daemon/` 等）：
- lease 过期回收 `expire_leases`/`handle_expired_leases_batch`（`lease/service.py:897/1060`）生产代码**无任何调用方**——claimed batch lease 心跳停后永不过期
- WS 断开只删内存连接不写 DB（`ws_hub.py:92-107`）；daemon 在线判定靠 DB status，惰性 45s 清理仅在列表端点触发（`runtime/service.py:862-925`）；placement 候选筛选只查 DB status 不查 WS 实连接（`agent/placement.py:1590/1625/1664`；interactive 通知路径已有 is_connected 检查，`placement.py:1075`）
- interactive 会话在 daemon 网络闪断（未重启）时保持 active 最长 600s 才被 offline sweep 收敛 failed（`sweep.py:162-251`）——daemon 优雅 stop 后超过 600s 重启，会话已被标 failed，恢复链路放弃（违反 D-001 口径）
- backend 重启 lifespan 只清 running run（`main.py:127-132`→`agent/service.py:2260-2305`），不动 pending run/lease、不重发唤醒、不重建 permission 内存 timers（`permission_service.py:243`）
- reopen 租约（SESSION_RESUME）刻意排除在 getPendingLeases 之外（`router.py:4098-4104`），WS 单次投递无补拉

**frontend 侧**（`frontend/src/`）：
- fetch-sse 封装无重连；会话流 streamSession 自带退避重连+REST resync（较健壮，`lib/daemon.ts:1343-1730`），但无连接状态回调——断连期间页面无任何提示
- run 级流 AgentRunStreamClient retryCount 仅 disconnect() 归零，5 次耗尽永久停连（`lib/agent-stream.ts:181,279-281`）
- 审批面板 SSE 零重连（`components/permissions/session-permission-panel.tsx:224-227`）
- running 轮无本地看门狗：backend 未写终态时无限期挂起（`components/daemon/session-panel.tsx:1223-1226` 明确「不伪造终态」且无兜底）

## 设计目标

1. **网络波动/客户端换网**（daemon 不重启，断连秒级~分钟级）：控制指令与终态上报零丢失（例外见 A2 投递语义：delivered 不重发，该损失由恢复链路收敛为中断轮 failed）；人审不再因断线被直接拒绝；前端断线可见、恢复自动同步。
2. **服务器重新部署**（backend 进程重启，DB 保留）：daemon 零人工干预自动恢复（重连+对账）；backend 侧 lease/run/session 状态自动收敛；重启窗口内 pending 任务重唤醒。
3. **daemon 关闭一段时间后重启**：原会话**自动恢复可继续对话**（D-001）——历史完整、会话存活（suspended→reconnecting→active）、中断轮标失败；任意时间间隔后重启均不丢历史。
4. **前端回显**（D-003）：连接状态可见（重连中/已恢复横幅）；运行中轮次有对账兜底不无限挂起；审批面板推送自动重连。

## 非目标（Non-Goals）

- DB 清空/换库场景（daemon 凭证全失效后的重新绑定流程）——D-002 明确排除
- daemon 长时崩溃中断轮的**输出续传**（resume 不 push prompt，SDK 空闲；中断轮收敛为 failed 是既定语义，不追求接续流式输出）
- SSE 协议层改造（Last-Event-ID/单调递增序号/服务端回放）——现有「timestamp 游标 + 2s 重叠窗 + log_id 去重 + resync」已满足回显正确性，仅做状态可见性与兜底
- 会话消息分页/多标签页状态同步/组件内存态重构
- SELF_UPDATE、CLEANUP 控制消息的可靠化（低频运维指令，维持现状 best-effort）
- batch pending lease 的派发侧超时治理（本轮只通过 lease GC + 重唤醒覆盖，不新增 pending lease TTL 列）

## 决策/方案选择（D-xxx）

本设计全部关键决策以 `decisions.md` 为唯一真相源（D-001~D-007，均为当前生效版本），此处摘录方案选择要点：

- **D-005 方案选型**：控制指令可靠化采用「落库待发 + WS 推送保即时 + 重连补拉」三段式（方案 A），否决纯轮询化（B，交互延迟受轮询间隔制约）与事件溯源重构（C，工作量数倍、过度设计）。
- **D-001 恢复口径**：daemon 重启后原会话自动恢复可继续对话（A5 suspended 语义服务此目标），而非仅历史不丢。
- **D-002 重部署边界**：仅 backend 进程重启 DB 保留；不做换库重绑定链路。
- **D-003 前端范围**：纳入关键回显修复（连接横幅/看门狗/审批重连），不做消息组件内存态重构。
- **D-004 改造深度**：授权新增表/端点/常驻协程等结构改造。
- **D-006 投递语义**：补拉只返回 pending、delivered 一律不重发（零重复执行优先）；WS 断开 10s 延迟降级；suspended 24h 上限；恢复网络失败保留本地记录。
- **D-007 Grill 裁定**：延迟降级取消判定=执行时复查实连接；pending 会话离线归宿维持 failed；outbox 扩展形态（kind 字段/drain 路由/dedupId 命名）；inject 两条过期路径均联动 run failed；recover 维持非白名单语义。

## 总体方案

采用方案 A（D-005）：控制指令可靠投递 + 分层加固。六块设计如下。

### A1 — daemon 连接韧性

**WS 重连退避化**（`ws-client.ts`）：
- `RECONNECT_INTERVAL_MS = 5_000` 固定值改为退避序列 `[1, 2, 4, 8, 16, 30]s`（封顶 30s）+ 每档 ±20% jitter；收到任何 WS 消息（含 pong）即重置为第 0 档。
- 握手超时/主动关闭逻辑不变（10s/5s）。

**register 周期重试**（`daemon.ts`）：
- 心跳循环内检测 `_registeredRuntimes` 为空 → 以心跳周期（15s，即每拍）重试 `_registerDaemon`，连续失败按退避拉长至 60s 封顶；成功后恢复正常三循环。
- 覆盖两类入口：启动时 register 失败；运行期 heartbeat 返回 401/403 且重试 register 成功（DB 保留场景下 401 不应发生，出现即 FATAL 日志 + 重试，不静默）。

**重连后统一对账 `_reconcileAfterReconnect()`**（`daemon.ts`，幂等、`_reconciling` 防重入）：
1. 立即拍一次 HTTP 心跳（加速 backend 在线状态恢复 + 拉取 allowed_roots/pending 计数）
2. drain outbox（上行回放）
3. 补拉控制指令（A2：getPendingControls → 逐条处理 → ack）
4. 补拉 pending leases（现有 getPendingLeases，含 change-write 分支保持不变）
- 触发点：WS onConnected；另在心跳响应携带 `pending_controls > 0` 时触发第 3 步。

### A2 — 控制指令可靠投递（核心）

**新表 `daemon_control_commands`**（`backend/app/modules/daemon/model.py`，参考 DaemonChangeWrite 先例）：

| 列 | 类型 | 说明 |
|---|---|---|
| id | UUID PK | 即 command_id，daemon 侧幂等键 |
| runtime_id | UUID FK | 目标 runtime |
| kind | str | session_inject / session_interrupt / session_end / session_resume / permission_response / provider_config_changed |
| payload | JSON | 与现有 WS 消息 payload 同构 + 注入 command_id |
| status | str | pending / delivered / acked / expired |
| created_at / delivered_at / ack_at / expires_at | ts | expires_at 按 kind：inject 10min、permission_response 6min（对齐 5min 审批超时+余量）、其余 30min |

**投递状态机**（关键语义决策，D-006）：
- 下发方（session service inject/interrupt/end/resume、permission_service 审批结果与超时 deny、provider_switch）统一改走 `ControlCommandService.enqueue()`：INSERT pending → 尝试 WS 推送（现有消息形状 + payload 内加 `command_id` 字段）→ 推送成功标 delivered；失败/不在线保持 pending。
- **补拉只返回 pending**：`GET /runtimes/{id}/pending-controls` 只发 status=pending 的指令，**delivered 一律不重发**——保证零重复执行（inject 重复执行会向 agent 双发 prompt，不可接受）。delivered-未-ack 与过期行由 GC 清理。WS 推送成功 = TCP 已达 daemon 进程，daemon 收到后崩溃的场景由会话恢复链路收敛（中断轮 failed），不追求重发。
- daemon 侧消费仍带 LRU 去重窗（256 条，同 ws_hub task_available 先例）：仅防御「pull 在途时 WS 推送同条到达」的窗口竞态。
- `POST /runtimes/{id}/controls/ack {ids}`：消费成功标 acked（消费失败的业务错误也 ack——避免毒丸指令无限重投，错误进日志与告警）。
- GC（并入 A4 常驻协程）：pending 且 created_at > expires_at → expired；delivered 未 ack 超 10min → expired；acked 保留 1h 后删除。
- inject 类指令过期时（**pending 过期与 delivered-未-ack 过期两条路径同样联动**），同步把对应 pending run 标 failed（error_code=`interactive_inject_send_failed`，幂等 UPDATE，复用 `session/service.py:3659` 现有错误码先例）——覆盖「daemon 长期不回来时用户发消息」的终态收敛，并保证两个过期窗口（10min）语义一致，不留给 600s sweep 兜底。
- **与 AgentSessionQueuedMessage 的边界**：排队表解决「会话忙」（业务层排队），控制指令表解决「链路断」（投递层可靠），两层正交、互不替代。
- reopen 租约（session_resume）纳入控制指令后即获得补拉能力，弥补「WS 单次投递丢失 → reopen lease 永挂」缺陷。

### A3 — 上行终态可靠化

- **终态入 outbox**（daemon `resilience/`）——**outbox 扩展形态**（现有 `OutboxEntry{leaseId, claimToken, runId, envelopes}` 与 drainOutbox 硬编码 submitMessages 装不下终态语义，按下述扩展）：
  - entry 增加 `kind: 'messages' | 'run_result' | 'session_end'` 字段（默认 messages，向后兼容旧 `<runId>.jsonl` 文件——load 时缺 kind 按 messages 解析）；
  - `run_result` entry：dedup_key = runId、携带完整 result payload（无需 claimToken）；`session_end` entry：dedup_key = sessionId、文件命名维度从 `<runId>.jsonl` 泛化为 `<dedupId>.jsonl`（messages/run_result 沿用 runId，session_end 用 sessionId）；
  - drain 按 kind 路由：messages → submitMessages（现状）、run_result → notifyRunResult、session_end → notifySessionEnd；SubmitClient 接口相应扩展两方法；
  - notifyRunResult / notifySessionEnd 先走 retryTerminal 快路径（低延迟），用尽后落 outbox 由对账重放。
  - backend 侧 result/session-end 端点幂等化（重复提交同 payload → 200 no-op 或 409 视为已送达）。
- **PERMISSION_REQUEST HTTP 上行通道**：新端点 `POST /api/daemon/sessions/{id}/permission-requests`（daemon `hub-client.ts` 增加 `submitPermissionRequest`）。WS 不通时改走 HTTP 创建待审记录；等待响应不设时限依赖 backend 5min 超时 + daemon 侧 fallback timer（保留为最终兜底）。下行 PERMISSION_RESPONSE 由 A2 覆盖补拉。**效果：断线期间人审挂起等待而非直接 deny。**
- **422 对账**：`submitWithRetry` 遇 422（claim_token 失效）不再丢弃——消息入 outbox，并触发一次会话详情刷新（`getAgentSession`）尝试恢复 claim_token；仍无效则由 backend dedup/终态规则兜底。

### A4 — backend 收敛与 GC 接线

- **lease 过期 GC 常驻协程**：`sweep.py` 新增 `lease_expiry_sweeper`（60s 周期，模式同 session_reconnect_sweeper，main.py lifespan 挂载），调用既有 `expire_leases` + `handle_expired_leases_batch` + `alert_stuck_terminating_leases`——claimed batch lease 心跳停后过期重派（<3 次）或 run failed（≥3 次）。
- **WS 断开即时降级（防抖动）**：ws_hub.disconnect 后延迟 10s 再把 instance+runtimes 标 offline（DB）；**延迟任务执行时复查取消判定：`ws_hub.is_connected(daemon_instance_id)` 为真则跳过标记**（注意 ws_hub 键控维度是 daemon_id 而非 runtime_id，placement 候选行联查 `is_connected(row.daemon_instance_id)`）。期间重连/心跳成功也会取消标记（daemon A1 重连后立即拍心跳）。心跳周期 15s 与 10s 延迟存在相位差，极端情况下 DB 有最长一个心跳周期（~15s）的 offline→online 抖动窗口，该窗口内 placement 拒绝派发——为已声明的可接受行为（宁可短暂不派发，不可派发即卡死）。
- **backend 重启 lifespan 扩展**：
  - 对在线 daemon 的 pending batch lease 重发 WS 唤醒（复用 `_send_ws_wakeup`）
  - reconnecting 会话维持既有 180s sweeper 收敛（不新增逻辑）
  - permission：持久化的 AskUserQuestion dialog 不受影响（前端轮询恢复）；canUseTool 内存 timers 重启丢失为**接受的残余风险**（daemon 侧 5min fallback deny 兜底，记入风险登记）

### A5 — 会话挂起与恢复语义

- **AgentSession.status 新增 `suspended`**（`agent/model.py`；String 列无 DB 枚举约束，应用层词表 + 三端展示兜底 default 分支）。
- **daemon 优雅停止主动挂起**：daemon stop() 在 markOffline 前调用新端点 `POST /api/daemon/sessions/suspend-batch`（按 daemon_local_id）——该 daemon 全部 active 会话：中断中 run → failed（error_code=`daemon_stopped`）、session → suspended、挂起 lease → cancelled。
- **offline sweep 改语义**：`session_offline_sweep_once`（600s 宽限）把 **active** 会话标 **suspended**（原 failed）；**pending 会话维持 failed 不变**——pending 会话 daemon 本地无 sessions.json 记录（快照仅持久化 active/running 且有 agentSessionId 的会话），标 suspended 后无人 recover 只能等 24h GC，维持 failed 语义更准确。同步保持现状三步收敛：挂起 run→failed、lease→cancelled（recover 的 lease 校验只查 kind 不查 status，cancelled lease 仍可 recover，闭环成立）。新增 suspended GC——suspended 超 24h（`SUSPENDED_MAX_AGE_SEC` 可配）→ failed（防永久泄漏）。
- **recover 接受 suspended**：`POST /sessions/{id}/recover` 现状是「非终态一律 → reconnecting」无白名单，suspended 天然可 recover（**实现要求：不新增白名单分支，用例锁定 suspended/pending/reconnecting 三态均可 recover**）；daemon 重启后 sessions.json 恢复链路闭环：suspended → recover → reconnecting → restoreAndReconnect（SDK resume，历史在 SDK jsonl + 平台 DB 双侧完整）→ confirm-reconnected → active → 用户可直接继续对话（D-001）。
- **suspend-batch 失败 fallback 已声明**：daemon stop() 时网络已断则 suspend-batch 调用失败，与强杀等价走 600s offline sweep → suspended 收敛一致；代价是 fallback 路径下前端最长 600s 仍显示 active（期间 inject 派发失败）——已声明的体验延迟，非正确性问题。
- **daemon 侧恢复健壮性**：
  - `_recoverOneSession` 对 HTTP 网络类失败（请求未达/5xx/超时）**保留本地记录**，按 30s 起步退避重试（封顶 5min），WS onConnected 时若有遗留记录立即重试一轮；仅业务终态（ended/failed/rejected）才删记录。
  - claimToken 空窗：onTurnResult/onTurnMessage 遇 no_claim_token 不再丢弃——消息入 outbox（带 pending_token 标记），下一次 SESSION_INJECT 刷新 token 后 drain 重放；重放仍 422 则走 A3 对账。

### A6 — 前端回显兜底

- **连接状态回调与横幅**：streamSession 处理器增加 `onStatusChange(status: 'reconnecting' | 'reconnected' | 'live', attempt?)`；session-panel 顶部横幅：「实时连接已断开，正在重连…（第 N 次）」warning 色 /「连接已恢复，正在同步…」success 色 2s 自动消失。复用现有「离线只读」横幅样式位，明暗双主题（原型②③）。
- **运行轮看门狗**：turn running 且 90s 无新日志/SSE 事件 → 主动 `getAgentSession` + `listSessionRuns` 对账一次；连续 3 轮（每 30s）仍 running 且 SSE 处于断开态 → 显示「本轮长时间无响应，正在与平台核对…」提示（accent 色，不伪造终态，原型④）。对账若发现 run 已终态 → 按 resync 路径刷新轮次。
- **run 级流预算重置**：AgentRunStreamClient 收到任一成功事件即重置 retryCount=0（修复「5 次耗尽永久停连」）。
- **审批面板重连**：session-permission-panel SSE 套用列表事件流的无限退避重连模式 + onReconnected 后补拉 dialogs。
- **suspended 会话展示**：列表/详情/浮窗状态徽标「已挂起」、横幅「守护进程不在线，重新启动后自动恢复」（info 色，原型⑤）、输入框禁用；daemon 回归恢复中横幅（原型⑥）。api-types 经 `pnpm gen:types` 再生成。

## 生命周期契约表

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| control_command 入队 | backend（session/permission/provider_switch） | daemon_control_commands 表 | id/runtime_id/kind/payload/expires_at | status=pending |
| control_command WS 推送成功 | backend ws_hub | daemon | 现有消息形状+command_id | 表 status: pending→delivered |
| control_command 补拉 | daemon（重连对账/心跳计数触发） | backend GET pending-controls | runtime_id 鉴权 | 仅返回 pending 行（delivered 不重发） |
| control_command ACK | daemon | backend POST controls/ack | ids[] | status: pending\|delivered→acked |
| control_command 过期 | backend GC 协程 | — | expires_at / delivered_at | →expired（pending 过期与 delivered-未-ack 过期同路径）；inject 类联动 run→failed(interactive_inject_send_failed) |
| daemon register 重试成功 | daemon 心跳循环 | backend /register | daemon_local_id+providers | _registeredRuntimes 空→有；心跳/WS 恢复 |
| WS 断开 10s 未恢复 | backend ws_hub 延迟任务 | daemon_instances/runtimes | daemon_id | status: online→offline（DB） |
| daemon 心跳成功 | daemon | backend /heartbeat | daemon_local_id+providers | status→online（覆盖离线标记） |
| lease 过期 | backend lease_expiry_sweeper | lease 表 | lease_expires_at | claimed→expired；run 重派(≤3)/failed(>3) |
| 会话挂起（优雅停止） | daemon stop() | backend suspend-batch | daemon_local_id | session: active→suspended；中断 run→failed(daemon_stopped)；lease→cancelled |
| 会话挂起（离线超时） | backend offline sweep（600s） | session 表 | runtime offline | session: active→suspended（原 failed）；**pending 会话维持 failed**；同步 run→failed、lease→cancelled（维持现状三步） |
| suspended 超龄 | backend sweep（24h） | session 表 | suspended_since | session: suspended→failed |
| 会话恢复 | daemon 重启 _recoverSessionsOnBoot | backend /recover | session_id+runtime | session: 非终态（suspended/active/pending/reconnecting）→reconnecting；claim_token 轮换 |
| 会话恢复确认 | daemon restoreAndReconnect 成功 | backend /confirm-reconnected | session_id | session: reconnecting→active |
| 恢复网络失败重试 | daemon 恢复循环 | — | 本地 sessions.json 记录 | 记录保留（原：删除）；业务终态才删 |
| 终态 outbox 重放 | daemon drain | backend runs/result、session/end | dedup_key | 端点幂等（重复→no-op/409=已送达） |
| 权限请求 HTTP 上行 | daemon（WS 不通时） | backend /permission-requests | request_id/tool/input | 创建待审记录；等待（原：fail-closed deny） |
| 权限审批结果下发 | backend | daemon（WS+控制指令） | request_id/decision | 表 pending→delivered/acked；dialog resolved |
| backend 重启 | lifespan | lease/在线 daemon | — | pending lease 重发 WS 唤醒；running run→failed（既有）；reconnecting 交 180s sweeper |

## 文件变更清单（File Changes）

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | backend/app/modules/daemon/control_commands.py | ControlCommandService：enqueue/mark_delivered/fetch_pending/ack/gc |
| 新增 | backend/migrations/versions/20260829_1200_add_daemon_control_commands.py | 建表迁移（alembic.ini script_location=migrations） |
| 修改 | backend/app/modules/daemon/model.py | DaemonControlCommand 表 |
| 修改 | backend/app/modules/daemon/router.py | GET pending-controls、POST controls/ack、POST sessions/suspend-batch、POST sessions/{id}/permission-requests；心跳响应加 pending_controls |
| 修改 | backend/app/modules/daemon/ws_hub.py | disconnect 延迟降级回调挂载 |
| 修改 | backend/app/modules/daemon/runtime/service.py | 延迟 offline 标记 + 心跳恢复 online |
| 修改 | backend/app/modules/daemon/sweep.py | lease_expiry_sweeper、offline sweep 改 suspended、suspended 超龄 GC、控制指令 GC |
| 修改 | backend/app/modules/daemon/session/service.py | inject/interrupt/end/resume 走 enqueue+WS；suspend 批量端点逻辑；recover 接受 suspended；result/session-end 幂等化 |
| 修改 | backend/app/modules/daemon/permission_service.py | 审批结果/超时 deny 走控制指令；HTTP 上行端点逻辑 |
| 修改 | backend/app/modules/daemon/lease/service.py | expire/handle_expired/alert_stuck 接线（只调用不改语义） |
| 修改 | backend/app/modules/daemon/lease/provider_switch.py | provider_config_changed 走控制指令 |
| 修改 | backend/app/modules/agent/model.py | AgentSession.status 词表加 suspended |
| 修改 | backend/app/modules/agent/placement.py | 派发前查 ws_hub.is_connected |
| 修改 | backend/app/main.py | lifespan：lease sweeper 挂载、pending lease 重唤醒 |
| 重新生成 | backend/openapi.json | openapi 再导出 |
| 新增 | sillyhub-daemon/src/control-dispatcher.ts | 控制指令消费分发：统一 (kind,payload) 入口，WS 与补拉共用；LRU 去重窗（避免 daemon.ts god 文件继续膨胀） |
| 修改 | sillyhub-daemon/src/ws-client.ts | 退避重连序列+jitter+消息重置 |
| 修改 | sillyhub-daemon/src/daemon.ts | register 周期重试、_reconcileAfterReconnect、stop 挂起批量、恢复网络失败保留重试、no_claim_token 入 outbox |
| 修改 | sillyhub-daemon/src/hub-client.ts | getPendingControls/ackControls/suspendSessions/submitPermissionRequest |
| 修改 | sillyhub-daemon/src/resilience/service.ts | run_result/session_end 终态 kind、drain 按 kind 路由、pending_token 暂存 |
| 修改 | sillyhub-daemon/src/resilience/outbox.ts | entry kind 字段、dedupId 命名维度、旧 runId 文件兼容 |
| 修改 | sillyhub-daemon/src/protocol.ts | 控制指令 kind 常量与心跳响应类型 |
| 重新生成 | sillyhub-daemon/src/api-types.ts | gen:types |
| 修改 | frontend/src/lib/daemon.ts | streamSession onStatusChange、suspended 类型与展示辅助 |
| 修改 | frontend/src/components/daemon/session-panel.tsx | 连接横幅、看门狗对账、suspended 展示与输入禁用 |
| 修改 | frontend/src/components/daemon/session-list-layout.tsx | SESSION_STATUS_LABELS 增加 suspended 徽标 |
| 修改 | frontend/src/components/daemon/runtime-session-helpers.tsx | ACTIVE_SESSION_VIEW_STATUSES 词表 + 恢复按钮对 suspended 的处理 |
| 修改 | frontend/src/lib/agent-stream.ts | 成功事件重置 retryCount |
| 修改 | frontend/src/components/permissions/session-permission-panel.tsx | 无限退避重连+dialogs 补拉 |
| 重新生成 | frontend/src/lib/api-types.ts | pnpm gen:types |

## 接口定义

**daemon → backend（新增 HTTP）**
```
GET  /api/daemon/runtimes/{runtime_id}/pending-controls
     → 200 { commands: [{ id, kind, payload, created_at }] }   # 仅 status=pending，created_at 升序
POST /api/daemon/runtimes/{runtime_id}/controls/ack
     body { ids: [uuid...] } → 200 { acked: n }                 # 消费成功或业务性失败均 ack
POST /api/daemon/sessions/suspend-batch
     body { daemon_local_id } → 200 { suspended: n, runs_failed: n }
POST /api/daemon/sessions/{session_id}/permission-requests
     body { request_id, tool_name, input, session_id } → 200    # WS 不通时的上行兜底
```

**心跳响应扩展**：`POST /heartbeat` 响应增加 `pending_controls: int`（该 daemon 全部 runtime 的 pending 控制指令计数；A1 对账与心跳循环统一用此字段名）。

**WS 消息扩展**：现有控制消息 payload 内新增可选字段 `command_id: uuid`（向后兼容，旧 daemon 忽略）。

**控制指令 kind 枚举**：`session_inject | session_interrupt | session_end | session_resume | permission_response | provider_config_changed`（表列 `kind` 用 String(32)——最长值 provider_config_changed 为 24 字符，DaemonChangeWrite 先例的 String(20) 装不下）。

**配置常量**：daemon WS 退避 `[1,2,4,8,16,30]s`/jitter ±20%；register 重试 15s 起步封顶 60s；WS 断开延迟降级 10s；控制指令过期 inject=10min / permission_response=6min / 其他=30min；delivered-未-ack 过期 10min；acked 保留 1h；suspended 上限 24h；运行轮看门狗 90s/复核 30s×3。

## 风险登记（Risk Register）

| # | 风险 | 等级 | 缓解 |
|---|---|---|---|
| R1 | 控制指令表每次 inject/审批多一次 INSERT，增加延迟 | 低 | 单行写入微秒级；低频操作（用户级） |
| R2 | WS 断开即时降级引起状态抖动（前端频繁切换离线横幅） | 中 | 10s 延迟标记可取消；daemon 重连即拍心跳恢复 |
| R3 | suspended 新状态三端展示遗漏（列表/详情/浮窗/枚举 default） | 中 | 前端统一 status 徽标映射函数 + default 兜底「未知状态」；四处入口同改：session-panel.tsx、session-list-layout.tsx、runtime-session-helpers.tsx、浮窗 |
| R4 | daemon.ts 已 4773 行（god 文件），继续膨胀 | 中 | 控制指令消费独立 control-dispatcher.ts；对账流程独立方法组 |
| R5 | 终态 outbox 重放与 backend 端点幂等不严格导致重复副作用 | 中 | result/session-end 端点显式幂等（同 dedup/payload → no-op）+ 用例覆盖 |
| R6 | 恢复重试保留本地记录无限堆积 | 低 | 记录数上限 + 超龄清理（7 天）+ 日志 |
| R7 | canUseTool 审批 timer 重启丢失（backend 重启窗口） | 低 | 接受的残余风险：daemon 5min fallback deny 兜底；记录在案 |
| R8 | alembic 并行变更撞 revision 多 head（known issue） | 中 | 提交前 `alembic heads` 单 head 检查；撞车则 re-parent |
| R9 | gen:types 三端联动（backend openapi 变更 → daemon/frontend 类型再生成） | 低 | 同一变更内完成三端 gen:types 并提交 |
| R10 | 既有 flaky 测试（xdist 隔离等）与新增后台协程测试互相干扰 | 中 | 新协程用例显式注入 fake 时钟/独立 event loop，遵守 known_failures 豁免清单纪律 |

## 自审（Self-Review）

- 章节完整性：背景/设计目标/非目标/总体方案/生命周期契约表/文件变更清单/接口定义/风险登记/自审 —— 齐全 ✓
- 决策引用：D-001（恢复口径→A5）、D-002（重部署范围→A4/非目标）、D-003（前端范围→A6）、D-004（结构改造授权→A2 表/端点）、D-005（方案 A 选型）、D-006（补拉只返回 pending 等关键语义）、D-007（Design Grill 裁定：WS 断开取消判定、pending 会话归宿、outbox 扩展形态、inject 过期双路径联动、recover 非白名单）—— 全部当前版本已引用 ✓
- 生命周期契约表：本变更重度涉及 session/lease/daemon 生命周期，19 行契约矩阵已覆盖全部新增状态转移 ✓
- 原型：前端改动达「建议生成」级（新增横幅/状态徽标/输入禁用），prototype-session-connection-states.html 已产出（六状态+双主题）✓
- Design Grill 交叉审查（独立子代理，2026-08-29）：23 个交叉点，17 处源码行号引用全部命中；2 个 P1 缺口（X-14 outbox 扩展形态、X-07 延迟降级取消条件）与 3 个语义空洞（X-08 pending 会话归宿维持 failed、X-15 delivered-未-ack 过期联动 run failed、X-22 recover 非白名单语义）已全部修正入上文（A2/A3/A4/A5/契约表/接口定义对应位置），无 P0/P1 未决项残留 ✓
- ⚠️ 自审存疑 1：A2「补拉只返回 pending、delivered 不重发」以零重复换极小概率丢失（WS 推送成功后 daemon 立即崩溃）——该丢失由恢复链路收敛为中断轮 failed，与 D-001 口径一致，判定可接受；已在设计中显式声明。
- ⚠️ 自审存疑 2：suspend-batch 在 daemon 优雅停止路径调用，若 daemon 被强杀（taskkill/断电）则走 offline sweep 600s→suspended 路径，两条路径都收敛到 suspended ✓ 一致。
- ⚠️ 自审存疑 3：backend lease sweeper 与既有 mission_patrol/session sweeper 并发访问 lease 表——expire_leases 已用 FOR UPDATE + limit 批处理，冲突安全；需用例验证。
- 规模判定：跨三子项目、新增表与状态机、多文件（~25 个源文件）→ scale=large，四件套齐 ✓
