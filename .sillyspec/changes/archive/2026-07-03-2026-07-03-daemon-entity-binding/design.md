---
author: qinyi
created_at: 2026-07-03 11:00:00
change: 2026-07-03-daemon-entity-binding
stage: brainstorm
---

# Design — 守护进程实体化绑定

## 1. 背景

当前工作区（workspace）的「绑定」指向 `daemon_runtimes.id`，一行 = 一个用户在一台机器上、针对**一种智能体**（claude/codex/...）的注册。一个物理守护进程因同时支持多智能体，会注册出 N 行 runtime。这套模型有三个真问题：

1. **守护进程无稳定身份**。后端无「daemon 实体」概念，物理进程身份靠它注册出的 N 行 runtime 隐式表达，唯一键 `(user_id, provider, hostname)`（`runtime/service.py:139`）。hostname 变 → runtime id 全部重建 → 绑定全断；同机双开 → 互相 upsert 覆盖心跳。
2. **绑定粒度太细**。同一台机器跑 claude+codex，用户得分两次绑（两个 runtime）。直觉上「我连这台机器的守护进程」才对。
3. **智能体维度混进绑定**。「连哪台机器」与「用哪个智能体」本是正交两件事，被 runtime_id 揉成一件。

## 2. 目标 / 非目标

**目标**
- 引入 `daemon_instances` 实体（稳定身份：本地 uuid，按后端地址隔离），`daemon_runtimes` 退化为它的从属清单。
- 工作区 per-member 绑定从 runtime_id 改为 daemon_id（D-004）。
- daemon 注册 / WS Hub / 心跳从 per-runtime 改为 per-daemon（D-006）。
- 派发按 `daemon_id + workspace.default_agent` 解析（D-005）。
- 前端切换器从「选智能体记录」改为「选守护进程」。

**非目标（YAGNI）**
- 不改 agent-detector 探测逻辑（仍扫 PATH，`agent-detector.ts:104-180`）。
- 不引入「一成员绑多 daemon」（沿用 per-member 一行）。
- 不改 lease / daemon_change_writes 的 runtime_id 引用（D-003 保留）。
- 不新增 daemon 端 provider 启停 UI（provider 启用由本机探测决定）。
- 不做 runtime_id→daemon_id 的历史数据迁移脚本（D-007 重置）。

## 3. 整体方案（方案 A · 标准实体化）

```
┌──────────────────────┐ 1:N ┌──────────────────────┐
│  daemon_instances    │←───→│  daemon_runtimes     │
│  （新·守护进程实体）  │     │ （退化为从属清单）    │
│  id=本地uuid上报     │     │  daemon_instance_id   │
│  机器级字段归位       │     │  provider + status    │
└──────────┬───────────┘     └──────────▲───────────┘
           │                            │ FK 保留（D-003）
           │ daemon_id                  │
┌──────────▼───────────┐     ┌──────────┴───────────┐
│ workspace_member_    │     │ daemon_task_leases   │
│ runtimes             │     │ daemon_change_writes │
│  + daemon_id（新列）  │     │ （不动，runtime_id）  │
│  runtime_id→nullable │     └──────────────────────┘
└──────────────────────┘
```

## 4. 数据模型（backend）

### 4.1 新表 `daemon_instances`（新增 model：`DaemonInstance`）

| 列 | 类型 | 说明 |
|---|---|---|
| id | Uuid PK | = daemon 上报的 daemon_local_id（复用 `config.runtime_id`） |
| user_id | Uuid FK→users CASCADE | 注册它的用户 |
| hostname | String(255) | 机器名（展示用） |
| display_alias | String(200) nullable | admin 自定义别名（复用 runtime 现有列） |
| server_url | String(255) | 连接的后端地址（隔离多实例） |
| os / arch / version | String(50) nullable | 机器级（从 runtime 提升） |
| allowed_roots | JSON | 机器级沙箱（从 runtime 提升） |
| capabilities | JSON nullable | 机器级能力 |
| status | String(20) default 'online' | online/offline |
| last_heartbeat_at | DateTime nullable | daemon 级心跳 |
| created_at / updated_at | DateTime | 审计 |

唯一约束：`(user_id, server_url, daemon_local_id)`（通过 daemon_local_id 即 id 主键天然唯一；附加 `(user_id, server_url, hostname)` 索引便于查询）。

### 4.2 `daemon_runtimes` 改造（`DaemonRuntime` model）

- **新增** `daemon_instance_id`：Uuid FK→daemon_instances，ondelete=CASCADE，nullable=False。
- **移除**（迁移到 daemon_instances）：`os`、`arch`、`allowed_roots`、`capabilities`、`version`（version 保留 provider 级二进制版本，不挪）。
- **保留**：`id`、`user_id`（冗余但便于查询，与 daemon_instance.user_id 一致）、`name`、`provider`、`status`、`last_heartbeat_at`。
- **移除** `display_alias`（X-004 澄清：原 runtime 级 provider 别名与 `daemon_instance.display_alias` 机器别名语义碰撞；YAGNI 移除，provider 直接用 provider 名展示）。
- 索引：新增 `idx_daemon_runtimes_instance` on `daemon_instance_id`。

### 4.3 `workspace_member_runtimes` 改造（`WorkspaceMemberRuntime` model）

- **新增** `daemon_id`：Uuid FK→daemon_instances，ondelete=RESTRICT，nullable=True（便于过渡）。
- `runtime_id` 保留列但改 nullable + 不再写入（D-004 旧数据快照，未来清理）。
- 索引：新增 `ix_wmr_daemon` on `daemon_id`（与现有 `ix_wmr_runtime` 并存）。

### 4.4 不动

- `daemon_task_leases.runtime_id` FK（D-003）。
- `daemon_change_writes.runtime_id` FK（D-003）。
- `workspaces.default_agent` / `default_model`（D-005）。

### 4.5 Alembic 迁移

- 新建 `daemon_instances` 表。
- `daemon_runtimes` 加 `daemon_instance_id` 列 + 移除机器级列（downgrade 逆向）。
- `workspace_member_runtimes` 加 `daemon_id` 列。
- **不写历史 daemon_local_id**（D-007 重置）：现有 daemon_runtimes 行的 daemon_instance_id 留空，workspace_member_runtimes.runtime_id 旧值保留但 dispatch 不再读（改读 daemon_id；旧 binding 行 daemon_id 为空 → dispatch 报「未绑定守护进程，请重绑」）。

## 5. 注册与通信

### 5.1 daemon 配置隔离（D-001）

`config.ts` 改：`DEFAULT_CONFIG_PATH` 从固定 `config.json` 改为 `config-<server_hash>.json`，其中 `server_hash = sha256(server_url).slice(0,8)`。`loadConfig()` 接收 server_url 计算 hash 定位文件。每个 daemon 进程按它连接的后端地址用独立配置 → 独立 daemon_local_id。向后兼容：首次升级时若旧 `config.json` 存在，迁移其 daemon_local_id 到新 per-server 文件（保留身份）。

### 5.2 注册流程

daemon 启动（`daemon.ts:821-855` `_registerOne` 重构为 `_registerDaemon`）：
1. `loadConfig(server_url)` → 取 daemon_local_id（缺失则生成 + 落盘）。
2. `agent-detector` 探测可用 provider 列表（不动）。
3. `POST /api/daemon/register`（`hub-client.ts:294-330` register body 改造），body：
   ```
   { daemon_local_id, server_url, hostname, os, arch, allowed_roots,
     providers: [{ provider, version, status }, ...] }
   ```
4. backend `register_runtime`（`runtime/service.py:120-190`）重构为 `register_daemon`：
   - upsert `daemon_instances` by (user_id, server_url, daemon_local_id)：更新 hostname/os/arch/allowed_roots/status/last_heartbeat_at。
   - 对每个 provider upsert `daemon_runtimes` by (daemon_instance_id, provider)：更新 version/status/last_heartbeat_at；删除该 daemon 实例下、本次未上报的 stale runtime（provider 被卸载）。
5. 返回 daemon_instance_id + 各 runtime_id（daemon 侧缓存 runtime_id 用于 WS payload 标识具体 provider 会话）。

### 5.3 WS Hub per-daemon（D-006）

`ws_hub.py` `DaemonWsHub` 改造：
- `_connections: dict[uuid.UUID, WebSocket]` 键从 runtime_id → **daemon_instance_id**。
- 所有方法签名 `runtime_id` → `daemon_id`：`connect/ disconnect/ send_to_runtime/ notify_task_available/ send_wakeup/ send_heartbeat_ack/ send_session_control/ send_permission_response/ send_self_update/ send_rpc/ is_connected/ connected_runtime_ids`（→ connected_daemon_ids）。
- WS 握手端点（`daemon/router.py` ws 端点）：握手 message 从带 runtime_id 改带 daemon_local_id；后端查 daemon_instances.id 注册连接。
- payload 内仍带 runtime_id（标识具体 provider 会话，如 session_control 针对哪个 provider 的 session），但连接路由按 daemon_id。

### 5.4 心跳

daemon 单条心跳（`daemon.ts:1848-1874` 并发心跳收敛为单条）：
```
POST /api/daemon/heartbeat { daemon_local_id, providers: [{provider, status, last_heartbeat_at}] }
```
backend 同时更新 `daemon_instances.last_heartbeat_at` + 各 `daemon_runtimes.status`。stale 判定（`cleanup_stale_runtimes service.py:491-512`）改以 `daemon_instances.last_heartbeat_at` 为准（DEFAULT_RUNTIME_STALE_SECONDS=45s），daemon 实体标 offline 时其下所有 runtime 联动标 offline。

### 5.5 daemon 侧 WS 客户端

`daemon.ts` `_wsClients: Map<provider, ws>` 收敛为单条 `_wsClient: WebSocket`（连 backend Hub 带 daemon_local_id）。WS receive loop 按 message.payload.runtime_id 分发到对应 provider 的 session-manager / task-runner。

## 6. 任务派发（backend `agent/placement.py`）

`_resolve_dispatch_runtime`（placement.py:606-773）改造（D-005 / D-008）：

```
1. workspace_id is None → 不变（_get_online_runtime）
2. per-member binding（MemberBindingResolver）→ 读 binding.daemon_id（不再是 runtime_id）
   2a. daemon_id 为空（旧 binding 未迁移）→ 报「未绑定守护进程，请重绑」
   2b. 查 daemon_instances（在线 + 归属 user）
   2c. 在该 daemon 的 daemon_runtimes 里找 provider == workspace.default_agent 且 status==online
       命中 → 返回该 runtime（lease.runtime_id 落它）
       未命中 → NoOnlineDaemonError(message 含 default_agent + 该 daemon 已启用 provider 列表)（D-008）
3. 无 binding 行 → fallback legacy workspaces.daemon_runtime_id（向后兼容，渐废弃）
```

`_resolve_decide_runtime`（placement.py:805-939）对称改造。`MemberBindingResolver.resolve_member_binding`（`resolver.py:13-29`）返回 daemon_id。provider 单次覆盖：agent run 发起时 provider 参数覆盖 default_agent（`agent/router.py` 发起端点透传）。

**调用方覆盖（X-002 核实）**：`MemberBindingResolver` 当前被 `agent/service.py`（agent run 派发）与 `spec_workspace/router.py`（scan / init lease）共同调用——改 resolver 返回 daemon_id + 解析逻辑后，**两条路径自动覆盖**，无需为 scan/init 单独适配。`_resolve_decide_runtime` 对称改造覆盖 decide 路径。

**change-write 端点（X-003）**：`daemon/change_write_router.py` 的 lease-polling 端点（`/runtimes/{rid}/pending-change-writes` 等）保持 runtime_id 路径参数（D-003 change_write.runtime_id 不动）；创建 change-write 任务时，runtime_id 解析复用派发机制（daemon_id + default_agent → runtime）。WS breaking 不影响 change-write（走 HTTP 轮询，非 WS）。

## 7. 前端

- `workspace-daemon-switcher.tsx:91-115`：下拉数据源从 runtimes 改 daemon_instances（该 user 在线的）；显示 `hostname/display_alias` + 启用 provider 徽标（查该 daemon 的 daemon_runtimes）；选中调 `upsertMyBinding({ daemon_id })`。
- `workspace-binding.ts`：`MemberBindingView` 加 `daemon_id`，`MemberBindingUpsertRequest` 改传 daemon_id。
- 详情页 `workspaces/[id]/page.tsx:465-479`：「默认智能体」SectionCard 独立（从该 daemon 已启用 provider 里选），与守护进程绑定分离展示。
- agent 页 `workspaces/[id]/agent/page.tsx`：发起 agent run 时支持单次 provider 覆盖（D-005）。
- runtimes 相关组件（runtime-session-dialog 等）：适配 daemon×runtime 两层（daemon 为主，runtime 为 provider 槽位）。

## 8. 兼容与迁移（D-007）

- **部署时序**：daemon 与 backend 同步升级。旧 daemon（握手带 runtime_id）连新 backend（期望 daemon_local_id）→ 握手失败 → 日志提示升级 daemon。
- **数据**：倾向重置。alembic 迁移建表 + 加列，旧 daemon_runtimes.daemon_instance_id 留空，旧 workspace_member_runtimes.daemon_id 留空。提供可选 cleanup 脚本清空两表旧数据。daemon 升级后重新注册上报 daemon_local_id，用户重绑守护进程。
- **回退路径**：若新版本出问题，回退 backend + daemon 到旧版，恢复旧 daemon_runtimes 数据（备份），旧 binding（runtime_id）仍可用。workspaces.default_agent 数据全程不动。

## 9. 生命周期契约表

### 9.1 daemon_instance 生命周期

| 事件 | 触发 | 落库变化 | WS |
|---|---|---|---|
| registered | daemon 启动 POST /register | upsert daemon_instances（status=online, last_heartbeat_at=now）+ upsert 各 daemon_runtimes | — |
| heartbeat | daemon 周期 POST /heartbeat（默认 15s） | daemon_instances.last_heartbeat_at=now + 各 runtime.status 更新 | heartbeat_ack 下发 |
| ws_connected | WS 握手带 daemon_local_id | — | _connections[daemon_id]=ws |
| stale | last_heartbeat_at 超 45s（cleanup_stale_runtimes） | daemon_instances.status=offline + 其下所有 runtime.status=offline | 连接驱逐 |
| re_registered | daemon 重启（daemon_local_id 持久） | 复用同一 daemon_instances.id（hostname 变也不换 id） | 新 WS 替换旧（code=4000 replaced） |

必需字段（DTO `DaemonRegisterRequest` / `DaemonHeartbeatRequest`）：`daemon_local_id: str`、`server_url: str`、`providers: list[{provider, version, status}]`、`hostname: str`、`os/arch/allowed_roots`。

### 9.2 daemon_runtime（从属）生命周期

随 daemon_instance 注册而生、随 provider 卸载而删（register 时未上报的 stale runtime 删除）、随 daemon stale 而 status=offline。无独立心跳。

### 9.3 WS 连接生命周期

connect（握手带 daemon_local_id，替换同 daemon_id 旧连接 code=4000）→ active（收发 message，按 payload.runtime_id 分发）→ disconnect（daemon 主动关闭 / send timeout 10s 驱逐 / stale 驱逐）→ cancel_all_pending（取消该连接所有 pending RPC）。

### 9.4 lease / change_write 生命周期（不变）

lease: pending→claimed→completed/expired/cancelled（`daemon_task_leases.status`），runtime_id FK 保留。change_write: pending→claimed→done/failed，runtime_id FK 保留。

## 10. 风险与对策

| 风险 | 对策 |
|---|---|
| WS breaking 导致升级期间 daemon 全离线 | 文档强调同步升级；保留旧 daemon 二进制便于快速回退 |
| per-server config 文件迁移丢 daemon_local_id | 首次升级迁移旧 config.json 的 daemon_local_id 到 per-server 文件（兼容） |
| 同一 server 同机双开仍冲突（异常用法） | 后端检测同 daemon_local_id 双 WS → 驱逐旧连接（沿用 ws_hub replaced 语义）+ warn 日志 |
| WS payload 内 runtime_id 与连接 daemon_id 不一致（脏数据） | WS receive loop 校验 payload.runtime_id 属于 connection.daemon_id，不一致 drop + warn |
| provider 卸载后 lease 找不到 runtime | 派发时实时查 daemon_runtimes，未命中走 D-008 报错路径 |
| daemon_client workspace 的 init lease / scan 路径未适配 | task 显式覆盖 scan/init lease 的 binding 解析（scan-stage-interactive-dispatch 提醒） |

## 11. 验收标准

- daemon 启动注册后，`daemon_instances` 有 1 行、`daemon_runtimes` 有 N 行（N=探测到的 provider 数），均挂同一 daemon_instance_id。
- 换 hostname 重启 daemon → `daemon_instances.id` 不变（复用），workspace 绑定不断。
- 同机连不同后端的两 daemon → 两条 `daemon_instances`（不同 server_url + 不同 daemon_local_id）。
- workspace per-member 绑定改 daemon_id 后，dispatch 按 default_agent 在该 daemon 解析 runtime；default_agent 不匹配时报错（D-008）。
- WS Hub 连接数 = 在线 daemon 实体数（不再 × provider）。
- lease.runtime_id 仍正确记录执行 provider（D-003 不变）。
- backend 测试：daemon/runtime/workspace/agent placement 模块全通过；新增 daemon_instance 注册/心跳/WS 握手用例。
- daemon 测试：注册上报 config 隔离 / per-server daemon_local_id / 单 WS 用例。
- frontend 测试：switcher 选 daemon + default_agent 独立选择器用例。

## 12. 决策引用

D-001 daemon 身份本地 uuid + server_url 隔离 ｜ D-002 daemon_runtimes 退化为从属 ｜ D-003 lease/change_write runtime_id 保留 ｜ D-004 workspace 加 daemon_id 列 ｜ D-005 provider=default_agent ｜ D-006 注册/WS/心跳 per-daemon ｜ D-007 breaking 同步部署 + 重置 ｜ D-008 不匹配报错不 fallback。详见 `decisions.md`。

## 13. 规模预估

~15 task / 5 Phase（数据模型 → 注册通信 → 派发 → 前端 → 兼容部署），跨 backend + frontend + sillyhub-daemon。plan 阶段拆分。

## 14. 文件变更清单

**backend**
- `app/modules/daemon/model.py` — 新增 `DaemonInstance`；改造 `DaemonRuntime`（加 daemon_instance_id、移除机器级字段、移除 display_alias）
- `app/modules/daemon/runtime/service.py` — `register_runtime` 重构为 `register_daemon`（upsert daemon_instances + 各 runtime）；stale cleanup 改以 daemon_instance 心跳为准
- `app/modules/daemon/ws_hub.py` — `_connections` 键 runtime_id→daemon_instance_id；全方法签名改 daemon_id
- `app/modules/daemon/router.py` — register / heartbeat / ws 握手端点改 daemon_local_id
- `app/modules/daemon/protocol.py` — 握手 message 字段改 daemon_local_id
- `app/modules/daemon/change_write_router.py` — 创建 change-write 时 runtime 解析复用派发机制（端点路径参数不变）
- `app/modules/daemon/schema.py` — DaemonRegisterRequest / DaemonHeartbeatRequest DTO 改字段
- `app/modules/workspace/member_runtimes/model.py` — 加 daemon_id 列
- `app/modules/workspace/member_runtimes/resolver.py` — 返回 daemon_id
- `app/modules/workspace/member_runtimes/service.py` — PUT /my-binding 写 daemon_id
- `app/modules/agent/placement.py` — `_resolve_dispatch_runtime` / `_resolve_decide_runtime` 改 daemon_id+default_agent 解析 + D-008 报错
- `app/modules/agent/service.py` + `app/modules/spec_workspace/router.py` — 调用方适配（共享 resolver，自动覆盖）
- `migrations/versions/<新>.py` — 新建 daemon_instances + 加列 + 移除列
- `app/modules/runtime/service.py` — `_resolver_for` 适配 daemon-client（task-16，关联缺陷，详见 §16）

**sillyhub-daemon**
- `src/config.ts` — `DEFAULT_CONFIG_PATH` 改 per-server（`config-<server_hash>.json`）+ 旧 config 迁移
- `src/daemon.ts` — `_registerOne`→`_registerDaemon`；`_wsClients` Map 收敛为单条 WS；心跳合并
- `src/hub-client.ts` — register / heartbeat body 改（daemon_local_id + providers 列表）
- `src/ws-client.ts` — 握手带 daemon_local_id
- `src/protocol.ts` — 握手字段

**frontend**
- `src/components/workspace-daemon-switcher.tsx` — 选 daemon + provider 徽标
- `src/lib/workspace-binding.ts` — MemberBindingView/UpsertRequest 改 daemon_id
- `src/app/(dashboard)/workspaces/[id]/page.tsx` — default_agent 独立选择器
- `src/app/(dashboard)/workspaces/[id]/agent/page.tsx` — 单次 provider 覆盖

## 15. 自审

**step11 自审（10 项全通过）**：需求覆盖（10 确认点）/ Grill 覆盖（D-001~008 全引用）/ 约束一致性（文档驱动+TDD+REST+SQLModel+Alembic+WS Hub 现有模式）/ 真实性（daemon_runtimes/DaemonWsHub._connections/_resolve_dispatch_runtime 来自核实代码，daemon_instances/daemon_id 标注新增）/ YAGNI（非目标 5 条）/ 验收可测 / 兼容回退 / 风险 6 条 / 生命周期契约表 4 实体。

**step12 Design Grill（5 交叉点全 immediately_answered，无 P0/P1 blocker）**：
- X-001 daemon 侧 runtime_id→provider 反查（§5.5 + daemon.ts:599 _registeredRuntimes 已存在）
- X-002 scan/init 共享 MemberBindingResolver（grep 确认 spec_workspace/router.py 调用，§6 补调用方）
- X-003 change-write 端点保持 runtime_id（§6 补）
- X-004 display_alias 移除避免碰撞（§4.2 修正）
- X-005 WS breaking 不影响 lease-polling（§8 已覆盖）

**剩余风险**：WS breaking 部署时序（D-007 文档强调 + 回退路径）；同 server 同机双开仍冲突（异常用法，驱逐+warn）。

## 16. 关联缺陷纳入 — daemon-client 工作区 runtime 进度读取断链（2026-07-03 诊断）

**现象**：daemon-client 工作区前端 `/workspaces/<id>/runtime` 页面长期显示「没有运行时数据」。

**根因**（核实自 `backend/app/modules/runtime/service.py:43-67` `_resolver_for` + `backend/app/core/spec_paths.py:114-151`，容器内复现 `db_path.is_file()=False`）：daemon-client + repo-native 组合下三重路径错位——

1. **root 选错**：`_resolver_for` 维度 A 条件 `strategy != "repo-native"` 不成立（该 workspace `spec_workspaces.strategy = repo-native`），root 落到 `workspace.root_path`（Windows 宿主路径），后端 Linux 容器访问不到。
2. **mode 选错**：维度 B `path_source == "daemon-client"` 触发 `platform_managed=True`（扁平 `.runtime/`），但 repo-native 真实写入是包裹 `.sillyspec/.runtime/`。注释自相矛盾（声称 daemon-client 走 spec_root，条件却用 strategy）。
3. **同步 db 为空**：daemon-client spec sync 同步到 `/data/spec-workspaces/<id>/sillyspec.db` 是 **0 字节**空文件，且位置在根（不在 `.runtime/`）。

→ `get_progress()` 恒返回 None → 前端空。

**与本变更的关系**：**解耦**。本变更是 daemon 身份/WS/派发（写侧），runtime 进度读取是 SQLite 文件读（读侧），技术栈不重叠。纳入本变更是为避免 daemon-client workspace 落地后页面仍割裂；**若 Wave 5 膨胀，task-16 可拆为独立 quick**（改动仅 `runtime/service.py` 一两个方法 + 可能一处 spec sync）。

**修复范围（task-16）**：
- `runtime/service.py:_resolver_for` — daemon-client 时 root 强制走 `spec_root`（`/data/spec-workspaces/<id>/`），忽略 `strategy`；mode 跟随同步目录实际布局。
- 核实 daemon-client-spec-strategy-change（已 commit f11e1770）是否已覆盖 `.runtime/sillyspec.db` 真实内容同步；当前证据是 0 字节，若未覆盖需补 spec sync 把宿主 db 同步到 `/data/spec-workspaces/<id>/.runtime/sillyspec.db`。

**验收补充**：daemon-client + repo-native 工作区的 `/runtime` 页面能读到流水线进度（stages 表非空时正确显示阶段）。
