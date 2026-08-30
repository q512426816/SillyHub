---
id: task-01
title: CustomSkill model switch ownership key to created_by
title_zh: CustomSkill 模型改归属键 created_by 强归属 + name 联合唯一
author: qinyi
created_at: 2026-07-31 22:40:05
priority: P0
depends_on: []
blocks: [task-02, task-03, task-04, task-05]
requirement_ids: [FR-01, FR-02]
decision_ids: [D-001, D-002@v2, D-007]
allowed_paths:
  - backend/app/modules/skills/model.py
---

## 目标
把 `CustomSkill` 的归属从「平台级全局共享」改为「per-user 强归属」：`created_by` 改 NOT NULL + ON DELETE CASCADE，`name` 从列级全局唯一改为 `(created_by, name)` 联合唯一。

## 实现要点
- 当前 `model.py:46-53` `created_by` 是 `uuid.UUID | None` + `ForeignKey("users.id", ondelete="SET NULL")` + `nullable=True`；改为 `uuid.UUID` + `ondelete="CASCADE"` + `nullable=False`（去掉 `default=None`）。
- 当前 `model.py:37-39` `name` 用列级 `unique=True`（`Column(String(40), unique=True, nullable=False)`）；改为去掉列级 `unique=True`，改由表级 `UniqueConstraint("created_by", "name", name="uq_custom_skills_created_by_name")` 承担（在 `__table_args__` 里声明，import `UniqueConstraint`）。
- 类 docstring 与模块 docstring 更新：废弃 D-010（平台级共享）与原 D-002（name 全局唯一），改写为 per-user 独立 + 联合唯一，引用 D-001 / D-002@v2 / D-007。
- 字段顺序、其余列（id / description / content / created_at / updated_at）保持不变；只动 created_by 的 null/fk 行 + name 的 unique 形式。

## 验收
- `mypy backend/app/modules/skills/model.py` 通过（created_by 类型从 Optional 收窄到非空，注意调用方 mypy 假绿坑——disable_error_code 含 arg-type，须配合 task-03/04/05 改调用方）。
- model 字段与约束改完：created_by NOT NULL+CASCADE、name 列级 unique 删除、__table_args__ 含 (created_by, name) 联合唯一。
- import 补 `UniqueConstraint`，无未用 import 残留（ruff 过）。
