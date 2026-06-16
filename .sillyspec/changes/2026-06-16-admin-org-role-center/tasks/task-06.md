---
id: task-06
title: 用户管理后端迁移与扩展（admin users_service + settings 兼容 forward + auth login 检查）
priority: P0
estimated_hours: 5
depends_on: [task-04, task-05]
blocks: [task-07, task-08]
allowed_paths:
  - backend/app/modules/admin/users_service.py
  - backend/app/modules/admin/router.py
  - backend/app/modules/admin/schema.py
  - backend/app/modules/admin/tests/test_users_router.py
  - backend/app/modules/settings/service.py
  - backend/app/modules/settings/schema.py
  - backend/app/modules/settings/router.py
  - backend/app/modules/auth/service.py
author: WhaleFall
created_at: 2026-06-16T15:27:48
---

# task-06: 用户管理后端迁移与扩展

把 `settings/service.py` 中的 `UserService` 整体迁出到 `admin/users_service.py` 并扩展组织/角色绑定、登录权限控制两个能力；`settings/router.py` 的 11 个 `/api/users/*` 端点改为同步 forward 到 admin（保持 `require_platform_admin` 权限语义与响应字段不变）；`auth/service.py` 的 `login()` 加 `login_enabled` 检查。

依赖 task-04（roles_service 提供校验输入）+ task-05（organizations_service 提供校验输入）+ task-02（User.login_enabled 字段已就绪）。

## 修改文件

8 个文件（2 新建 + 6 修改）：

| 操作 | 路径 | 说明 |
|---|---|---|
| 新建 | `backend/app/modules/admin/users_service.py` | 从 `settings/service.py` 整体迁移 `UserService`；新增 `update_user_organizations` / `update_user_roles` / `disable_login` / `enable_login` |
| 新建 | `backend/app/modules/admin/tests/test_users_router.py` | 13 端点测试（11 兼容 + disable-login/enable-login）+ 自保护 + 最后管理员 + 组织/角色绑定 + session 撤销 |
| 修改 | `backend/app/modules/admin/schema.py` | `UserCreateRequest` / `UserUpdateRequest` 扩展 `organization_ids` / `role_ids` / `login_enabled` / `is_platform_admin`；`UserRead` 扩展 `login_enabled` + `organizations` + `roles` 关联数组；新增 `OrganizationBrief` / `RoleBrief` |
| 修改 | `backend/app/modules/admin/router.py` | 注册 `/api/admin/users` 11+2 端点（继承旧端点 + disable-login/enable-login）；写端点用 `Depends(require_permission(Permission.USER_WRITE))`，disable-login/enable-login 用 `USER_LOGIN_MANAGE` |
| 修改 | `backend/app/modules/settings/service.py` | 文件改为一行 re-export：`from app.modules.admin.users_service import UserService  # noqa: F401  兼容历史 import` |
| 修改 | `backend/app/modules/settings/schema.py` | User 相关 schema 改为 `from app.modules.admin.schema import UserCreateRequest, UserUpdateRequest, UserRead, UserListResponse, UserSessionRead, RevokeAllResponse, AuditLogRead, UserWorkspaceRead, ResetPasswordRequest, ResetPasswordResponse  # noqa: F401`；保留 PlatformSetting 相关 schema 本地定义 |
| 修改 | `backend/app/modules/settings/router.py` | 11 个 `/api/users/*` handler 内部改为 forward 调用（`from app.modules.admin.users_service import UserService`），权限依赖、签名、响应字段全部不变 |
| 修改 | `backend/app/modules/auth/service.py` | `login()` 在密码校验通过后插入 `if not user.login_enabled: raise AuthUserLoginDisabled`；同时从 `app.core.errors` import `AuthUserLoginDisabled` |

## 实现要求

### R-01: admin/users_service.py 整体迁移 + 扩展

- 从 `settings/service.py` 原样搬入 `UserService`（含 `_set_audit_context` / `_revoke_sessions` / `_active_admin_count` / `list_users` / `create_user` / `update_user` / `delete_user` / `list_sessions` / `revoke_session` / `revoke_all_sessions` / `list_audit_logs` / `list_workspaces` / `reset_password`），import 路径不变（`User` / `Role` / `UserWorkspaceRole` / `AuthSession` / `AuditLog` / `Workspace` 全部从原模块 import）
- `UserWorkspaceRead` import 从 `settings/schema` 改为 `admin/schema`（避免循环依赖，admin/schema 不反向 import settings）
- 新增方法签名（按 design.md §7.3 + FR-10 / FR-12）：

```python
async def update_user_organizations(
    self, target_id: uuid.UUID, *, organization_ids: list[uuid.UUID]
) -> User:
    """重写式更新用户的组织绑定。

    流程：
    1. target User 存在性检查（404 USER_NOT_FOUND）
    2. 校验所有 organization_ids 都存在且 status='active'（不存在 → 422）
    3. set audit_context
    4. 删除现有 user_organizations 关联（WHERE user_id = target_id）
    5. 批量插入新关联
    6. commit + refresh + return target
    """

async def update_user_roles(
    self, target_id: uuid.UUID, *, role_ids: list[uuid.UUID]
) -> User:
    """重写式更新用户的平台级角色绑定。

    流程：
    1. target User 存在性检查（404）
    2. 校验所有 role_ids 都存在且 is_active=true（不存在 → 422 ROLE_NOT_FOUND）
    3. set audit_context
    4. 删除现有 user_roles 关联
    5. 批量插入新关联
    6. commit + refresh + return target
    """

async def disable_login(self, target_id: uuid.UUID) -> User:
    """禁用登录 + 立即撤销所有 sessions。

    流程：
    1. 自保护：if self.actor_id == target_id → raise USER_SELF_DISABLE_LOGIN_FORBIDDEN
    2. target User 存在性检查（404）
    3. set audit_context
    4. target.login_enabled = False + target.updated_at = now
    5. await self._revoke_sessions(target_id)  # 复用现有方法
    6. commit + refresh + return target
    """

async def enable_login(self, target_id: uuid.UUID) -> User:
    """启用登录（不主动恢复 sessions，用户重新登录）。

    流程：
    1. target User 存在性检查（404）
    2. set audit_context
    3. target.login_enabled = True + target.updated_at = now
    4. commit + refresh + return target
    """
```

- `update_user` 扩展：在原有 `display_name` / `is_platform_admin` / `status` 基础上，新增可选参数 `login_enabled: bool | None`、`organization_ids: list[uuid.UUID] | None`、`role_ids: list[uuid.UUID] | None`；非 None 时分别走 `target.login_enabled =` 赋值 / `await self.update_user_organizations()` / `await self.update_user_roles()`（在事务内调用，不单独 commit）。最后管理员保护扩展：若 `is_platform_admin=False` 或 `login_enabled=False`（针对唯一 admin）→ 复用 `_active_admin_count()` 检查。

- `create_user` 扩展：在现有签名基础上新增可选 `login_enabled: bool = True`、`organization_ids: list[uuid.UUID] | None = None`、`role_ids: list[uuid.UUID] | None = None`；创建 User 后在事务内追加调用 `update_user_organizations` + `update_user_roles` 逻辑（直接复用，避免代码重复）。

### R-02: admin/schema.py User schema 扩展

```python
class OrganizationBrief(BaseModel):
    """UserRead.organizations 项 — 仅含 UI 展示必需字段。"""
    id: uuid.UUID
    name: str
    code: str

class RoleBrief(BaseModel):
    """UserRead.roles 项 — 仅含 UI 展示必需字段。"""
    id: uuid.UUID
    key: str
    name: str

class UserCreateRequest(BaseModel):
    email: str = Field(min_length=3)
    password: str = Field(min_length=8)
    display_name: str | None = None
    is_platform_admin: bool = False
    login_enabled: bool = True
    organization_ids: list[uuid.UUID] = Field(default_factory=list)
    role_ids: list[uuid.UUID] = Field(default_factory=list)

class UserUpdateRequest(BaseModel):
    display_name: str | None = None
    is_platform_admin: bool | None = None
    status: str | None = None
    login_enabled: bool | None = None
    organization_ids: list[uuid.UUID] | None = None  # None=不动；[] = 清空；[a,b]=替换
    role_ids: list[uuid.UUID] | None = None

class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    email: str
    display_name: str | None
    status: str
    is_platform_admin: bool
    login_enabled: bool              # 新增
    last_login_at: datetime | None
    created_at: datetime
    organizations: list[OrganizationBrief] = Field(default_factory=list)  # 新增
    roles: list[RoleBrief] = Field(default_factory=list)                  # 新增
```

- `UserRead` 从 ORM User 实例化时，`organizations` / `roles` 由 router/service 在响应前装配（service 返回 tuple `(User, list[Organization], list[Role])` 或 router 单独查询后注入）—— **实现选择**：service.list_users / get_user 返回的 User 已 eager-load `user_organizations` / `user_roles` 关系，UserRead.model_validate 时从关系读取（需在 service 查询时 `selectinload(User.user_organizations)`）
- 其它 schema（`UserListResponse` / `UserSessionRead` / `RevokeAllResponse` / `AuditLogRead` / `UserWorkspaceRead` / `ResetPasswordRequest` / `ResetPasswordResponse` / `UserQueryParams`）保持原签名

### R-03: admin/router.py 注册 13 端点

继承 11 个旧端点（与 settings/router.py 一一对应）+ 新增 2 个登录权限控制端点。所有端点权限依赖：

- 读端点（GET /users、GET /users/{id}/sessions、GET /users/{id}/audit、GET /users/{id}/workspaces）→ `Depends(require_permission(Permission.USER_READ))`
- 写端点（POST /users、PATCH /users/{id}、DELETE /users/{id}、revoke-session、revoke-all、reset-password）→ `Depends(require_permission(Permission.USER_WRITE))`
- 登录权限控制（disable-login / enable-login）→ `Depends(require_permission(Permission.USER_LOGIN_MANAGE))`
- `is_platform_admin=True` 用户走短路（rbac.py 已支持）

端点列表（path 以 router 注册时的 `/api` 前缀为根）：

```
GET    /admin/users                                   → list_users
POST   /admin/users                                   → create_user（201）
PATCH  /admin/users/{user_id}                         → update_user
DELETE /admin/users/{user_id}                         → delete_user（204）
GET    /admin/users/{user_id}/sessions                → list_user_sessions
DELETE /admin/users/{user_id}/sessions/{session_id}   → revoke_user_session（204）
POST   /admin/users/{user_id}/sessions/revoke-all     → revoke_all_user_sessions
GET    /admin/users/{user_id}/audit                   → list_user_audit
GET    /admin/users/{user_id}/workspaces              → list_user_workspaces
POST   /admin/users/{user_id}/reset-password          → reset_user_password
GET    /admin/users/{user_id}                         → get_user_detail（新增，含 organizations+roles 关联）
POST   /admin/users/{user_id}/disable-login           → disable_login（新增）
POST   /admin/users/{user_id}/enable-login            → enable_login（新增）
```

注意：旧 settings/router.py 中没有 `GET /users/{id}` 详情端点，admin 新增该端点用于前端 Drawer 装载完整关联数据。

### R-04: settings/router.py forward 实现

11 个 `/api/users/*` handler 改为同步 import 调用 admin.users_service.UserService：

```python
@router.get("/users", response_model=UserListResponse)
async def list_users(
    session: SessionDep,
    user: AdminUser,  # ← 权限依赖保持 require_platform_admin 不变（避免 R-06 回归）
    q: str | None = Query(None),
    ...
) -> UserListResponse:
    from app.modules.admin.users_service import UserService  # 函数内 import 避免模块加载顺序问题
    svc = UserService(session, actor_id=user.id)
    rows, total = await svc.list_users(...)
    return UserListResponse(items=[UserRead.model_validate(u) for u in rows], total=total)
```

- 所有 11 个 handler 顶层签名（路径、HTTP 方法、Query 参数、权限依赖、响应模型）**完全不变**
- 仅 handler body 内的 `UserService` import 改为从 admin 引入；`from app.modules.settings.service import UserService` 顶层 import 删除（替换为函数内 lazy import）
- 响应字段不变（UserRead 通过 settings/schema.py 的 re-export 仍可访问，且字段是超集，旧客户端忽略新增 `login_enabled` / `organizations` / `roles`）

### R-05: settings/service.py + schema.py re-export

`settings/service.py` 全文：

```python
"""UserService has moved to app.modules.admin.users_service.

This module re-exports UserService for backwards compatibility with
historical imports (tests, other modules). New code should import from
admin.users_service directly.
"""
from __future__ import annotations

from app.modules.admin.users_service import UserService  # noqa: F401

__all__ = ["UserService"]
```

`settings/schema.py` 保留 PlatformSetting 相关 schema（`SettingRead` / `SettingsBulkRead` / `SettingsUpdateRequest` / `SettingsUpdateResponse`），User 相关 schema 在文件末尾追加：

```python
# User-related schemas moved to admin.schema; re-export for back-compat.
from app.modules.admin.schema import (  # noqa: F401
    AuditLogRead,
    OrganizationBrief,
    ResetPasswordRequest,
    ResetPasswordResponse,
    RevokeAllResponse,
    RoleBrief,
    UserCreateRequest,
    UserListResponse,
    UserQueryParams,
    UserRead,
    UserSessionRead,
    UserUpdateRequest,
    UserWorkspaceRead,
)
```

### R-06: auth/service.py login() 加 login_enabled 检查

在 `login()` 方法密码校验通过、issue token 之前插入：

```python
async def login(self, *, email: str, password: str, ...) -> tuple[User, TokenPair]:
    user = await self._lookup_active_user_by_email(email)
    if user is None or not password_hasher.verify(password, user.password_hash):
        raise AuthInvalidCredentials("Invalid email or password.")

    # 新增：登录权限检查
    if not user.login_enabled:
        raise AuthUserLoginDisabled(
            "Login has been disabled for this account.",
            details={"user_id": str(user.id)},
        )

    pair = await self._issue_token_pair(user, user_agent=user_agent, ip=ip)
    ...
```

`AuthUserLoginDisabled` 错误类（task-03 已在 `core/errors.py` 注册，本任务只 import + 使用）。

注意：密码先校验、login_enabled 后校验 —— 防止通过错误码差异探测账号是否存在（与现有 `AuthInvalidCredentials` 统一信封策略一致）。

## 接口定义

### UserService 新增方法签名（汇总）

```python
async def update_user_organizations(
    self, target_id: uuid.UUID, *, organization_ids: list[uuid.UUID]
) -> User: ...

async def update_user_roles(
    self, target_id: uuid.UUID, *, role_ids: list[uuid.UUID]
) -> User: ...

async def disable_login(self, target_id: uuid.UUID) -> User: ...

async def enable_login(self, target_id: uuid.UUID) -> User: ...
```

### 现有方法扩展签名（差异部分）

```python
async def create_user(
    self, *,
    email: str,
    password: str,
    display_name: str | None = None,
    is_platform_admin: bool = False,
    login_enabled: bool = True,                           # 新增
    organization_ids: list[uuid.UUID] | None = None,      # 新增
    role_ids: list[uuid.UUID] | None = None,              # 新增
) -> User: ...

async def update_user(
    self, target_id: uuid.UUID, *,
    display_name: str | None = None,
    is_platform_admin: bool | None = None,
    status: str | None = None,
    login_enabled: bool | None = None,                    # 新增
    organization_ids: list[uuid.UUID] | None = None,      # 新增
    role_ids: list[uuid.UUID] | None = None,              # 新增
) -> User: ...
```

### 13 端点完整定义（admin/router.py）

| # | 方法 | 路径 | 请求体 | 响应 | 状态码 | 权限 |
|---|---|---|---|---|---|---|
| 1 | GET | /admin/users | — | UserListResponse | 200 | USER_READ |
| 2 | POST | /admin/users | UserCreateRequest | UserRead | 201 | USER_WRITE |
| 3 | GET | /admin/users/{id} | — | UserRead | 200 | USER_READ |
| 4 | PATCH | /admin/users/{id} | UserUpdateRequest | UserRead | 200 | USER_WRITE |
| 5 | DELETE | /admin/users/{id} | — | — | 204 | USER_WRITE |
| 6 | GET | /admin/users/{id}/sessions | — | list[UserSessionRead] | 200 | USER_READ |
| 7 | DELETE | /admin/users/{id}/sessions/{sid} | — | — | 204 | USER_WRITE |
| 8 | POST | /admin/users/{id}/sessions/revoke-all | — | RevokeAllResponse | 200 | USER_WRITE |
| 9 | GET | /admin/users/{id}/audit | — | list[AuditLogRead] | 200 | USER_READ |
| 10 | GET | /admin/users/{id}/workspaces | — | list[UserWorkspaceRead] | 200 | USER_READ |
| 11 | POST | /admin/users/{id}/reset-password | ResetPasswordRequest | ResetPasswordResponse | 200 | USER_WRITE |
| 12 | POST | /admin/users/{id}/disable-login | — | UserRead | 200 | USER_LOGIN_MANAGE |
| 13 | POST | /admin/users/{id}/enable-login | — | UserRead | 200 | USER_LOGIN_MANAGE |

### forward 实现伪代码（settings/router.py）

```python
@router.{method}("/users{sub_path}", ...)
async def handler(
    {path_params},
    {body_param},
    session: SessionDep,
    user: AdminUser,
) -> ResponseModel:
    from app.modules.admin.users_service import UserService  # lazy import
    svc = UserService(session, actor_id=user.id)
    return await svc.{method_name}({args})
```

11 个 handler 全部按此模式重写。**关键约束**：函数内 lazy import 而非顶层 import，规避循环依赖风险（R-01）。

## 边界处理

1. **单向依赖**：admin 模块所有文件禁止 `from app.modules.settings import ...`；settings 单向依赖 admin。CI 测试新增 `import app.modules.settings.router` + `import app.modules.admin.router` 双向加载验证不抛 `ImportError`/`CircularImportError`。
2. **forward 字段兼容**：UserRead 是超集，旧客户端 JSON 反序列化时忽略 `login_enabled` / `organizations` / `roles` 字段；旧 `/api/users` 不返回 404，行为与迁移前完全一致（响应字段、状态码、错误码全部不变）。
3. **不能删除自己** → `delete_user(self.actor_id)` 抛 `PermissionDenied` 含 `code="USER_SELF_DELETE_FORBIDDEN"`（403）。
4. **不能 disable-login 自己** → `disable_login(self.actor_id)` 抛 `PermissionDenied` 含 `code="USER_SELF_DISABLE_LOGIN_FORBIDDEN"`（403）。
5. **最后一个 is_platform_admin 用户保护** → `update_user` 中 `is_platform_admin=False`（或 `login_enabled=False` 且目标是唯一 admin）时复用 `_active_admin_count()`，count ≤ 1 抛 `PermissionDenied` 含 `code="USER_LAST_ADMIN_PROTECTED"`（403）。
6. **重置密码 / disable-login 立即撤销所有 sessions** → 复用现有 `_revoke_sessions()` 方法；reset_password 已有该逻辑保留；disable_login 新增该逻辑。
7. **organization_ids / role_ids 校验失败** → 任一 id 在数据库不存在 → `VALIDATION_ERROR`（422）含 `details={"missing_ids": [...], "kind": "organization"|"role"}`；不写入数据库（事务回滚）。
8. **update 时 organization_ids/role_ids 为 `None`**（默认） → 不修改现有绑定；为 `[]` → 清空所有绑定；为 `[a, b]` → 替换为 [a, b]（重写式语义，与 design.md §7.3 一致）。
9. **`AuthUserLoginDisabled` 错误信封** → 与 `AuthInvalidCredentials` 一致（`code` + `message` + `request_id` + `details`），http_status=401，避免前端需要单独适配。
10. **新 GET /admin/users/{id} 详情端点** → 与旧 settings 不冲突（旧端点没有此 path）；返回 UserRead 含 organizations + roles 关联数组，供前端 Drawer 渲染。

## 非目标

- 不实现前端代码（task-07~11 负责）
- 不修改 `user_workspace_roles` 关系（workspace 级角色保持现状）
- 不引入「忘记密码 / 邮件重置流程」（仅管理员主动 reset）
- 不修改 `auth/router.py` 的 `/api/auth/login` 端点签名（仅 service 层加 login_enabled 检查）
- 不引入 `GET /api/admin/users/{id}/organizations` 独立子资源端点（合并到 UserRead.organizations）
- 不实现批量操作（批量 disable / 批量删除）

## 参考

- design.md §7.3 用户管理接口（端点签名 + UserRead 扩展字段）
- design.md §7.4 现有 /api/users 兼容路径（forward 伪代码）
- design.md §9 兼容策略（响应字段超集 + 单向依赖 + 回退路径）
- requirements.md FR-10 用户管理 CRUD 扩展
- requirements.md FR-11 自保护与最后管理员保护
- requirements.md FR-12 登录权限控制
- requirements.md FR-13 现有 /api/users 端点兼容
- 现有 `backend/app/modules/settings/service.py` UserService 全部方法签名（迁移源）
- 现有 `backend/app/modules/settings/router.py` 11 个 `/api/users/*` 端点（forward 源）
- 现有 `backend/app/modules/auth/service.py` `login()` 方法（注入点）

## TDD 步骤

1. **写测试** — 创建 `admin/tests/test_users_router.py`，覆盖：
   - 11 个旧端点的兼容性（请求/响应字段、状态码、错误码与迁移前一致）
   - 新增 2 个端点（disable-login / enable-login）成功路径
   - 自保护：DELETE 自己 → 403 `USER_SELF_DELETE_FORBIDDEN`
   - 自保护：POST disable-login 自己 → 403 `USER_SELF_DISABLE_LOGIN_FORBIDDEN`
   - 最后管理员：PATCH 唯一 admin 的 `is_platform_admin=false` → 403 `USER_LAST_ADMIN_PROTECTED`
   - 最后管理员：PATCH 唯一 admin 的 `login_enabled=false` → 403 `USER_LAST_ADMIN_PROTECTED`
   - 组织绑定：POST /admin/users 含 `organization_ids=[org1, org2]` → 响应 `organizations` 含两项
   - 角色绑定：PATCH /admin/users/{id} 含 `role_ids=[role1]` → 响应 `roles` 含一项；再次 PATCH `role_ids=[]` → `roles` 为空
   - 非法 id：POST 含 `organization_ids=[<不存在 uuid>]` → 422
   - session 撤销：disable-login 后 user 的所有 sessions `revoked_at IS NOT NULL`
   - 审计：每个写操作完成后 audit_logs 表有对应记录（action / actor_id / resource_id）
   - 登录权限：禁用 Bob 后 `POST /api/auth/login` 用 Bob 凭据 → 401 `AUTH_USER_LOGIN_DISABLED`
   - 权限检查：普通用户（无 USER_WRITE）调 POST /admin/users → 403 `PERMISSION_DENIED`
2. **跑测试失败** — `pytest app/modules/admin/tests/test_users_router.py`，预期全部 fail（UserService 未迁移、端点未注册、schema 未扩展）
3. **迁移 + 扩展** — 按 R-01 ~ R-06 顺序实现
4. **跑测试通过** — `pytest app/modules/admin/tests/test_users_router.py` 全绿
5. **回归测试** — `pytest app/modules/settings/tests/ app/modules/auth/tests/` 全绿，验证 forward 兼容不破坏现有功能

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | GET /api/users（旧 settings 端点）| 200 + 响应字段与迁移前一致（含 items/total；旧客户端忽略新增 login_enabled/organizations/roles） |
| AC-02 | DELETE /api/users/{自己 id}（旧端点）| 403 + 错误码 `USER_SELF_DELETE_FORBIDDEN` |
| AC-03 | POST /api/admin/users/{bob_id}/disable-login | 200 + 响应 `login_enabled=false` + Bob 的 3 个 sessions 全部 `revoked_at IS NOT NULL` + audit_logs 记录 |
| AC-04 | POST /api/admin/users/{bob_id}/disable-login（actor=bob 自己）| 403 + 错误码 `USER_SELF_DISABLE_LOGIN_FORBIDDEN` |
| AC-05 | POST /api/admin/users/{bob_id}/enable-login | 200 + 响应 `login_enabled=true`（sessions 不自动恢复）|
| AC-06 | PATCH /api/admin/users/{唯一 admin id} body `{"is_platform_admin": false}` | 403 + 错误码 `USER_LAST_ADMIN_PROTECTED` |
| AC-07 | POST /api/admin/users body `{"email": ..., "password": ..., "organization_ids": [org1, org2], "role_ids": [role1]}` | 201 + 响应 `organizations` 含 2 项 + `roles` 含 1 项 + DB 表 user_organizations/user_roles 写入对应记录 |
| AC-08 | PATCH /api/admin/users/{alice_id} body `{"organization_ids": [eng_id]}`（alice 原绑定 [ENG, QA]）| 200 + 响应 `organizations` 仅含 ENG + user_organizations 表 QA 关联已删除（事务原子）|
| AC-09 | POST /api/admin/users body 含 `organization_ids=[<不存在的 uuid>]` | 422 + 错误码 `VALIDATION_ERROR` + details.missing_ids 含该 uuid + 数据库无写入 |
| AC-10 | POST /api/auth/login 用 login_enabled=false 的用户凭据 | 401 + 错误码 `AUTH_USER_LOGIN_DISABLED` |
| AC-11 | 普通用户（无 USER_WRITE 权限、is_platform_admin=false）调 POST /api/admin/users | 403 + 错误码 `PERMISSION_DENIED` |
| AC-12 | GET /api/admin/users/{id}（新详情端点）| 200 + UserRead 含完整 organizations + roles 关联数组 |
| AC-13 | `pytest app/modules/admin/tests/test_users_router.py` | 全绿（覆盖 ≥20 个测试用例）|
| AC-14 | `pytest app/modules/settings/tests/ app/modules/auth/tests/` | 全绿（forward 兼容不破坏现有功能）|
| AC-15 | `python -c "import app.modules.settings.router; import app.modules.admin.router"` | 无 ImportError / CircularImportError |
| AC-16 | disable-login 后 audit_logs 表对应记录存在 | action 字段匹配（如 `user.login_disabled`）+ actor_id + resource_id + timestamp 正确 |
| AC-17 | 旧端点 11 个全部 forward 后权限依赖仍为 `require_platform_admin` | 旧测试用例（平台管理员访问）通过；普通用户访问 → 403 |
