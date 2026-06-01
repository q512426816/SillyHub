---
id: task-01
title: "后端 schema 增强 — ChangeCreateRequest 增加 description + scope 字段"
priority: P0
estimated_hours: 0.5
depends_on: []
blocks: [task-03, task-04]
allowed_paths:
  - backend/app/modules/change_writer/schema.py
---

# task-01: 后端 schema 增强

## 目标

在 `change_writer/schema.py` 中增强 Pydantic 模型，为变更创建流程新增 `description`（需求描述）和 `scope`（执行规模）字段，并在响应模型中返回 `current_stage`。此任务是 Wave 1 的基础任务，无前置依赖，后续 task-03（router 透传）和 task-04（前端 API）均依赖本任务的 schema 定义。

## 操作步骤

### Step 1: 在 `ChangeCreateRequest` 中增加 `description` 字段

在 `title` 字段之后、`change_type` 字段之前，新增：

```python
description: str = Field(default="", max_length=5000)
```

- 类型：`str`
- 默认值：`""`（空字符串，保证向后兼容）
- 最大长度：5000
- 用途：用户输入的需求/变更描述文本

### Step 2: 在 `ChangeCreateRequest` 中增加 `scope` 字段

在 `description` 字段之后、`change_type` 字段之前，新增：

```python
scope: str = Field(default="full", pattern="^(full|quick)$")
```

- 类型：`str`
- 默认值：`"full"`（保证向后兼容）
- 校验正则：`"^(full|quick)$"`，仅允许 `"full"` 或 `"quick"` 两个值
- 用途：决定执行模式 — `"full"` 走完整 SillySpec 流程，`"quick"` 走快速模式

### Step 3: 在 `ChangeCreateResponse` 中增加 `current_stage` 字段

在 `status` 字段之后、`path` 字段之前，新增：

```python
current_stage: str | None
```

- 类型：`str | None`
- 用途：返回变更当前所处阶段（如 `"created"`, `"propose"`, `"plan"` 等），新创建时为 `"created"`

### 预期最终代码

```python
class ChangeCreateRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=500)
    description: str = Field(default="", max_length=5000)  # 新增
    scope: str = Field(default="full", pattern="^(full|quick)$")  # 新增
    change_type: str | None = Field(default=None, max_length=50)
    affected_components: list[str] = Field(default_factory=list)
    lease_id: uuid.UUID | None = None


class ChangeCreateResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    workspace_id: uuid.UUID
    change_key: str
    title: str | None
    status: str
    current_stage: str | None  # 新增
    path: str
    created_at: datetime
```

## 完成标准

- [ ] `ChangeCreateRequest` 包含 `description: str` 字段，默认值 `""`，`max_length=5000`
- [ ] `ChangeCreateRequest` 包含 `scope: str` 字段，默认值 `"full"`，`pattern="^(full|quick)$"`
- [ ] `ChangeCreateResponse` 包含 `current_stage: str | None` 字段
- [ ] 不传 `description` 和 `scope` 时，使用默认值，向后兼容
- [ ] 传入 `scope="invalid"` 时，Pydantic 校验失败返回 422
- [ ] `backend` 相关测试通过（`pytest backend/tests/` 或项目测试命令）
- [ ] 无其它文件被修改

## 文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `backend/app/modules/change_writer/schema.py` | 修改 | `ChangeCreateRequest` +2 字段，`ChangeCreateResponse` +1 字段 |
