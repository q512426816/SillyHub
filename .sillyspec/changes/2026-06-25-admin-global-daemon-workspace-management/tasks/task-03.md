---
author: qinyi
created_at: "2026-06-25 17:48:59"
id: task-03
title: 添加 display_alias 数据迁移与 ORM 字段
priority: P0
estimated_hours: 1.5
depends_on: [task-01]
blocks: [task-04, task-05, task-09]
requirement_ids: [FR-03]
decision_ids: [D-002@v1]
allowed_paths:
  - backend/migrations/versions/**
  - backend/app/modules/daemon/model.py
  - backend/app/modules/workspace/model.py
  - .sillyspec/changes/2026-06-25-admin-global-daemon-workspace-management/tasks/task-03.md
---

# task-03: 添加 display_alias 数据迁移与 ORM 字段

## 修改文件（必填）

- 新增 `backend/migrations/versions/202606251748_add_resource_display_alias.py`
  - 如果执行时该文件名或 revision 已存在，改用同主题且唯一的 `backend/migrations/versions/<YYYYMMDDHHMM>_add_resource_display_alias.py`，并保持只新增这一条 migration。
- 修改 `backend/app/modules/daemon/model.py`
- 修改 `backend/app/modules/workspace/model.py`

## 覆盖来源

- Requirements: FR-03 两类资源支持独立别名。
- Decisions: D-002@v1 别名独立于资源原始名称，不覆盖 `workspace.name` / daemon `name`，空值回退原始 `name` / `slug` / `provider`。
- Design: `design.md` 第 5 节 Phase 1 和第 8 节数据模型，要求 `daemon_runtimes`、`workspaces` 新增 nullable `display_alias VARCHAR(200)`，历史数据无需回填。
- Plan: `plan.md` Wave 2 task-03，为 task-04、task-05 提供持久化字段，并阻塞 task-09 后端验证。

## 实现要求

1. 新增 Alembic migration，为 `daemon_runtimes` 增加 `display_alias` 列：
   - 类型：`sa.String(length=200)`。
   - nullable：`True`。
   - 不设置 `server_default`。
   - 不执行历史数据回填。
   - 不创建索引和唯一约束。
2. 同一 migration 为 `workspaces` 增加 `display_alias` 列：
   - 类型、nullable、default、索引策略与 `daemon_runtimes.display_alias` 完全一致。
3. migration 的 `down_revision` 必须接到执行时的 Alembic 单一 head：
   - 当前读取到的 head 为 `202608010900 (head)`。
   - 执行前运行 `cd backend && uv run alembic heads`；如果输出不是 `202608010900 (head)`，以实际单一 head 填写 `down_revision`。
   - 不允许制造新的并列 head；若发现多个 head，先停止并报告，不要自行写 merge migration。
4. migration 的 `downgrade()` 必须删除两个新增字段：
   - 先 `op.drop_column("workspaces", "display_alias")`。
   - 再 `op.drop_column("daemon_runtimes", "display_alias")`。
5. 在 `DaemonRuntime` ORM 中同步字段：
   - 放在 `name` 字段之后、`provider` 字段之前。
   - 使用现有 `String` import，不新增无用 import。
   - 字段定义为：
     ```python
     display_alias: str | None = Field(
         default=None,
         sa_column=Column(String(200), nullable=True),
     )
     ```
6. 在 `Workspace` ORM 中同步字段：
   - 放在 `name` 字段之后、`slug` 字段之前。
   - 使用现有 `String` import。
   - 字段定义与 `DaemonRuntime.display_alias` 保持一致。
7. 保持现有字段不变：
   - 不修改 `DaemonRuntime.name/provider/status`。
   - 不修改 `Workspace.name/slug/root_path/path_source/status`。
   - 不改 `__table_args__`，本任务不新增索引。
8. 文件头和风格遵循现有 migration 示例：
   - `from __future__ import annotations`
   - `import sqlalchemy as sa`
   - `from alembic import op`
   - `revision = "..."`
   - `down_revision = "..."`
   - `branch_labels = None`
   - `depends_on = None`

## 接口定义（代码类任务必填）

本任务不新增 HTTP API，只新增数据库 schema 与 ORM 字段。

### Alembic migration 形状

```python
"""add display_alias to daemon runtimes and workspaces

Revision ID: 202606251748
Revises: 202608010900
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "202606251748"
down_revision = "202608010900"  # 执行时如 head 已变化，改为实际单一 head
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "daemon_runtimes",
        sa.Column("display_alias", sa.String(length=200), nullable=True),
    )
    op.add_column(
        "workspaces",
        sa.Column("display_alias", sa.String(length=200), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("workspaces", "display_alias")
    op.drop_column("daemon_runtimes", "display_alias")
```

### ORM 字段契约

```python
class DaemonRuntime(BaseModel, table=True):
    ...
    name: str | None = Field(...)
    display_alias: str | None = Field(
        default=None,
        sa_column=Column(String(200), nullable=True),
    )
    provider: str | None = Field(...)
```

```python
class Workspace(BaseModel, table=True):
    ...
    name: str = Field(...)
    display_alias: str | None = Field(
        default=None,
        sa_column=Column(String(200), nullable=True),
    )
    slug: str = Field(...)
```

### 控制流伪代码

```text
before edit:
  read current alembic head
  if exactly one head:
    create one migration whose down_revision = that head
  else:
    stop and report multiple heads

upgrade:
  add nullable String(200) display_alias to daemon_runtimes
  add nullable String(200) display_alias to workspaces

model sync:
  add DaemonRuntime.display_alias with matching nullable String(200)
  add Workspace.display_alias with matching nullable String(200)

downgrade:
  drop workspaces.display_alias
  drop daemon_runtimes.display_alias
```

## 边界处理（必填）

- 历史数据：现有 `daemon_runtimes` 和 `workspaces` 行保持 `display_alias = NULL`，不得写 backfill SQL，也不得设置 `server_default=""`。
- 空值行为：ORM 字段默认 `None`，数据库允许 NULL；空字符串是否清理为 NULL 由后续 schema/service 任务处理，本任务不做输入标准化。
- 长度一致性：migration 和两个 ORM 字段必须全部使用 200 长度；不能出现 migration 是 200、ORM 是 255 或无长度限制的漂移。
- 兼容旧行为：原始 `name`、`slug`、`provider` 字段不改名、不迁移、不回填，旧列表和注册逻辑在未使用 `display_alias` 时行为不变。
- 异常处理：`op.add_column` / `op.drop_column` 失败时让 Alembic 抛错；不要捕获后静默跳过，也不要用条件判断掩盖 schema 不一致。
- 参数不可变：不修改任何现有 service、router、schema 入参对象；本任务只暴露 ORM 属性供后续任务使用。
- downgrade 可回退：`downgrade()` 只删除本任务新增的两个列，不删除表、不改索引、不碰其他字段；删除顺序与 upgrade 反向且不依赖数据内容。
- 并发迁移：执行前发现 Alembic 多 head 或目标 revision 重名时停止报告，避免在多人协作中引入断链 migration。

## 非目标（本任务不做的事）

- 不新增或修改 `backend/app/modules/daemon/schema.py`、`router.py`、`service.py`、`runtime/service.py`。
- 不新增或修改 `backend/app/modules/workspace/schema.py`、`router.py`、`service.py`。
- 不实现 `PATCH display_alias` 接口，不实现列表筛选、分页、owner DTO 或前端展示。
- 不修改任何测试文件；task-01 负责先落失败测试，task-09 负责后端集中验证和必要修正。
- 不新增 `display_alias` 索引、唯一约束、非空约束或独立 alias 表。
- 不为历史 runtime/workspace 生成默认别名。

## 参考

- `.sillyspec/changes/2026-06-25-admin-global-daemon-workspace-management/requirements.md`
- `.sillyspec/changes/2026-06-25-admin-global-daemon-workspace-management/design.md`
- `.sillyspec/changes/2026-06-25-admin-global-daemon-workspace-management/plan.md`
- `.sillyspec/changes/2026-06-25-admin-global-daemon-workspace-management/decisions.md`
- `.sillyspec/docs/backend/scan/CONVENTIONS.md`
- `.sillyspec/docs/backend/scan/ARCHITECTURE.md`
- `.sillyspec/docs/backend/modules/migrations.md`
- `.sillyspec/docs/backend/modules/daemon.md`
- `.sillyspec/docs/backend/modules/workspace.md`
- `backend/migrations/versions/202607030900_add_workspace_path_source.py`
- `backend/migrations/versions/202606270900_create_daemon_tables.py`
- `backend/migrations/versions/202606110900_add_agent_run_audit_fields.py`
- `backend/app/modules/daemon/model.py`
- `backend/app/modules/workspace/model.py`

## TDD 步骤

1. 红灯：确认 task-01 已提供与 `display_alias` 持久化相关的后端失败用例；本任务不新增测试文件。若尚未执行，运行后端相关测试时应看到 ORM 字段或数据库列缺失导致失败。
2. 红灯命令：执行前先读取 `local.yaml` 中的后端测试配置；若未配置，默认使用 `cd backend && uv run pytest app/modules/daemon/tests app/modules/workspace/tests -k display_alias`，预期在实现前失败或无法通过。
3. 写实现：新增 migration，并在 `DaemonRuntime`、`Workspace` ORM 中加入 `display_alias` 字段。
4. 迁移验证：运行 `cd backend && uv run alembic upgrade head`，确认升级成功且两个表都有 nullable `display_alias` 列。
5. 回退验证：在临时/测试数据库运行 `cd backend && uv run alembic downgrade -1`，确认只删除两个 `display_alias` 列；再 `cd backend && uv run alembic upgrade head` 恢复。
6. 绿灯：重新运行第 2 步相关测试；如果 task-04/task-05 尚未完成，允许只验证迁移和 ORM 字段相关断言，接口层失败记录给后续任务。
7. 回归：运行 `cd backend && uv run ruff check app/modules/daemon/model.py app/modules/workspace/model.py migrations/versions/<new_revision>_add_resource_display_alias.py`。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | 打开新增 migration 文件 | 文件位于 `backend/migrations/versions/`，包含 `upgrade()`、`downgrade()`、唯一 `revision`，且 `down_revision` 指向执行时的单一 Alembic head |
| AC-02 | 检查 `upgrade()` | `daemon_runtimes` 和 `workspaces` 都通过 `op.add_column` 新增 `display_alias`，类型均为 `sa.String(length=200)`，`nullable=True`，无 `server_default`、无 backfill、无索引 |
| AC-03 | 检查 `downgrade()` | 只调用 `op.drop_column("workspaces", "display_alias")` 和 `op.drop_column("daemon_runtimes", "display_alias")`，不删除其他字段、索引或表 |
| AC-04 | 检查 `backend/app/modules/daemon/model.py` | `DaemonRuntime` 存在 `display_alias: str \| None` 字段，默认 `None`，SQLAlchemy Column 为 `String(200), nullable=True`，原有字段未被改名或删除 |
| AC-05 | 检查 `backend/app/modules/workspace/model.py` | `Workspace` 存在同规格 `display_alias` 字段，放置在 `name` 和 `slug` 附近，原有 `name/slug/root_path` 语义不变 |
| AC-06 | 运行 `cd backend && uv run alembic upgrade head` | 测试数据库升级成功，两个表都能反映出 nullable `display_alias` 列 |
| AC-07 | 运行 `cd backend && uv run alembic downgrade -1` 后再升级回 head | downgrade 只移除本任务新增列，重新 upgrade 后列恢复，迁移链无断头 |
| AC-08 | 运行后端格式检查 | `ruff check` 对两个 model 文件和新增 migration 文件通过，未引入未使用 import 或格式问题 |
