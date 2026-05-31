---
id: task-03
title: 后端 router 透传 description + scope & Response 增加 current_stage
priority: P0
estimated_hours: 0.5
depends_on:
  - task-01
  - task-02
blocks:
  - task-05
allowed_paths:
  - backend/app/modules/change_writer/router.py
  - backend/app/modules/change_writer/tests/test_router.py
---

# task-03: 后端 router 透传

## 目标

将 `ChangeCreateRequest` 新增的 `description` 和 `scope` 字段从 router 层透传到 `ChangeWriterService.create_change()`，同时在 `ChangeCreateResponse` 中增加 `current_stage` 字段，使前端创建变更后能立刻拿到阶段状态。

## 操作步骤

### Step 1 — 修改 router.py create_change 端点

文件：`backend/app/modules/change_writer/router.py`

1. 在 `create_change` 函数中，将 `service.create_change()` 调用增加两个参数：
   - `description=data.description`
   - `scope=data.scope`
2. 确保 `ChangeCreateResponse.model_validate(change)` 能自动映射 DB model 的 `current_stage` 字段（schema 在 task-01 已添加）

修改后的 `create_change` 应为：

```python
@router.post(
    "/changes/create",
    response_model=ChangeCreateResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_change(
    workspace_id: uuid.UUID,
    data: ChangeCreateRequest,
    session: SessionDep,
    user: CurrentUser,
) -> ChangeCreateResponse:
    service = ChangeWriterService(session)
    change = await service.create_change(
        workspace_id,
        user.id,
        title=data.title,
        description=data.description,        # 新增透传
        scope=data.scope,                     # 新增透传
        change_type=data.change_type,
        affected_components=data.affected_components,
        lease_id=data.lease_id,
    )
    return ChangeCreateResponse.model_validate(change)
```

### Step 2 — 验证 Response 包含 current_stage

确认 `ChangeCreateResponse`（task-01 已加 `current_stage: str | None`）能正确序列化 DB model。由于 `from_attributes=True` 已配置，`Change` model 的 `current_stage` 字段会自动映射。

### Step 3 — 更新测试

文件：`backend/app/modules/change_writer/tests/test_router.py`

1. 在 `test_create_change_success` 中增加断言：
   - 请求 body 增加 `"description": "用户登录功能"` 和 `"scope": "full"`
   - 验证响应中 `current_stage` 为 `"created"`
   - 验证响应中 `status` 仍为 `"active"`（task-02 修改后的值）
2. 增加一个新测试用例 `test_create_change_default_scope`：
   - 只传 `title`，不传 `scope`
   - 断言 `scope` 默认为 `"full"`
   - 断言 `description` 默认为空字符串
3. 增加测试用例 `test_create_change_quick_scope`：
   - 传 `"scope": "quick"`
   - 断言创建成功且 `current_stage === "created"`

### Step 4 — 运行测试

```bash
cd /Users/qinyi/SillyHub
.venv/bin/python -m pytest backend/app/modules/change_writer/tests/test_router.py -v
```

## 完成标准

- [ ] `router.py` 的 `create_change` 端点将 `description` 和 `scope` 透传给 service
- [ ] `ChangeCreateResponse` 包含 `current_stage` 字段，值正确序列化
- [ ] 新增/修改的测试全部通过
- [ ] 现有不传 description/scope 的调用仍正常工作（向后兼容）

## 文件清单

| 文件 | 操作 |
|------|------|
| `backend/app/modules/change_writer/router.py` | 修改 — 透传 description + scope |
| `backend/app/modules/change_writer/tests/test_router.py` | 修改 — 增加断言 + 新测试 |
