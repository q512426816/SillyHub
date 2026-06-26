---
author: qinyi
created_at: 2026-06-26 11:36:00
priority: P0
depends_on: []
blocks: [task-09, task-10, task-11]
requirement_ids: [FR-08]
decision_ids: [D-004@v1]
allowed_paths:
  - backend/app/modules/daemon/model.py
  - backend/migrations/versions/<新 migration>.py
---

# task-08 — daemon_change_writes model + alembic migration

Wave 4 / Phase 3（design §5.3, §8）。新增 `daemon_change_writes` 表作为 change-write 任务队列，供 daemon 经 lease-polling 轮询消费（D-004@v1）。task-09（轮询端点）/ task-10（proxy service）/ task-11（daemon handler）依赖本表的 model 与 schema 落地。

## 依据

- design §5.3：daemon 不暴露 HTTP server，change-write 经 lease-polling；任务记录字段 `id/workspace_id/runtime_id/change_key/files/status/claim_token/created_at/completed_at/error`。
- design §8 数据模型：新增 `daemon_change_writes` 表（pending/claimed/done/failed 状态机）。
- D-004@v1 → 覆盖映射 design §12：task-08 落表结构。
- 现有 `backend/app/modules/daemon/model.py:194`（`DaemonTaskLease`）、`backend/migrations/versions/202606270900_create_daemon_tables.py`（create_table + 索引风格参考）。

## implementation

1. **model.py 新增 `DaemonChangeWrite` SQLModel 表**（紧随 `DaemonTaskLease` 之后，同文件）：
   - `__tablename__ = "daemon_change_writes"`。
   - 字段：
     - `id`：UUID PK（`default_factory=uuid.uuid4`），与既有 daemon 表一致。
     - `workspace_id`：UUID FK → `workspaces.id` `ondelete="CASCADE"`，nullable=False。
     - `runtime_id`：UUID FK → `daemon_runtimes.id` `ondelete="CASCADE"`，nullable=False（change-write 必绑在线 runtime，与 lease 可空 runtime 区分）。
     - `change_key`：`String(128)` nullable=False（date+slug+hex，与 `changes.key` 对齐）。
     - `files`：JSON nullable=False（`[{path, content}, ...]`，相对 `changes/<key>/`）。
     - `status`：`String(20)` nullable=False，`server_default=text("pending")`，default `"pending"`。取值 pending/claimed/done/failed（free-form string column，与 `DaemonTaskLease.status` 同风格，免后续加值迁移）。
     - `claim_token`：`String(128)` nullable=True（daemon claim 时下发，回执校验；与 `daemon_task_leases` 无 claim_token 故为本表独有）。
     - `created_at`：`DateTime(timezone=True)` nullable=False `server_default=text("now()")`。
     - `completed_at`：`DateTime(timezone=True)` nullable=True（done/failed 时落）。
     - `error`：`Text` nullable=True（failed 时落错误信息；用 `Text` 而非 `String` 容纳多行 traceback）。
   - `__table_args__` 索引：
     - `Index("idx_daemon_change_writes_runtime_status", "runtime_id", "status")` —— **复合索引**，直接支撑 daemon 轮询查询 `WHERE runtime_id=? AND status='pending'`（FR-08 轮询热路径）。
     - `Index("idx_daemon_change_writes_workspace_id", "workspace_id")` —— 按 workspace 查回执/状态。
     - `Index("idx_daemon_change_writes_status", "status")` —— 单列兜底（超时扫描 failed/pending）。
   - 继承 `BaseModel`、`table=True`，import 复用现有 `JSON/Column/DateTime/ForeignKey/Index/String/Uuid/text` + 新增 `Text`。
2. **alembic migration**（新文件 `backend/migrations/versions/202606261130_create_daemon_change_writes.py`）：
   - `revision = "202606261130"`（**唯一**，YYYYMMDDHHMM 风格，grep 全表无冲突）。
   - `down_revision = "202606251900"`（**当前真实 head**，已 `uv run alembic heads` 核实为唯一 head；防多 head，参考 migration-chain-fragmentation-pattern）。
   - `upgrade()`：`op.create_table("daemon_change_writes", ...)` 列定义与 model 对齐（含 FK / server_default `sa.func.now()`），随后 `op.create_index` 三个索引（复合索引列序 `["runtime_id", "status"]`）。
   - `downgrade()`：逆序 `drop_index` → `drop_table`（可逆）。
   - 列类型与 model 严格一致：`sa.Uuid(as_uuid=True)` / `sa.String(length=...)` / `sa.JSON` / `sa.DateTime(timezone=True)` / `sa.Text`。
3. **model 注册**：`DaemonChangeWrite` 定义在 `daemon/model.py` 即被 `app.models` 导入链 + `migrations/env.py` 的 `target_metadata` 自动拾取（既有 daemon 表同路径，无需改 env）。conftest 建表走 `BaseModel.metadata.create_all` 自动含新表。

## 取舍（design §8 备注的二选一）

design §8 给出「新表」vs「复用 `daemon_task_leases.kind='change-write'`」两案。本 task 选**独立新表**，约束注明：
- lease 表承载 agent-run 执行语义（claim/lease_expires_at/attempt_number/agent_run_id），change-write 是无 agent 的纯文件写 + sync，语义不同；塞进 lease 会逼出大量 nullable 列 + kind 分支判定，污染 lease 生命周期。
- change-write 独有 `change_key/files/claim_token/completed_at/error` 字段，新表更直白；轮询查询（runtime_id+status）走专用复合索引，不与 lease 轮询混索引。
- 代价：多一张表 + 多一条 migration；可接受（轻量表，无高频写）。

## acceptance

- `cd backend && uv run alembic upgrade head` 成功，新表 `daemon_change_writes` + 3 索引落地；`alembic downgrade -1` 可逆且不留残表/残索引。
- `uv run alembic heads` 仍为**单一 head**（=`202606261130`），无多 head。
- model 导入无报错：`uv run python -c "from app.modules.daemon.model import DaemonChangeWrite; print(DaemonChangeWrite.__tablename__)"`。
- `daemon_change_writes` 表出现在 `BaseModel.metadata.tables`（conftest 自动建表覆盖）。
- 轮询查询有索引支撑：`EXPLAIN`（PG）/`EXPLAIN QUERY PLAN`（SQLite）`WHERE runtime_id=? AND status='pending'` 命中 `idx_daemon_change_writes_runtime_status`（集成测断言索引存在即可，不绑死 plan 输出）。

### 执行记录（2026-06-26）

- `model.py` 新增 `DaemonChangeWrite`（10 列：id/workspace_id/runtime_id/change_key/files/status/claim_token/created_at/completed_at/error + 3 索引：复合 `runtime_status`、`workspace_id`、`status`），import 补 `Text`。
- migration `202606261130_create_daemon_change_writes.py`：`revision=202606261130`（grep 确认唯一）、`down_revision=202606251900`（`alembic heads` 核实为唯一 head）；`upgrade` create_table + 3 index，`downgrade` 逆序 drop_index → drop_table。
- 验证：`alembic heads` 单一 head=`202606261130`（无多 head，排除 migration-chain-fragmentation 风险）；model import + `BaseModel.metadata.create_all`（SQLite，完整 metadata 含 workspaces/daemon_runtimes）建 `daemon_change_writes` 表成功（10 列 + 3 索引 + FK 链无误）；ruff/mypy 干净。
- 待 task-14：`alembic upgrade head` 实际跑通——worktree `.venv` 无 `aiosqlite` + 无 PG，`env.py` 用 async engine（`async_engine_from_config`）跑不了 SQLite/PG upgrade；migration DDL 与 model 逐列对照一致 + 参考 `202606270900_create_daemon_tables` 同风格，Docker PG（task-14）环境验证 upgrade/downgrade 可逆。

## verify

```
cd backend
uv run alembic upgrade head
uv run alembic heads                       # 单一 head
uv run alembic downgrade -1 && uv run alembic upgrade head   # 可逆
uv run pytest -k "daemon_change_write or migration"         # 若 task-13 补测则跑
uv run ruff check app/modules/daemon/model.py migrations/versions/202606261130_create_daemon_change_writes.py
```

## constraints

- **revision id 唯一**：`202606261130` 已 grep 全 `migrations/versions/*.py` 无冲突；不撞既有 `2026062*` 系列。
- **down_revision 接真实 head**：`202606251900`（`uv run alembic heads` 当前唯一 head，2026-06-26 核实）。若执行时 head 已变（并行变更合入），须重跑 `alembic heads` 取最新 head 再改 down_revision，禁止盲填。
- **不破坏既有 `daemon_task_leases`**：本 task 仅新增表/索引，不改 lease 表 schema 与既有索引；lease 轮询路径零影响。
- **migration upgrade/downgrade 必须可逆**：downgrade 逆序 drop，不留残。
- **跨方言兼容**（memory backend-test-sqlite-vs-pg）：列类型用 `sa.Uuid`/`sa.JSON`/`sa.Text` 通用类型，复合索引无 PG 专属语法（不用 `postgresql_where`），SQLite/PG 双跑通过。
- 本 task 仅落 model + migration，**不写 service/router/handler**（task-09/10/11 职责）；不在此 task 内补业务测试（task-13 统一）。
