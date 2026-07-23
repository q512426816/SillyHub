---
id: task-01
title: alembic head 收敛 + WorktreeLease agent_run_id 外键 migration
title_zh: alembic 头部收敛 + WorktreeLease 加 agent_run_id 外键迁移
author: qinyi
created_at: 2026-07-14 11:01:53
priority: P0
depends_on: []
blocks: [task-04]
requirement_ids: [FR-03]
decision_ids: [D-003@v2]
allowed_paths:
  - backend/migrations/versions/20260714_worktree_agent_run_fk.py
  - backend/app/modules/worktree/model.py
---

# task-01 — alembic head 收敛 + WorktreeLease agent_run_id 外键 migration

## goal
给 `worktree_leases` 表加 `agent_run_id` 外键列（FK → agent_runs.id，nullable + indexed），并产出可建可升的 alembic migration；该列是 task-04 worktree GC 判据改造（关联 agent_run 非终态→保留 / 终态含 cancelled→回收 / 孤儿 NULL→原 expires_at）的唯一数据依赖。

## provides
```yaml
contract: WorktreeLease
fields: [agent_run_id]
```

## implementation
1. 执行 `alembic heads` 核实当前 head（实测已收敛唯一 head = `20260713_fix_session_zombie`，无多 head，不需先 merge；若实测变为多 head 必须先 `alembic merge` 收敛再 down，对应 R-6 / [migration-chain-fragmentation-pattern]）。
2. 新建 `backend/migrations/versions/20260714_worktree_agent_run_fk.py`：`revision = "20260714_worktree_agent_run_fk"`，`down_revision = "20260713_fix_session_zombie"`。
3. `upgrade()`：`op.add_column("worktree_leases", sa.Column("agent_run_id", sa.Uuid(as_uuid=True), nullable=True))` + `op.create_index("ix_worktree_leases_agent_run_id", "worktree_leases", ["agent_run_id"])` + 建 FK 约束 `op.create_foreign_key("fk_worktree_leases_agent_run_id", "worktree_leases", "agent_runs", ["agent_run_id"], ["id"], ondelete="SET NULL")`。
4. `downgrade()`：drop FK → drop index → drop column（项目未上线，down 直接删列，无数据回填负担，CLAUDE.md 规则 11）。
5. `WorktreeLease` model（worktree/model.py）加字段：`agent_run_id: uuid.UUID | None = Field(default=None, sa_column=Column(Uuid(as_uuid=True), ForeignKey("agent_runs.id", ondelete="SET NULL"), nullable=True, index=True))`，与 migration 类型一致。
6. FK 目标表名核实 = `agent_runs`（agent/model.py:29 `__tablename__ = "agent_runs"`），现有 WorktreeLease `__tablename__ = "worktree_leases"`（model.py:20）。

## 验收标准
- `alembic heads` 执行后输出唯一 head = `20260714_worktree_agent_run_fk`。
- `alembic upgrade head` 在干净 SQLite（测试）与本地 PG 均成功，`worktree_leases` 表出现 `agent_run_id` 列 + 索引 `ix_worktree_leases_agent_run_id` + FK 约束。
- `alembic downgrade -1` 成功删列（down 可逆）。
- WorktreeLease model 反射出 `agent_run_id` 字段（nullable，default None）。
- 历史行不受影响（nullable=True，存量 lease 的 agent_run_id = NULL）。

## verify
- `cd backend && alembic heads`（确认唯一 head）
- `cd backend && alembic upgrade head && alembic downgrade -1 && alembic upgrade head`（升降级往返）
- `cd backend && python -c "from app.modules.worktree.model import WorktreeLease; print(WorktreeLease.__table__.c.agent_run_id)"`（model 反射）
- `cd backend && pytest app/modules/worktree/tests/ -q`（现有 worktree 单测零回归）

## constraints
- 先 `alembic heads` 收敛多 head（若存在）再 down；本任务实测 head 已唯一 `20260713_fix_session_zombie`，直接接此。
- 外键列 `nullable=True`（兼容孤儿 worktree + HTTP 手动 acquire 不传 agent_run_id，design §8.1）+ `indexed=True`（GC `WHERE agent_run_id IS NOT NULL` 查询）。
- `ondelete="SET NULL"`（agent_runs 删除时不级联误杀 worktree lease；终态判定在 task-04 service 层做）。
- 项目未上线，down 直接 drop 列，不写数据回填（design §9、CLAUDE.md 规则 11）。
- 本任务只动 schema + model，**不改** GC 判据/acquire 回填/终态集（那是 task-04，消费本任务的 agent_run_id 字段）。
- revision id ≤32 字符（`20260714_worktree_agent_run_fk` = 28 字符，满足 alembic_version.version_num varchar(32)）。
