---
id: task-04a
title: 实现用户认证与 RBAC（horizontal slice）
phase: V1
priority: P0
status: draft
owner: qinyi
estimated_hours: 20
affected_components:
  - platform-api
  - platform-web
allowed_paths:
  - backend/app/modules/auth/
  - backend/app/core/security.py
  - backend/migrations/versions/
  - frontend/src/app/(auth)/
  - frontend/src/app/(dashboard)/
  - frontend/src/lib/api.ts
  - frontend/src/lib/auth.ts
  - frontend/src/stores/session.ts
  - frontend/src/components/app-shell.tsx
depends_on:
  - task-03
blocks:
  - task-04
  - task-05
  - task-09
---

## 1. 目标

替换 task-01/02/03 临时的 `X-Debug-User` 占位 header，落地 `references/15-authentication.md` + `16-rbac.md` 中**可立即生效**的子集：

- DB schema：`users` / `sessions` / `roles` / `role_permissions` / `user_workspace_roles`
- JWT access + refresh
- `POST /api/auth/login` / `/refresh` / `/logout` + `GET /api/auth/me`
- `Permission` enum + `check_permission` + `require_permission(...)` 依赖
- 现有 workspace / component 路由全部接入 RBAC
- 前端登录页 + token 持久化 + 401 自动重定向 + 顶部用户菜单
- 启动时 bootstrap：env 提供首位 admin（`PLATFORM_BOOTSTRAP_ADMIN_*`），首位用户自动成为所有现存 workspace 的 owner

**不在范围**（标注延后到哪个 task）：

| 暂不做 | 推后 |
|---|---|
| MFA / TOTP | 任意时刻，不阻塞下游 |
| `login_attempts` 表 + 账号锁定 | task-Auth-v2（暂用 in-memory rate limiter 占位） |
| `audit_events` 写入 | task-Auth-v2（先 structlog 记录） |
| `POST /api/auth/register` | V2，由 admin UI 触发 |
| `change-password` / `logout-all` | task-Auth-v2 |
| `user_component_overrides` | task-Auth-v2 |
| Postgres RLS | V3 |
| 二次审批弹窗 | task-13 |
| admin 给用户授权的 UI | task-Auth-v2（V1 用 DB 直改 + seed） |

## 2. 输入

- `references/15-authentication.md` §1-6
- `references/16-rbac.md` §1-6
- `references/17-db-schema.md` §2.1（users / sessions）

## 3. 产出清单

### 3.1 数据表

按 `references/15` §2 和 `references/16` §5：

- `users`
- `sessions`
- `roles`（含 7 个系统种子，`is_system=true`）
- `role_permissions`
- `user_workspace_roles`

migration `202605280900_create_auth_and_rbac.py`。种子 7 个 role 在同一 migration 的 `op.bulk_insert` 里完成。

### 3.2 后端模块

```text
backend/app/core/
├─ security.py        # bcrypt + JWT encode/decode + Permission enum
└─ auth_deps.py       # get_current_user / get_optional_user / require_permission

backend/app/modules/auth/
├─ __init__.py
├─ model.py           # User / Session / Role / RolePermission / UserWorkspaceRole
├─ schema.py          # LoginRequest / TokenPair / UserRead / MeResponse
├─ service.py         # AuthService
├─ rbac.py            # check_permission()
├─ router.py          # /api/auth/*
└─ tests/
   ├─ test_crypto.py
   ├─ test_service.py
   ├─ test_router.py
   └─ test_rbac.py
```

### 3.3 API

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| POST | `/api/auth/login` | 公开 | email + password → access + refresh |
| POST | `/api/auth/refresh` | 公开 | refresh_token → 新 access + 新 refresh，旧 refresh 立即作废 |
| POST | `/api/auth/logout` | bearer | 撤销当前 session |
| GET | `/api/auth/me` | bearer | 当前用户 + 所有 workspace 的 role 概览 |

### 3.4 Permission 接入

按 `references/16` §2 落地 `Permission` enum 全部 35 个权限点（不省略，后续 task 直接用）。

**V1 必须用到的**：
- `workspace:read` / `workspace:write` / `workspace:admin`
- `component:read` / `component:write` / `component:admin`

`workspace_router`：
- `GET /scan` / `POST` create / `GET ""` list / `GET /{id}` / `POST /{id}/rescan` / `DELETE /{id}` → `Depends(get_current_user)` + `require_permission(WORKSPACE_READ|WRITE)` 按动词区分

`component_router`：
- `GET *` → `COMPONENT_READ`
- `POST /reparse` → `COMPONENT_WRITE`

### 3.5 Bootstrap 流程

启动时（lifespan `startup`）：

1. 跑 alembic upgrade（已有）
2. 检查 `users` 表行数：
   - 0 → 用 env `PLATFORM_BOOTSTRAP_ADMIN_EMAIL` + `PLATFORM_BOOTSTRAP_ADMIN_PASSWORD` 创建第一个用户，`is_platform_admin=true`
   - 缺 env → log error 但不阻断启动（容器化场景）
3. 检查已有 workspace：所有 `created_by IS NULL` 的 workspace 改成 admin id（一次性追溯赋权）

### 3.6 前端

| 文件 | 作用 |
|---|---|
| `src/lib/auth.ts` | login / refresh / logout / me API + token storage helpers |
| `src/lib/api.ts` (修改) | 自动注入 `Authorization: Bearer ...`；401 → 调 refresh；refresh 失败 → 清 token + 跳 `/login` |
| `src/stores/session.ts` (重写) | Zustand + persist：user + access + refresh + login/logout actions |
| `src/app/(auth)/login/page.tsx` (重写) | email + password 表单 + 错误展示 |
| `src/components/app-shell.tsx` (新) | 顶部 nav：品牌 / Workspaces 链接 / 用户菜单（display_name + logout） |
| `src/app/(dashboard)/layout.tsx` (修改) | 包 `AppShell` + 客户端 AuthGuard（未登录 → `/login`） |

## 4. 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | env 设置 `PLATFORM_BOOTSTRAP_ADMIN_*` 后 `make up` | 启动日志含 "auth.bootstrap.admin_created" |
| AC-02 | `POST /api/auth/login` 用 admin 凭据 | 返回 `{access_token, refresh_token, expires_in}` |
| AC-03 | 错密码 | 401 + `HTTP_401_AUTH_INVALID_CREDENTIALS` |
| AC-04 | 不带 token 调 `GET /api/workspaces` | 401 + `HTTP_401_AUTH_TOKEN_MISSING` |
| AC-05 | 过期 access token | 401 + `HTTP_401_AUTH_TOKEN_EXPIRED` |
| AC-06 | `POST /api/auth/refresh` 老 refresh | 200 + 新 token；旧 refresh 再用一次 → 401 + 该 user 所有 session 被吊销 |
| AC-07 | 普通用户（无 WORKSPACE_WRITE）调 `POST /api/workspaces` | 403 + `HTTP_403_PERMISSION_DENIED` |
| AC-08 | admin 调任何 API | 通过（is_platform_admin 直通） |
| AC-09 | `GET /api/auth/me` 返回当前用户 + 所有 workspace 下的 role list | shape 见 `schema.MeResponse` |
| AC-10 | 前端无 token 访问 `/workspaces` | 自动重定向 `/login` |
| AC-11 | 前端登录成功 | 跳 `/workspaces`，顶部菜单显示 display_name |
| AC-12 | 前端 access 过期但 refresh 有效 | 透明 refresh，用户无感 |
| AC-13 | 前端点 logout | 清 token + DB session 撤销 + 跳 `/login` |
| AC-14 | 单测覆盖率 | auth 模块 ≥ 85% |
| AC-15 | bootstrap 后追溯赋权 | minimal-sillyspec / Task-03 Valid Fixture 的 `created_by` 变成 admin id |

## 5. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| `PLATFORM_BOOTSTRAP_*` 写到镜像被泄露 | 默认密码风险 | 强制要求登录后立即改密；启动日志不打印密码；env 不写进 docker-compose.yml，只放 .env |
| bcrypt cost=12 性能 | 登录慢 | 接受 ~250ms 单次；后续可降到 10 配合 rate limit |
| refresh token 在 localStorage | XSS 时被偷 | V1 妥协；V2 改 httpOnly cookie + SameSite=strict |
| 401 自动 refresh 死循环 | 无穷重试 | apiFetch 加 retried 标记，refresh 失败 → 强制跳 /login 不再重试 |
| 现有 workspace `created_by=NULL` | bootstrap 后查询 RBAC 出错 | bootstrap 同步追溯赋值；后续 NOT NULL 约束在 task-Auth-v2 加 |
| 测试要 mock JWT | 测试样板代码多 | conftest 提供 `auth_client` fixture：自动登录 admin 返回带 token 的 AsyncClient |

## 6. 完成定义

- [ ] 15 个 AC 通过
- [ ] 单测 + 浏览器实测截图（登录 / logout / 401 拦截 / 403 拦截）
- [ ] `tasks.md` 总览插入 task-04a，依赖关系更新
- [ ] `verification.md` 追加 task-04a 记录
- [ ] PR 合并
