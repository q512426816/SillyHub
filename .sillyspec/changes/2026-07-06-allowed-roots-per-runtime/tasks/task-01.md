---
id: task-01
title: DaemonRuntime 加 allowed_roots 列 + 迁移 copy
author: WhaleFall
created_at: 2026-07-06T11:40:00
priority: P0
depends_on: []
blocks: [task-02, task-03, task-04, task-05]
allowed_paths:
  - backend/app/modules/daemon/model.py
  - backend/migrations/versions/20260706_runtime_allowed_roots.py
change: 2026-07-06-allowed-roots-per-runtime
goal: "(见 body)"
implementation: "(见 body)"
acceptance: "(见 body)"
verify: "(见 body)"
constraints: "(见 body)"
---

# task-01

> goal: DaemonRuntime 加回 allowed_roots 列（per-runtime 持久化），迁移 copy instance→runtime。FR-01/D-002。

## implementation
- `backend/app/modules/daemon/model.py` DaemonRuntime 加 `allowed_roots: list[str] = Field(default_factory=list, sa_column=Column(JSON, default=[]))`
- 迁移 `20260706_runtime_allowed_roots.py`：`op.add_column('daemon_runtimes', Column('allowed_roots', JSON, nullable=True))` + `UPDATE daemon_runtimes r SET allowed_roots = (SELECT allowed_roots FROM daemon_instances i WHERE i.id = r.daemon_instance_id)`
- down_revision 接当前 head（20260706_merge_heads），跑前 `alembic heads` 确认单 head

## 验收标准
- DaemonRuntime.allowed_roots 列存在（JSON list）
- 迁移 copy 成功，runtime 行有值
- alembic upgrade head 无 multiple heads

## 验证
- 容器跑 `alembic upgrade head` + `alembic heads`（单 head）
- DB 查 daemon_runtimes.allowed_roots 非 null

## constraints
- 注意 merge heads（避免 ql-20260706-002 同款 crash loop）
- 项目允许重置测试数据，无需 downgrade
