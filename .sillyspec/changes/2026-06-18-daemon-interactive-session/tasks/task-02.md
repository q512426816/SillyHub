---
id: task-02
title: 数据模型迁移（agent_sessions 表 + lease.kind + agent_runs.agent_session_id）
change: 2026-06-18-daemon-interactive-session
wave: W1
priority: P0
estimated_hours: 4
depends_on: []
blocks: [task-05, task-06]
requirement_ids: [FR-01, FR-09]
decision_ids: [D-001@v1, D-002@v3, D-005@v1]
covers: [FR-01, FR-09, D-001@v1, D-002@v3, D-005@v1]
author: qinyi
created_at: 2026-06-18T22:41:08
allowed_paths:
  - backend/app/modules/agent/model.py
  - backend/app/modules/daemon/model.py
  - backend/migrations/env.py
  - backend/migrations/versions/202607040900_add_agent_sessions_and_lease_kind.py
  - backend/app/modules/agent/tests/test_agent_session_model.py
  - backend/app/modules/daemon/tests/test_lease_kind_model.py
---

# task-02 — 数据模型迁移（agent_sessions + lease.kind + agent_runs.agent_session_id）

> 依据：`plan.md` task-02（W1, P0, depends_on=[], blocks=[task-05,task-06]）；`design.md` §8 数据模型（§8.1-§8.5）、§6 文件变更清单；`requirements.md` FR-01 / FR-09；`decisions.md` D-001@v1（命名 AgentSession）、D-002@v3（driver 层与 TaskRunner 并存，kind 隔离）、D-005@v1（session/lease/run 三元关系）。
>
> 本项目未正式上线、数据可清空（CLAUDE.md 规则 7）：迁移用新增表 + 新增字段，无需旧数据兼容 / backfill。

## 1. 目标

为本变更（D-002@v3）铺设数据地基，使后续 task-05（backend REST/service）、task-06（session SSE 聚合）能基于稳定的三元关系（session / lease / run）落地：

1. 新增 `agent_sessions` 表（含 12 个字段），承载交互式会话主实体（D-001@v1 命名）。
2. `daemon_task_leases` 增加 `kind` 字段（`batch` / `interactive`，默认 `batch`），实现两条执行路径隔离（D-002@v3 方案 A 并存，FR-09）。
3. `agent_runs` 增加 `agent_session_id` FK 指向 `agent_sessions.id`，承载 session↔runs 1:N（D-005@v1）；**不改动**现有 `AgentRun.session_id`（claude resume 语义，quick-chat 在用，D-001@v1）。
4. 提供 Alembic 迁移（新增表 + 新增两列），并让 autogenerate 能稳定识别新表。
5. 全部继承 `BaseModel`（共享 metadata，env.py autogenerate 扫描入口）。
6. 不动 batch 路径的任何现有字段 / 端点 / lease 生命周期语义（FR-09）。

## 2. 真实源码基线（已用 Read 确认，非臆造）

| 位置 | 当前事实 | 本任务动作 |
|---|---|---|
| `backend/app/models/base.py:13` | `class BaseModel(SQLModel)` 仅含 `pass`，所有表继承它以共享 metadata | AgentSession 继承 BaseModel；不改 base.py |
| `backend/app/modules/agent/model.py:26` | `AgentRun` 表 `agent_runs`，含 `task_id` / `lease_id` / `session_id`(String 128, nullable, model.py:187) 等；`session_id` 当前是 claude resume 用，**不碰** | 在 AgentRun **新增** `agent_session_id` 字段（Uuid FK agent_sessions.id, ondelete=SET NULL, nullable）；不改 session_id |
| `backend/app/modules/daemon/model.py:98` | `DaemonTaskLease` 表 `daemon_task_leases`，含 `agent_run_id`(model.py:125, FK agent_runs.id ondelete=SET NULL) | 在 DaemonTaskLease **新增** `kind` 字段（String(20), server_default='batch'） |
| `backend/migrations/env.py:20-39` | 静态 import 各 feature module model 以挂载到 BaseModel.metadata；**未显式 import daemon model**（通过 router/service 链间接加载，存在 autogenerate 漏扫风险） | 在 env.py import 块**补** `from app.modules.daemon import model as _daemon_model  # noqa: F401`，确保 autogenerate 识别 agent_sessions / lease.kind |
| `backend/migrations/versions/202607030900_*.py` | 当前 head = `202607030900`（add_workspace_path_source） | 新迁移 `down_revision = "202607030900"`，`revision = "202607040900"` |
| `backend/migrations/versions/202606270900_create_daemon_tables.py` | daemon 表创建迁移，含 `postgresql_where=sa.text("status IN ('claimed','pending')")` partial index 风格 | 新迁移沿用同款风格（sa.Uuid(as_uuid=True)、server_default=sa.func.now()、FK 写在 Column 内） |

调用任何既有方法前用 `rg` / `Read` 二次确认真实签名；本任务不编造 API。

## 3. allowed_paths 与改动边界

执行阶段只能改 frontmatter `allowed_paths` 中列出的六个文件：

| 操作 | 路径 | 责任 |
|---|---|---|
| 修改 | `backend/app/modules/agent/model.py` | 新增 `AgentSession` 类；`AgentRun` 加 `agent_session_id` 字段 + 对应 Index |
| 修改 | `backend/app/modules/daemon/model.py` | `DaemonTaskLease` 加 `kind` 字段 |
| 修改 | `backend/migrations/env.py` | import 块补 daemon model（解决 autogenerate 漏扫） |
| 新增 | `backend/migrations/versions/202607040900_add_agent_sessions_and_lease_kind.py` | create_table agent_sessions + add_column lease.kind + add_column agent_runs.agent_session_id |
| 新增 | `backend/app/modules/agent/tests/test_agent_session_model.py` | AgentSession / AgentRun.agent_session_id 模型单测 |
| 新增 | `backend/app/modules/daemon/tests/test_lease_kind_model.py` | DaemonTaskLease.kind 模型单测 |

若实现需要改 router / service / placement / protocol / SSE / 前端 / 现有 AgentRun 其他字段，立即停止并回到对应 task（task-03 协议 / task-05 REST / task-06 SSE）；不得扩大本任务范围。

## 4. 覆盖来源映射

| 来源 | 条款 | 本任务落点 |
|---|---|---|
| FR-01 | "创建 agent_sessions(status=pending) + kind=interactive DaemonTaskLease(lease_expires_at=NULL) + 首个 AgentRun" | §5 表结构定义、§6 边界 B2（interactive lease_expires_at 由 service 写 NULL，本任务只提供可空字段） |
| FR-09 | "现有批处理 lease kind=batch 走 TaskRunner 零变化" | lease.kind 默认 batch；不删/不改任何 batch 字段；§6 边界 B1 |
| D-001@v1 | 新实体命名 AgentSession；agent 内部会话 id 存 `agent_sessions.agent_session_id`；AgentRun FK 字段名必须 `agent_session_id`，不得复用 `session_id` | §5.1 / §5.3 字段命名 |
| D-002@v3 | driver 层与 TaskRunner 并存，kind 隔离两条路径 | lease.kind（batch/interactive） |
| D-005@v1 | interactive lease.agent_run_id=NULL；session↔lease 1:1（session.lease_id）；session↔runs 1:N（run.agent_session_id）；interactive lease 不设 lease_expires_at | §5.1 lease_id FK；§5.3 agent_session_id FK；§6 边界 B2/B3/B4 |

## 5. 实现要求（搬砖级字段定义）

### 5.1 AgentSession 表（新增，`backend/app/modules/agent/model.py`）

继承 `BaseModel, table=True`，`__tablename__ = "agent_sessions"`。字段（与 design.md §8.1 逐字对齐）：

| # | 字段名 | Python 类型 | SQL 列 | 约束 / 默认 | 语义 |
|---|---|---|---|---|---|
| 1 | `id` | `uuid.UUID` | `Uuid(as_uuid=True)` | primary_key, nullable=False, default_factory=uuid.uuid4 | 主键 |
| 2 | `user_id` | `uuid.UUID` | `Uuid(as_uuid=True)` | FK `users.id` ondelete=CASCADE, nullable=False | 归属用户 |
| 3 | `runtime_id` | `uuid.UUID \| None` | `Uuid(as_uuid=True)` | FK `daemon_runtimes.id` ondelete=CASCADE, nullable=True, default=None | 执行该会话的 daemon（spike H1 系统 claude 所在 runtime） |
| 4 | `lease_id` | `uuid.UUID \| None` | `Uuid(as_uuid=True)` | FK `daemon_task_leases.id` ondelete=CASCADE, nullable=True, default=None | 1:1 长生命周期 lease（D-002@v3，D-005） |
| 5 | `provider` | `str` | `String(30)` | nullable=False | claude（codex 后续） |
| 6 | `status` | `str` | `String(20)` | nullable=False, default="pending" | pending/active/reconnecting/ended/failed |
| 7 | `agent_session_id` | `str \| None` | `String(255)` | nullable=True, default=None | **SDK session_id**（query 返回，resume 用，spike D3；不是 AgentRun.session_id） |
| 8 | `config` | `dict \| None` | `JSON` | nullable=True, default=None | { manual_approval, model, ... } |
| 9 | `turn_count` | `int` | `Integer` | nullable=False, default=0 | 已完成 turn 计数 |
| 10 | `cwd` | `str \| None` | `String` | nullable=True, default=None | SessionManager 固定工作目录（resume 按 cwd 分目录，spike D3，R-cwd） |
| 11 | `created_at` | `datetime` | `DateTime(timezone=True)` | nullable=False, default_factory=`lambda: datetime.now(UTC)`, server_default=`text("now()")` | 创建时间 |
| 12 | `last_active_at` | `datetime` | `DateTime(timezone=True)` | nullable=True, default=None | 最近活动（D-004 空闲 30min 扫描用，本任务只建字段，扫描逻辑在 task-07） |
| 13 | `ended_at` | `datetime` | `DateTime(timezone=True)` | nullable=True, default=None | 结束时间（service.end_session 写，task-05） |

`__table_args__` 索引（与现有表风格一致，Index）：
- `Index("ix_agent_sessions_user_id", "user_id")`
- `Index("ix_agent_sessions_runtime_id", "runtime_id")`
- `Index("ix_agent_sessions_status", "status")`（支持前端按状态筛 active 列表）
- `Index("ix_agent_sessions_lease_id", "lease_id")`（1:1 查找）

### 5.2 DaemonTaskLease.kind（修改，`backend/app/modules/daemon/model.py:98` 类内）

在 `agent_run_id` 字段后、`status` 字段前插入（或紧邻 agent_run_id，保持字段聚集）：

```python
kind: str = Field(
    default="batch",
    sa_column=Column(
        String(20),
        nullable=False,
        server_default=text("batch"),
    ),
)
# batch: 现有批处理 | interactive: 交互式会话（长生命周期，SDK driver，D-002@v3）
```

- `server_default="batch"` 保证迁移后存量 lease 行默认 batch（本项目可清空，但保留 server_default 符合 brownfield 友好）。
- 不改 `agent_run_id` 的 ondelete=SET NULL 语义（D-005 要求 interactive lease.agent_run_id=NULL 由 service 写，本任务不强制 DB 约束为 NULL，仅字段可空）。
- 不改 status / lease_expires_at / 其他字段。

### 5.3 AgentRun.agent_session_id（修改，`backend/app/modules/agent/model.py` AgentRun 类内）

在 `session_id` 字段（model.py:187）**之后**新增（避免改动现有 session_id 行，降低 diff 噪声）：

```python
agent_session_id: uuid.UUID | None = Field(
    default=None,
    sa_column=Column(
        Uuid(as_uuid=True),
        ForeignKey("agent_sessions.id", ondelete="SET NULL"),
        nullable=True,
    ),
)
# 指向本交互式会话聚合（D-005 session↔runs 1:N）。
# 现有 session_id 保留 claude resume 语义，不改动（D-001@v1）。
```

在 `__table_args__` 追加索引：
- `Index("ix_agent_runs_agent_session_id", "agent_session_id")`（支持按 session 聚合多 turn 的 run 列表，task-06 SSE / task-12 历史回看用）

### 5.4 Alembic 迁移（新增）

文件名 `202607040900_add_agent_sessions_and_lease_kind.py`，revision=`202607040900`，down_revision=`202607030900`。

`upgrade()` 顺序（先建表后加列，因为 agent_runs.agent_session_id FK 指向 agent_sessions）：

1. `op.create_table("agent_sessions", ...)`：13 列（见 §5.1），与 `202606270900_create_daemon_tables.py` 同款列定义（`sa.Uuid(as_uuid=True)`、`sa.ForeignKey(...)`、`server_default=sa.func.now()`）。
2. 4 个 `op.create_index(...)`（§5.1 索引列表）。
3. `op.add_column("daemon_task_leases", sa.Column("kind", sa.String(20), nullable=False, server_default="batch"))`。
4. `op.add_column("agent_runs", sa.Column("agent_session_id", sa.Uuid(as_uuid=True), sa.ForeignKey("agent_sessions.id", ondelete="SET NULL"), nullable=True))`。
5. `op.create_index("ix_agent_runs_agent_session_id", "agent_runs", ["agent_session_id"])`。

`downgrade()` 逆序：drop index → drop column agent_session_id → drop column kind → drop agent_sessions 索引 → drop table。

迁移文件 docstring 必须引用本变更号 + D-001@v1 / D-002@v3 / D-005@v1 + FR-01/FR-09，便于审计追溯。

### 5.5 env.py import 补丁

`backend/migrations/env.py` import 块（第 20-39 行）追加：

```python
from app.modules.daemon import model as _daemon_model  # noqa: F401
```

理由：当前 env.py 未静态 import daemon model，autogenerate 可能漏扫 DaemonTaskLease 变更（历史依赖 router 链间接加载，脆弱）。本任务新增 AgentSession 必须被 autogenerate 识别，故补显式 import。

## 6. 接口定义（表字段完整契约 — 搬砖级）

> 以下为下游 task-05/task-06/task-07 可直接依赖的字段契约，字段名、类型、nullable、默认值逐字锁定。

### 6.1 agent_sessions

```python
class AgentSession(BaseModel, table=True):
    __tablename__ = "agent_sessions"
    __table_args__ = (
        Index("ix_agent_sessions_user_id", "user_id"),
        Index("ix_agent_sessions_runtime_id", "runtime_id"),
        Index("ix_agent_sessions_status", "status"),
        Index("ix_agent_sessions_lease_id", "lease_id"),
    )
    id: uuid.UUID = Field(default_factory=uuid.uuid4, sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False))
    user_id: uuid.UUID = Field(sa_column=Column(Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False))
    runtime_id: uuid.UUID | None = Field(default=None, sa_column=Column(Uuid(as_uuid=True), ForeignKey("daemon_runtimes.id", ondelete="CASCADE"), nullable=True))
    lease_id: uuid.UUID | None = Field(default=None, sa_column=Column(Uuid(as_uuid=True), ForeignKey("daemon_task_leases.id", ondelete="CASCADE"), nullable=True))
    provider: str = Field(sa_column=Column(String(30), nullable=False))
    status: str = Field(default="pending", sa_column=Column(String(20), nullable=False, default="pending"))
    agent_session_id: str | None = Field(default=None, sa_column=Column(String(255), nullable=True))
    config: dict | None = Field(default=None, sa_column=Column(JSON, nullable=True))
    turn_count: int = Field(default=0, sa_column=Column(Integer, nullable=False, default=0))
    cwd: str | None = Field(default=None, sa_column=Column(String, nullable=True))
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC), sa_column=Column(DateTime(timezone=True), nullable=False, server_default=text("now()")))
    last_active_at: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True), nullable=True))
    ended_at: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True), nullable=True))
```

### 6.2 daemon_task_leases.kind

```python
kind: str = Field(default="batch", sa_column=Column(String(20), nullable=False, server_default=text("batch")))
```

### 6.3 agent_runs.agent_session_id

```python
agent_session_id: uuid.UUID | None = Field(
    default=None,
    sa_column=Column(Uuid(as_uuid=True), ForeignKey("agent_sessions.id", ondelete="SET NULL"), nullable=True),
)
```

### 6.4 三元关系不变式（D-005@v1，DB 层约束 + service 层共同保证）

| 关系 | 约束来源 | 本任务提供 |
|---|---|---|
| session ↔ lease 1:1 | `agent_sessions.lease_id` FK | 字段 + 索引（唯一性由 service 写入控制，不在 DB 加 unique，避免与 lease 可空冲突） |
| session ↔ runs 1:N | `agent_runs.agent_session_id` FK | 字段 + 索引 + ondelete=SET NULL |
| interactive lease.agent_run_id = NULL | service 层写 NULL（D-005） | lease.agent_run_id 仍可空（现状），本任务不加 CHECK 约束（batch lease 仍用 1:1） |
| interactive lease.lease_expires_at = NULL | service 层写 NULL（D-005，D-004 扫描不回收） | 字段已可空（现状），不新增约束 |

## 7. 边界处理（≥5）

| 编号 | 场景 | 契约期望 | 归属 |
|---|---|---|---|
| B1 | 存量 / 新建 batch lease 行 | `kind` 默认 `batch`（server_default），不进 interactive 路径，TaskRunner 零改动（FR-09） | 本任务（server_default + 默认值） |
| B2 | interactive lease 与 `lease_expires_at` | 字段可空；interactive 由 service 写 `lease_expires_at=NULL`，`handle_lease_expiry` partial index `status IN ('claimed','pending')` 自然不回收 NULL（D-005, D-004）。本任务不动 partial index | 本任务（字段可空）+ task-05（写 NULL） |
| B3 | `AgentRun.agent_session_id` 为 NULL | 合法：batch run（task lease）无 session 归属；现有 quick-chat resume run 也无 agent_session_id | 本任务（nullable=True） |
| B4 | `AgentSession.agent_session_id`（SDK session_id）为 NULL | 合法：session 创建时 SDK 尚未返回 session_id；首 turn result 后由 driver 回填（spike D3） | 本任务（nullable=True）+ task-04（回填） |
| B5 | 删除 AgentSession（ondelete 级联） | `agent_sessions.lease_id` / `runtime_id` / `user_id` 均 CASCADE（会话归属实体删除时清理）；`agent_runs.agent_session_id` FK ondelete=**SET NULL**（run 不随 session 删除而删，保留历史 run 记录，D-005） | 本任务（FK ondelete 精确设置） |
| B6 | AgentRun.session_id（claude resume）与 agent_session_id 共存 | 两者语义独立，可同时非空：session_id=SDK 内部 resume id（quick-chat 用），agent_session_id=平台会话聚合 FK。本任务**不改** session_id（D-001@v1） | 本任务（仅新增 agent_session_id） |
| B7 | autogenerate 漏扫 AgentSession | env.py 未静态 import daemon model（历史隐患）；新增 AgentSession 在 agent/model.py 已被 import，但 lease.kind 在 daemon/model.py 需补 import 才稳定识别 | 本任务（env.py 补 `_daemon_model` import） |
| B8 | 迁移在已有 daemon_task_leases 存量行上 add column kind NOT NULL | server_default='batch' 保证 add_column 不失败（PostgreSQL 用 DEFAULT 填充存量行） | 本任务（server_default） |
| B9 | 重复 down_revision 导致多 head | 当前 head=`202607030900`，新迁移 down_revision 必须精确指向它；若 task-02 与其他变更并行产生新迁移，需先 `alembic merge` 再下发 | 本任务（down_revision 校验） |
| B10 | 反向迁移（downgrade）顺序 | 先 drop agent_runs.agent_session_id（FK 依赖 agent_sessions）→ drop lease.kind → drop agent_sessions；顺序错误会因 FK 存在导致 drop table 失败 | 本任务（downgrade 逆序） |

## 8. 非目标

- 不实现 AgentSession 的任何 CRUD / service / REST 端点（task-05）。
- 不实现 session 级 Redis channel / SSE 聚合 / stream_session_logs（task-06）。
- 不实现 lease.kind 分流逻辑 / handle_lease_expiry 改动 / SessionManager（task-04/task-07）。
- 不实现 interactive lease_expires_at=NULL 的写入逻辑（service 层，task-05）。
- 不实现 agent_sessions.status 状态机迁移（service 层，task-05/task-07）。
- 不修改 AgentRun 现有 `session_id` 字段（D-001@v1，保留 claude resume 语义）。
- 不修改任何现有批处理 lease 字段 / 端点 / TaskRunner（FR-09）。
- 不为 AgentSession 加 DB 级 unique(lease_id)（避免 batch lease 可空冲突，唯一性由 service 保证）。
- 不加 CHECK 约束强制 interactive lease.agent_run_id IS NULL（D-005 由 service 写，DB 层不强约束）。
- 不写 backfill 脚本（本项目可清空数据，CLAUDE.md 规则 7）。

## 9. 参考

- design.md §8（§8.1 agent_sessions / §8.2 lease.kind / §8.3 agent_runs.agent_session_id / §8.4 三元关系 / §8.5 interactive lease 过期语义）
- design.md §6 文件变更清单（agent/model.py 新增、daemon/model.py 修改、alembic 迁移新增）
- decisions.md D-001@v1（命名）、D-002@v3（kind 隔离并存）、D-005@v1（三元 + lease.agent_run_id=NULL）
- requirements.md FR-01（创建会话）、FR-09（批处理兼容）
- 现有表结构范本：`backend/app/modules/daemon/model.py` DaemonRuntime / DaemonTaskLease；`backend/app/modules/agent/model.py` AgentRun
- 迁移风格范本：`backend/migrations/versions/202606270900_create_daemon_tables.py`、`202607030900_add_workspace_path_source.py`
- env.py autogenerate 入口：`backend/migrations/env.py:20-49`

## 10. TDD 实施顺序

### Red

1. 新增 `backend/app/modules/agent/tests/test_agent_session_model.py`：
   - 断言 `AgentSession.__tablename__ == "agent_sessions"`；
   - 断言全部 13 个字段名存在于 `AgentSession.model_fields`（id/user_id/runtime_id/lease_id/provider/status/agent_session_id/config/turn_count/cwd/created_at/last_active_at/ended_at）；
   - 断言 `agent_session_id` 与 `session_id` 是不同字段（防止误改名碰撞，D-001@v1）；
   - 构造 `AgentSession(user_id=<uuid>, provider="claude")` 验证默认 status="pending"、turn_count=0、agent_session_id=None、lease_id=None；
   - 断言 `AgentRun` 含 `agent_session_id` 字段且默认 None、nullable；
   - 断言 `AgentRun.session_id` 字段仍存在（未删除）。
2. 新增 `backend/app/modules/daemon/tests/test_lease_kind_model.py`：
   - 断言 `DaemonTaskLease` 含 `kind` 字段，默认值 "batch"；
   - 构造 `DaemonTaskLease()` 验证 kind="batch"；
   - 构造 `DaemonTaskLease(kind="interactive")` 验证可设。
3. 运行定向 pytest，确认因类 / 字段 / 迁移未实现而失败（ImportError / AttributeError / 表不存在）。

### Green

4. 在 `backend/app/modules/agent/model.py` 新增 `AgentSession` 类（§5.1 字段逐字）+ `AgentRun.agent_session_id` 字段（§5.3）+ 索引。
5. 在 `backend/app/modules/daemon/model.py` `DaemonTaskLease` 加 `kind` 字段（§5.2）。
6. 在 `backend/migrations/env.py` import 块补 `_daemon_model`（§5.5）。
7. 新增迁移文件 `202607040900_add_agent_sessions_and_lease_kind.py`（§5.4）。
8. 运行定向 pytest 直至通过。

### Refactor / 回归

9. 运行迁移与 autogenerate 校验：

```powershell
Set-Location backend
uv run alembic upgrade head
uv run alembic check        # 期望：无 pending diff（model 与 DB 一致）
uv run pytest app/modules/agent/tests/test_agent_session_model.py
uv run pytest app/modules/daemon/tests/test_lease_kind_model.py
```

10. 若 `alembic check` 报 pending diff，说明 model 与迁移不一致，必须修齐再继续（不得用 `--sql` 绕过）。
11. 回归现有 agent / daemon 模块测试，确认未破坏 batch 路径：

```powershell
uv run pytest app/modules/agent app/modules/daemon
```

## 11. 验收表

| ID | 验收条件 | 自动化证据 |
|---|---|---|
| AC-02-01 | `agent_sessions` 表存在，13 字段名/类型/nullable 与 §5.1 逐字一致 | test_agent_session_model.py 字段断言 + `alembic upgrade head` 成功 |
| AC-02-02 | `agent_sessions.agent_session_id` 为 String(255) nullable，语义=SDK session_id（非 AgentRun.session_id） | 字段类型断言 + 注释审查 |
| AC-02-03 | `AgentRun.agent_session_id` 为 Uuid FK agent_sessions.id ondelete=SET NULL nullable；现有 `session_id` 未改动 | model 单测 + `git diff` 仅新增未删除 session_id |
| AC-02-04 | `DaemonTaskLease.kind` 为 String(20) NOT NULL server_default='batch' | test_lease_kind_model.py + 迁移 server_default |
| AC-02-05 | 三元关系字段齐备：session.lease_id FK + run.agent_session_id FK；FK ondelete 符合 §6.4（lease/runtime/user CASCADE，agent_session_id SET NULL） | 迁移 DDL 审查 + `alembic check` |
| AC-02-06 | env.py 静态 import daemon model，autogenerate 识别 AgentSession 与 lease.kind | `alembic check` 无 pending diff |
| AC-02-07 | 迁移 down_revision=202607030900 无多 head；downgrade 可逆且顺序正确（先 drop FK 列再 drop table） | `alembic downgrade -1` + `alembic upgrade head` 往返 |
| AC-02-08 | 现有 batch lease / AgentRun / quick-chat 测试零回归 | `uv run pytest app/modules/agent app/modules/daemon` 全绿 |
| AC-02-09 | 未修改 allowed_paths 外文件 | `git diff --name-only` 仅含 6 个 allowed path |
| AC-02-10 | 未实现 service / REST / SSE / SessionManager / 状态机（仅数据模型 + 迁移） | diff 审查无 router/service/placement/protocol/SSE 改动 |

## 12. 下游接口约束

- **task-05**（backend REST/service）：依赖 `AgentSession` 类做 `create_session` / `end_session`；依赖 `lease.kind` 区分 interactive lease 写 `lease_expires_at=NULL`；依赖 `agent_runs.agent_session_id` 在 inject 时为新 AgentRun 写归属。
- **task-06**（session SSE）：依赖 `agent_runs.agent_session_id` 查询某 session 下所有 run，做 session 级 Redis channel 聚合（D-005）；`ix_agent_runs_agent_session_id` 索引支撑聚合查询。
- task-07（空闲回收）依赖 `agent_sessions.last_active_at` 字段（本任务提供字段，扫描逻辑在 task-07）。
- task-10（resume）依赖 `agent_sessions.agent_session_id`（SDK session_id）做 `query({resume})`，依赖 `agent_sessions.cwd` 还原工作目录。
- task-12（前端历史回看）依赖 `agent_runs.agent_session_id` 聚合多 turn 历史。

## 13. 完成定义

- [ ] allowed_paths 内 6 个文件实现与测试完成，未改其他文件。
- [ ] Red 阶段失败证据与 Green 阶段通过证据可追溯。
- [ ] `uv run pytest app/modules/agent/tests/test_agent_session_model.py app/modules/daemon/tests/test_lease_kind_model.py` 通过。
- [ ] `uv run alembic upgrade head` 成功，`uv run alembic check` 无 pending diff。
- [ ] `uv run alembic downgrade -1 && uv run alembic upgrade head` 往返成功。
- [ ] `uv run pytest app/modules/agent app/modules/daemon` 零回归。
- [ ] 验收表 AC-02-01 至 AC-02-10 全部满足。
- [ ] task-05 / task-06 可仅依赖本文件 §6 字段契约实现，无需回头改本任务。
