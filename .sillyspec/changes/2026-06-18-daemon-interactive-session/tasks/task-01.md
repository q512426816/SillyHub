---
id: task-01
title: 数据模型迁移（agent_sessions 表 + lease.kind + agent_runs.agent_session_id + alembic）
wave: W1
priority: P0
depends_on: []
covers: [FR-01, FR-09, D-001, D-002, D-005]
created_at: 2026-06-18 14:11:24
author: qinyi
---

# task-01 — 数据模型迁移（agent_sessions 表 + lease.kind + agent_runs.agent_session_id + alembic）

> 设计依据：`design.md` §8 数据模型（§8.1 agent_sessions 字段、§8.2 lease.kind、§8.3 agent_runs.agent_session_id、§8.4 三元关系、§8.5 interactive lease 过期语义）、§6 文件变更清单、§9 兼容策略；`plan.md` task-01 行；`decisions.md` D-001~D-002/D-005。

## 目标

新增 `agent_sessions` 表 + `daemon_task_leases.kind` 字段 + `agent_runs.agent_session_id` FK，配套 alembic 迁移，为交互式会话管控奠定数据契约（不改现有 `AgentRun.session_id`，D-001）。

## 前置依赖

无（Wave1 地基任务，`depends_on: []`）。

## 涉及文件

| 操作 | 真实路径 | 说明 |
|---|---|---|
| 修改 | `backend/app/modules/agent/model.py` | 新增 `AgentSession(BaseModel, table=True)` 类；`AgentRun` 加 `agent_session_id` FK 字段（不改现有 `session_id`） |
| 修改 | `backend/app/modules/daemon/model.py` | `DaemonTaskLease` 加 `kind` 字段（默认 `batch`，新增 interactive 取值） |
| 新增 | `backend/migrations/versions/202606180900_create_agent_sessions.py`（命名遵循现有 `YYYYMMDDHHMM_<desc>.py` 格式；与本次变更日期对齐，建议 `down_revision = "202607030900"` 即当前最新 head） | alembic 迁移：建 agent_sessions 表 + 加 lease.kind 列 + 加 agent_runs.agent_session_id 列 + 三类索引 |
| 校对 | `backend/migrations/env.py` | **可选**：确认 daemon model 的 eager import（当前未显式 import，autogenerate 可能扫不到 daemon 表）。本任务采用**手写迁移**而非 autogenerate，故 env.py 不强制改；若后续依赖 autogen 需补 `from app.modules.daemon import model as _daemon_model  # noqa: F401` |

> 现有 daemon model 已通过运行时（router/service import 链）注册到 `BaseModel.metadata`，且 `202606270900_create_daemon_tables.py` 即手写迁移，本任务延续手写风格，避免 autogen 噪声。

## 数据模型细节

### 1. `agent_sessions` 表（design §8.1 完整字段）

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `id` | Uuid PK | NOT NULL | 主键 |
| `user_id` | Uuid | NOT NULL, FK→`users.id` ON DELETE CASCADE | 所属用户 |
| `runtime_id` | Uuid | NULL, FK→`daemon_runtimes.id` ON DELETE CASCADE（design §8.1 标 NULL 可空，与 workspace path_source 语义对齐：daemon 可能下线但 session 记录保留） | 执行该会话的 daemon runtime |
| `lease_id` | Uuid | NULL, FK→`daemon_task_leases.id` ON DELETE SET NULL（D-002 1:1 长生命周期 lease） | 关联 lease |
| `provider` | String(30) | NOT NULL | `claude` / `codex` |
| `status` | String(20) | NOT NULL, server_default `'pending'` | `pending`/`active`/`reconnecting`/`ended`/`failed` |
| `agent_session_id` | String(255) | NULL | agent 内部会话 id（claude session_id / codex thread_id），供 resume；**注意此字段名是数据库列**，与表名 `agent_sessions.id` 区分 |
| `config` | JSON | NULL | `{ manual_approval, model, ... }`（Wave2 用 manual_approval） |
| `turn_count` | Integer | NOT NULL, server_default `0` | 已执行 turn 数 |
| `created_at` | DateTime(tz) | NOT NULL, server_default `now()` | 创建时间（审计字段，与现有 model 风格一致） |
| `last_active_at` | DateTime(tz) | NULL | 最近一次 turn 活跃时间（D-004 空闲回收用） |
| `ended_at` | DateTime(tz) | NULL | 会话结束时间（status=ended/failed 时填） |

> 审计字段（`created_at`/`updated_at`）：现有各 model 在类内自定义（BaseModel 仅共享 metadata，无强制钩子）。本表用 `created_at` + `last_active_at` + `ended_at`（无 `updated_at`，用 `last_active_at` 兼作活跃更新戳，对齐 design §8.1 字段列表）。

### 2. `daemon_task_leases.kind` 字段（design §8.2）

```python
kind: str = Field(
    default="batch",
    sa_column=Column(String(20), nullable=False, server_default=text("batch")),
)
```

- 取值：`batch`（默认，现有批处理，跑完即结束）| `interactive`（交互式会话，长生命周期，多 turn）。
- 现有所有 lease 默认 `batch`，行为不变（design §9 兼容策略）。
- 迁移用 `server_default='batch'` 回填现有行。

### 3. `agent_runs.agent_session_id` FK（design §8.3）

```python
agent_session_id: uuid.UUID | None = Field(
    default=None,
    sa_column=Column(
        Uuid(as_uuid=True),
        ForeignKey("agent_sessions.id", ondelete="SET NULL"),
        nullable=True,
    ),
)
```

- **不改现有 `AgentRun.session_id`（String(128)）**：那是 claude resume id，被 quick-chat-multiturn 在用，术语区分见 D-001。
- 新增 `agent_session_id` 指向本会话聚合实体（D-005 三元关系）。
- 批处理 run 的 `agent_session_id = NULL`（默认）。

### 4. 三元关系（design §8.4 / D-005）

```
daemon_task_leases (kind=interactive)          agent_sessions
   id ────────────────────────────────────────► lease_id    (1:1, session.lease_id)
   agent_run_id = NULL  ◄── interactive 不用     id
                                                   ┌─ agent_session_id (FK) ◄────┐
                                                   │                             │
                                               agent_runs (N)                  │
                                                   agent_session_id ────────────┘  (N:1)
                                                   session_id (保留,claude resume 用)
```

- **interactive lease.agent_run_id = NULL**（不直接关联单个 run，避免与"每 turn 一个 AgentRun"矛盾）；batch lease 保持原 1:1 用法。
- **session ↔ lease 1:1**：`agent_sessions.lease_id` FK→daemon_task_leases。
- **session ↔ runs 1:N**：`agent_runs.agent_session_id` FK→agent_sessions，每 turn 一个 run。

> 本任务**只**建表/字段/约束，不实现"interactive lease.agent_run_id=NULL"的业务逻辑（那是 task-04 placement 的事）；契约层把 FK 留出来即可。

### 5. interactive lease 过期语义（design §8.5）

本任务**不**实现 `lease_expires_at=NULL` 的业务赋值（task-04 创建 interactive lease 时设置）；契约上 `lease_expires_at` 仍是 nullable DateTime，interactive lease 创建时由 service 层显式传 NULL。`handle_lease_expiry` 跳过 interactive（基于 status 路径）的改动属 service 层（task-04/task-06）。

## 实现步骤

1. **定义 `AgentSession` model**（`backend/app/modules/agent/model.py`）：
   - 新增 `class AgentSession(BaseModel, table=True):`，`__tablename__ = "agent_sessions"`；
   - `__table_args__` 含索引（见步骤 5）；
   - 按 §1 字段表逐一定义字段，沿用现有 model 的 `Field(sa_column=Column(...))` 风格、`default_factory=uuid.uuid4` / `default_factory=lambda: datetime.now(UTC)` / `server_default=text(...)` 审计戳模式；
   - FK：`user_id`→`users.id` CASCADE、`runtime_id`→`daemon_runtimes.id` CASCADE（nullable）、`lease_id`→`daemon_task_leases.id` SET NULL（nullable）。
2. **`AgentRun` 加 `agent_session_id`**（同文件）：按 §3 代码片段加字段，放在 `session_id` 字段**之后**并加注释指明两者语义差异（D-001）。
3. **`DaemonTaskLease` 加 `kind`**（`backend/app/modules/daemon/model.py`）：按 §2 代码片段加字段，放在 `status` 字段附近；同步在 `__table_args__` 加索引（见步骤 5）。
4. **手写 alembic 迁移**（`backend/migrations/versions/202606180900_create_agent_sessions.py`）：
   - `revision = "202606180900"`、`down_revision = "202607030900"`（当前 head）、`branch_labels = None`、`depends_on = None`；
   - `upgrade()`：
     - `op.create_table("agent_sessions", ...)` 按 §1 字段表（注意 FK 引用已有表 `users` / `daemon_runtimes` / `daemon_task_leases`）；
     - `op.add_column("daemon_task_leases", sa.Column("kind", sa.String(20), nullable=False, server_default="batch"))`；
     - `op.add_column("agent_runs", sa.Column("agent_session_id", sa.Uuid(as_uuid=True), sa.ForeignKey("agent_sessions.id", ondelete="SET NULL"), nullable=True))`；
   - `downgrade()`：反向 drop（先 drop agent_runs.agent_session_id 列与相关索引 → drop lease.kind 列 → drop agent_sessions 索引 → drop agent_sessions 表），参考 `202606270900_create_daemon_tables.py` 的逆序风格。
5. **索引**（迁移 + model `__table_args__` 双写）：
   - `agent_sessions`：`idx_agent_sessions_user_id` (user_id)、`idx_agent_sessions_runtime_id` (runtime_id)、`idx_agent_sessions_lease_id` (lease_id)、`idx_agent_sessions_status` (status)、`idx_agent_sessions_agent_session_id` (agent_session_id, partial WHERE NOT NULL 供 resume 查找)；
   - `agent_runs.agent_session_id`：`ix_agent_runs_agent_session_id` (agent_session_id, partial WHERE NOT NULL)；
   - `daemon_task_leases.kind`：`idx_daemon_task_leases_kind` (kind) —— 支持 service 层按 kind 过滤调度（task-04 用）。
6. **自检**：跑 `cd backend && uv run alembic upgrade head` → `alembic downgrade -1` → `alembic upgrade head` 确认 up/down 可逆无错。

## 完成标准

- [ ] `agent_sessions` 表创建，字段名/类型/约束 100% 对齐 design §8.1（含 `agent_session_id` String(255) 列、`turn_count` 默认 0、三个时间戳）。
- [ ] `daemon_task_leases.kind` 列存在，`server_default='batch'`，现有行回填为 batch。
- [ ] `agent_runs.agent_session_id` FK 列存在，nullable，批处理 run 为 NULL。
- [ ] **`AgentRun.session_id`（String(128)）字段、语义、值零改动**（D-001 守门，验收时 grep 确认无任何代码改写 session_id 的取值/含义）。
- [ ] alembic `upgrade head` / `downgrade -1` 可逆执行无错。
- [ ] 三元关系 FK 链成立：`agent_sessions.lease_id → daemon_task_leases.id`、`agent_runs.agent_session_id → agent_sessions.id`。
- [ ] 索引齐全（5 个 agent_sessions 索引 + 1 个 agent_runs 索引 + 1 个 lease.kind 索引）。
- [ ] `AgentSession` 继承 `BaseModel`，被 `BaseModel.metadata` 注册（env.py 经运行时 import 链可达；如需 autogen 则补 daemon eager import，见涉及文件表"校对"行）。
- [ ] 现有批处理 lease / workspace agent run 行为零变化（兼容，design §9）：`kind` 默认 batch、`agent_session_id` 默认 NULL、现有端点不受影响。

## 测试要点

- **模型实例化测试**（新增 `backend/app/modules/agent/tests/test_agent_session_model.py`）：
  - `AgentSession(...)` 能实例化，必填字段（user_id、provider）缺失时按预期报错；
  - `AgentRun(agent_session_id=<sid>)` 关联可读回；
  - `DaemonTaskLease(kind='interactive')` / `kind='batch'` 默认值正确。
- **迁移 up/down 测试**：
  - `alembic upgrade head` 后 `\d agent_sessions` 字段齐全、FK 成立、索引存在；
  - `alembic downgrade -1` 干净回滚（表/列/索引全部 drop）；
  - 二次 `upgrade head` 幂等无错。
- **契约守门测试**：`session_id` 列在迁移前后定义不变（diff schema dump）。
- **回归**：现有 `backend/app/modules/agent/tests/*` 与 `backend/app/modules/daemon/tests/*` 全绿（`cd backend && uv run pytest`）。

## 风险/注意

- **数据可清空**（CLAUDE.md 规则 7）：本项目未正式上线，迁移无需保留旧数据兼容，直接 add_column + server_default 回填即可，无需分阶段 online migration。
- **BaseModel 审计钩子**：`BaseModel`（`backend/app/models/base.py`）仅共享 `metadata`，**无** `created_at`/`updated_at` 自动钩子 —— 各 model 自定义时间戳字段。`AgentSession` 沿用现有手写模式（参考 `DaemonRuntime`/`DaemonTaskLease`），不要假设基类自动填审计戳。
- **术语碰撞**（R-05/D-001）：表名 `agent_sessions`、列 `agent_sessions.agent_session_id`（agent 内部会话 id）、FK 列 `agent_runs.agent_session_id`（指向本表）三者在数据库层同名易混。代码注释和迁移注释必须写清三者语义；model 字段顺序把"内部 agent_session_id 列"和"FK"放一起并注释区分。
- **三元关系 FK 方向**（D-005）：interactive lease 不再用 `agent_run_id`（保持 nullable），关系通过 `agent_sessions.lease_id` + `agent_runs.agent_session_id` 表达；**本任务只建 FK，不实现"interactive lease.agent_run_id 留空"的业务约束**（属 task-04 placement），避免 over-engineering。
- **env.py eager import**：当前 `migrations/env.py` 未显式 import daemon model（依赖运行时链注册），autogen 可能漏扫。本任务手写迁移规避；若后续任务依赖 `alembic revision --autogenerate`，需在 env.py 补 daemon import。
- **`agent_session_id` 双义**：数据库里 `agent_sessions.agent_session_id` 是 claude/codex 内部会话 id 的缓存列，而 `agent_runs.agent_session_id` 是指向 `agent_sessions.id` 的 FK —— 两者同名但语义截然不同，迁移与 model 必须明确注释（D-001）。
- **down_revision 选择**：当前 head 为 `202607030900`，如执行本任务期间有其他迁移合入，需先 `alembic heads` 确认；若多 head 需补 merge migration（参考现有 `4d9236aa3abb_merge_heads.py`）。
