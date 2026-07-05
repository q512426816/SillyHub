---
author: WhaleFall
created_at: 2026-06-16T10:05:30
---

# Proposal: 组织与权限中心（用户/组织/角色三模块）

## 变更名

`2026-06-16-admin-org-role-center`

## 动机

第一阶段（`2026-06-10-user-management`）已经把用户管理从「无权限校验、无安全保护、无审计」的状态升级到企业可用水平。但用户管理在模块归属、组织维度、角色可视化三个层面仍存在结构性缺陷：

1. **模块边界混乱**：用户管理位于 `backend/app/modules/settings/`，与平台键值配置（PlatformSetting）混居。settings 模块的 `service.py` 几乎全是 `UserService` 代码，与 `model.py` 里的 PlatformSetting 表毫无关联。这种错配导致：
   - 阅读代码时按目录推断职责失效
   - 用户管理（身份域）和平台设置（配置域）的演进互相阻塞
   - 单元测试覆盖路径混乱（test_settings 里全是用户测试）

2. **缺少组织维度**：现有用户只能按 `is_platform_admin` 二分（超级管理员 / 普通用户）。无法表达「Alice 属于工程组 + QA 组」「Bob 属于销售组（已禁用）」这种现实组织结构。Worktree/Change/Agent 等模块未来要做按组织过滤都没有抓手。

3. **角色管理缺位**：底层 `Role` / `RolePermission` / `Permission`（25 项 StrEnum）基础设施已就绪，但没有 CRUD 端点、没有前端 UI。管理员无法在不写 SQL 的前提下创建/编辑角色或调整权限。`is_system` 字段（标记系统内置角色）存在但从未被业务代码读取。

## 关键问题

### 问题 1：settings 模块职责过载

`backend/app/modules/settings/router.py` 现有 13 个端点，其中 11 个是 `/api/users/*`，只有 2 个是 `/api/settings/*`。`service.py` 整文件是 `UserService` 类（10+ 方法），完全没有 PlatformSetting 的业务逻辑（键值对 CRUD 直接写在 router 里）。这种「文件名与内容不匹配」让维护成本激增，新人按文件名找用户代码会先去 `auth/` 翻一遍。

### 问题 2：身份域被物理割裂

身份相关概念分散在三处：
- `auth/model.py`：User / Role / RolePermission / UserWorkspaceRole / Session / ApiKey
- `auth/permissions.py`：Permission StrEnum（25 项）
- `settings/service.py`：UserService（用户管理业务逻辑）

权限检查（`rbac.py`）、登录（`auth/service.py`）、用户 CRUD（`settings/service.py`）跨模块分布，导致 `rbac.py` 想加一个 `user_roles` 平台级关联查询，需要跨模块读取 `settings` 模块的隐含知识。

### 问题 3：组织能力完全缺失

- 用户表没有 `organization_id` 字段
- 数据库没有 `organizations` 表
- API 没有组织相关端点
- 前端没有组织管理页面

这意味着任何「按部门筛选用户」「按组织分配资源」「部门管理员只看本部门」等需求都从根上无法实现。

## 变更范围

本次变更交付：

1. **新增 admin 模块**：`backend/app/modules/admin/`，承载用户/组织/角色三组 service + router
2. **新增数据模型**：`organizations` / `user_organizations`（多对多）/ `user_roles`（平台级用户-角色关联）三张表；`roles` 加 `is_active` + `updated_at`；`users` 加 `login_enabled`
3. **新增权限项**：Permission 枚举新增 7 项（USER_READ/WRITE/LOGIN_MANAGE、ORGANIZATION_READ/WRITE、ROLE_READ/WRITE），加 `PermissionGroup` 枚举和 `Permission.group` 属性支持前端按组渲染
4. **新增 API 端点**：`/api/admin/users`、`/api/admin/organizations`、`/api/admin/roles` 三组完整 CRUD + 状态切换 + 删除前置检查
5. **新增前端页面**：`/admin/users`、`/admin/organizations`、`/admin/roles` 三页面 + 鉴权 layout + 三组件（用户 Drawer / 组织树 / 权限选择器）
6. **settings 剥离**：删除前端 settings/UsersTab + 左侧导航新增「系统管理」分组；后端 settings/router.py 的 `/api/users/*` 端点保留并内部 forward 到 admin.users_service（向后兼容）
7. **扩展登录控制**：`AuthService.login()` 加 `login_enabled` 检查；新增 `/api/admin/users/{id}/disable-login` 和 `enable-login` 端点，禁用立即撤销 sessions
8. **复用现有基础设施**：UserService 自保护（不能删除自己 / 不能禁用自己登录 / 最后一个平台管理员保护）、审计（SQLAlchemy `audit_hooks` 自动捕获）、JWT 双 token、require_permission auth_deps

## 不在范围内（显式清单）

明确不做：

- **工作区级角色管理 UI**：`UserWorkspaceRole` 表保持现状不动；仅做平台级角色，schema 已预留扩展
- **邀请流程 / 邮件验证**：用户仍由管理员手动创建，不发邀请邮件
- **MFA / OAuth / SSO**：维持现有 JWT 双 token 方案
- **Git 身份绑定**：与 `git_identity` 模块无关
- **批量导入用户**：本期不做（CSV 导入留待后续）
- **组织级别角色**：仅平台级角色，组织内角色留待后续变更
- **数据权限（行级 / 列级）**：仅做功能权限（user:* / organization:* / role:*），不涉及数据可见性过滤
- **密码策略增强**：维持现有 bcrypt + 后端生成随机密码方案
- **会话超时策略**：维持现有 refresh token 模式
- **审计日志查询 UI 升级**：现有 `/api/audit` 端点不变

## 成功标准（可验证）

### 后端

1. `cd backend && pytest app/modules/admin/` 全绿，覆盖：
   - 角色管理：CRUD + 系统角色保护 + 删除前置检查（用户数 > 0 拒绝）
   - 组织管理：CRUD + 树形结构 + 删除前置检查（有子组织或关联用户拒绝）
   - 用户管理：CRUD + 组织/角色绑定 + 自保护 + 最后管理员保护 + 登录权限控制
2. `cd backend && pytest app/modules/settings/ app/modules/auth/` 全绿，验证：
   - `/api/users/*` 旧端点 forward 后行为完全一致（响应 schema 兼容）
   - `auth.login()` 在 `login_enabled=false` 时返回 401
3. `cd backend && ruff check . && mypy app` 0 错误
4. Alembic 迁移 `202606161200_create_admin_org_role.py` 在空库 + 含数据两种情况下都能成功执行
5. Bootstrap 启动后 `platform_admin` 角色存在且 `is_system=true`、绑定所有 Permission

### 前端

1. `cd frontend && pnpm test` 全绿，覆盖 admin API 客户端
2. `cd frontend && pnpm build` 0 错误
3. `/admin/users` / `/admin/organizations` / `/admin/roles` 三页面：
   - 平台管理员可访问并完成 CRUD
   - 无任何 ADMIN 组权限的普通用户访问 `/admin/*` 时重定向到 `/` 并 toast 提示
4. `/settings` 页面 UsersTab 已删除，左侧导航新增「系统管理」分组
5. 现有 `/api/users` 旧链接（如收藏夹）访问 `/admin/users` 时不报错（如有 redirect 则更好，但非必须）

### 端到端

1. 创建组织 → 创建角色（绑定权限）→ 创建用户（绑定组织+角色）→ 用户登录验证权限
2. 禁用用户登录 → 该用户当前 sessions 立即失效（再调 `/api/auth/me` 返回 401）
3. 尝试删除自己 → 403 + 错误码 `USER_SELF_DELETE_FORBIDDEN`
4. 尝试删除最后一个 platform_admin → 403 + 错误码 `USER_LAST_ADMIN_PROTECTED`
5. 尝试删除有用户的角色 → 409 + 错误码 `ROLE_IN_USE`
6. 尝试删除有子组织的组织 → 409 + 错误码 `ORGANIZATION_HAS_CHILDREN`
7. 尝试删除有关联用户的组织 → 409 + 错误码 `ORGANIZATION_IN_USE`
8. 所有 CRUD 操作后查 `/api/audit` 都能看到对应记录

### 兼容性

1. 数据库迁移 `downgrade -1` 后，所有现有功能恢复到迁移前状态（新表删除、新字段移除）
2. 旧端点 `/api/users` 经 forward 后，前端旧版本（未升级到 /admin/users）仍可正常工作
