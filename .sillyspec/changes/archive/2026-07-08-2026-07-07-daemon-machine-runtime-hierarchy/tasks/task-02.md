---
id: task-02
title: service 新增 list_machines/update_machine_alias/_get_owned_instance（覆盖 FR-1,2）
author: WhaleFall
created_at: 2026-07-07 16:30:00
priority: P0
depends_on: [task-01]
blocks: [task-03]
requirement_ids: [FR-1, FR-2]
decision_ids: [D-001, D-002, D-004]
allowed_paths:
  - backend/app/modules/daemon/runtime/service.py
  - backend/app/modules/daemon/service.py
provides: {}
expects_from:
  task-01:
    - contract: DaemonMachineRead
      needs: [runtime_count, online_runtime_count, runtimes, owner, status]
    - contract: DaemonMachineUpdate
      needs: [display_alias]
---

# goal
机器级聚合查询 service 层：支撑 `GET /machines`（JOIN users 的机器级分页/筛选 + 嵌套 runtimes，避免 N+1）与 `PATCH /machines/{id}` 别名 mutation，直写 daemon_instance（0-runtime 机器亦可改）。

# implementation
- `RuntimeService.list_machines(actor_user_id, is_platform_admin, q, status, provider, user_id, limit, offset) -> tuple[list[tuple[DaemonInstance, User|None]], int]`：
  - 进入先调 `cleanup_stale_runtimes()`（与 `/runtimes/page` 一致，保证 stale 已收敛，D-002）。
  - 权限：admin 看全部（admin 传 `user_id` 则按 owner 精确过滤）；普通用户固定追加 `daemon_instance.user_id == actor_user_id`（请求的 `user_id` 忽略），对齐 `list_runtimes_page` 的 `is_platform_admin` 分支模式。
  - WHERE：`q`（max 200）大小写不敏感 ILIKE `%q%` 匹配 `hostname`/`display_alias` + 该机器下任一 runtime `provider`（后者用 EXISTS 子查询，复用 `daemon_runtimes.daemon_instance_id` 索引）；`status` 精确匹配 `instance.status`；`provider` 用 EXISTS 子查询（含某 provider 的机器）。
  - ORDER BY：online 优先（case status=='online'）→ `last_heartbeat_at DESC`（前端 `statusRank`+心拍排序上提到 SQL）；LIMIT/OFFSET 机器级分页。
  - 主查询：`select(DaemonInstance, User).outerjoin(User, instance.user_id==User.id)` + WHERE/ORDER/LIMIT；另跑 `select(func.count())` 取 total。
  - 二次查询（避免 N+1）：取本页 instance_ids，**一次性** `select(DaemonRuntime).where(daemon_instance_id IN (ids)).order_by(provider)`，按 instance 分组挂载。
  - 组装：每 instance 挂其 runtimes（复用 `_runtime_read` 构造 `DaemonRuntimeRead`），派生 `runtime_count`（全部）/`online_runtime_count`（status=='online'）。0-runtime → `runtimes=[]`、计数 0（D-003）。
- `_get_owned_instance(instance_id, actor_user_id, *, is_platform_admin) -> DaemonInstance`：复用 `_get_owned_runtime` 模式——`self._session.get(DaemonInstance, instance_id)`，404 不存在；普通用户且 `instance.user_id != actor` → 403 越权；admin 全局通过。
- `update_machine_alias(instance_id, actor_user_id, *, display_alias, display_alias_set, is_platform_admin) -> DaemonInstance`：经 `_get_owned_instance` 取归属实例；`display_alias_set=False` 不变，显式 null/空白串归一 None（`strip()` 后为空 → None，对齐 `update_runtime` 语义）；直写 `instance.display_alias` + bump `updated_at`；flush/refresh 后返回（调用方再聚合为 `DaemonMachineRead`，不写 runtime）。
- `DaemonService` 薄委托：新增 `list_machines`/`update_machine_alias` 直接 `await self._rt.xxx(...)`，对齐 `list_instances`/`update_runtime` 的 facade 模式（`service.py:210/242`）。

## 验收标准
- `list_machines` 返回 `(items: list[tuple[DaemonInstance, User|None]], total)`，调用方（task-03 router）负责拼装 `DaemonMachineRead`（含 owner + runtimes + 计数）。
- 权限正确：admin 看全部 / admin+user_id 按 owner / 普通用户仅自己（请求 user_id 被忽略）。
- 0-runtime 机器：`runtimes=[]`、`runtime_count=0`、`online_runtime_count=0`。
- 排序正确：online 优先 → 心跳 DESC；`q`/`status`/`provider` 过滤命中。
- `update_machine_alias` 直写 `daemon_instance.display_alias`（不写 runtime），支持「省略不变 / 显式 null+空白清空」语义；0-runtime 机器可改。
- `_get_owned_instance` 越权 403 / 不存在 404，与 `_get_owned_runtime` 行为一致。
- `cd backend && uv run mypy app` 通过；`cd backend && uv run ruff check app/modules/daemon` 无新增告警。

# verify
- `cd backend && uv run mypy app`
- `cd backend && uv run ruff check app/modules/daemon`

# constraints
- 避免 N+1：runtimes 用一次性 `IN (本页 instance_ids)` 查询分组，禁止 per-instance 循环查询。
- runtimes 复用 `_runtime_read` 构造 `DaemonRuntimeRead`，不另造 read 拼装逻辑。
- 不改 `list_instances`/`list_runtimes_page`/`update_runtime` 等既有方法签名与行为（brownfield 不破坏既有契约，FR-8）。
- `cleanup_stale_runtimes()` 复用现有实现，不修改其逻辑（生命周期契约豁免，design §14）。
- 进程内行为 0 改表、0 新事件；不引入用量聚合（D-004：用量走 `/runtimes/usage`）。
