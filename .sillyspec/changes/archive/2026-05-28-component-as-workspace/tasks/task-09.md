---
author: qinyi
created_at: 2026-05-29T22:10:00+08:00
id: task-09
title: Workspace PATCH 端点 — 支持更新元数据字段
priority: P1
estimated_hours: 1
depends_on: [task-01]
blocks: [task-08]
allowed_paths:
  - backend/app/modules/workspace/schema.py
  - backend/app/modules/workspace/service.py
  - backend/app/modules/workspace/router.py
  - backend/app/modules/workspace/tests/test_router.py
---

# task-09: Workspace PATCH 端点 — 支持更新元数据字段

## 修改文件

| 文件 | 操作 |
|---|---|
| `backend/app/modules/workspace/schema.py` | 新增 `WorkspaceUpdate` schema |
| `backend/app/modules/workspace/service.py` | 新增 `update()` 方法 |
| `backend/app/modules/workspace/router.py` | 新增 `PATCH /{workspace_id}` 端点 |
| `backend/app/modules/workspace/tests/test_router.py` | 新增 PATCH 测试 |

## 实现要求

1. `WorkspaceUpdate` schema：所有 WorkspaceCreate 的字段均为 Optional（含 name、root_path），额外支持 `status` 字段
2. `update()` 方法：仅更新传入的非 None 字段，保留未传字段不变
3. 路由：`PATCH /api/workspaces/{workspace_id}`，需要 `WORKSPACE_ADMIN` 权限
4. 边界处理：
   - workspace 不存在 → 404
   - slug 修改冲突 → 409
   - name 为空字符串 → 422
   - 未传任何字段 → 返回当前值（幂等）
   - 不修改传入参数

## 接口定义

```python
# schema.py
class WorkspaceUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    slug: str | None = Field(default=None, max_length=100)
    root_path: str | None = Field(default=None, min_length=1, max_length=4096)
    component_key: str | None = Field(default=None, max_length=100)
    type: str | None = Field(default=None, max_length=50)
    role: str | None = Field(default=None, max_length=100)
    repo_url: str | None = Field(default=None)
    default_branch: str | None = Field(default=None, max_length=100)
    tech_stack: list[str] | None = Field(default=None)
    build_command: str | None = Field(default=None)
    test_command: str | None = Field(default=None)
    source_yaml_path: str | None = Field(default=None)
    status: str | None = Field(default=None)

    @field_validator("slug")
    @classmethod
    def _validate_slug(cls, v):
        ...  # 同 WorkspaceCreate

# service.py
async def update(self, workspace_id: uuid.UUID, payload: WorkspaceUpdate) -> Workspace:
    ws = await self._get(workspace_id)  # 已有方法，不存在抛 WorkspaceNotFound
    for field, value in payload.model_dump(exclude_unset=True).items():
        if value is not None:
            setattr(ws, field, value)
    ws.updated_at = datetime.utcnow()
    self._session.add(ws)
    await self._session.commit()
    await self._session.refresh(ws)
    return ws

# router.py
@router.patch("/{workspace_id}", response_model=WorkspaceRead)
async def update_workspace(
    workspace_id: uuid.UUID,
    payload: WorkspaceUpdate,
    session: SessionDep,
    current_user: CurrentUser,
    _: None = Depends(require_permission(Permission.WORKSPACE_ADMIN)),
):
    svc = WorkspaceService(session)
    ws = await svc.update(workspace_id, payload)
    return WorkspaceRead.model_validate(ws)
```

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | PATCH /api/workspaces/{id} 更新 name | 200, 返回新 name |
| AC-02 | PATCH 更新多个元数据字段 | 200, 所有字段更新 |
| AC-03 | PATCH 不存在的 workspace | 404 |
| AC-04 | PATCH 无认证 | 401 |
| AC-05 | PATCH 不传任何字段 | 200, 返回原值 |
