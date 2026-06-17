---
author: qinyi
created_at: 2026-06-01T12:00:00
---

# auth
> 最后更新：2026-06-01
> 最近变更：scan（初始生成）
> 模块路径：backend/app/modules/auth/**

## 职责

用户认证与授权模块，提供登录/登出/刷新/当前用户查询的 HTTP API，以及 RBAC 权限管理和初始管理员引导。

- **认证**：JWT access token + refresh token 双 token 方案
- **授权**：基于角色（Role）和权限（Permission）的 RBAC 模型
- **用户管理**：User / Session 数据模型
- **种子数据**：bootstrap_admin_and_seed_rbac 自动创建管理员和默认角色

## 当前设计

### 文件结构

```
backend/app/modules/auth/
├── __init__.py       # 导出 User, Session, Role, RolePermission, UserWorkspaceRole
├── model.py          # ORM 模型定义
├── schema.py         # Pydantic 请求/响应 schema
├── permissions.py    # Permission 枚举定义
├── rbac.py           # RBAC 权限查询函数
├── service.py        # 业务逻辑层（AuthService）
└── router.py         # HTTP 路由定义
```

### 关键类

| 类名 | 文件 | 说明 |
|------|------|------|
| `User` | model.py | 用户表模型，包含 email / password_hash / display_name / is_active 等 |
| `Session` | model.py | 用户会话表模型，关联 refresh token |
| `Role` | model.py | 角色表模型（platform_admin / workspace_admin / workspace_member） |
| `RolePermission` | model.py | 角色-权限关联表 |
| `UserWorkspaceRole` | model.py | 用户-工作区-角色关联表 |
| `Permission` | permissions.py | 权限枚举（StrEnum），定义所有系统权限 |
| `AuthService` | service.py | 认证业务逻辑入口，封装 login / refresh / logout |

### 关键 Schema

| 类名 | 文件 | 说明 |
|------|------|------|
| `LoginRequest` | schema.py | 登录请求（email + password） |
| `RefreshRequest` | schema.py | 刷新请求（refresh_token） |
| `TokenPair` | schema.py | Token 对响应（access_token + refresh_token） |
| `UserRead` | schema.py | 用户信息响应 |
| `WorkspaceRoleAssignment` | schema.py | 工作区角色分配 |
| `MeResponse` | schema.py | 当前用户响应（含 workspace_roles） |

## 对外接口

| 函数名 | 方法 | 路径 | 说明 |
|--------|------|------|------|
| `login` | POST | `/auth/login` | 用户登录，返回 access + refresh token |
| `refresh` | POST | `/auth/refresh` | 刷新 access token |
| `logout` | POST | `/auth/logout` | 登出，撤销 refresh token |
| `me` | GET | `/auth/me` | 获取当前用户信息及工作区角色 |

## 关键数据流

1. **登录流**：POST /auth/login → AuthService.login() → 查找用户 → bcrypt 验证密码 → 签发 token pair → 创建 Session 记录 → 返回 TokenPair
2. **刷新流**：POST /auth/refresh → AuthService.refresh() → 验证 refresh token → 撤销旧 session → 签发新 token pair → 返回 TokenPair
3. **登出流**：POST /auth/logout → AuthService.logout_session_by_refresh() → 验证 refresh token → 标记 session 已撤销 → 204
4. **权限检查流**：请求 → auth_deps.require_permission() → decode_access_token() → 查 User → rbac.has_permission() → 放行/拒绝

## 设计决策

| 决策 | 原因 | 替代方案 |
|------|------|----------|
| JWT + refresh token 双 token | access token 短期、refresh token 长期，平衡安全与体验 | 纯 JWT / 纯 session |
| RBAC 角色权限模型 | 灵活的权限管理，支持工作区级别权限 | 简单 admin/user 二元角色 |
| AuthService 封装业务逻辑 | router 保持薄层，便于测试 | 逻辑直接写在 router 中 |
| StrEnum 权限枚举 | 类型安全，可遍历所有权限 | 字符串常量 |
| bootstrap 自动种子 | 开发环境零配置启动 | 手动创建管理员 |

## 依赖关系

### 内部依赖
- `app.models.base` — BaseModel
- `app.core.config` — Settings, get_settings
- `app.core.db` — get_session
- `app.core.security` — create_access_token, decode_access_token, password_hasher, generate_refresh_token, hash_refresh_token, verify_refresh_token, refresh_token_expiry
- `app.core.errors` — AuthTokenMissing, AuthTokenInvalid, AuthTokenExpired, AuthInvalidCredentials, AuthRefreshReused, AuthUserInactive, PermissionDenied
- `app.core.logging` — get_logger
- `app.core.auth_deps` — get_current_user（router 使用）

### 外部库
- fastapi — APIRouter, Depends
- sqlalchemy (async) — 异步数据库查询
- sqlmodel — ORM 模型
- pydantic — Schema 定义
- bcrypt — 密码哈希验证（通过 core.security）

## 注意事项

- `Session` 模型在 service.py 中被 import 为 `SessionRow` 以避免与 SQLAlchemy Session 冲突
- `bootstrap_admin_and_seed_rbac()` 应在应用启动时调用，创建默认管理员和角色
- `Permission` 枚举是全局权限定义，新增权限必须在此处添加
- `AuthService.__init__` 接受 db session 和 settings，由 router 层通过依赖注入传入

## 变更索引

| 日期 | 变更 | 影响 |
|------|------|------|
| 2026-06-17 | ql-20260617-005-2682 | 7 个 system role name 改中文（key 不变）；同步原 migration SYSTEM_ROLES + service.py fallback + 新增 202606170900 UPDATE migration 兼容已部署库 |
