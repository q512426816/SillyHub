---
id: task-01
title: model.py 加 id UUID 主键 + change_name 去主键
goal: platform_change_progress 从 change_name 单主键(全局唯一)改为 id 主键 + (workspace_id, change_name) 复合唯一
implementation: |
  1. PlatformChangeProgressORM 加 id: uuid.UUID 字段（Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)）——default 必须（免除既有 7 处测试构造补 id）
  2. change_name 去 primary_key=True 降普通列
  3. 保留 UniqueConstraint("workspace_id", "change_name")
acceptance:
  - model.py id 主键 + change_name 非主键
  - create_all 建表成功（SQLite 测试库）
  - 既有 7 处 PlatformChangeProgressORM 构造（default 免除补 id）不报 NOT NULL
verify:
  - cd backend && uv run pytest app/modules/platform_sync -q --no-cov
constraints:
  - 零 API 变更（端点/schema/body 不变，D-004）
  - 保留复合唯一约束（D-002）
  - id default=uuid.uuid4 必须（免除测试构造点）
depends_on: []
allowed_paths:
  - backend/app/modules/platform_sync/model.py
provides:
  - contract: platform_change_progress_id_pk
    fields: [id]
    desc: platform_change_progress 有独立 id 主键，change_name 非主键
expects_from: []
related_tests:
  - backend/app/modules/platform_sync/tests/test_router.py
  - backend/app/modules/change/tests/test_router.py
  - backend/app/modules/change/tests/test_enrich_projection.py
---

## 依据
- design.md §5（总体方案 A）、§6 文件清单 model.py 行、§8 数据模型；decisions.md D-001/D-002/D-004；plan.md Wave 1 task-01。
- 当前 model.py 缺陷：`change_name` 为单主键（`primary_key=True`，全局唯一），偏离 D-001 目标态（复合主键语义），导致跨 workspace 同名冲突 + NULL 历史行挡道。

## 实现要求
`backend/app/modules/platform_sync/model.py` 的 `PlatformChangeProgressORM`：

1. 加 `id` 字段：`id: uuid.UUID = Field(sa_column=Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4))`。**`default=uuid.uuid4` 必须**——change/测试中既有 7 处 `PlatformChangeProgressORM(...)` 构造不带 id，靠 default 免除补 id。
2. `change_name` 去 `primary_key=True`，保留 `nullable=False` 普通列：`Column(String, nullable=False)`。
3. 保留现有 `UniqueConstraint("workspace_id", "change_name", name="uq_platform_change_progress_workspace_change")`（__table_args__ 不动）。

## 注意
- `BaseModel`（`app/models/base.py`）为空的 SQLModel 子类，无预置 `id`，加 `id` 不冲突。
- 不改 service / router / schema；零 API 变更（D-004），无 gen:types。
- 本 task 只动 model.py；migration（task-02）、service INSERT 加 id（task-03）由后续 task 处理。

## 验收标准
- `PlatformChangeProgressORM` 的 `__table_args__` 主键为 `id`，`change_name` 非主键、仍 NOT NULL。
- 测试库 `create_all`（SQLModel metadata）建表成功。
- platform_sync 现有测试全绿（7 处既有构造不报 NOT NULL）。
- `cd backend && uv run pytest app/modules/platform_sync -q --no-cov` 通过。
