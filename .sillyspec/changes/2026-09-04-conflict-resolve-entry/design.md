---
author: qinyi
created_at: 2026-09-04 21:25:00
scale: large
tier: independent
---

# 设计文档（Design）— 变更中心平台同步处理区（冲突裁决 + ghost 清理）

> v2（2026-09-04）：按 Design Grill（brainstorm-review-2026-09-04-213204）修订——X-04 心跳结果字段改两态清除语义（对象=直写 / 键不出现=置 NULL，register 恒清）、X-05 ghost 闭环证据改引 sync.js:588-624 墓碑链；P2 六项：生命周期表补 register 行、无回报恢复窗 90s→150s、超时 config 化、迁移路径改 backend/migrations/versions/、回显时钟偏差说明、归档引用行号修正。

## 1. 背景

多端使用 sillyspec（本机 + 平台服务器 + 其他机器）后，同步冲突（spec 树版本不匹配 / 进度 base_ts 乐观锁失败）和 ghost 残留（平台有记录、本地目录已不存在）目前只能上机器手敲 CLI 裁决：`sillyspec platform resolve <名> --keep-local|--take-platform` 与 `sillyspec doctor --cleanup-ghosts --confirm`。当前本机就有 6 条未决冲突挂在进度库里阻塞推进（`sillyspec progress show` 红灯）。

数据链路现状（已核实）：
- 冲突/ghost 的**检测源头在 daemon**：`sillyspec-manager.collectStatusOnce()` 跑 `progress show --json`，组装 `sillyspec_status`（含 `pending_conflicts[]`、`ghost_count`），经心跳落 `daemon_instances.sillyspec_status` JSON 列（backend 零改写整包透传），`GET /api/daemon/machines` 透出。
- 工作台「活跃变更总览」卡（2026-09-02-changes-overview-card）已展示这些红灯，但当时明确 Non-goal「不做写操作，卡片只展示与 CLI 指引」。本变更解除这条 Non-goal，把操作收进变更中心页。
- 归档变更 2026-09-02-changes-overview-card/design.md:16（「卡片是门铃，变更中心是操作台」）与 :29（写操作 Non-goal 行）的定位继续成立：本变更是操作台落地。

## 2. 设计目标

1. 变更中心页新增「平台同步」处理区：列出当前机器的未决同步冲突（spec 树 / 进度两类）与 ghost 残留。
2. 冲突行内一键裁决：保本地（keep-local）/ 取平台（take-platform），带危险确认弹窗；活跃变更的冲突加警示但不硬禁（D-003@v1）。
3. ghost 一键清理：daemon 执行 `doctor --cleanup-ghosts --confirm` + `platform sync` 完成平台侧收敛。
4. 执行结果回显：fire-and-forget 下发后，daemon 把命令结果经心跳新字段捎带回平台，页面在心跳周期内（约 15s）显示成功/失败，冲突清单在 sillyspec_status 采集周期内（约 60s）回绿。
5. 权限：机器所有者 + 平台管理员可操作，其他成员只读（D-003@v1）。

## 3. 非目标

- **abort 裁决不上页面**（D-002@v1）：活跃变更误弃风险高，留 CLI。
- 不新建命令队列表、不做离线补拉/ack 重试（D-001@v1：sillyspec 操作必须机器在线，离线排队无意义；沿用机器级 fire-and-forget 先例）。
- 不改 `control_commands` 六类可靠投递通道、不改 run/lease 状态机。
- 不做冲突的 diff 对比视图（两端内容差异明细），弹窗只描述策略后果。
- 不覆盖「变更总览卡」的跨机器监控定位，只把其中 CLI 指引文案改为指向变更中心。

## 4. 拆分判断

单变更不拆：三端改动共享同一对新契约（2 条 WS 消息 + 1 个心跳字段），拆开必然留半成品契约。与两个收尾中的活跃变更（agent-provider-abstraction / provider-pi-onboarding）代码不重叠：它们碰 daemon.ts 的 driver/事件区，本变更碰 `_handleWsMessage` 机器级 case 区、sillyspec-manager、心跳组装，冲突面为零。

## 5. 总体方案

通道选型 = D-001@v1 方案A：复用机器级即时 WS 指令先例（`POST /machines/{id}/sillyspec-update`，backend/app/modules/daemon/router.py:1268-1302 → ws_hub.send_sillyspec_update，ws_hub.py:411-424；daemon 侧直连 case，daemon.ts:5445-5449）。结果回传仿 `sillyspec_update` 升级状态机的「daemon 内存槽 + 心跳捎带 + 终态窗口惰性过期」范式（sillyhub-daemon/src/sillyspec-manager.ts:250/620-634）。

### Phase 1 — Backend 下发通道与结果落库

1. `protocol.py` 新增两条 Server→Daemon 消息常量：`DAEMON_MSG_SILLYSPEC_RESOLVE = "daemon:sillyspec_resolve"`、`DAEMON_MSG_SILLYSPEC_GHOST_CLEANUP = "daemon:sillyspec_ghost_cleanup"`。
2. `ws_hub.py` 新增 `send_sillyspec_resolve(instance_id, change, strategy)` / `send_sillyspec_ghost_cleanup(instance_id)`，照 `send_sillyspec_update` 范式走 `send_to_runtime`（锁内 10s 发送超时，失败/超时逐出连接）。
3. `router.py` 新增两个管理端点（权限同先例：`RuntimeAdminUser`（router.py:466）+ `_get_owned_instance(instance_id, user.id, is_platform_admin=user.is_platform_admin)`，普通用户非本机 → 404 防存在性泄漏）：
   - `POST /daemon/machines/{instance_id}/sillyspec-resolve`，body `{change: str, strategy: "keep_local"|"take_platform"}`；
   - `POST /daemon/machines/{instance_id}/sillyspec-ghost-cleanup`，无 body。
   - `change` 白名单：`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$` 且不含 `..`（防穿越；CLI 侧 `assertSafeChangeName` SEC-05 双保险）。
   - 发送失败 → `DaemonRuntimeOffline` 504（同先例文案与 details）。
4. 心跳回传：`DaemonHeartbeatSillySpecCommandResult` DTO（字段见 §7），`heartbeat_daemon` 新参数；落库语义与 `sillyspec_status` 完全一致的**两态**：对象=整包直写，键不出现=置 NULL 清除（model.py:108-109 注释、runtime/service.py:525-529 同款；daemon 侧无需也不得发送显式 null——X-04 修订）。register 时恒清（service.py:232-235 先例）。`_build_machine_read` 经 `MachineSillySpecCommandResultRead` 在 `GET /machines` 透出。
5. `daemon_instances` 加 `sillyspec_command_result` JSON nullable 列 + alembic 迁移。

### Phase 2 — Daemon 执行与心跳上报

1. `protocol.ts` 加两条 MSG 常量与 payload 类型；`daemon.ts _handleWsMessage` 加两个直连 case（不走 control-dispatcher，与 self_update/cleanup/sillyspec_update 同路径）。
2. `sillyspec-manager.ts` 新增命令执行器：
   - `runResolve(change, strategy)`：`execFile sillyspec ['platform','resolve','--change',<change>, <flag>]`，flag 由 payload `keep_local`/`take_platform` 单点映射为 `--keep-local`/`--take-platform`；cwd 用 `_sillyspecStatusRoot`（claim 观察到的 workspace 主仓根），无根 → 直接记 failed。
   - `runGhostCleanup()`：先 `['doctor','--cleanup-ghosts','--confirm']`（本地 DB 幽灵行翻 archived + 超 7 天空壳归档），再 `['platform','sync']`（上行终态 + 墓碑，平台侧收敛——闭环依据：sync.js:588-624 X1 墓碑链，本地行 status='archived' → 墓碑 POST → 平台 location='deleted'；X-05 修订，此前误引 doctor-diagnostics 注明）。
   - 执行器复用 `runProgressJsonDefault` 形态（execFile 数组参数、windowsHide、结果全收敛不 reject）；超时经新配置键 `sillyspec_command_timeout_sec`（config.ts，仿 `sillyspec_status_interval_sec` 先例），默认 120s（keep-local 内置自动重推 sync 有网络往返，比 30s 采集宽；Grill 裁决：重推为单变更粒度，120s 够用）。
3. 结果内存槽 `_lastCommandResult`（结构见 §7）+ 10 分钟终态窗口惰性过期（`_expireTerminalIfDue` 先例）。窗口内每次心跳携带该字段，过期后键即不出现——backend 两态语义随之置 NULL 清除，daemon 无需显式 null（X-04 修订）。`_sendHeartbeatOnce` 携带，`hub-client.ts heartbeat` 加可选参数。
4. 串行保护：同一时刻仅允许一条 sillyspec 命令在跑（in-flight guard，`_cleanupInFlight` 先例）；忙时新指令立即记 failed（error='another sillyspec command is running'），让页面可见可重试，不排队（Grill 裁决维持：D-001 已拒排队语义 + 单管理员低频场景）。命令执行与 npm 升级链共用同一 in-flight 判定，升级进行中到达的命令同样记 failed busy。

### Phase 3 — 前端操作台

1. `lib/daemon.ts` 加 `triggerMachineSillySpecResolve` / `triggerMachineSillySpecGhostCleanup`；后端 schema 落地后 `pnpm gen:types` 重生成 api-types。
2. 新组件 `components/changes/platform-sync-section.tsx`（原型：prototype-conflict-resolve.html）：
   - 数据链复刻总览卡：`fetchMyBinding(workspaceId).daemon_id` → `useDaemonMachines`（15s 轮询）按 id 匹配 → `machine.sillyspec_status` + `machine.sillyspec_command_result`；无绑定或无 sillyspec_status → 卡片不渲染。
   - 冲突行：类型徽章（spec 树/进度，按 `type`）、变更名、活跃警示（冲突名出现在 `changes[]` 即活跃 → ⚠ 徽标 + 弹窗加重文案，不硬禁）、保本地/取平台按钮（取平台 danger）。
   - ghost 区：`ghost_count` + 清单（`changes[]` 中 `ghost=true` 项，≤50）+ 一键清理 danger 按钮（0 时禁用）。
   - 确认弹窗走 antd `modal.confirm`（`App.useApp()` 实例，`okType:"danger"` 用于取平台/清理），文案按原型 STRATEGY_TEXT；清理弹窗如实说明波及范围（幽灵记录 + 超 7 天空壳目录）。
   - 回显：下发后按钮置「已下发 · 等待机器回报」；`sillyspec_command_result` 的 action/change 与本次下发匹配即认定回报（`executed_at` 为机器本地钟，跨机比较仅作辅助——X-18）→ 成功 toast（行随快照 ≤60-75s 消失）/ 失败红字摘要 + 恢复按钮；150s 无回报恢复可重试（执行上限 120s + 一个心跳周期——X-17；兼容旧 daemon 静默忽略）。
   - 权限 hook `useMachineSyncActionAccess`：`is_platform_admin || machine.owner.user_id === user.id`（仿 `useChangeDeleteAccess`，前端启发式、后端权威）。
3. `changes/page.tsx` 在「解析警告」SectionCard（:708-719）之后、主 tab 之前挂 `<PlatformSyncSection>`；移动端镜像页 `m/workspaces/[id]/changes/page.tsx` 同步挂。
4. `changes-overview-card.tsx` 冲突/ghost 区的 CLI 指引文案改为跳转变更中心（操作单一入口）。

## 6. 文件变更清单

### backend

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/daemon/protocol.py | 新增 2 条 Server→Daemon MSG 常量（SILLYSPEC_RESOLVE / SILLYSPEC_GHOST_CLEANUP） |
| 修改 | backend/app/modules/daemon/ws_hub.py | 新增 send_sillyspec_resolve(change, strategy) / send_sillyspec_ghost_cleanup()，复用 send_to_runtime |
| 修改 | backend/app/modules/daemon/router.py | 2 个 POST 端点 + 请求模型 + 心跳 DTO DaemonHeartbeatSillySpecCommandResult + MachineSillySpecCommandResultRead + _build_machine_read 组装 |
| 修改 | backend/app/modules/daemon/model.py | daemon_instances 加 sillyspec_command_result JSON nullable 列 |
| 新增 | backend/migrations/versions/<rev>_add_sillyspec_command_result.py | 列迁移 |
| 修改 | backend/app/modules/daemon/runtime/service.py | heartbeat_daemon 新参数；对象=整包直写 / 键不出现=置 NULL（两态）；register 恒清 |
| 新增 | backend/app/modules/daemon/tests/test_sillyspec_platform_commands.py | 端点权限（owner/admin/越权 404）、change 白名单、离线 504、心跳结果落库/清除（键不出现=置 NULL） |

心跳字段数据流（producer→consumer）：daemon `sillyspec-manager._lastCommandResult`（producer）→ `daemon.ts _sendHeartbeatOnce` → `hub-client.heartbeat` body 键 `sillyspec_command_result`（对象=整包直写 / 键不出现=置 NULL 清除，两态）→ backend `DaemonHeartbeatSillySpecCommandResult`（router.py）→ `runtime/service.heartbeat_daemon` 写 `daemon_instances.sillyspec_command_result`（consumer 落库；register 恒清）→ `GET /machines` `MachineSillySpecCommandResultRead` → `pnpm gen:types` → 前端 `PlatformSyncSection` 回显（最终 consumer）。

resolve 指令数据流：前端 strategy `"keep_local"`（下划线）→ POST body → ws_hub payload `{change, strategy}` → daemon case 单点映射 `--keep-local`（中划线）→ execFile sillyspec。

### sillyhub-daemon

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | sillyhub-daemon/src/protocol.ts | 2 条 MSG 常量 + SillySpecResolvePayload 类型 + HeartbeatBody.sillyspec_command_result 字段 |
| 修改 | sillyhub-daemon/src/daemon.ts | _handleWsMessage 2 个直连 case（含 in-flight 串行 guard、忙时记 failed）+ 心跳携带结果 |
| 修改 | sillyhub-daemon/src/sillyspec-manager.ts | runResolve / runGhostCleanup（sillyspec_command_timeout_sec 默认 120s execFile）+ _lastCommandResult 槽 + 10min 惰性过期（过期停发键，不发显式 null） |
| 修改 | sillyhub-daemon/src/hub-client.ts | heartbeat 签名加 sillyspecCommandResult 可选参数（对象=携带，省略=清除） |
| 修改 | sillyhub-daemon/src/config.ts | 新配置键 sillyspec_command_timeout_sec（默认 120，仿 sillyspec_status_interval_sec 先例） |
| 新增 | sillyhub-daemon/tests/sillyspec-platform-command.test.ts | case 分发、flag 映射、超时/非零退出/忙拒绝、心跳携带与过期清除 |

### frontend

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | frontend/src/lib/daemon.ts | triggerMachineSillySpecResolve / triggerMachineSillySpecGhostCleanup |
| 重新生成 | frontend/src/lib/api-types.ts + backend/openapi.json | `pnpm gen:types`（后端 schema 先落地） |
| 新增 | frontend/src/components/changes/platform-sync-section.tsx | 平台同步处理区卡片（冲突行 + ghost 区 + 弹窗 + 回显 + 权限） |
| 修改 | frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx | 解析警告卡后挂卡 |
| 修改 | frontend/src/app/m/workspaces/[id]/changes/page.tsx | 移动端镜像挂卡 |
| 修改 | frontend/src/components/workspace/changes-overview-card.tsx | CLI 指引文案 → 跳转变更中心 |

### 文档

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | .sillyspec/docs/multi-agent-platform/modules/backend.md、modules/sillyhub-daemon.md、modules/frontend.md | execute 完成后按惯例加变更索引条目 |

## 7. 接口定义

### REST（backend 新增）

```python
POST /api/daemon/machines/{instance_id}/sillyspec-resolve
  body: { "change": "2026-09-02-changes-overview-card", "strategy": "keep_local" | "take_platform" }
  200: { "sent": true }
  422: change 白名单不过 / strategy 非法
  504: DaemonRuntimeOffline（机器离线）

POST /api/daemon/machines/{instance_id}/sillyspec-ghost-cleanup
  200: { "sent": true } / 504 同上
```

### WS 消息（Server→Daemon，fire-and-forget 无回执）

```json
{ "type": "daemon:sillyspec_resolve", "payload": { "change": "2026-09-02-...", "strategy": "keep_local" } }
{ "type": "daemon:sillyspec_ghost_cleanup", "payload": {} }
```

### 心跳结果字段（Daemon→Backend）

```json
"sillyspec_command_result": {
  "action": "resolve" | "ghost_cleanup",
  "change": "2026-09-02-...",        // 仅 resolve
  "strategy": "keep_local" | "take_platform",  // 仅 resolve
  "state": "success" | "failed",
  "exit_code": 0,
  "error": "执行失败（exit 1）…截断≤200字",
  "executed_at": "2026-09-04T13:20:00+08:00"
}
```
全字段宽松可选（保活通道宁宽勿断，与 DaemonHeartbeatSillySpecStatus 同风格）。携带语义两态：终态窗口内每跳携带对象，过期后键不出现（backend 置 NULL 清除）。daemon 只保留最新一条（latest-wins，见 R-07）。

## 7.5 生命周期契约表

本变更涉及 daemon / heartbeat 关键词，契约表如下。注意：均为机器级命令，**不经** run/lease/control_commands 状态机，无 pending→acked 迁移。

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| dispatch resolve | backend | daemon（WS） | change, strategy | 无（fire-and-forget） |
| dispatch ghost_cleanup | backend | daemon（WS） | — | 无 |
| exec platform resolve | daemon | 本机 sillyspec CLI | --change, --keep-local/--take-platform | 本地冲突标记文件清除；keep-local 自动重推平台、take-platform 导入平台版本 |
| exec doctor cleanup | daemon | 本机 sillyspec CLI | --cleanup-ghosts --confirm | 本地 DB ghost 行 → archived |
| exec platform sync | daemon | 本机 sillyspec CLI | — | 平台侧终态/墓碑收敛 |
| heartbeat command_result | daemon | backend | action, state, executed_at | daemon_instances.sillyspec_command_result 覆盖或清除 |
| heartbeat sillyspec_status | daemon | backend | pending_conflicts, ghost_count | 快照刷新（页面回绿来源） |
| daemon register | daemon | backend | — | sillyspec_command_result 置 NULL（恒清，service.py:232-235 先例） |

表内每个事件均有对应代码任务与测试任务（见 §6 测试文件）；无缺失事件。

## 8. 数据模型

- `daemon_instances` 加列：`sillyspec_command_result JSON NULL`（紧邻 `sillyspec_status`，model.py:124-127 之后）；alembic 迁移仅 ADD COLUMN，无数据回填。
- 无新表、无其他表变更。`daemon_control_commands`、`platform_change_progress`、`changes` 零改动。

## 9. 兼容策略

- **旧 daemon**：`_handleWsMessage` default 分支 warn 后忽略未知类型（daemon.ts:5484 实证）→ 指令无副作用；页面 150s 无回报恢复按钮兜底，不做版本门控（与 sillyspec_update 先例一致；项目未上线，无长期兼容负担）。
- 无 workspace 绑定或 sillyspec_status 缺失 → 前端卡片不渲染，页面行为与现状完全一致。
- 心跳携带语义与 `sillyspec_status` 现状一致的**两态**（X-04 修订，v1 误写三态）：对象=整包直写、键不出现=置 NULL 清除；daemon 重启走 register 恒清，DB 无残留路径。
- `sillyspec_status` / `sillyspec_update` / `control_commands` 三条既有通道零改动。
- 回退路径：前端隐藏卡片即回现状；backend 端点无调用方；daemon case 无消息源。CLI 手工路径始终保留（页面对话框可展示对应命令文案）。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | resolve 与本机另一 sillyspec 进程并发写冲突文件竞态 | P1 | daemon in-flight 串行 guard（忙即拒+回显）；CLI resolve 自身 fail-closed（take-platform 缺 platform_progress 不执行） |
| R-02 | 大仓 keep-local 自动重推 sync 超 120s | P2 | 超时记 failed（timedOut）可重试；保活通道不受影响（execFile 异步不阻塞心跳） |
| R-03 | 旧 daemon 静默忽略指令，用户以为已执行 | P2 | 150s 无回报恢复按钮（执行上限 120s + 一个心跳周期）+ 弹窗文案注明需较新 daemon |
| R-04 | change 名注入（路径穿越/参数注入） | P1 | backend 正则白名单 + 禁 `..`；execFile 数组参数不经 shell；CLI assertSafeChangeName 三重防线 |
| R-05 | take-platform/清理覆盖丢失本地未推改动（破坏性） | P1 | 危险确认弹窗明确写出覆盖方向；活跃变更冲突加警示徽标+加重文案（D-003，不硬禁） |
| R-06 | sillyspec_status 60s 采集周期导致回绿延迟 | P2 | command_result 约 15s 先行回显；文案如实标注 ≤60-75s |
| R-07 | 连续多条命令结果只留最新（latest-wins） | P2 | 每行反馈以下发时刻+action/change 匹配判定，行随快照消失，不依赖历史结果 |
| R-08 | ghost 清理会连带归档「超 7 天空壳」目录（doctor 语义） | P2 | 清理弹窗如实写明波及范围（幽灵记录 + 空.shell 目录） |

## 11. 决策追踪

- **D-001@v1**（通道=机器级即时 WS 指令）：覆盖于 §5 Phase 1/2（消息常量+hub 直发+内存槽心跳回传）、§3 非目标（不建队列表）；支撑 FR-02/FR-03/FR-05。
- **D-002@v1**（范围=冲突裁决+ghost 清理一并）：覆盖于 §2 目标 2/3、§3（abort 不上页面）；支撑 FR-01~FR-04。
- **D-003@v1**（权限=机器所有者+平台管理员，活跃警示不硬禁）：覆盖于 §2 目标 5、§5 Phase 3 权限 hook 与警示徽标、R-05；支撑 FR-04。
- **D-004@v1**（心跳结果字段两态清除语义 + register 恒清，Grill X-04 修订）：覆盖于 §5 Phase 1 第 4 条、Phase 2 第 3 条、§7 携带语义、§7.5 register 行、§9；支撑 FR-05。
- 无未解决决策；无剩余风险外溢。

## 12. 自审

| 检查项 | 结果 |
|---|---|
| 必填章节齐全（背景/目标/非目标/总体方案/文件清单/接口定义/风险登记） | ✅ |
| frontmatter 字段齐全（author/created_at/scale） | ✅ scale=large（19 文件跨三端），tier=independent |
| 生命周期契约表（daemon/heartbeat 关键词触发） | ✅ §7.5，8 事件全覆盖（含 register 恒清行）且声明与 control_commands 状态机无关 |
| 文件清单含数据流标注（新对外字段 sillyspec_command_result / WS payload / 2 端点） | ✅ §6 两条数据流链 |
| 引用全部当前版本决策 D-001~004@v1 | ✅ §11 |
| UI 原型核对（前端组件级变化 ≥ 建议生成级） | ✅ prototype-conflict-resolve.html 已落盘（分段展示步产物） |
| 代码锚点抽查 | ✅ sillyspec-update 先例 router.py:1268-1302 / ws_hub.py:411-424 / daemon.ts:5445-5449 / 状态机先例 sillyspec-manager.ts:250,620-634 / default 忽略 daemon.ts:5484 / CLI resolve index.js:2427-2476、sync.js:1656-1800 / ghost 清理 doctor-diagnostics.js:1018-1170 |
| 跨仓写法 | 不适用（单主仓，无 local.yaml repos 外仓） |

自审存疑 3 项已由 Design Grill（brainstorm-review-2026-09-04-213204）二轮裁决并落 v2：
1. **120s 超时**：够用（keep-local 重推为单变更粒度，sync.js 实证），config 化为 `sillyspec_command_timeout_sec` 默认 120。
2. **忙拒不排队**：维持（D-001 拒排队 + CLEANUP in-flight skip 先例 + 单管理员低频），并补升级链共用 in-flight 判定。
3. **ghost 清理连带 platform sync**：语义安全维持（archived→墓碑是必要闭环，冲突文件跳过 + quick 豁免护栏），证据归属改引 sync.js:588-624（X-05）。
另：X-04 心跳语义修正为两态 + register 恒清（v1 三态表述与 sillyspec_status 现状不符）；X-17 恢复窗 150s；X-18 回显以 action+change 匹配为主；X-06/07 路径与行号已修。
