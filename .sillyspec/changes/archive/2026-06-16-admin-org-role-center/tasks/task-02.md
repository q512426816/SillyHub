---
id: task-02
title: Permission 扩展 + auth model/rbac 扩展
priority: P0
estimated_hours: 3
depends_on: [task-01]
blocks: [task-04, task-05, task-06]
allowed_paths:
  - backend/app/modules/auth/permissions.py
  - backend/app/modules/auth/model.py
  - backend/app/modules/auth/rbac.py
author: WhaleFall
created_at: 2026-06-16T15:27:48
---

# task-02: Permission 扩展 + auth model/rbac 扩展

## 修改文件

- **backend/app/modules/auth/permissions.py**
  - 新增 `PermissionGroup` StrEnum（PLATFORM / ADMIN / WORKSPACE / AGENT / CHANGE / AUDIT 共 6 项）
  - `Permission` StrEnum 新增 7 项：`USER_READ` / `USER_WRITE` / `USER_LOGIN_MANAGE` / `ORGANIZATION_READ` / `ORGANIZATION_WRITE` / `ROLE_READ` / `ROLE_WRITE`
  - `Permission` 新增 `group` 属性（`@property`，按 value prefix 解析）
  - 现有 25 项枚举值保持不变（字符串值不变，兼容现有 role_permissions 表数据）

- **backend/app/modules/auth/model.py**
  - `Role` 表新增 `is_active: bool = Field(default=True, ...)` + `updated_at: datetime` 字段（task-01 迁移已加列，本任务对齐 ORM）
  - `User` 表新增 `login_enabled: bool = Field(default=True, ...)` 字段
  - `updated_at` 在 Role 上加 `default_factory=lambda: datetime.now(UTC)`（与 User 保持一致），后续 service 层负责刷新

- **backend/app/modules/auth/rbac.py**
  - 新增 `collect_permissions_platform(session, *, user_id)` 函数：经 `user_roles`（平台级）→ `role_permissions` 查询权限集
  - 修改 `has_permission()`：保留 `is_platform_admin` 短路；新增平台级查询分支（优先于 `collect_permissions_all`）
  - `collect_permissions_all()` 保持现状（用于跨 workspace 权限聚合，向后兼容）

## 实现要求

### permissions.py

1. `PermissionGroup` 必须在 `Permission` 类之前定义（`group` 属性前向引用会用到）
2. 7 项新枚举值的字符串值严格匹配 design.md §8.4：`user:read` / `user:write` / `user:login:manage` / `organization:read` / `organization:write` / `role:read` / `role:write`
3. `group` 属性返回规则（来自 design §5.3）：
   - `user` / `organization` / `role` → `PermissionGroup.ADMIN`
   - `workspace` → `PermissionGroup.WORKSPACE`
   - `change` → `PermissionGroup.CHANGE`
   - `task` / `code` / `tool` / `deploy` → `PermissionGroup.AGENT`
   - `platform:audit:read` → `PermissionGroup.AUDIT`（特例）
   - 其余 `platform:*` → `PermissionGroup.PLATFORM`
4. 用 `self.value.split(":")[0]` 取 prefix，`platform:audit:read` 单独按值匹配
5. 注释加一行 `# Mirrors design §8.4 + §5.3`，方便后续 audit
6. **不删除、不重排**现有 25 项（保持 StrEnum 序号稳定，避免 Alembic seed 失配）

### model.py

1. `Role.is_active` 与 `User.login_enabled` 都用 `Boolean` + `nullable=False` + `default=False/True`，与 task-01 DDL 的 `DEFAULT TRUE` 对齐
2. `Role.updated_at` 沿用 User 的写法：`Column(DateTime(timezone=True), nullable=False)` + `default_factory`
3. 字段位置：`Role.is_active` 放在 `is_system` 之后；`Role.updated_at` 放在 `created_at` 之后
4. `User.login_enabled` 放在 `is_platform_admin` 之后（紧邻身份相关字段）

### rbac.py

1. 新增 `collect_permissions_platform(session, *, user_id: uuid.UUID) -> set[str]`：JOIN `user_roles` → `Role` → `RolePermission`，**不**带 workspace 过滤
2. `has_permission()` 改造（保持现有签名不变）：
   ```python
   async def has_permission(session, *, user, permission, workspace_id):
       if user.is_platform_admin:
           return True
       # 新增：先看平台级角色（user_roles）
       platform_perms = await collect_permissions_platform(session, user_id=user.id)
       if permission.value in platform_perms or Permission.PLATFORM_ADMIN.value in platform_perms:
           return True
       # 再走原有 workspace 链路
       if workspace_id is None:
           perms = await collect_permissions_all(session, user_id=user.id)
           return permission.value in perms or Permission.PLATFORM_ADMIN.value in perms
       perms = await collect_permissions(session, user_id=user.id, workspace_id=workspace_id)
       return permission.value in perms or Permission.PLATFORM_ADMIN.value in perms
   ```
3. `collect_permissions` / `collect_permissions_all` / `list_user_workspace_roles` / `allowed_workspace_ids` 函数体**不动**
4. `user_roles` 表是 task-01 创建的，本任务直接 import：`from app.modules.admin.model import UserRole`（admin 模块 task-03 才创建；为规避依赖，task-02 **不**直接 import admin，改用字符串表名 + SQLAlchemy core `text()` 或在函数内延迟 import）

   **决策**：task-02 在 rbac.py 顶部使用延迟 import（函数内 `from app.modules.admin.model import UserRole`），task-03 完成后即可工作；本任务测试时 admin 模块尚未创建，相关测试在 task-03 后补全

## 接口定义

### Permission / PermissionGroup

```python
class PermissionGroup(StrEnum):
    PLATFORM = "platform"
    ADMIN = "admin"
    WORKSPACE = "workspace"
    AGENT = "agent"
    CHANGE = "change"
    AUDIT = "audit"


class Permission(StrEnum):
    # ── 现有 25 项保留 ──
    PLATFORM_ADMIN = "platform:admin"
    PLATFORM_BILLING = "platform:billing"
    PLATFORM_AUDIT_READ = "platform:audit:read"
    WORKSPACE_READ = "workspace:read"
    # ... 其余 22 项原样不变 ...

    # ── 新增（admin 组） ──
    USER_READ = "user:read"
    USER_WRITE = "user:write"
    USER_LOGIN_MANAGE = "user:login:manage"
    ORGANIZATION_READ = "organization:read"
    ORGANIZATION_WRITE = "organization:write"
    ROLE_READ = "role:read"
    ROLE_WRITE = "role:write"

    @property
    def group(self) -> "PermissionGroup":
        if self == Permission.PLATFORM_AUDIT_READ:
            return PermissionGroup.AUDIT
        prefix = self.value.split(":")[0]
        if prefix in ("user", "organization", "role"):
            return PermissionGroup.ADMIN
        if prefix == "workspace":
            return PermissionGroup.WORKSPACE
        if prefix == "change":
            return PermissionGroup.CHANGE
        if prefix in ("task", "code", "tool", "deploy"):
            return PermissionGroup.AGENT
        return PermissionGroup.PLATFORM
```

### rbac.has_permission 新链路

```python
async def has_permission(
    session: AsyncSession,
    *,
    user: User,
    permission: Permission,
    workspace_id: uuid.UUID | None,
) -> bool:
    if user.is_platform_admin:                                # 1. 短路
        return True
    platform_perms = await collect_permissions_platform(     # 2. 平台级 user_roles
        session, user_id=user.id
    )
    if permission.value in platform_perms:
        return True
    if Permission.PLATFORM_ADMIN.value in platform_perms:     # 3. 持 platform_admin 角色也放行
        return True
    if workspace_id is None:                                  # 4. 跨 workspace 聚合
        perms = await collect_permissions_all(session, user_id=user.id)
    else:                                                     # 5. workspace 内
        perms = await collect_permissions(session, user_id=user.id, workspace_id=workspace_id)
    return permission.value in perms or Permission.PLATFORM_ADMIN.value in perms


async def collect_permissions_platform(
    session: AsyncSession, *, user_id: uuid.UUID
) -> set[str]:
    from app.modules.admin.model import UserRole              # 延迟 import 规避循环
    stmt = (
        select(col(RolePermission.permission))
        .join(Role, col(Role.id) == col(RolePermission.role_id))
        .join(UserRole, col(UserRole.role_id) == col(Role.id))
        .where(col(UserRole.user_id) == user_id)
    )
    rows = (await session.execute(stmt)).scalars().all()
    return set(rows)
```

## 边界处理

1. **is_platform_admin 短路优先级**：在 `has_permission` 第 1 行立即返回，避免无谓查询；持 `platform:admin` 字符串权限的角色（非超级管理员）走第 3 步放行
2. **现有 user_workspace_roles 查询路径不变**：`collect_permissions` / `collect_permissions_all` / `allowed_workspace_ids` 函数体零修改，保证现有 `/api/workspaces/*` / `/api/changes/*` 等路由行为不回归
3. **Permission.group 对历史权限的归类**：25 项历史枚举按 prefix 自动归类（workspace → WORKSPACE / change → CHANGE / task,code,tool,deploy → AGENT / platform:* → PLATFORM，唯独 `platform:audit:read` 特判为 AUDIT），新增 7 项 → ADMIN；遍历全部 32 项都必须有非 PLATFORM 之外的合理归属（测试断言）
4. **is_active 默认 true 兼容历史数据**：Role.is_active ORM 默认 True + Alembic `server_default=text("true")` 双保险；现有角色迁移后未填值也自动 True
5. **login_enabled 默认 true 兼容历史 sessions**：User.login_enabled ORM 默认 True；现有活跃 sessions 在迁移后仍可继续访问，不被一刀切
6. **rbac 平台级查询失败时的回退**：若 admin 模块尚未创建（task-03 未完成），延迟 import 抛 ImportError；本任务测试时只在 task-03 落地后跑，本任务 PR 不含该路径的运行时测试
7. **PLATFORM_ADMIN 字符串双重检查**：既查 `permission.value` 也查 `Permission.PLATFORM_ADMIN.value`，匹配 `roles` 表里被显式授予 `platform:admin` 字符串的自定义角色

## 非目标

- 不创建 admin 模块（UserRole ORM 定义在 task-03 / task-05；本任务仅用延迟 import 引用）
- 不实现 admin 路由 / service（task-04 / task-05 / task-06）
- 不写 Alembic 迁移（task-01）
- 不改 `auth/service.py` 的 login() 加 login_enabled 检查（属 task-06）
- 不动 seed / bootstrap（属 task-03）
- 不改 `Role.is_system` 既有逻辑

## 参考

- design.md §5.3（权限分组表） + §8.4（Permission 枚举扩展伪代码）
- requirements.md FR-02（Permission 枚举扩展验收点）
- 现有 `backend/app/modules/auth/permissions.py` 25 项枚举 + StrEnum 写法
- 现有 `backend/app/modules/auth/rbac.py` 的 JOIN 查询模式（collect_permissions 为模板）
- 现有 `backend/app/modules/auth/model.py` 的 SQLModel Field + sa_column 写法

## TDD 步骤

1. **写 Permission.group 单元测试**（`backend/app/modules/auth/tests/test_permissions.py`，若不存在则新建）：
   - 遍历 `Permission` 全部 32 项，断言 `.group` 返回值与预期映射一致
   - 单独断言 `Permission.PLATFORM_AUDIT_READ.group == PermissionGroup.AUDIT`（特例）
   - 断言 7 项新枚举的 `.value` 字符串完全匹配 design §8.4
   - 断言 `PermissionGroup` 的 6 个成员字符串值
2. **跑测试** → 应失败（`group` 属性 / 新枚举 / `PermissionGroup` 都不存在）
3. **加 PermissionGroup + 7 项新枚举 + group 属性** → 实现伪代码
4. **跑测试** → 应通过
5. **写 rbac 平台级链路测试**（`backend/app/modules/auth/tests/test_rbac.py`）：
   - mock user_roles + role_permissions 数据，断言 `collect_permissions_platform` 返回正确集合
   - 断言持 `USER_READ` 权限的角色用户在 `has_permission(workspace_id=None)` 时返回 True
   - 断言 `is_platform_admin=True` 用户短路（不查 DB）
   - 注：依赖 `UserRole` 表（task-03 完成），本步骤在 task-03 落地后执行；本任务 PR 至少完成 step 1-4
6. **回归现有 rbac / auth_deps 测试** → `pytest app/modules/auth/` 全绿

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | `Permission.USER_READ.group` | 返回 `PermissionGroup.ADMIN` |
| AC-02 | `Permission.ORGANIZATION_WRITE.group` | 返回 `PermissionGroup.ADMIN` |
| AC-03 | `Permission.ROLE_READ.group` | 返回 `PermissionGroup.ADMIN` |
| AC-04 | `Permission.PLATFORM_AUDIT_READ.group` | 返回 `PermissionGroup.AUDIT`（特例） |
| AC-05 | `Permission.PLATFORM_ADMIN.group` | 返回 `PermissionGroup.PLATFORM` |
| AC-06 | `Permission.WORKSPACE_READ.group` | 返回 `PermissionGroup.WORKSPACE` |
| AC-07 | `Permission.CHANGE_CREATE.group` | 返回 `PermissionGroup.CHANGE` |
| AC-08 | `Permission.TASK_READ.group` | 返回 `PermissionGroup.AGENT` |
| AC-09 | `Permission.DEPLOY_PRODUCTION.group` | 返回 `PermissionGroup.AGENT` |
| AC-10 | `len(list(Permission))` | 等于 32（25 旧 + 7 新） |
| AC-11 | `Permission.USER_LOGIN_MANAGE.value` | 等于 `"user:login:manage"` |
| AC-12 | `len(list(PermissionGroup))` | 等于 6 |
| AC-13 | `Role` 类有 `is_active` 字段且默认 True | `Role().is_active is True` |
| AC-14 | `Role` 类有 `updated_at` 字段 | `Role().updated_at` 非 None |
| AC-15 | `User` 类有 `login_enabled` 字段且默认 True | `User().login_enabled is True` |
| AC-16 | 现有 `has_permission` 测试集 | 全部回归通过（workspace 链路未破坏） |
| AC-17 | `pytest app/modules/auth/` | 0 失败 |
| AC-18 | `ruff check app/modules/auth/` + `mypy app/modules/auth/` | 0 错误 |
| AC-19 | 遍历 32 项 Permission 的 `group` 返回值都覆盖 | 单元测试断言全过（无未归类抛 KeyError） |
| AC-20 | 现有 `permissions.py` 25 项的字符串值 | 与改动前 diff 中**无字符串变化**（仅新增） |
