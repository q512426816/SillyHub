---
id: task-02
title: Alembic migration for per-user custom skill ownership
title_zh: Alembic 迁移 清空表 + 删 name 全局唯一 + created_by NOT NULL + 联合唯一
author: qinyi
created_at: 2026-07-31 22:40:05
priority: P0
depends_on: [task-01]
blocks: []
requirement_ids: [FR-02, FR-08]
decision_ids: [D-002@v2, D-005]
allowed_paths:
  - backend/migrations/versions/
---

## 目标
新增 Alembic 迁移：清空 `custom_skills` 现有全局数据 → 删 `name` 列级全局唯一约束 → `created_by` 改 NOT NULL → 加 `(created_by, name)` 联合唯一；downgrade 声明数据不可逆。

## 实现要点
- 新文件 `backend/migrations/versions/<rev>_custom_skill_per_user.py`（项目 `alembic.ini` script_location=migrations，不是 alembic/versions）；`revision` 唯一，`down_revision` 接当前真实 head（execute 前先 `alembic heads` 确认单 head，防多 head 撞车 — memory: migration-chain-fragmentation-pattern）。
- upgrade 顺序（不可调换，gap#1/gap#2）：
  1. `op.execute("DELETE FROM custom_skills")`（D-005 清空，开发环境已确认可清；必须先清否则 NOT NULL 与联合唯一会被历史 NULL/重复行阻塞）。
  2. drop 列级 unique：原迁移 `20260707_custom_skills.py:54-59` 用 `op.create_index("ix_custom_skills_name", ..., unique=True)`，故按 index 名 drop：`op.drop_index("ix_custom_skills_name", table_name="custom_skills")`（gap#1：列级约束按实际约束名处理，不要瞎猜 constraint 名）。
  3. `op.alter_column("custom_skills", "created_by", existing_type=sa.Uuid(), nullable=False)`（gap#2：必须先清空再 ALTER）。
  4. 同步把 FK ondelete 从 SET NULL 改 CASCADE：若 SQLite 测试遇 FK 重建限制，照项目惯例用 `batch_alter_table` 包住 alter_column + fk 重建（参考其它改 ondelete 的迁移）；PG 直接 `op.drop_constraint` + `op.create_foreign_constraint(..., ondelete="CASCADE")`。
  5. `op.create_index("uq_custom_skills_created_by_name", "custom_skills", ["created_by", "name"], unique=True)`（与 task-01 model 的 UniqueConstraint 名字对齐）。
- downgrade（gap#4 DELETE 不可逆，无法恢复行数据）：回滚结构（drop 联合唯一 index → created_by nullable → 重建 ix_custom_skills_name unique → FK 改回 SET NULL），数据返回空表并在 docstring 注明「downgrade 不恢复已清空的 custom_skills 行」。
- 文件头 docstring 写清 D-005（清空重置）+ R2（迁移顺序）+ 引用 20260707_custom_skills 为来源。

## 验收
- 干净库 `alembic upgrade head` 成功，`custom_skills` 表 created_by NOT NULL、有 uq_custom_skills_created_by_name 联合唯一 index、无 ix_custom_skills_name。
- `alembic heads` 仍单 head（无分叉）。
- `alembic downgrade -1` 不报错（返回空表，数据不可逆已在 docstring 声明）。
- 迁移文件 `revision` / `down_revision` 与 task-01 model 字段/约束一一对应，无代码↔迁移漂移。
