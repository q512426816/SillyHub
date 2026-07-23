---
id: task-02
title: New alembic migration removing workspace path_source/daemon_runtime_id
title_zh: 新 alembic 迁移删 path_source/daemon_runtime_id 列 + 显式清理非 CASCADE 表
author: qinyi
created_at: 2026-07-10 23:45:39
priority: P0
depends_on: []
blocks: [task-15]
requirement_ids: [FR-4]
decision_ids: [D-004, D-006, D-007]
allowed_paths:
  - backend/migrations/versions/20260710_remove_workspace_path_source.py
---

## goal

新增一份标准 alembic 迁移文件，作为 DB 层 DROP `workspaces.path_source` + `workspaces.daemon_runtime_id` 两列的唯一真相来源，并在 DROP 前显式清理所有引用 `workspaces.id` 但**非 CASCADE** 的外键表（至少 `incidents` RESTRICT），使存量 server-local 工作区行连同 CASCADE 外键表一并删除、迁移在 PG 上无 FK 违约。本任务是 Wave 1 与 task-01 并列的 schema 定型前置，但只产出迁移文件——文件本身不在单测里跑（SQLite 新库无 server-local 行），真正 apply 验证在 task-15 Docker 部署阶段。覆盖 design §5 Phase 3 + §8 数据模型 + R-02（incident RESTRICT 守卫）+ D-004（标准迁移保链）/ D-006（存量数据删除）/ D-007 P0-3（FK 全表清理修正）。

## implementation

### 文件骨架（backend/migrations/versions/20260710_remove_workspace_path_source.py）

参照同仓既有迁移格式（`7c77e09b84e1_add_gate_fields_to_agent_runs.py` 头部 docstring + `revision: str` / `down_revision: str | None` / `branch_labels` / `depends_on` 四元组 + `from __future__ import annotations` + `import sqlalchemy as sa` + `from alembic import op`）。

1. **revision**：自取稳定唯一串（如 `20260710_remove_workspace_path_source`，与文件名 stem 同；不必随机 hex，与仓内 `20260707_custom_skills` / `20260706_component_readonly` 同风格）。
2. **down_revision**：`"7c77e09b84e1"`（实测当前唯一 head，design revision note D-007 已否决子代理多 head 误判）。
3. **branch_labels** / **depends_on**：`None`。
4. docstring 说明：移除 server-local 模式连带的两列 + incident RESTRICT 显式 DELETE 守卫 + CASCADE 表自动连带 + downgrade 仅形式对称（项目未上线不保证还原）。引用本变更 change id + design §5 Phase 3 / §8 / R-02。

### upgrade() 步骤（顺序严格，R-02 关键）

按 design §5 Phase 3 的三步法，使用 `op.get_bind().execute(sa.text(...))` 执行显式 SQL（dialect 无关，PG/SQLite 均可）：

1. **显式 DELETE 非 CASCADE 表的引用行**（至少 incident）：
   - `DELETE FROM incidents WHERE workspace_id IN (SELECT id FROM workspaces WHERE path_source = 'server-local')`。
   - 依据：`incident/workspace_id` FK 无 `ondelete` 子句（`incident/model.py:19` `ForeignKey("workspaces.id")`），PG 默认 RESTRICT/NO ACTION，若不先删则下一步 DELETE workspace 被 PG 拦截抛 `violates foreign key constraint`（R-02 关键守卫）。
   - 评估并按需追加 `workflow`（`ondelete=SET NULL`，design §5 列为非 CASCADE）+ `agent_runs` 旧行（design §5 标 450 SET NULL）清理：SET NULL 本身不阻断 DELETE workspace（PG 自动把 workspace_id 置 NULL），**默认不显式删**，仅在 docstring 注明"workflow/agent_runs SET NULL 行保留为 workspace_id=NULL，属预期"；若 task-15 部署验证发现需清理再加。
2. **DELETE server-local 工作区行**：
   - `DELETE FROM workspaces WHERE path_source = 'server-local'`。
   - 依据 design §5 Phase 3：约 15+ 张 CASCADE 外键表（auth/release/git_gateway/change/daemon_audit/worktree/scan_docs/spec_workspace/spec_profile/tool_gateway/tool_policy/task/daemon/workspace 自表/member_runtimes/agent_runs M:N 等）由 PG `ondelete=CASCADE` 自动连带删除，迁移不逐一显式 DELETE。
3. **DROP 两列**：
   - `op.drop_column("workspaces", "daemon_runtime_id")` —— PG 自动级联删 `ix_workspaces_daemon_runtime_id` 索引（model.py:35），无需显式 `drop_index`。
   - `op.drop_column("workspaces", "path_source")`。
   - 顺序无强约束（两列无相互依赖），建议先 daemon_runtime_id 再 path_source 与 task-01 删字段顺序一致。

### downgrade()（形式对称，design §9 不保证还原）

```python
op.add_column("workspaces", sa.Column("path_source", sa.String(20), nullable=False, server_default="server-local"))
op.add_column("workspaces", sa.Column("daemon_runtime_id", sa.Uuid(as_uuid=True), nullable=True))
op.create_index("ix_workspaces_daemon_runtime_id", "workspaces", ["daemon_runtime_id"])
```

- 项目未正式上线（CLAUDE.md 规则 10），downgrade 仅保证迁移链可回退、表结构对称，不回填已 DELETE 的 server-local 工作区行 + CASCADE 连带数据（物理已丢）。
- `path_source` `server_default='server-local'` 与原 model 定义一致（回退后所有现存行默认 server-local，语义不正确但不阻断，已脱离本次范围）。

## 验收标准

- 文件 `backend/migrations/versions/20260710_remove_workspace_path_source.py` 存在，`revision` / `down_revision="7c77e09b84e1"` / `branch_labels=None` / `depends_on=None` 四元组齐全。
- `upgrade()` 含三步：①显式 DELETE incidents（workspace_id IN server-local 子查询）→ ②DELETE workspaces WHERE path_source='server-local' → ③drop_column daemon_runtime_id + drop_column path_source。
- `downgrade()` 对称 add_column 两列 + create_index `ix_workspaces_daemon_runtime_id`。
- 文件可被 `alembic` import 无 SyntaxError（`uv run alembic heads` 不报 broken chain）。
- 迁移链保持单 head：新 revision 成为唯一 head，`7c77e09b84e1` 不再是 head（`alembic heads` 输出仅一个）。

## verify

```bash
cd backend
# 1. 迁移文件可加载 + 链路完整（不实际 upgrade）
uv run alembic history 2>&1 | head -5
uv run alembic heads          # 预期单一 head = 本任务 revision

# 2. fresh SQLite 升级冒烟（tests 用 SQLite，无 server-local 行 → DELETE 0 行 + DROP 两列）
uv run alembic upgrade head
uv run python -c "import sqlite3, pathlib; db=max(pathlib.Path('migrations').parent.glob('*.db'), key=lambda p:p.stat().st_mtime); ..." 2>/dev/null || true

# 3. fresh SQLite 降级对称冒烟
uv run alembic downgrade -1
uv run alembic upgrade head
```

- 真实 PG apply + incident RESTRICT 守卫验证在 **task-15** Docker 部署阶段跑（本任务的 `alembic upgrade head` 在 SQLite 下 DELETE 0 行，无法证明 R-02 守卫生效；task-15 进 PG 容器核验 `\d workspaces` + 迁移日志无 FK 违约）。

## constraints

- **down_revision 必须是 `7c77e09b84e1`**（实测单一 head）。**execute 写迁移前重新 `cd backend && uv run alembic heads` 确认**——若 head 漂移（如期间有其他变更 merge 新迁移）必须改 down_revision 接真实 head，否则迁移链分叉致 `alembic upgrade head` 报多 head 错误（R-05 防漂移守卫；记忆 migration-chain-fragmentation-pattern）。
- **incident 显式 DELETE 不可省**——`incident/workspace_id` FK 无 `ondelete`（RESTRICT），跳过则 PG 上 DELETE workspace 直接抛 FK 违约（R-02）。
- **CASCADE 表不显式 DELETE**——约 15+ 张 `ondelete=CASCADE` 表由 PG 自动连带，迁移里逐一 DELETE 既冗余又易漏（design §5 Phase 3 / D-007 P0-3）。
- **drop_column 无需先 drop_index**——PG 下 DROP COLUMN 自动级联删 `ix_workspaces_daemon_runtime_id`；SQLite 同理（单测 dialect 无关）。
- **workflow/agent_runs(SET NULL) 默认不显式删**——SET NULL 不阻断 DELETE，相关行 workspace_id 置 NULL 属预期；若 task-15 部署验证发现需清理再加显式 DELETE。
- **仅生成迁移文件**，不改 ORM model（task-01）、不改 service/router（task-03~09）；迁移与 model 删除两份改动须保持列名/类型/索引名一致（`path_source` String(20) / `daemon_runtime_id` Uuid nullable / `ix_workspaces_daemon_runtime_id`）。
- **downgrade 仅形式对称**，不回填已 DELETE 数据（项目未上线，CLAUDE.md 规则 10 / design §9）。
