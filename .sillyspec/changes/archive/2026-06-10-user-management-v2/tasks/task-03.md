---
id: task-03
title: "用户 Workspace 角色查询（后端）"
priority: P0
estimated_hours: 1
depends_on: []
blocks: [task-04]
allowed_paths:
  - backend/app/modules/settings/service.py
  - backend/app/modules/settings/router.py
  - backend/app/modules/settings/schema.py
author: WhaleFall
created_at: 2026-06-10T11:45:44
---

# task-03: 用户 Workspace 角色查询（后端）

## 修改文件（必填）

- `backend/app/modules/settings/schema.py` — 新增 `UserWorkspaceRead` DTO
- `backend/app/modules/settings/service.py` — 新增 `UserService.list_workspaces` 方法
- `backend/app/modules/settings/router.py` — 新增 `GET /api/users/{user_id}/workspaces` 端点，导入 `UserWorkspaceRead`

## 实现要求

1. 在 `schema.py` 新增 `UserWorkspaceRead` Pydantic DTO，包含 `workspace_name`、`workspace_slug`、`role_name` 三个字段
2. 在 `UserService` 新增 `list_workspaces(target_id: uuid.UUID) -> list[UserWorkspaceRead]` 方法，执行三表 JOIN 查询
3. 在 `router.py` 新增 `GET /api/users/{user_id}/workspaces` 端点，返回 `list[UserWorkspaceRead]`

## 接口定义（代码类任务必填）

### DTO — `UserWorkspaceRead`

```python
# 文件: backend/app/modules/settings/schema.py
# 位置: 在 AuditLogRead 类之后、ResetPasswordRequest 之前

class UserWorkspaceRead(BaseModel):
    """用户在某 Workspace 中持有的角色信息。"""
    workspace_name: str
    workspace_slug: str
    role_name: str
```

### Service — `UserService.list_workspaces`

```python
# 文件: backend/app/modules/settings/service.py
# 位置: 在 list_audit_logs 方法之后（Detail queries 区段）

async def list_workspaces(self, target_id: uuid.UUID) -> list[UserWorkspaceRead]:
    """查询用户所属 Workspace 及角色。

    JOIN 路径: UserWorkspaceRole -> Workspace -> Role
    只返回 workspace.status != 'deleted' 的记录。
    """
    from app.modules.auth.model import Role, UserWorkspaceRole
    from app.modules.workspace.model import Workspace

    stmt = (
        select(
            Workspace.name.label("workspace_name"),
            Workspace.slug.label("workspace_slug"),
            Role.name.label("role_name"),
        )
        .select_from(UserWorkspaceRole)
        .join(Workspace, UserWorkspaceRole.workspace_id == Workspace.id)
        .join(Role, UserWorkspaceRole.role_id == Role.id)
        .where(
            UserWorkspaceRole.user_id == target_id,
            Workspace.deleted_at.is_(None),
        )
    )
    result = await self.session.execute(stmt)
    rows = result.all()
    return [UserWorkspaceRead(
        workspace_name=r.workspace_name,
        workspace_slug=r.workspace_slug,
        role_name=r.role_name,
    ) for r in rows]
```

### Router — `GET /api/users/{user_id}/workspaces`

```python
# 文件: backend/app/modules/settings/router.py
# 位置: 在 list_user_audit 端点之后、reset_user_password 端点之前

@router.get("/users/{user_id}/workspaces", response_model=list[UserWorkspaceRead])
async def list_user_workspaces(
    user_id: str,
    session: SessionDep,
    _user: AdminUser,
) -> list[UserWorkspaceRead]:
    svc = UserService(session, actor_id=_user.id)
    return await svc.list_workspaces(uuid.UUID(user_id))
```

### 导入变更

`router.py` 顶部 schema 导入列表新增 `UserWorkspaceRead`：

```python
from app.modules.settings.schema import (
    AuditLogRead,
    ResetPasswordRequest,
    SettingRead,
    SettingsBulkRead,
    SettingsUpdateRequest,
    SettingsUpdateResponse,
    UserCreateRequest,
    UserListResponse,
    UserRead,
    UserSessionRead,
    UserUpdateRequest,
    UserWorkspaceRead,  # 新增
)
```

`service.py` 顶部无需新增导入（`list_workspaces` 方法内部延迟导入 `Role`、`UserWorkspaceRole`、`Workspace`，避免循环依赖风险）。如果不存在循环依赖，也可以改为顶部导入。

### 控制流伪代码

```
list_user_workspaces(user_id: str):
  1. 解析 user_id 为 UUID（无效则 FastAPI 自动 422）
  2. 检查调用者是 platform_admin（AdminUser 依赖项处理）
  3. 构造 UserService(session, actor_id=_user.id)
  4. 调用 svc.list_workspaces(target_id)
  5. list_workspaces 内部:
     a. 构造 SELECT 三表 JOIN 语句
     b. WHERE user_id = target_id AND workspace.deleted_at IS NULL
     c. 执行查询
     d. 将每行映射为 UserWorkspaceRead
  6. 返回列表（空列表也合法）
```

## 边界处理（必填）

1. **用户不存在**: `list_workspaces` 不需要单独检查用户是否存在。如果 user_id 在 `user_workspace_roles` 表中没有记录，SQL 查询返回空列表，端点返回 `[]`（HTTP 200），不报错。这与 `list_sessions`、`list_audit_logs` 的行为一致。

2. **用户无任何 Workspace 角色**: 返回空列表 `[]`，HTTP 200。前端据此显示"暂无 Workspace"占位。

3. **Workspace 已软删除**: WHERE 条件 `Workspace.deleted_at.is_(None)` 过滤掉已删除的 Workspace。用户在已删除 Workspace 中的角色不会出现在结果中。

4. **用户在同一 Workspace 持有多个角色**: `UserWorkspaceRole` 的复合 PK 是 `(user_id, workspace_id, role_id)`，同一用户可以有多行对应不同角色。查询会返回多行（如 workspace_name="项目A", role_name="developer" 和 workspace_name="项目A", role_name="reviewer"），这是正确行为，不做合并。

5. **user_id 格式非法**: 由 FastAPI 路径参数类型 + `uuid.UUID()` 构造抛出 `ValueError`，FastAPI 自动返回 422。不需手动处理。

6. **不修改传入参数**: `list_workspaces` 只读取数据，不做任何写操作，不修改 `target_id`，不修改 session 状态。

7. **数据库异常不静默吞掉**: SQL 查询异常由 FastAPI/SQLAlchemy 中间件统一处理为 500，不在 service 层捕获。

## 非目标（本任务不做的事）

- 不实现 Workspace 角色的分配/撤销（仅只读查询）
- 不实现分页（Workspace 角色数量有限，单用户通常 < 50 条）
- 不实现按 Workspace 或 Role 过滤
- 不修改 `UserWorkspaceRole`、`Workspace`、`Role` 模型
- 不创建新的 Service 类（在现有 `UserService` 上扩展）
- 不处理 `force_change_on_next_login`（属于 task-02）
- 不处理会话撤销（属于 task-01）
- 不修改前端代码（属于 task-04、task-05）

## 参考

- `UserService.list_sessions` — 现有 detail query 模式，`list_workspaces` 遵循相同模式
- `UserService.list_audit_logs` — 同上，返回列表无分页
- `router.py` 中 `list_user_sessions` / `list_user_audit` — 现有端点模式，新端点遵循相同的 `SessionDep + AdminUser + UserService` 注入模式
- `UserWorkspaceRole` 模型（`auth/model.py`）：复合 PK `(user_id, workspace_id, role_id)`，外键到 `users`、`workspaces`、`roles`
- `Role` 模型（`auth/model.py`）：`key`（唯一标识如 "admin"）、`name`（显示名）、`is_system`
- `Workspace` 模型（`workspace/model.py`）：`name`、`slug`、`deleted_at`（软删除标记）

## TDD 步骤

1. **写测试**: 在 `backend/tests/` 下新增测试用例（或找到现有 settings 相关测试文件追加），覆盖以下场景：
   - 用户有多个 Workspace 角色 → 返回正确列表
   - 用户无 Workspace 角色 → 返回空列表
   - 用户的某个 Workspace 已软删除 → 该 Workspace 的角色不出现
   - 用户在同一 Workspace 有多个角色 → 返回多行
   - user_id 格式非法 → 422
2. **确认失败**: 运行测试，确认新测试全部失败（功能尚未实现）
3. **写代码**: 按"实现要求"和"接口定义"依次修改 schema.py → service.py → router.py
4. **确认通过**: 运行测试，确认全部通过
5. **回归**: 运行 `python -m pytest backend/tests/ -x`，确认现有测试未受影响；运行 `ruff check backend/app/modules/settings/` 确认 lint 通过

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|----------|----------|
| AC-01 | `GET /api/users/{user_id}/workspaces` 端点存在且注册在 router 中 | FastAPI OpenAPI docs 显示该端点，需要 platform_admin 权限 |
| AC-02 | 调用端点传入有效 user_id（该用户有 workspace 角色记录） | 返回 HTTP 200，body 为 JSON 数组，每项包含 `workspace_name`、`workspace_slug`、`role_name`，值与数据库一致 |
| AC-03 | 调用端点传入有效 user_id（该用户无任何 workspace 角色） | 返回 HTTP 200，body 为 `[]` |
| AC-04 | 调用端点传入无效 user_id 格式（如 "abc"） | 返回 HTTP 422 |
| AC-05 | 数据库中存在已软删除的 workspace（deleted_at 非空），用户在该 workspace 有角色 | 返回结果中不包含该 workspace 的记录 |
| AC-06 | 用户在同一 workspace 有两个角色（如 developer + reviewer） | 返回两条记录，workspace_name 和 workspace_slug 相同，role_name 不同 |
| AC-07 | 非 admin 用户调用该端点 | 返回 HTTP 403 |
| AC-08 | `schema.py` 中 `UserWorkspaceRead` 类定义存在且字段类型正确 | `workspace_name: str`、`workspace_slug: str`、`role_name: str` |
| AC-09 | `ruff check backend/app/modules/settings/` | 零错误零警告 |
| AC-10 | 现有端点 `GET /api/users`、`GET /api/users/{user_id}/sessions`、`GET /api/users/{user_id}/audit` 功能不受影响 | 回归测试全部通过 |
