---
task_id: task-02
title: schema — PsPlanNodeResp / PsPlanNodeWithDetail 加 template_plan_node_id + has_module
author: WhaleFall
created_at: 2026-07-17 11:02:17
priority: P0
status: pending
depends_on: [task-01]
blocks: [task-03, task-04, task-06]
requirement_ids: [FR-005]
decision_ids: [D-005@v1]
allowed_paths:
  - backend/app/modules/ppm/plan/schema.py
---

# Task-02 — schema 透传 PsPlanNode 两字段

> 来源 design §7.1 + §5.1；plan §Wave1 task-02。只改 `schema.py`，model/migration 由 task-01 负责。

## implementation

`PsPlanNodeBase` 加 2 字段（`PsPlanNodeResp` / `PsPlanNodeWithDetail` 继承自动带）：

```python
class PsPlanNodeBase(PydanticModel):
    ...
    # 来源 PlanNode 模板；新建项目计划时写入，手动建为 null（D-005@v1）。
    template_plan_node_id: uuid.UUID | None = None
    # 冗余自模板 has_module，模块层判断用，避免每次反查模板（D-005@v1）。
    has_module: bool = False
```

不改 `PsPlanNodeCreate` / `PsPlanNodeUpdate`（自动继承；Create 可选传入，Update 可选不改，与既有可选字段语义一致）。

## acceptance

- `PsPlanNodeResp` 实例含 `template_plan_node_id`（uuid|null）+ `has_module`（bool）。
- `PsPlanNodeWithDetail`（继承 `PsPlanNodeResp`）同样带两字段。
- `from_attributes=True` 序列化 ORM 对象时两字段正确透传。
- mypy strict 过；不引入新 import（`uuid` 已 import）。

## verify

```bash
cd backend && ruff check app/modules/ppm/plan/
cd backend && mypy app/modules/ppm/plan/
```

（字段只透传，无逻辑分支，单测由 task-05 统一覆盖。）

## constraints

- 向后兼容：两字段均可选（`None` / `False` default），旧客户端无感。
- `has_module` 必填类型 bool，default `False`（非 null），对齐 design §8 NOT NULL DEFAULT FALSE。
- 仅改 `schema.py`，不动 model/service/migration。
