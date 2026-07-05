---
id: task-01
title: backend AgentRunLog 加 tool_kind 列 + alembic 迁移 + AgentRunLogEntry schema
author: qinyi
created_at: 2026-07-05 10:05:43
priority: P0
depends_on: []
blocks: [task-04, task-05, task-07]
requirement_ids: [FR-01]
decision_ids: [D-003@v1]
allowed_paths:
  - backend/app/modules/agent/model.py
  - backend/app/modules/agent/schema.py
  - backend/migrations/versions/
goal: AgentRunLog 加 tool_kind 结构化列支撑 Phase2 落库与 Phase3 两层筛选（D-003@v1 方案B）
implementation: model.py 加 tool_kind 字段+Index；schema.py AgentRunLogEntry 加字段；新 alembic 迁移 upgrade/downgrade 可逆
acceptance: 迁移可逆；列+索引存在；AgentRunLogEntry 透传 tool_kind；零回归
verify: cd backend && alembic heads 确认唯一 head；alembic upgrade head/downgrade 可逆；pytest 零回归
constraints: down_revision 接 alembic heads 真实 head（R-01）；user_input 构造点不改靠 default=None；PG 验证不只 SQLite；参照 AgentArtifact.kind(model.py:550)
provides:
  - contract: AgentRunLogEntry
    fields: [tool_kind]
expects_from: {}
---

# task-01 · backend 数据基础

## goal

为 `agent_run_logs` 加结构化 `tool_kind` 列（D-003@v1 方案 B），落库支撑 Phase 2 双路径打标与 Phase 3 两层筛选。覆盖 design §5 Phase 1、§8 数据模型、FR-01。

## implementation

1. **model.py:285-358** `AgentRunLog` 加 `tool_kind` 字段，参照 `AgentArtifact.kind`（model.py:550-571）的 `Field(sa_column=Column(...))` 模式：
   `tool_kind: str | None = Field(default=None, sa_column=Column(String(32), nullable=True))`，并在 `__table_args__` 追加 `Index("ix_agent_run_logs_tool_kind", "tool_kind")`（沿用现有 `ix_agent_run_logs_*` 命名）。
2. **schema.py:128-139** `AgentRunLogEntry` 加 `tool_kind: str | None = None`（`from_attributes` 已存在，自动透传）。
3. **新迁移** `backend/migrations/versions/20260705xxxx_add_agent_run_log_tool_kind.py`：写前先 `cd backend && alembic heads` 拿唯一真实 head 填 `down_revision`（R-01）；upgrade 用 `op.add_column` + `op.create_index`；downgrade 反向（drop_index 后 drop_column）。
4. **构造点不改**：`agent/service.py:618`、`daemon/session/service.py:403/589` 等 `AgentRunLog(...)` 不传 `tool_kind`，依赖 `default=None` 兜底（user_input 非工具调用）。

## 验收标准

- [ ] 迁移 upgrade + downgrade 可逆（PG 与 SQLite 双跑，R-01）
- [ ] `agent_run_logs.tool_kind` 列 + `ix_agent_run_logs_tool_kind` 索引存在
- [ ] `AgentRunLogEntry.model_validate(orm_row).tool_kind` 正确透传（None / 值两路径）
- [ ] `down_revision` 指向 `alembic heads` 实际输出，无多 head 分叉
- [ ] 现有 agent/daemon 测试零回归（仅加列，不改构造逻辑）

## verify

- `cd backend && alembic heads`（确认唯一 head）
- `cd backend && alembic upgrade head && alembic downgrade -1 && alembic upgrade head`
- `cd backend && uv run pytest tests/modules/agent/ -v`（零回归）

## constraints

- **R-01 迁移链断裂**：execute 务必先 `alembic heads` 再写 `down_revision`；verify 在 PG 跑迁移（不只 SQLite）。
- 仅加列+迁移+schema，不做 query/publish/classify（属 task-02/04/05）。
- 参照先例 `AgentArtifact.kind`（model.py:550-571）；本项目未上线，`down -v` 重置可接受。
