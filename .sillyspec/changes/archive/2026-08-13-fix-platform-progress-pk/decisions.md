---
author: qinyi
created_at: 2026-08-13 15:52:00
---

# 决策记录（Decisions）

> change: `2026-08-13-fix-platform-progress-pk`
> 决策台账，对应 design.md §11。

## D-001@v1 加 id UUID 主键 + change_name 去主键 + 保留复合唯一

- **决策**：`platform_change_progress` 加独立 `id` UUID 主键；`change_name` 去 `primary_key=True` 降普通列；保留 `(workspace_id, change_name)` 复合唯一约束。
- **理由**：`change_name` 单主键（全局唯一）导致跨 workspace 重名冲突（第二工作区上行 500）+ NULL 历史行挡道。加独立 id 主键后，跨 workspace 同名各占一行（复合唯一），NULL 行与 workspace 行共存。
- **evidence**：model.py:69 `change_name` 实为 `primary_key=True`（2026-08-13 实测）；PG/SQLite 唯一约束对 NULL 不参与唯一性。

## D-002@v1 保留 `(workspace_id, change_name)` 复合唯一

- **决策**：保留复合唯一约束（同 workspace 内 change_name 唯一，跨 workspace 可同名）。
- **理由**：同 workspace 内重复变更名应拒绝（语义冲突），跨 workspace 隔离是目标（收件箱隔离 D-001@v1 前身）。
- **evidence**：model.py:53-58 `UniqueConstraint("workspace_id", "change_name")` 已存在，保留不动。

## D-003@v1 现有 NULL 历史行保留 + migration 回填 id

- **决策**：现有 10 行（8 NULL + 2 workspace）迁移回填 `id`（uuid4）保留，不丢进度镜像数据。
- **理由**：progress 表有真实进度数据，保留更合理（CLAUDE.md 规则 11 允许重置但不必）。NULL 过渡行修复后与 workspace 行共存。
- **evidence**：2026-08-13 生产库实测 10 行分布。

## D-004@v1 无 gen:types（端点 schema 不变）

- **决策**：本变更不改端点/请求/响应 schema（仅 ORM 层加 id），无需 `pnpm gen:types`。
- **理由**：service `upsert_progress` 是 ORM 构造器（service.py:117），非 API schema；openapi/api-types 不涉及 `platform_change_progress` 表。
- **evidence**：platform_sync 端点 schema（ProgressSyncOk/ConflictResponse/ChangeListItem）不变。

## D-005@v1 service INSERT 加 id，IntegrityError 回退逻辑不变

- **决策**：`upsert_progress` INSERT 分支加 `id=uuid.uuid4()`；`_find_row` 复合键 + IntegrityError 回退（rollback→重查→UPDATE）逻辑不变。
- **理由**：id 有 `default=uuid.uuid4`（D-001 吸收），INSERT 可省略 id 但显式更清晰；冲突回退撞复合唯一（非 change_name PK），逻辑语义不变。
- **evidence**：service.py:95-145 upsert_progress 现状。

无未解决决策。
