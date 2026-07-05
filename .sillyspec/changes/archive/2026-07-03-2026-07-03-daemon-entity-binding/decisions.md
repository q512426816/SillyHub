---
author: qinyi
created_at: 2026-07-03 10:55:00
change: 2026-07-03-daemon-entity-binding
stage: brainstorm
---

# 决策台账 — 守护进程实体化绑定

本变更的决策记录。每条含稳定版本 ID（D-xxx@vN）。后续 Design Grill 修正时新增 D-xxx@vN+1 并标注 supersedes。

---

## D-001@v1 — daemon 实体身份：本地持久 uuid + 按 server_url 隔离

- type: architecture
- status: accepted
- source: user
- question: 守护进程的稳定身份（daemon_id）怎么建立？同机多实例如何不冲突？
- answer: daemon 本地生成持久 uuid（复用现有 `config.runtime_id`），注册时上报后端作 `daemon_instances.id` 主键。配置文件按连接的后端地址（server_url）隔离（如 `config-<server_hash>.json`），保证 per-server per-machine 唯一；同一 server 同机双开仍是异常用法，后端检测到同一 daemon_local_id 双连接时驱逐旧连接（沿用 ws_hub 现有 replaced 语义）。
- normalized_requirement: daemon 启动读 `~/.sillyhub/daemon/config-<server_hash>.json`（不存在则生成 daemon_local_id 并落盘）；注册请求 body 必含 `daemon_local_id` 与 `server_url`；后端 `daemon_instances` 唯一键 = (user_id, server_url, daemon_local_id)；换 hostname 但 daemon_local_id 不变 → 复用同一 daemon 实体（绑定不断）。
- impacts: [FR-01, task-数据模型, task-daemon注册, task-WS握手]
- evidence: sillyhub-daemon/src/config.ts:40,46（当前固定路径）,74-75,318-322；用户确认「多个连不同后端」场景
- priority: high

---

## D-002@v1 — daemon_runtimes 退化为 daemon×provider 从属表

- type: architecture
- status: accepted
- source: code
- question: 现有 daemon_runtimes（用户×机器×provider 注册）在实体化后怎么定位？
- answer: 保留 daemon_runtimes 表，但语义从「独立绑定对象」退化为「daemon 实体上启用了哪些 provider」的从属清单。加 `daemon_instance_id` FK→daemon_instances（CASCADE）。机器级字段 os/arch/version/allowed_roots/capabilities 从 runtime 提升到 daemon_instances（消除冗余）；runtime 仅保留 provider/provider 级 status/version/last_heartbeat_at。
- normalized_requirement: daemon_runtimes 新增非空列 daemon_instance_id（FK daemon_instances ondelete=CASCADE）；os/arch/allowed_roots/capabilities 列从 daemon_runtimes 移除（迁移到 daemon_instances）；daemon_runtimes.user_id 保留（查询便利，与 daemon_instance.user_id 冗余但一致）。
- impacts: [task-数据模型, task-注册upsert, task-前端徽标]
- evidence: backend/app/modules/daemon/model.py:62-92（os/arch/allowed_roots 冗余在 runtime）
- priority: high

---

## D-003@v1 — lease / change_write 的 runtime_id 引用保留

- type: compatibility
- status: accepted
- source: user
- question: 改成绑 daemon 后，任务执行记录里那种「每种智能体一条」的细粒度记录怎么处理？
- answer: 保留为从属清单（用户确认）。daemon_task_leases.runtime_id 与 daemon_change_writes.runtime_id 的 FK 不动，仍记录「这次任务由哪个 provider 跑」。派发时由 (daemon_id, default_agent) 解析出具体 runtime_id 落入 lease。
- normalized_requirement: daemon_task_leases.runtime_id FK 保留（不动）；daemon_change_writes.runtime_id FK 保留（不动）；不引入 lease.daemon_id 列（daemon_id 经由 runtime 反查）；派发服务解析 runtime_id 后写入 lease 如旧。
- impacts: [task-派发解析, verify-lease不变]
- evidence: backend/app/modules/daemon/model.py:221-228,316-322；用户选「保留为从属清单」
- priority: high

---

## D-004@v1 — workspace 绑定增加 daemon_id 列

- type: architecture
- status: accepted
- source: user
- question: 工作区（per-member）绑定的对象从 runtime_id 改 daemon，表结构怎么改？
- answer: workspace_member_runtimes 新增 `daemon_id` 列（FK daemon_instances ondelete=RESTRICT，nullable 便于过渡），per-member 绑定改存 daemon_id。runtime_id 列保留但改 nullable（不再写入，仅留旧数据快照；后续 task 可清空）。
- normalized_requirement: workspace_member_runtimes 新增 daemon_id（FK daemon_instances, ondelete=RESTRICT, nullable）；PUT /my-binding 写 daemon_id（不再写 runtime_id）；MemberBindingResolver 返回 daemon_id；旧 runtime_id 列保留不写、不删（YAGNI，未来清理）。
- impacts: [task-per-member绑定, task-resolver, task-前端switcher, task-init-lease]
- evidence: backend/app/modules/workspace/member_runtimes/model.py:21-84；collaborative-workspace 表结构复用
- priority: high

---

## D-005@v1 — provider 选择 = workspace.default_agent

- type: boundary
- status: accepted
- source: user
- question: 工作区绑到 daemon 后，daemon 上同时有多个智能体时用哪个？
- answer: 保留 workspace.default_agent（legacy 全局列）作为工作区默认 provider。派发时从该 daemon 在线的 daemon_runtimes 清单里找 provider == default_agent；用户可在 agent 页单次发起时覆盖默认。向后兼容现有 default_agent 字段，改动最小。
- normalized_requirement: workspace.default_agent 列保留；dispatch 解析顺序 = member_binding.daemon_id + workspace.default_agent → 该 daemon 在线 runtime 中 provider 匹配项；default_agent 与该 daemon 已启用 provider 不匹配 → 报错提示（D-008 边界）；单次覆盖经 agent run 发起参数传入。
- impacts: [task-派发解析, task-agent页, verify-default-agent]
- evidence: backend/app/modules/workspace/model.py default_agent 列；用户选「工作区配默认智能体」
- priority: high

---

## D-006@v1 — 注册 / WS Hub / 心跳改 per-daemon

- type: architecture
- status: accepted
- source: user
- question: daemon 与后端的实时通道当前按 runtime_id 维护（一个 daemon N 条 WS），实体化后怎么改？
- answer: 改为 per-daemon：一个 daemon 实体一条 WS。DaemonWsHub._connections 键从 runtime_id 改 daemon_instance_id；WS 握手协议带 daemon_local_id（替代 runtime_id）；心跳单条带 daemon_local_id + 各 provider 状态，后端同时更新 daemon_instances.last_heartbeat_at 与各 daemon_runtimes.status。
- normalized_requirement: ws_hub._connections: dict[daemon_instance_id, WebSocket]；connect/disconnect/send_to_* 全部方法签名改 daemon_id；daemon 侧 _wsClients 从 Map<provider, ws> 收敛为单条 WS；task_available/heartbeat_ack/session_control/permission_response/self_update/rpc 全部按 daemon_id 路由（payload 内带 runtime_id 标识具体 provider 会话）。
- impacts: [task-WS-Hub, task-daemon-ws-client, task-protocol, task-心跳]
- evidence: backend/app/modules/daemon/ws_hub.py:50,61,106（全方法 runtime_id 键）；sillyhub-daemon/src/daemon.ts _wsClients
- priority: high

---

## D-007@v1 — breaking 部署时序 + 数据重置

- type: risk
- status: accepted
- source: user
- question: WS 握手从 runtime_id 改 daemon_id 是 breaking change，兼容策略？
- answer: 守护进程与后端必须同步升级（旧 daemon 连新 backend 握手失败 → 强制升级 daemon）。数据策略倾向重置：项目未上线允许重置（CLAUDE.md 规则10），daemon_runtimes/workspace_member_runtimes 旧数据无 daemon_local_id 线索，迁移脚本推导成本高于重置价值；daemon 升级后重新注册上报 daemon_local_id，用户重绑守护进程。
- normalized_requirement: 发布说明标注「daemon 与 backend 同步升级」；alembic 迁移建 daemon_instances 表 + 加列，不写历史 daemon_local_id（留空）；提供 cleanup 脚本清空 daemon_runtimes + workspace_member_runtimes 旧绑定（可选，默认重置）；保留 workspaces.default_agent 数据（非 daemon 绑定相关，不动）。
- impacts: [task-migration, task-部署文档, verify-升级时序]
- evidence: CLAUDE.md 规则10；memory「daemon-client 架构」「数据可清空」
- priority: medium

---

## D-008@v1 — default_agent 与 daemon provider 不匹配的处理

- type: boundary
- status: accepted
- source: design-grill
- question: 工作区 default_agent=claude，但绑的 daemon 只启用了 codex，派发怎么办？
- answer: 报错提示，不自动 fallback。错误信息明确「该守护进程未启用 <default_agent>，请去守护进程启用或本次指定其他智能体」。理由：自动 fallback 会偏离用户明确配置的默认，造成预期外 provider 执行；显式报错让用户决策。
- normalized_requirement: _resolve_dispatch_runtime 在 daemon_id 的在线 runtimes 中找不到 provider==default_agent 时，抛 NoOnlineDaemonError 变体（message 含 default_agent 与该 daemon 已启用 provider 列表）；不自动选其他 provider；agent 页单次发起可传 provider 覆盖。
- impacts: [task-派发解析, task-agent页, verify-不匹配报错]
- evidence: placement.py:692-700（现有 provider mismatch warn 逻辑改造）
- priority: medium
