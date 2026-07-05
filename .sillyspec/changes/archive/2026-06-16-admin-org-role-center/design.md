---
author: WhaleFall
created_at: 2026-06-16T09:55:00
---

# Design: 组织与权限中心（用户/组织/角色三模块）

## 变更名

`2026-06-16-admin-org-role-center`

## 1. 背景

当前用户管理嵌在 `/settings` 页面的 UsersTab，后端 `/api/users` 与 `/api/settings` 同住 `backend/app/modules/settings/router.py`。第一阶段（`2026-06-10-user-management`）已完成安全加固 + 基础功能（自保护、最后管理员保护、审计、会话管理、密码重置），但：

- 用户管理属于身份域，与 `auth` 模块（已有 Role/RolePermission/UserWorkspaceRole/Permission）天然耦合，目前却被困在 `settings` 模块内
- 缺少组织维度：用户只能按平台管理员/普通用户二分，无法表达跨部门、跨工作区的组织归属
- 缺少可视化的角色管理 UI：现有角色表 `is_system`/`RolePermission` 都已就绪，但没有 CRUD 端点也没有前端
- `settings` 模块边界模糊：平台键值配置 + 用户管理混在一起，违反单一职责

本次变更把用户管理彻底从 settings 剥离，并补齐组织 + 角色管理，形成统一的「系统管理」入口。

## 2. 设计目标

- 数据模型层：新增 `organizations` / `user_organizations` / `user_roles` 三张表，扩展现有 `roles` / `users`
- API 层：新增 `/api/admin/{users,organizations,roles}` 三组端点，旧 `/api/users` 保留并 forward
- 权限层：`Permission` StrEnum 加 `group` 属性 + 新增 `user:*` / `organization:*` / `role:*` 权限
- 安全层：复用现有 UserService 自保护/最后管理员保护，扩展 login_enabled 控制
- 前端：新增 `/admin/{users,organizations,roles}` 三页面 + 左侧导航「系统管理」分组；settings 删除 UsersTab
- 审计：依赖现有 SQLAlchemy `audit_hooks.py` 自动捕获，无需业务代码改动

## 3. 非目标

明确不做：

- **工作区级角色管理 UI**：`UserWorkspaceRole` 保持现状不动；本期仅做平台级角色，但 schema 预留扩展
- **邀请流程 / 邮件验证**：用户仍由管理员手动创建
- **MFA / OAuth / SSO**：维持现有 JWT 双 token 方案
- **Git 身份绑定**：与 `git_identity` 模块无关
- **批量导入用户**：本期不做
- **组织级别角色**：仅平台级角色，组织内角色留待后续
- **数据权限（行级 / 列级）**：仅功能权限，不涉及数据可见性

## 4. 拆分判断

三个子模块（用户/组织/角色）耦合度评估：

- 角色管理 → 独立可用（无依赖）
- 组织管理 → 独立可用（无依赖）
- 用户管理 → 依赖前两者（编辑用户时选组织 + 角色）

因此按用户指定的优先顺序拆为 4 个 Wave（在单一变更内承载，无需 MASTER 子变更）：

- **Wave 1**：数据模型 + 模块骨架（基础设施，所有后续 Wave 依赖）
- **Wave 2**：角色管理（无依赖，最早可交付）
- **Wave 3**：组织管理（无依赖，可并行 Wave 2 但顺序执行避免迁移冲突）
- **Wave 4**：用户管理升级 + settings 剥离（依赖 Wave 2/3）

不批量模式：三个模块业务逻辑差异大（角色=权限集管理，组织=树形结构，用户=身份+绑定），非「模板×数据」。

## 5. 总体方案

### 5.1 架构方案 A（用户确认）

新增独立 `admin` 模块，承载三组 service。settings/router.py 保留 `/api/users` 但内部 forward 到 `admin.users_service`，单向依赖（settings → admin），admin 不反向依赖 settings。

```
backend/app/modules/
├── admin/         ← 新增（核心交付）
│   ├── model.py                       Organization, UserOrganization, UserRole
│   ├── schema.py                      请求/响应 DTO（admin/* 共用）
│   ├── users_service.py               ← 从 settings/service.py 迁移
│   ├── organizations_service.py
│   ├── roles_service.py
│   ├── router.py                      /api/admin/{users,organizations,roles}
│   └── tests/
├── settings/
│   ├── router.py                      /api/users 端点保留，内部 forward 到 admin
│   └── service.py                     UserService 类移除（或保留空 stub 兼容历史 import）
├── auth/
│   ├── model.py                       Role 加 is_active + updated_at；User 加 login_enabled
│   ├── permissions.py                 加 group 属性 + 新增 USER_*/ORG_*/ROLE_*
│   ├── rbac.py                        扩展支持 user_roles（平台级）
│   └── service.py                     login() 增加 login_enabled 检查
```

### 5.2 数据流

- 创建用户 → `POST /api/admin/users` → `users_service.create_user()` → 写 `users` + `user_organizations` + `user_roles` → audit_hooks 自动记录
- 编辑用户角色 → `PATCH /api/admin/users/{id}` → `users_service.update_user()` → 重写 `user_roles`（删旧+插新）→ 事务原子
- 禁用登录 → `POST /api/admin/users/{id}/disable-login` → `users.login_enabled = false` + 撤销 sessions → audit_hooks 捕获 user 更新 + sessions 删除
- 角色删除前置检查 → `roles_service.delete_role()` → 查 `user_roles` count > 0 → 抛 `RoleInUse`
- 组织删除前置检查 → `organizations_service.delete_organization()` → 查 children + user_organizations 任一非 0 → 抛 `OrganizationInUse`
- 权限检查 → 路由声明 `Depends(require_permission(Permission.ROLE_WRITE))` 或 `Depends(require_platform_admin)` → 现有 `auth_deps.py` 逻辑短路

### 5.3 权限分组（前端 UI）

`Permission.group` 属性按字符串 prefix 解析，无额外表：

| Prefix | Group |
|---|---|
| `platform:` | PLATFORM（platform_admin / billing / audit:read） |
| `user:` / `organization:` / `role:` | ADMIN |
| `workspace:` | WORKSPACE |
| `change:` | CHANGE |
| `task:` / `code:` / `tool:` | AGENT（合并展示） |
| `deploy:` | DEPLOY（前端可挂在 AGENT 下或单列） |

## 6. 文件变更清单

### 6.1 新增文件

| 操作 | 路径 | 说明 |
|---|---|---|
| 新增 | `backend/migrations/versions/202606161200_create_admin_org_role.py` | 创建 organizations + user_organizations + user_roles 表；roles 加 is_active/updated_at；users 加 login_enabled |
| 新增 | `backend/app/modules/admin/__init__.py` | 模块导出 |
| 新增 | `backend/app/modules/admin/model.py` | Organization, UserOrganization, UserRole ORM |
| 新增 | `backend/app/modules/admin/schema.py` | 请求/响应 DTO |
| 新增 | `backend/app/modules/admin/router.py` | /api/admin/{users,organizations,roles} 端点 |
| 新增 | `backend/app/modules/admin/users_service.py` | 从 settings/service.py 迁移 UserService，扩展 organization/role 绑定 |
| 新增 | `backend/app/modules/admin/organizations_service.py` | 组织 CRUD + 树形结构 + 删除前置检查 |
| 新增 | `backend/app/modules/admin/roles_service.py` | 角色 CRUD + 权限配置 + 系统角色保护 |
| 新增 | `backend/app/modules/admin/tests/__init__.py` | 测试包 |
| 新增 | `backend/app/modules/admin/tests/test_users_router.py` | 用户管理 API 测试 |
| 新增 | `backend/app/modules/admin/tests/test_organizations_router.py` | 组织管理 API 测试 |
| 新增 | `backend/app/modules/admin/tests/test_roles_router.py` | 角色管理 API 测试 |
| 新增 | `frontend/src/app/(dashboard)/admin/layout.tsx` | 鉴权 + 子菜单（无权限重定向到 /） |
| 新增 | `frontend/src/app/(dashboard)/admin/users/page.tsx` | 用户管理页面 |
| 新增 | `frontend/src/app/(dashboard)/admin/organizations/page.tsx` | 组织管理页面（左树+右详情） |
| 新增 | `frontend/src/app/(dashboard)/admin/roles/page.tsx` | 角色管理页面 |
| 新增 | `frontend/src/lib/admin.ts` | admin API 客户端（users/orgs/roles 三组函数） |
| 新增 | `frontend/src/lib/__tests__/admin.test.ts` | admin API 客户端测试 |
| 新增 | `frontend/src/components/admin-user-drawer.tsx` | 用户编辑 Drawer（组织/角色多选 + 登录权限） |
| 新增 | `frontend/src/components/admin-organization-tree.tsx` | 组织树组件（递归渲染） |
| 新增 | `frontend/src/components/admin-role-permission-picker.tsx` | 角色权限选择器（按 Permission.group 分组） |

### 6.2 修改文件

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | `backend/app/modules/auth/model.py` | Role 加 `is_active: bool` + `updated_at: datetime`；User 加 `login_enabled: bool = True` |
| 修改 | `backend/app/modules/auth/permissions.py` | Permission StrEnum 新增 USER_READ/WRITE/LOGIN_MANAGE、ORGANIZATION_READ/WRITE、ROLE_READ/WRITE 共 7 项；新增 `PermissionGroup` 枚举；Permission 加 `group` 属性（按 prefix 解析） |
| 修改 | `backend/app/modules/auth/rbac.py` | 扩展 `has_permission()` 查询路径：先看 `user.is_platform_admin`（短路）→ 再查 `user_roles` → `role_permissions`（平台级链路） |
| 修改 | `backend/app/modules/auth/service.py` | `AuthService.login()` 增加 `if not user.login_enabled: raise AuthUserLoginDisabled` |
| 修改 | `backend/app/modules/auth/errors.py`（或 core/errors.py） | 新增 `AuthUserLoginDisabled`、`RoleInUse`、`RoleSystemProtected`、`OrganizationInUse`、`OrganizationHasChildren` |
| 修改 | `backend/app/modules/settings/router.py` | `/api/users/*` 端点保留，handler 内部改为 forward 到 `admin.users_service`（import 调用，非 HTTP） |
| 修改 | `backend/app/modules/settings/service.py` | UserService 类整体迁出，文件保留 `from app.modules.admin.users_service import UserService  # 兼容历史 import` re-export |
| 修改 | `backend/app/modules/settings/schema.py` | User 相关 schema 迁出到 admin/schema.py；settings/schema.py 保留 `from app.modules.admin.schema import ...` re-export |
| 修改 | `backend/app/main.py` | 注册 `admin_router`：`app.include_router(admin_router, prefix="/api")` |
| 修改 | `backend/app/modules/auth/seed.py`（或 bootstrap 函数所在文件） | seed `platform_admin` 角色（is_system=true）+ 绑定所有 Permission |
| 修改 | `frontend/src/app/(dashboard)/settings/page.tsx` | 删除 UsersTab（及对应 import + state） |
| 修改 | `frontend/src/components/app-shell.tsx` | 左侧导航新增「系统管理」分组，含用户/组织/角色三个入口 |
| 修改 | `frontend/src/lib/settings.ts` | 移除用户管理 API 函数（已迁到 admin.ts） |

### 6.3 删除文件

无（settings/service.py 和 schema.py 仅清空内容、保留 re-export，避免破坏历史 import 路径）。

## 7. 接口定义

### 7.1 角色管理 `/api/admin/roles`

```python
# 列表
GET /api/admin/roles?search=&is_active=&page=1&size=20
  → RoleListResponse { items: RoleRead[], total, page, size }

# 详情
GET /api/admin/roles/{role_id}
  → RoleRead

# 创建
POST /api/admin/roles
  body: RoleCreateRequest {
    key: str (max 50, unique, lowercase_snake)
    name: str (max 100)
    description: str | None
    permission_keys: list[Permission]  # 必须是 Permission 枚举子集
  }
  → RoleRead

# 更新（非系统角色）
PATCH /api/admin/roles/{role_id}
  body: RoleUpdateRequest {  # 全部可选
    name?, description?, permission_keys?, is_active?
  }
  → RoleRead

# 启用 / 禁用
POST /api/admin/roles/{role_id}/disable
POST /api/admin/roles/{role_id}/enable
  → RoleRead

# 删除（前置：!is_system && user_roles count == 0）
DELETE /api/admin/roles/{role_id}
  → 204
```

`RoleRead` schema：
```python
class RoleRead(BaseModel):
    id: uuid.UUID
    key: str
    name: str
    description: str | None
    is_system: bool
    is_active: bool
    permissions: list[str]  # Permission 字符串值
    user_count: int         # 关联用户数（用于前端禁用删除按钮）
    created_at: datetime
    updated_at: datetime
```

### 7.2 组织管理 `/api/admin/organizations`

```python
# 列表（支持 parent_id 过滤子树；不传返回全树扁平）
GET /api/admin/organizations?parent_id=&is_active=
  → list[OrganizationRead]

# 详情（含 children + member_count）
GET /api/admin/organizations/{org_id}
  → OrganizationDetail

# 创建
POST /api/admin/organizations
  body: OrganizationCreateRequest {
    name: str (max 100)
    code: str (max 50, unique)
    description: str | None
    parent_id: uuid | None
    sort_order: int = 0
  }
  → OrganizationRead

# 更新
PATCH /api/admin/organizations/{org_id}
  body: OrganizationUpdateRequest { ...全部可选 }
  → OrganizationRead

# 启用 / 禁用
POST /api/admin/organizations/{org_id}/disable
POST /api/admin/organizations/{org_id}/enable
  → OrganizationRead

# 删除（前置：children count == 0 && user_organizations count == 0）
DELETE /api/admin/organizations/{org_id}
  → 204
```

`OrganizationRead` schema：
```python
class OrganizationRead(BaseModel):
    id: uuid.UUID
    name: str
    code: str
    description: str | None
    parent_id: uuid | None
    status: Literal["active", "disabled"]
    sort_order: int
    member_count: int
    children_count: int
    created_at: datetime
    updated_at: datetime
```

### 7.3 用户管理 `/api/admin/users`

继承现有 `/api/users` 端点（11 个），新增以下扩展：

```python
# 创建用户（扩展现有 schema）
POST /api/admin/users
  body: UserCreateRequest {
    email, password, display_name,
    is_platform_admin: bool = False,
    login_enabled: bool = True,
    organization_ids: list[uuid] = []
    role_ids: list[uuid] = []
  }
  → UserRead  # 含 organizations + roles 字段

# 更新用户
PATCH /api/admin/users/{user_id}
  body: UserUpdateRequest {
    display_name?, is_platform_admin?, login_enabled?,
    organization_ids?, role_ids?  # 重写式更新（替换全部绑定）
  }
  → UserRead

# 登录权限控制（新增端点）
POST /api/admin/users/{user_id}/disable-login
  → 撤销所有 sessions + users.login_enabled = false → UserRead
POST /api/admin/users/{user_id}/enable-login
  → users.login_enabled = true → UserRead
```

`UserRead` 扩展（在现有字段基础上）：
```python
class UserRead(BaseModel):
    # 现有字段...
    id: uuid.UUID
    email: str
    display_name: str | None
    is_platform_admin: bool
    is_active: bool
    login_enabled: bool       # 新增
    last_login_at: datetime | None
    created_at: datetime
    # 新增关联
    organizations: list[OrganizationBrief]   # [{id, name, code}]
    roles: list[RoleBrief]                   # [{id, key, name}]
```

### 7.4 现有 `/api/users` 兼容路径

`settings/router.py` 保留所有 11 个 `/api/users/*` 端点签名不变，handler 改为：

```python
@router.get("/users", response_model=UserListResponse)
async def list_users(
    session: Annotated[AsyncSession, Depends(get_session)],
    user: Annotated[User, Depends(require_platform_admin)],
    search: str = "",
    ...
) -> UserListResponse:
    # forward 到 admin.users_service
    from app.modules.admin.users_service import UserService
    service = UserService(session, actor_id=user.id)
    return await service.list_users(...)
```

## 8. 数据模型

### 8.1 新增表

```sql
-- organizations：组织树
CREATE TABLE organizations (
    id UUID PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    code VARCHAR(50) NOT NULL UNIQUE,
    description TEXT,
    parent_id UUID REFERENCES organizations(id) ON DELETE RESTRICT,
    status VARCHAR(16) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'disabled')),
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX ix_organizations_parent_id ON organizations(parent_id);
CREATE INDEX ix_organizations_status ON organizations(status);
COMMENT ON COLUMN organizations.status IS
    'active=可绑定新用户；disabled=仅历史保留，不允许新绑定';

-- user_organizations：多对多关联（用户↔组织）
CREATE TABLE user_organizations (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (user_id, organization_id)
);
CREATE INDEX ix_user_organizations_org ON user_organizations(organization_id);

-- user_roles：平台级用户↔角色关联（区别于 user_workspace_roles）
CREATE TABLE user_roles (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (user_id, role_id)
);
CREATE INDEX ix_user_roles_role ON user_roles(role_id);
```

### 8.2 现有表扩展

```sql
-- roles 加 is_active + updated_at
ALTER TABLE roles
    ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
CREATE INDEX ix_roles_is_active ON roles(is_active);

-- users 加 login_enabled（与 is_active 区分：is_active 是软删除标记，login_enabled 是登录权限）
ALTER TABLE users
    ADD COLUMN login_enabled BOOLEAN NOT NULL DEFAULT TRUE;
COMMENT ON COLUMN users.login_enabled IS
    '管理员可独立切换的登录权限；is_active=整体生命周期';
```

### 8.3 ER 关系图

```
users 1───* user_organizations *───1 organizations
                                   organizations 1───* organizations (self-ref via parent_id)
users 1───* user_roles *───1 roles ──* role_permissions
users 1───* user_workspace_roles *───1 roles（现有，不动）
users 1───* sessions（现有，不动）
```

### 8.4 Permission 枚举扩展

```python
# backend/app/modules/auth/permissions.py
class PermissionGroup(StrEnum):
    PLATFORM = "platform"
    ADMIN = "admin"
    WORKSPACE = "workspace"
    AGENT = "agent"
    CHANGE = "change"
    AUDIT = "audit"

class Permission(StrEnum):
    # 现有 25 项保留...

    # 新增（admin 组）
    USER_READ = "user:read"
    USER_WRITE = "user:write"                # create/update/delete/reset_password
    USER_LOGIN_MANAGE = "user:login:manage"  # enable/disable-login
    ORGANIZATION_READ = "organization:read"
    ORGANIZATION_WRITE = "organization:write"
    ROLE_READ = "role:read"
    ROLE_WRITE = "role:write"

    @property
    def group(self) -> "PermissionGroup":
        prefix = self.value.split(":")[0]
        if prefix in ("user", "organization", "role"):
            return PermissionGroup.ADMIN
        if prefix == "workspace":
            return PermissionGroup.WORKSPACE
        if prefix == "change":
            return PermissionGroup.CHANGE
        if prefix == "task" or prefix == "code" or prefix == "tool" or prefix == "deploy":
            return PermissionGroup.AGENT
        if self == Permission.PLATFORM_AUDIT_READ:
            return PermissionGroup.AUDIT
        return PermissionGroup.PLATFORM
```

### 8.5 Bootstrap seed

修改 `bootstrap_admin_and_seed_rbac()`（或同名函数）：

```python
# 现有逻辑保留...
# 新增：确保 platform_admin 角色存在（is_system=true）
admin_role = await session.exec(
    select(Role).where(Role.key == "platform_admin")
).first()
if not admin_role:
    admin_role = Role(
        key="platform_admin",
        name="Platform Administrator",
        description="系统超级管理员（短路所有权限检查）",
        is_system=True,
        is_active=True,
    )
    session.add(admin_role)
    await session.flush()
    # 绑定所有 Permission
    for perm in Permission:
        session.add(RolePermission(role_id=admin_role.id, permission=perm.value))
await session.commit()
```

## 9. 兼容策略（brownfield）

### 9.1 未配置新功能时行为不变

- 数据库迁移后，`users.login_enabled` 默认 `TRUE`，所有现有用户登录行为不变
- `roles.is_active` 默认 `TRUE`，所有现有角色权限检查路径不变
- `platform_admin` 角色未绑定时：现有 `User.is_platform_admin=TRUE` 用户仍走短路，不依赖 role 绑定

### 9.2 新旧逻辑的回退路径

- 旧端点 `/api/users/*` 内部 forward 到 `admin.users_service`，**响应 schema 完全一致**（UserRead 字段是超集，旧客户端忽略新增字段）
- 旧前端 settings/UsersTab 删除后，浏览器历史链接 `/settings` 仍可访问（仅缺少用户 tab），不会 404
- 用户迁移失败回滚：`alembic downgrade -1` 回到迁移前状态，新表 + 字段全部回退

### 9.3 不改变的 API / 表结构

- `/api/auth/login|refresh|logout|me` 端点签名不变（仅 login 内部加 login_enabled 检查）
- `users` 表的 `email` / `password_hash` / `is_active` / `is_platform_admin` 字段不变
- `roles` 表的 `key` / `name` / `description` / `is_system` 字段不变
- `role_permissions` / `user_workspace_roles` / `sessions` 表不变

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | settings → admin 单向依赖在 settings/router.py 内 `from app.modules.admin.users_service import UserService` 可能触发循环 import（若 admin 反向引用 settings） | P1 | 强制 admin 不依赖 settings；code review 检查；测试用 `import settings.router` 验证 |
| R-02 | 数据库迁移在已有数据的环境执行：`users.login_enabled` 默认 TRUE，但若旧数据存在 NULL 风险 | P2 | Alembic 迁移用 `server_default=text("true")`；执行后 backfill `UPDATE users SET login_enabled = true WHERE login_enabled IS NULL` |
| R-03 | `user_roles` 平台级 vs `user_workspace_roles` 工作区级在权限检查时混淆 | P1 | `rbac.has_permission()` 明确分离：先查 is_platform_admin → user_roles → user_workspace_roles；测试覆盖三层路径 |
| R-04 | 删除组织时 `ON DELETE RESTRICT` 阻止，但前端没提示用户具体阻塞原因 | P2 | service 抛 `OrganizationInUse` 含 detail（children_count + member_count）；前端 toast 显示具体数字 |
| R-05 | 系统角色（is_system=true）的 is_active 被禁用导致登录用户失去权限 | P0 | service 层强制：is_system=true 角色的 is_active 不可改为 false（抛 RoleSystemProtected） |
| R-06 | 现有 `/api/users` forward 到 admin 后，Permission 检查从 `require_platform_admin` 变为 `require_permission(USER_WRITE)` 导致回归 | P1 | settings/router.py 的 forward 保持原 `require_platform_admin` 依赖不变，权限语义不变 |
| R-07 | 前端 `/admin` 路由无权限用户访问后空白页 | P2 | `/admin/layout.tsx` 客户端鉴权：无任何 ADMIN 组权限 → router.replace("/") + toast 提示 |
| R-08 | `Permission.group` 属性按 prefix 解析，新增 Permission 时忘记归类 | P2 | `permissions.py` 加单元测试：遍历所有 Permission，断言 group 返回值非 PLATFORM 之外的可能性 |

## 11. 自审

### 11.1 需求覆盖检查

| 需求点 | 覆盖位置 | 状态 |
|---|---|---|
| 新增 /admin/users、/admin/organizations、/admin/roles 页面 | 文件清单 6.1 前端部分 | ✅ |
| settings 删除 UsersTab | 文件清单 6.2 修改 settings/page.tsx | ✅ |
| organizations 表（name/code/description/parent_id/status/sort_order） | 数据模型 8.1 | ✅ |
| 组织 CRUD + 启用/禁用 | 接口 7.2 | ✅ |
| 删除组织校验子组织 + 关联用户 | 接口 7.2 + 风险 R-04 | ✅ |
| 角色复用现有 roles + role_permissions | 接口 7.1 | ✅ |
| 角色 CRUD + 启用/禁用 + 配置权限 | 接口 7.1 | ✅ |
| 权限按用户/组织/角色/Workspace/Agent/Change/Audit 分组 | Permission.group 属性 + 5.3 | ✅ |
| 系统内置角色不能删除 | Role.is_system + roles_service 检查 | ✅ |
| 用户 CRUD + 配置组织和角色 | 接口 7.3 + UserRead 扩展 | ✅ |
| 重置用户密码 | 现有 reset_password 迁移 | ✅ |
| login_enabled 登录权限控制 | users 表新增字段 + disable-login/enable-login 端点 | ✅ |
| 禁止登录/重置密码后撤销 sessions | users_service 内 _revoke_sessions 已有，disable-login 复用 | ✅ |
| 权限字符串 user.*/organization.*/role.* | Permission 枚举扩展 8.4 | ✅ |
| is_platform_admin 短路 | rbac.py 已有逻辑保留 | ✅ |
| 不能删除自己 | UserService 现有自保护保留 | ✅ |
| 不能禁用自己登录 | users_service disable-login 检查 actor_id != target_id | ✅ |
| 不能删除最后一个平台管理员 | UserService 现有 _active_admin_count 保留 | ✅ |
| 有用户的角色不能删除 | roles_service.delete_role 前置检查 | ✅ |
| 有用户/子组织的组织不能删除 | organizations_service.delete 前置检查 | ✅ |
| 所有 CRUD/重置/登录控制写审计 | 现有 audit_hooks 自动捕获 | ✅ |
| 保持现有 /api/users 兼容 | settings/router.py forward 策略 | ✅ |
| 优先顺序：数据模型→角色→组织→用户 | Wave 1/2/3/4 划分 | ✅ |

### 11.2 约定一致性检查

- ✅ SQLModel 继承 BaseModel（CONVENTIONS 1.4）
- ✅ 路由 `/api` 前缀由 `app.include_router(admin_router, prefix="/api")` 注册（CONVENTIONS 1.2）
- ✅ 认证 opt-in：路由显式 `Depends(require_permission(...))`（CONVENTIONS 框架隐形规则）
- ✅ 服务层 `__init__(self, session: AsyncSession)` + actor_id 注入（与现有 UserService 一致）
- ✅ 错误继承 AppError，含 code + http_status（CONVENTIONS 1.6）
- ✅ 前端 `"use client"` + useEffect 数据获取（CONVENTIONS 2.2）
- ✅ API 客户端经 `apiFetch()`（CONVENTIONS 2.3）
- ✅ 前端类型与后端 schema 对应（CONVENTIONS 2.5）
- ✅ 文件命名 snake_case（后端）/ PascalCase（前端组件）/ kebab-case（API 路由）

### 11.3 真实性检查

- ✅ 表名 `users` / `roles` / `role_permissions` / `user_workspace_roles` / `sessions` 来自 `auth/model.py` 真实定义
- ✅ `Permission` 现有 25 项来自 `auth/permissions.py` 真实枚举
- ✅ `Role.is_system` 字段已存在（auth/model.py:118）
- ✅ `User.is_platform_admin` 字段已存在（auth/model.py:41）
- ✅ `require_permission` / `require_platform_admin` / `get_current_user` 来自 `core/auth_deps.py` 真实导出
- ✅ `bootstrap_admin_and_seed_rbac` 函数在 auth 模块（auth.md 文档已提及）
- ✅ `audit_hooks.py` 自动审计机制（ARCHITECTURE.md 4.5 节）
- ✅ `app.include_router(*, prefix="/api")` 注册模式（main.py 真实代码）
- ✅ 现有 UserService 方法签名（settings/service.py 真实代码）
- ⚠️ 自审存疑：`auth/seed.py` 文件名待确认（auth.md 中提到 bootstrap 函数但未明确文件位置），plan 阶段需查证后修正引用

### 11.4 YAGNI 检查

- ✅ 未引入「组织级别角色」（明确列为非目标）
- ✅ 未引入「邀请流程」（明确列为非目标）
- ✅ 未引入「权限组表」（用 Permission.group 属性替代，更轻）
- ✅ 未引入「数据权限」（仅功能权限）
- ✅ 未引入「批量用户导入」
- ✅ `Organization.status` 用字符串而非 enum class（与现有项目风格一致：User.is_active 是 boolean，但组织需要更明确状态）
- ⚠️ 自审存疑：`OrganizationsBrief` / `RoleBrief` 是否真有必要（前端列表可能只需要 id+name），plan 阶段细化

### 11.5 验收标准可测性

- ✅ 接口定义给出了具体路径、方法、请求/响应字段
- ✅ 风险登记 R-04/R-05/R-06/R-07 都有具体应对策略可写测试用例
- ✅ 数据模型 SQL DDL 可直接作为 Alembic 迁移蓝本
- ✅ 自审 11.1 的需求覆盖表逐项可对应到测试用例

### 11.6 非目标清晰度

✅ 非目标章节明确列出 7 项不做的事，包含工作区角色管理、邀请流程、MFA、Git 身份绑定、批量导入、组织级角色、数据权限。

### 11.7 兼容策略

✅ 第 9 节明确：未配置新功能时行为不变（默认值）、新旧逻辑回退路径（forward 端点 + alembic downgrade）、不改变的 API/表结构。

### 11.8 风险识别

✅ 第 10 节识别 8 项风险（R-01 ~ R-08），含 P0（系统角色禁用）+ P1（循环依赖、权限语义回归、平台/工作区角色混淆）+ P2（迁移数据完整性、UX 提示、权限分组归类）。

### 11.9 自审结论

**通过**。两处「⚠️ 自审存疑」（auth/seed.py 文件位置、Brief schema 必要性）在 plan 阶段细化即可，不阻塞进入下一步。
