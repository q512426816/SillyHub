---
author: qinyi
created_at: 2026-06-18 15:31:03
change: 2026-06-18-daemon-interactive-session
id: task-01
title: "数据模型迁移：agent_sessions、lease.kind、agent_runs.agent_session_id 与 Alembic"
wave: W1
priority: P0
depends_on: []
blocks: [task-02, task-04]
requirement_ids: [FR-01, FR-09]
decision_ids: [D-001@v1, D-002@v2, D-005@v1]
allowed_paths:
  - backend/app/modules/agent/model.py
  - backend/app/modules/daemon/model.py
  - backend/migrations/env.py
  - backend/migrations/versions/202607040900_create_agent_sessions.py
  - backend/tests/modules/agent/test_agent_session_model.py
  - backend/tests/modules/daemon/test_interactive_lease_model.py
  - backend/tests/migrations/test_create_agent_sessions_migration.py
---

# task-01 — 交互式会话数据契约与迁移

> Wave 1 / 数据地基 / 无前置依赖。依据 `plan.md` 的显式 task-01、`design.md` §8-§9、`decisions.md` D-001@v1、D-002@v2、D-005@v1，以及当前 `AgentRun`、`DaemonTaskLease`、Alembic 迁移链真实实现。

## 1. 目标

建立交互式会话的持久化三元关系，同时保持现有批处理执行契约不变：

1. 新增 `AgentSession` / `agent_sessions`，一条记录代表一个跨 turn 会话。
2. `DaemonTaskLease.kind` 区分 `batch` 与 `interactive`，默认和存量均为 `batch`。
3. `AgentRun.agent_session_id` 指向会话聚合实体；每个 turn 仍是一条独立 `AgentRun`。
4. 保留 `AgentRun.session_id` 的既有 agent 内部 resume id 语义，不重命名、不迁移、不复用。
5. 提供可逆 Alembic 迁移，并让 Alembic metadata 显式加载 daemon 表。

本任务只建立数据契约。spawn + resume、session REST、SSE 聚合和生命周期编排分别由后续任务实现。

## 覆盖来源

| 来源 | 要求/决策 | 本任务落实 |
|---|---|---|
| `plan.md` task-01 | Wave 1 数据模型迁移，覆盖 FR-01、FR-09 / D-001@v1、D-002@v2、D-005@v1 | 建立 session/lease/run 数据地基与 batch 兼容默认值 |
| FR-01 | 创建 `agent_sessions`、interactive lease 与首个 AgentRun 的持久化关系 | 新表、`lease.kind`、run 会话 FK；创建业务逻辑留给 task-04 |
| FR-09 | 批处理 lease 和 workspace AgentRun 行为不变 | `kind` 默认/回填 `batch`，run FK 默认 NULL，不改 `AgentRun.session_id` |
| D-001@v1 | 新实体叫 `AgentSession`；FK 叫 `agent_session_id`；旧 `session_id` 保留 | ORM、迁移和守门测试逐项锁定命名与旧字段类型 |
| D-002@v2 | 1 session = 1 长生命周期 lease；1 session = N 个独立 turn/run | lease 唯一关联 + run N:1 FK；不引入跨 turn 进程字段 |
| D-005@v1 | interactive lease 不绑定单一 run，三元关系通过 session 表表达 | 保留 nullable `lease.agent_run_id`，新增 `session.lease_id` 和 `run.agent_session_id` |
| `design.md` §8-§9 | 字段、三元关系、过期语义与 brownfield 兼容 | §4 数据接口、§5 不变量、§6 边界与 §9 验收共同约束 |

## 2. 真实现状与约束

| 位置 | 当前事实 | 本任务约束 |
|---|---|---|
| `backend/app/modules/agent/model.py` | `AgentRun.session_id` 已是 `String(128), nullable=True`，quick-chat 用作 agent resume id；`AgentRun` 尚无会话 FK | 新增字段必须叫 `agent_session_id`，现有 `session_id` 定义保持原样 |
| `backend/app/modules/daemon/model.py` | `DaemonTaskLease.agent_run_id` 可空且 FK→`agent_runs.id`；无 `kind` | batch 保持现有关联；interactive 的 `agent_run_id=NULL` 由 task-04 业务层保证 |
| `backend/migrations/env.py` | eager import 了 agent model，但没有 daemon model | 必须显式 import daemon model，确保 `BaseModel.metadata` 可解析新增跨模块 FK |
| `backend/migrations/versions/202607030900_add_workspace_path_source.py` | 当前迁移链尾 revision 为 `202607030900` | 新迁移使用 revision `202607040900`，执行前再次检查 head；若 head 已变化，先调整 revision/down_revision，禁止制造平行 head |
| `BaseModel` | 只统一 metadata，不提供审计字段 | `AgentSession` 自行声明时间字段，禁止假设基类自动生成 |

## 3. 修改文件

| 操作 | 精确路径 | 改动 |
|---|---|---|
| 修改 | `backend/app/modules/agent/model.py` | 新增 `AgentSession`；为 `AgentRun` 增加 nullable FK `agent_session_id` 和索引 |
| 修改 | `backend/app/modules/daemon/model.py` | 为 `DaemonTaskLease` 增加非空 `kind`，Python/DB 默认均为 `batch`，增加索引 |
| 修改 | `backend/migrations/env.py` | 增加 `from app.modules.daemon import model as _daemon_model  # noqa: F401` |
| 新增 | `backend/migrations/versions/202607040900_create_agent_sessions.py` | 建表、加列、加 FK/索引；提供严格逆序 downgrade |
| 新增 | `backend/tests/modules/agent/test_agent_session_model.py` | `AgentSession` 与 `AgentRun.agent_session_id` 模型契约测试 |
| 新增 | `backend/tests/modules/daemon/test_interactive_lease_model.py` | lease.kind 默认值、列约束与索引测试 |
| 新增 | `backend/tests/migrations/test_create_agent_sessions_migration.py` | 迁移 revision、操作序列与 downgrade 对称性测试 |

不得修改 `schema.py`、service、router、placement、前端或 daemon TypeScript 文件；这些不属于数据模型任务。

## 4. 实现要求与接口定义

### 4.1 `AgentSession`

在 `backend/app/modules/agent/model.py` 定义：

```python
class AgentSession(BaseModel, table=True):
    __tablename__ = "agent_sessions"
```

字段契约：

| 字段 | SQLAlchemy 类型 | NULL/默认 | FK / 语义 |
|---|---|---|---|
| `id` | `Uuid(as_uuid=True)` | NOT NULL；`uuid.uuid4` | PK |
| `user_id` | `Uuid(as_uuid=True)` | NOT NULL | FK→`users.id`, `ondelete="CASCADE"` |
| `runtime_id` | `Uuid(as_uuid=True)` | NULL | FK→`daemon_runtimes.id`, `ondelete="SET NULL"`；runtime 删除不抹掉会话历史 |
| `lease_id` | `Uuid(as_uuid=True)` | NULL | FK→`daemon_task_leases.id`, `ondelete="SET NULL"`；唯一约束保证 session↔lease 最多 1:1 |
| `provider` | `String(30)` | NOT NULL | 当前支持 `claude` / `codex`；本任务不加 DB enum/check |
| `status` | `String(20)` | NOT NULL；Python default + server default `pending` | `pending/active/reconnecting/ended/failed` |
| `agent_session_id` | `String(255)` | NULL | agent 内部 Claude session id / Codex thread id，供后续 resume |
| `config` | `JSON` | NULL | 会话配置，如 `manual_approval`、`model` |
| `turn_count` | `Integer` | NOT NULL；Python default 0 + server default `0` | 已创建/执行 turn 计数，递增逻辑不在本任务 |
| `created_at` | `DateTime(timezone=True)` | NOT NULL；UTC factory + `now()` | 创建时间 |
| `last_active_at` | `DateTime(timezone=True)` | NULL | 最近活动时间 |
| `ended_at` | `DateTime(timezone=True)` | NULL | ended/failed 收口时间 |

索引/唯一性必须同时体现在 ORM `__table_args__` 与迁移：

- `idx_agent_sessions_user_id(user_id)`
- `idx_agent_sessions_runtime_id(runtime_id)`
- `uq_agent_sessions_lease_id(lease_id)`：unique；PostgreSQL 允许多条 NULL，非 NULL lease 只能关联一个 session
- `idx_agent_sessions_status(status)`
- `idx_agent_sessions_agent_session_id(agent_session_id)`，可使用 `WHERE agent_session_id IS NOT NULL`

### 4.2 `AgentRun.agent_session_id`

在现有 `session_id` 后新增：

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

并在 `AgentRun.__table_args__` 新增 `ix_agent_runs_agent_session_id`，可采用 `agent_session_id IS NOT NULL` 的 PostgreSQL partial index。该 FK 表达 session↔runs 1:N。禁止改动现有 `session_id: str | None / String(128)`。

### 4.3 `DaemonTaskLease.kind`

```python
kind: str = Field(
    default="batch",
    sa_column=Column(
        String(20),
        nullable=False,
        default="batch",
        server_default="batch",
    ),
)
```

在 `DaemonTaskLease.__table_args__` 增加 `idx_daemon_task_leases_kind(kind)`。本任务只定义字符串契约：`batch` 与 `interactive`；不引入 enum/check constraint，避免把后续状态演进锁死。

### 4.4 Alembic 迁移

`backend/migrations/versions/202607040900_create_agent_sessions.py`：

```python
revision = "202607040900"
down_revision = "202607030900"
branch_labels = None
depends_on = None
```

`upgrade()` 固定顺序：

1. `op.create_table("agent_sessions", ...)`，列与 FK 完全匹配 §4.1。
2. 创建 `agent_sessions` 的 5 个索引/唯一索引。
3. `op.add_column("daemon_task_leases", kind)`，`nullable=False, server_default="batch"`，使存量行自动回填。
4. 创建 `idx_daemon_task_leases_kind`。
5. `op.add_column("agent_runs", agent_session_id)`，列内 FK→`agent_sessions.id`, `ondelete="SET NULL"`。
6. 创建 `ix_agent_runs_agent_session_id`。

`downgrade()` 必须严格逆序：先删 run 索引/列，再删 lease 索引/列，最后删 session 索引和表。不得触碰 `agent_runs.session_id` 或现有 lease 索引。

## 5. 三元关系不变量

```text
AgentSession.lease_id ──unique──> DaemonTaskLease.id
AgentRun.agent_session_id ──N:1──> AgentSession.id
AgentRun.session_id ─────────────> agent 内部 resume id（旧语义，保持不变）
```

- interactive lease 的 `agent_run_id` 应为 NULL，但这是 task-04 创建/编排逻辑的责任，本任务不加跨字段 DB check。
- batch lease 继续使用现有 `agent_run_id`，`kind` 默认 `batch`，不要求调用方立刻显式传值。
- 一个 session 可有多个按时间顺序创建的 run；本任务不增加“同一时刻最多一个 running run”的 DB 约束，该并发守门属于 task-04/task-06。

## 6. 边界与异常场景

| # | 场景 | 期望 |
|---|---|---|
| 1 | 现有 lease 行在迁移前没有 kind | upgrade 后全部读为 `batch`，列 NOT NULL；批处理调用方不传 kind 仍得到 `batch` |
| 2 | 普通 batch `AgentRun` 未绑定会话 | `agent_session_id=NULL` 合法，旧流程无行为变化 |
| 3 | 同一 session 关联多个 turn run | 多条 `agent_runs.agent_session_id` 可指向同一 session |
| 4 | 两个 session 绑定同一非 NULL lease | 唯一索引拒绝第二条，落实 1 session = 1 lease |
| 5 | session 尚未分配 runtime/lease 或关联对象被删除 | `runtime_id`/`lease_id` 可为 NULL；`SET NULL` 保留会话历史 |
| 6 | session 被删除 | 关联 run 的 `agent_session_id` 变为 NULL；run 历史不级联删除 |
| 7 | agent 内部 id 尚未返回 | `AgentSession.agent_session_id=NULL` 合法，后续 turn 调度必须等待该值，但不由本任务实现 |
| 8 | `config` 未提供或含 provider 特有字段 | NULL 或任意 JSON 合法；本任务不做配置 schema 校验 |
| 9 | downgrade 时存在新增数据 | 先移除依赖列/索引再删表，不因 FK 顺序失败；允许丢弃本变更数据 |
| 10 | 开始实现时 Alembic head 已不再是 `202607030900` | 停止使用写死的 down_revision，重新选顺序 revision；不得提交多 head |

## 7. 非目标

- 不实现 session create/inject/interrupt/end REST 或 service。
- 不实现 interactive lease 创建时 `agent_run_id=NULL`、`lease_expires_at=NULL` 的业务赋值。
- 不实现 spawn、Claude `--resume`、Codex thread resume 或 sessionStore。
- 不实现 session 级 Redis/SSE 聚合。
- 不实现 turn_count、last_active_at、ended_at 的状态更新逻辑。
- 不新增 ORM relationship 属性；后续查询先使用显式 FK，避免本任务扩大加载策略范围。
- 不修改/迁移/重解释 `AgentRun.session_id`。
- 不为 provider/status/kind 增加数据库 enum 或 check constraint。

## 8. TDD 实施顺序

1. **Red — 模型测试**
   - 新建 `test_agent_session_model.py`：断言表名、字段类型/长度/nullability/default/FK/ondelete、lease unique 索引、run FK/索引，以及旧 `AgentRun.session_id` 仍为 `String(128)`。
   - 新建 `test_interactive_lease_model.py`：断言默认 `batch`、kind 为 `String(20)`、NOT NULL、server default 和索引存在。
   - 运行定向测试，确认因字段/类不存在而失败。
2. **Green — ORM 最小实现**
   - 修改两个 model 和 `migrations/env.py`，只实现 §4 契约。
   - 运行上述定向测试至通过。
3. **Red — 迁移测试**
   - 新建 `test_create_agent_sessions_migration.py`，至少断言 revision 链、upgrade/downgrade callable、操作名称/顺序对称；若测试环境可连接 PostgreSQL，再覆盖真实 up/down。
4. **Green — 手写迁移**
   - 按 §4.4 编写 upgrade/downgrade，不使用 autogenerate 产生无关 schema diff。
5. **Refactor/验证**
   - `uv run ruff check` / `uv run ruff format --check` 覆盖本任务 Python 文件。
   - `uv run pytest backend/tests/modules/agent/test_agent_session_model.py backend/tests/modules/daemon/test_interactive_lease_model.py backend/tests/migrations/test_create_agent_sessions_migration.py`（从仓库根执行时按实际 pytest 配置调整路径）。
   - 在可用 PostgreSQL 上执行 `alembic upgrade head → alembic downgrade -1 → alembic upgrade head`；若本机环境不可用，明确记录为环境阻塞，不得声称已验证。
   - 运行 backend 全量 `uv run pytest`，确认 batch 回归。

## 9. 验收标准

| AC | 验收项 | 自动化/证据 |
|---|---|---|
| AC-01 | `AgentSession` 继承 `BaseModel`，表名为 `agent_sessions`，字段与 §4.1 完全一致 | model metadata 测试 |
| AC-02 | session↔lease 的 1:1 由非 NULL lease_id 唯一索引落实；session↔run 为 1:N | 索引/FK metadata 测试；PostgreSQL 约束验证 |
| AC-03 | `AgentRun.agent_session_id` nullable、FK→`agent_sessions.id`、ON DELETE SET NULL | model + migration 测试 |
| AC-04 | `AgentRun.session_id` 仍为 nullable `String(128)`，没有改名或语义迁移 | 守门测试 + diff 审查 |
| AC-05 | `DaemonTaskLease.kind` 为 NOT NULL `String(20)`，Python/DB 默认均为 `batch` | lease model 测试 |
| AC-06 | 迁移把存量 lease 回填为 batch，新增 session/run 关联与全部索引 | PostgreSQL upgrade 后 schema 查询 |
| AC-07 | downgrade 严格逆序且只撤销本任务对象，随后可再次 upgrade | `downgrade -1` / `upgrade head` |
| AC-08 | `backend/migrations/env.py` 显式加载 daemon model，跨模块 FK 可由 metadata 解析 | import/metadata 测试或 autogenerate dry-run |
| AC-09 | batch lease 与未绑定 session 的 AgentRun 可按旧调用方式实例化 | 回归单测 |
| AC-10 | 没有新增 Alembic 平行 head | 实现时执行 `alembic heads`，输出仅一个 head |
| AC-11 | 所有改动严格位于 `allowed_paths`，未提前实现后续 Wave | `git diff --name-only` 审查 |
| AC-12 | backend 定向测试、ruff 和全量 pytest 通过；不可用的外部 DB 验证被明确标注 | 命令输出 |

## 10. 完成定义

- 上述 AC 全部满足，或外部 PostgreSQL 验证有明确、可复现的环境阻塞记录。
- 迁移链基于实现时的真实单 head，不覆盖其他活跃变更的 migration。
- diff 中不存在 `AgentRun.session_id` 改动、业务 service 改动或后续 task 的预实现。
