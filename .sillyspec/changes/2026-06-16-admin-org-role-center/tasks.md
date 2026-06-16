---
author: WhaleFall
created_at: 2026-06-16T10:05:40
---

# Tasks: 组织与权限中心

> 任务清单只列名称 + 文件路径 + 所属 Wave，详细实现步骤在 plan 阶段展开。

## Wave 1: 数据模型 + 模块骨架

| # | 任务 | 文件路径 |
|---|---|---|
| W1-T1 | 编写 Alembic 迁移：organizations + user_organizations + user_roles 三表 + roles/users 字段扩展 | `backend/migrations/versions/202606161200_create_admin_org_role.py` |
| W1-T2 | 扩展 Permission StrEnum：新增 7 项 + PermissionGroup 枚举 + group 属性 | `backend/app/modules/auth/permissions.py` |
| W1-T3 | 扩展 auth/model.py：Role 加 is_active + updated_at；User 加 login_enabled | `backend/app/modules/auth/model.py` |
| W1-T4 | 扩展 auth/rbac.py：has_permission 链路加 user_roles 平台级查询 | `backend/app/modules/auth/rbac.py` |
| W1-T5 | 新增 admin 模块骨架：__init__ + 空 router + 空 model/schema/service 占位 | `backend/app/modules/admin/{__init__,model,schema,router}.py` |
| W1-T6 | 在 main.py 注册 admin_router | `backend/app/main.py` |
| W1-T7 | Bootstrap seed platform_admin 角色 + 绑定所有 Permission | `backend/app/modules/auth/seed.py` 或 bootstrap 函数所在文件 |
| W1-T8 | 新增 errors：AuthUserLoginDisabled / RoleInUse / RoleSystemProtected / OrganizationInUse / OrganizationHasChildren / OrganizationCodeDuplicate / RoleKeyDuplicate | `backend/app/core/errors.py` 或 `backend/app/modules/auth/errors.py` |

## Wave 2: 角色管理

| # | 任务 | 文件路径 |
|---|---|---|
| W2-T1 | 实现 roles_service.py：CRUD + 权限配置 + 系统角色保护 + 删除前置检查 | `backend/app/modules/admin/roles_service.py` |
| W2-T2 | 在 admin/router.py 注册 /api/admin/roles 路由组（7 端点） | `backend/app/modules/admin/router.py` |
| W2-T3 | 在 admin/schema.py 定义 RoleCreateRequest / RoleUpdateRequest / RoleRead / RoleListResponse | `backend/app/modules/admin/schema.py` |
| W2-T4 | 编写角色管理单元测试：CRUD + 系统角色保护 + 删除前置 + 权限非法值 | `backend/app/modules/admin/tests/test_roles_router.py` |
| W2-T5 | 实现前端 /admin/roles 页面（列表 + 创建/编辑 Drawer + 删除 confirm） | `frontend/src/app/(dashboard)/admin/roles/page.tsx` |
| W2-T6 | 实现 admin-role-permission-picker 组件（按 Permission.group 折叠分组） | `frontend/src/components/admin-role-permission-picker.tsx` |
| W2-T7 | 实现 admin API 客户端 roles 部分 + 单元测试 | `frontend/src/lib/admin.ts` + `frontend/src/lib/__tests__/admin.test.ts` |

## Wave 3: 组织管理

| # | 任务 | 文件路径 |
|---|---|---|
| W3-T1 | 实现 admin/model.py：Organization + UserOrganization + UserRole ORM | `backend/app/modules/admin/model.py` |
| W3-T2 | 实现 organizations_service.py：CRUD + 树形结构 + 删除前置检查（children/member） | `backend/app/modules/admin/organizations_service.py` |
| W3-T3 | 在 admin/router.py 注册 /api/admin/organizations 路由组（7 端点） | `backend/app/modules/admin/router.py` |
| W3-T4 | 在 admin/schema.py 定义 OrganizationCreateRequest / OrganizationUpdateRequest / OrganizationRead / OrganizationDetail | `backend/app/modules/admin/schema.py` |
| W3-T5 | 编写组织管理单元测试：CRUD + 树形查询 + 删除前置 + code 唯一性 | `backend/app/modules/admin/tests/test_organizations_router.py` |
| W3-T6 | 实现前端 /admin/organizations 页面（左树 + 右详情面板 + 编辑 Drawer） | `frontend/src/app/(dashboard)/admin/organizations/page.tsx` |
| W3-T7 | 实现 admin-organization-tree 组件（递归渲染 + 状态徽标） | `frontend/src/components/admin-organization-tree.tsx` |
| W3-T8 | 在 admin API 客户端补 organizations 部分 + 单元测试 | `frontend/src/lib/admin.ts` + `frontend/src/lib/__tests__/admin.test.ts` |

## Wave 4: 用户管理升级 + settings 剥离

| # | 任务 | 文件路径 |
|---|---|---|
| W4-T1 | 迁移 UserService：从 settings/service.py 移到 admin/users_service.py + 扩展 organization/role 绑定方法 + disable-login/enable-login | `backend/app/modules/admin/users_service.py` |
| W4-T2 | settings/service.py / settings/schema.py 改为 re-export admin.users_service / admin.schema（保持兼容） | `backend/app/modules/settings/{service,schema}.py` |
| W4-T3 | settings/router.py 的 /api/users/* 端点 handler 改为 forward 到 admin.users_service | `backend/app/modules/settings/router.py` |
| W4-T4 | 在 admin/router.py 注册 /api/admin/users 路由组（继承 11 个端点 + disable-login/enable-login） | `backend/app/modules/admin/router.py` |
| W4-T5 | 在 admin/schema.py 定义 UserCreateRequest / UserUpdateRequest / UserRead 扩展（含 organizations + roles + login_enabled） | `backend/app/modules/admin/schema.py` |
| W4-T6 | auth/service.py 的 login() 加 login_enabled 检查 | `backend/app/modules/auth/service.py` |
| W4-T7 | 编写用户管理单元测试：CRUD + 组织/角色绑定 + 自保护 + 最后管理员 + 登录权限 + 旧端点兼容 | `backend/app/modules/admin/tests/test_users_router.py` |
| W4-T8 | 实现前端 /admin/users 页面（列表 + 搜索 + 编辑 Drawer 含组织/角色多选） | `frontend/src/app/(dashboard)/admin/users/page.tsx` |
| W4-T9 | 实现 admin-user-drawer 组件（含组织/角色多选 + 登录权限开关 + is_platform_admin 开关） | `frontend/src/components/admin-user-drawer.tsx` |
| W4-T10 | 实现 /admin/layout.tsx 客户端鉴权（无权限重定向） | `frontend/src/app/(dashboard)/admin/layout.tsx` |
| W4-T11 | 在 app-shell.tsx 左侧导航新增「系统管理」分组（用户/组织/角色） | `frontend/src/components/app-shell.tsx` |
| W4-T12 | 删除 settings/page.tsx 的 UsersTab 及相关 import/state | `frontend/src/app/(dashboard)/settings/page.tsx` |
| W4-T13 | 删除 lib/settings.ts 的用户管理函数（已迁到 admin.ts） | `frontend/src/lib/settings.ts` |
| W4-T14 | 在 admin API 客户端补 users 部分 + 单元测试 | `frontend/src/lib/admin.ts` + `frontend/src/lib/__tests__/admin.test.ts` |

## 后置任务（跨 Wave）

| # | 任务 | 文件路径 |
|---|---|---|
| X-T1 | 端到端验证：8 项关键路径（自保护 / 最后管理员 / 角色占用 / 组织占用 / 登录控制 / 审计覆盖） | 手动测试脚本 |
| X-T2 | 数据库迁移在空库 + 含数据环境双重验证 | alembic upgrade/downgrade 测试 |
| X-T3 | Docker 镜像重建 + 部署 + 健康检查 | `deploy/docker-compose.yml`（无需改动，触发重建） |
