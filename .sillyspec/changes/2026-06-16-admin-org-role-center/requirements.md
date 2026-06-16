---
author: WhaleFall
created_at: 2026-06-16T10:05:35
---

# Requirements: 组织与权限中心

## 角色

| 角色 | 说明 | 在本变更中的能力 |
|---|---|---|
| 平台超级管理员（is_platform_admin=true） | 系统超级管理员，短路所有权限检查 | 可访问所有 `/admin/*`，可执行所有 CRUD |
| 平台管理员（持 platform_admin 角色 或 USER_*/ORG_*/ROLE_* 权限） | 通过角色获得管理权限的普通用户 | 按角色权限访问对应模块（仅读 / 读写） |
| 普通用户 | 无任何管理权限的认证用户 | 不能访问 `/admin/*`，重定向到 `/` |
| 未认证用户 | 未登录 | 所有 `/api/admin/*` 返回 401 |

## 功能需求

### FR-01: 数据模型与迁移

**Given** 一个运行 SillyHub 后端的 PostgreSQL 数据库
**When** 执行 `alembic upgrade head` 应用迁移 `202606161200_create_admin_org_role`
**Then**
- 表 `organizations` / `user_organizations` / `user_roles` 被创建，结构含 PK / FK / 索引 / CHECK 约束
- 表 `roles` 新增 `is_active BOOLEAN NOT NULL DEFAULT TRUE` + `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
- 表 `users` 新增 `login_enabled BOOLEAN NOT NULL DEFAULT TRUE`
- 现有数据完整保留，现有用户的 `login_enabled` 字段 backfill 为 `TRUE`
- 现有角色的 `is_active` backfill 为 `TRUE`，`updated_at` backfill 为 NOW()

**Given** 迁移已执行的环境
**When** 执行 `alembic downgrade -1`
**Then**
- 新表被删除
- `roles` / `users` 表的新增字段被移除
- 现有数据完整保留

### FR-02: Permission 枚举扩展

**Given** `auth/permissions.py` 中的 Permission StrEnum
**When** 模块加载
**Then**
- 包含新增项：USER_READ / USER_WRITE / USER_LOGIN_MANAGE / ORGANIZATION_READ / ORGANIZATION_WRITE / ROLE_READ / ROLE_WRITE
- 包含 `PermissionGroup` 枚举：PLATFORM / ADMIN / WORKSPACE / AGENT / CHANGE / AUDIT
- 每项 Permission 都有 `.group` 属性，返回正确的 PermissionGroup
- 遍历所有 Permission，`group` 返回值与预期 prefix 映射一致（user:/organization:/role: → ADMIN）

### FR-03: 角色管理 - 列表与详情

**Given** 数据库中存在系统角色 `platform_admin`（is_system=true）和自定义角色 `workspace_admin`（is_system=false）
**When** 持 ROLE_READ 权限的用户调用 `GET /api/admin/roles`
**Then**
- 返回所有角色，含字段：id / key / name / description / is_system / is_active / permissions（权限字符串数组）/ user_count / created_at / updated_at
- platform_admin 的 is_system=true、user_count 正确反映实际绑定用户数

**Given** 普通用户（无 ROLE_READ 权限、is_platform_admin=false）
**When** 调用 `GET /api/admin/roles`
**Then** 返回 403 + 错误码 `PERMISSION_DENIED`

### FR-04: 角色管理 - 创建

**Given** 持 ROLE_WRITE 权限的用户
**When** 调用 `POST /api/admin/roles`，body 含合法 key / name / permission_keys（Permission 枚举子集）
**Then**
- 创建成功，返回 201 + RoleRead
- role_permissions 表写入对应记录
- audit_logs 自动记录创建事件

**Given** 创建请求中 `permission_keys` 含非法字符串（非 Permission 枚举值）
**When** 调用 `POST /api/admin/roles`
**Then** 返回 422 + 错误码 `VALIDATION_ERROR`，不写入数据库

**Given** 创建请求中 `key` 与已有角色冲突
**When** 调用 `POST /api/admin/roles`
**Then** 返回 409 + 错误码 `ROLE_KEY_DUPLICATE`

### FR-05: 角色管理 - 更新与状态切换

**Given** 自定义角色 `workspace_admin`（is_system=false）
**When** 持 ROLE_WRITE 权限用户调用 `PATCH /api/admin/roles/{id}` 更新 name 和 permission_keys
**Then**
- 字段更新成功
- role_permissions 表替换为新权限集（删旧+插新，原子事务）
- audit_logs 自动记录更新事件

**Given** 系统角色 `platform_admin`（is_system=true）
**When** 持 ROLE_WRITE 权限用户尝试 `PATCH /api/admin/roles/{id}`
**Then** 返回 403 + 错误码 `ROLE_SYSTEM_PROTECTED`

**Given** 系统角色 `platform_admin`（is_system=true）
**When** 尝试调用 `POST /api/admin/roles/{id}/disable`
**Then** 返回 403 + 错误码 `ROLE_SYSTEM_PROTECTED`，`is_active` 保持 true

### FR-06: 角色管理 - 删除前置检查

**Given** 自定义角色 `viewer`，无任何用户绑定（user_roles count = 0）
**When** 持 ROLE_WRITE 权限用户调用 `DELETE /api/admin/roles/{id}`
**Then**
- 删除成功，返回 204
- role_permissions 级联删除
- audit_logs 自动记录删除事件

**Given** 自定义角色 `workspace_admin`，有 1 个用户绑定
**When** 调用 `DELETE /api/admin/roles/{id}`
**Then** 返回 409 + 错误码 `ROLE_IN_USE`，detail 含 `user_count: 1`

**Given** 系统角色 `platform_admin`
**When** 调用 `DELETE /api/admin/roles/{id}`
**Then** 返回 403 + 错误码 `ROLE_SYSTEM_PROTECTED`

### FR-07: 组织管理 - 树形结构

**Given** 数据库中存在根组织 HQ，HQ 下有子组织 Engineering、QA，Engineering 下有 Frontend、Backend
**When** 持 ORGANIZATION_READ 权限用户调用 `GET /api/admin/organizations`（不带 parent_id）
**Then** 返回扁平列表含所有 5 个组织，每个含 parent_id 字段反映层级

**When** 调用 `GET /api/admin/organizations?parent_id={HQ_id}`
**Then** 仅返回 HQ 的直接子组织（Engineering、QA），不含孙级

**When** 调用 `GET /api/admin/organizations/{HQ_id}`（详情）
**Then** 返回 OrganizationDetail，含 children 列表（直接子组织）+ member_count（直接成员数）

### FR-08: 组织管理 - 创建与更新

**Given** 持 ORGANIZATION_WRITE 权限用户
**When** 调用 `POST /api/admin/organizations`，body 含合法 name / code / parent_id（指向现有组织）
**Then**
- 创建成功，返回 201 + OrganizationRead
- code 在全表唯一
- audit_logs 自动记录

**Given** 创建请求中 `code` 与已有组织冲突
**When** 调用 `POST /api/admin/organizations`
**Then** 返回 409 + 错误码 `ORGANIZATION_CODE_DUPLICATE`

**Given** 创建请求中 `parent_id` 指向不存在的组织
**When** 调用 `POST /api/admin/organizations`
**Then** 返回 422 + 错误码 `VALIDATION_ERROR`（FK 约束）或 404 + `ORGANIZATION_PARENT_NOT_FOUND`

### FR-09: 组织管理 - 删除前置检查

**Given** 组织 HQ，有子组织 Engineering
**When** 调用 `DELETE /api/admin/organizations/{HQ_id}`
**Then** 返回 409 + 错误码 `ORGANIZATION_HAS_CHILDREN`，detail 含 `children_count: 1`

**Given** 组织 QA，无子组织，但有 2 个关联用户
**When** 调用 `DELETE /api/admin/organizations/{QA_id}`
**Then** 返回 409 + 错误码 `ORGANIZATION_IN_USE`，detail 含 `member_count: 2`

**Given** 组织 Partners，无子组织，无关联用户
**When** 调用 `DELETE /api/admin/organizations/{Partners_id}`
**Then** 返回 204，组织从数据库移除，audit_logs 记录

### FR-10: 用户管理 - CRUD 扩展

**Given** 持 USER_WRITE 权限用户
**When** 调用 `POST /api/admin/users`，body 含 email / password / display_name / organization_ids / role_ids
**Then**
- 创建用户成功，返回 201 + UserRead（含 organizations + roles 关联数组）
- user_organizations 表写入对应记录
- user_roles 表写入对应记录
- audit_logs 记录创建

**Given** 已存在的用户 Alice，绑定组织 [ENG, QA]、角色 [workspace_admin]
**When** 调用 `PATCH /api/admin/users/{alice_id}` body 含 `organization_ids: [ENG]`（仅 Engineering）
**Then**
- user_organizations 表删除 QA 关联，保留 ENG
- 响应 UserRead.organies 仅含 Engineering
- 事务原子（不存在中间状态）

**Given** 已存在的用户 Bob
**When** 调用 `DELETE /api/admin/users/{bob_id}`
**Then**
- 用户被软删除（is_active=false）
- 所有 sessions 被撤销
- user_organizations / user_roles 关联级联删除
- audit_logs 记录

### FR-11: 用户管理 - 自保护与最后管理员保护

**Given** 当前登录用户为 admin（actor_id=admin_id）
**When** admin 调用 `DELETE /api/admin/users/{admin_id}`（删除自己）
**Then** 返回 403 + 错误码 `USER_SELF_DELETE_FORBIDDEN`

**Given** 当前登录用户为 admin
**When** admin 调用 `POST /api/admin/users/{admin_id}/disable-login`（禁用自己登录）
**Then** 返回 403 + 错误码 `USER_SELF_DISABLE_LOGIN_FORBIDDEN`

**Given** 系统中只有 1 个 is_platform_admin=true 用户（admin）
**When** admin 调用 `PATCH /api/admin/users/{admin_id}` body 含 `is_platform_admin: false`
**Then** 返回 403 + 错误码 `USER_LAST_ADMIN_PROTECTED`

### FR-12: 用户管理 - 登录权限控制

**Given** 用户 Bob 当前 login_enabled=true，有 3 个活跃 sessions
**When** 持 USER_LOGIN_MANAGE 权限用户调用 `POST /api/admin/users/{bob_id}/disable-login`
**Then**
- users 表 Bob 的 login_enabled 更新为 false
- Bob 的 3 个活跃 sessions 全部被撤销
- audit_logs 记录 sessions 撤销 + 用户更新
- 返回 UserRead，login_enabled=false

**Given** 用户 Bob login_enabled=false
**When** Bob 本人尝试调用 `POST /api/auth/login`
**Then** 返回 401 + 错误码 `AUTH_USER_LOGIN_DISABLED`（新增）

**Given** Bob 的 sessions 已被撤销
**When** 用 Bob 的旧 access_token 调用 `/api/auth/me`
**Then** 返回 401（refresh token 已撤销）

### FR-13: 现有 /api/users 端点兼容

**Given** 现有客户端调用旧端点 `GET /api/users`（settings/router.py）
**When** 持平台管理员权限用户调用
**Then**
- 响应 schema 与迁移前完全一致（UserListResponse 字段不变）
- 内部 forward 到 admin.users_service.UserService.list_users()
- 性能不退化（同步 import 调用，非 HTTP 转发）

**Given** settings/router.py 的所有 `/api/users/*` 端点（11 个）
**When** 各自被调用
**Then** 行为与迁移前一致（含错误码、状态码、响应字段）

### FR-14: 前端 /admin 路由鉴权

**Given** 普通用户（无任何 ADMIN 组权限、is_platform_admin=false）
**When** 访问 `/admin/users`（或 /admin/organizations、/admin/roles）
**Then**
- 客户端检测权限失败后 `router.replace("/")`
- 显示 toast 提示「无系统管理权限」
- 不渲染任何管理 UI

**Given** 平台管理员（持 USER_READ 等）
**When** 访问 `/admin/users`
**Then** 正常渲染用户管理页面，可读不可写（无 USER_WRITE）

### FR-15: 前端 settings 剥离

**Given** 现有 `/settings` 页面有 UsersTab
**When** 本次变更部署后访问 `/settings`
**Then**
- UsersTab 已删除，仅保留平台设置 / API Keys / Git 身份等 tab
- 左侧导航出现「系统管理」分组，含用户/组织/角色三个入口

### FR-16: 审计覆盖

**Given** 持权限用户对组织 / 角色 / 用户执行任意 CRUD、状态切换、密码重置、登录权限控制操作
**When** 操作完成后
**Then** audit_logs 表自动捕获对应记录（actor_id / action / entity_type / entity_id / payload diff）

## 非功能需求

### 兼容性

- 浏览器：Chrome 100+ / Firefox 100+ / Safari 15+ / Edge 100+
- 数据库：PostgreSQL 16
- 后端：Python 3.12 + FastAPI + SQLModel + SQLAlchemy async
- 前端：Next.js 14 + React 18 + Tailwind 3.4
- 旧端点 `/api/users/*` 经 forward 后行为完全一致，旧前端版本（未升级）仍可工作

### 可回退

- Alembic 迁移 `downgrade -1` 后回到迁移前状态，所有现有功能不受影响
- 新表 / 新字段全部有 DEFAULT 值，未配置时行为不变（login_enabled=true / is_active=true）
- 旧 settings/UsersTab 删除后，浏览器历史链接 `/settings` 仍可访问（仅缺少用户 tab）

### 可测试

- 后端：pytest + pytest-asyncio 覆盖 admin/ + settings/ + auth/ 全部模块
- 前端：Vitest 覆盖 admin API 客户端（lib/admin.ts）
- 端到端：8 项关键路径在成功标准中明确（自保护 / 最后管理员 / 角色占用 / 组织占用 / 登录控制 / 审计覆盖）
- 错误码全部归一为 AppError 子类，含 code + http_status + detail

### 性能

- 用户列表分页查询不退化（现有 index 复用 + user_organizations/user_roles 通过 PK 查询）
- 组织树查询支持递归（CTE 或 N+1 优化，单次查询返回全树）
- 角色列表预聚合 user_count（避免 N+1，使用 GROUP BY）

### 安全

- 所有写操作要求 `require_permission(Permission.X)` 显式声明
- 系统角色（is_system=true）的 is_active 不可改为 false（防止锁死系统）
- 自保护 + 最后管理员保护在 service 层强制（不依赖前端）
- 禁用登录立即撤销 sessions（防止活跃 session 继续访问）

### 可观测

- 所有操作经 audit_hooks 自动落 audit_logs，无需业务代码显式写入
- structlog 输出关键事件（role_created / organization_disabled / user_login_disabled 等）
- 错误返回统一信封 `{code, message, request_id, details}`，前端 ApiError 直接映射
