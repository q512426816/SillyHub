---
author: qinyi
created_at: 2026-06-24T01:47:08
source_commit: ba87eec
---

# 鉴权与会话流程

## 目标
为前端、daemon 及 API 调用方提供双路径认证（JWT + API Key），并基于 workspace 维度做 RBAC 权限校验。

## 参与模块
- **backend/auth**：登录/刷新/登出/me、API Key 管理（`auth.service` / `api_key_service` / `permissions`）
- **backend/core.security**：JWT 签发与解码、密码哈希（`create_access_token` / `decode_access_token`）
- **backend/core.auth_deps**：`get_current_principal` 双路径依赖 + `require_permission`
- **backend/workspace (members)**：用户-工作区角色（`UserWorkspaceRole`）
- **backend/admin**：用户/角色/组织管理
- **frontend**：`(auth)/login` 页 → `lib/auth.ts` → `stores/session.ts`（zustand persist）

## 流程摘要

```text
(frontend)  POST /api/auth/login {username, password}
     │
(backend)   AuthService.authenticate → verify_password(pwd_context)
     │        └─ create_access_token + create_refresh_token → TokenPair
     ▼
(frontend)  useSession.setTokens → 写 localStorage(multi-agent-platform.session)
     │        后续请求 apiFetch 注入 Authorization: Bearer <access_token>
     ▼
(backend)   受保护端点 Depends(get_current_principal)
     │        ├─ 先解 JWT（decode_access_token）→ Principal
     │        └─ JWT 失败 → 取 header/query 的 api_key → ApiKeyService 校验
     ▼
(backend)   require_permission(p) → has_permission(user, p, workspace_id)
     │        查 UserWorkspaceRole + Permission rbac 矩阵
     │        缺权限 → 403 {workspace_id, permission}
     ▼
(frontend)  access_token 过期 → POST /api/auth/refresh {refresh_token}
            → 拿新 TokenPair；refresh 失败 → 跳登录页
```

daemon 路径：daemon 进程持 API Key（`?api_key=` query 或 header），走 `get_current_principal` 第二条路径调用 `/daemon/register`、`/daemon/heartbeat`、`/daemon/leases/*`。

## 失败回滚

| 失败点 | 处理 |
|--------|------|
| 密码错 | 返回 401，前端显示凭据错误 |
| access_token 过期 | 前端自动 refresh；refresh 也过期则登出 |
| api_key 失效 | daemon 请求 401，daemon 日志报错并停止心跳 |
| 缺 workspace 权限 | 403 带 permission 名，前端提示无权限 |
| bootstrap admin 缺失 | AuthService 启动时 seed bootstrap user + 授 workspace_owner |

## 关键术语
- **Principal**：认证主体（user 或 api_key 持有者），双路径归一
- **Permission / PermissionGroup**：RBAC 细粒度权限与权限组
- **UserWorkspaceRole**：用户在某 workspace 的角色绑定（多租户核心）
