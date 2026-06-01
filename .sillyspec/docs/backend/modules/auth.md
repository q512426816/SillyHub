---
author: qinyi
created_at: 2026-05-31T23:30:00
---

# auth

> 最后更新：2026-05-31
> 最近变更：feat(auth): RBAC permissions + workspace-scoped role binding
> 模块路径：`app/modules/auth/**`

## 职责

JWT 认证（登录/刷新/登出）+ RBAC 权限控制（角色-权限-工作区绑定），包括 bootstrap 管理员初始化和 refresh token 重用攻击检测。

## 当前设计

### 架构

```
AuthService（业务层）
  ├── JWT access_token（短期，含 user_id/email/is_admin）
  ├── Refresh token（长期，bcrypt 哈希存储在 Session 表）
  ├── Reuse attack 检测（已吊销 token 再现 → 吊销全部会话）
  └── bootstrap_admin_and_seed_rbac() — 启动时初始化管理员+角色

auth_deps.py（FastAPI 依赖注入）
  ├── get_current_user — JWT 解码 + 用户查询
  ├── require_permission — 单工作区权限检查
  └── require_permission_any — 任一工作区权限检查

rbac.py（权限查询）
  ├── allowed_workspace_ids — 用户有权限的工作区列表
  └── list_user_workspace_roles — 用户角色列表
```

### 关键逻辑

1. **登录流程**：校验 email+password → 签发 `(access_token, refresh_token)` 对 → 存储 `Session` 行
2. **Refresh 轮换**：消费旧 refresh token → 吊销旧 Session → 签发新 token 对
3. **重用攻击检测**：已吊销 token 再次使用 → 吊销该用户所有会话（`revoke_all_user_sessions`）
4. **Refresh token 验证**：遍历未吊销未过期的 Session 行，bcrypt 逐个比对（V1 暴力但安全）
5. **Bootstrap**：启动时检查 `PLATFORM_BOOTSTRAP_ADMIN_EMAIL`，自动创建管理员并 seed workspace_owner 角色
6. **RBAC**：`UserWorkspaceRole` 三元组 `(user_id, workspace_id, role_id)` → `Role` → `RolePermission` → 权限字符串

## 对外接口

| 接口 | 方法 | 说明 | 调用方 |
|------|------|------|--------|
| `POST /auth/login` | `login()` | 登录，返回 TokenPair | 前端 |
| `POST /auth/refresh` | `refresh()` | 刷新 token 对 | 前端 |
| `POST /auth/logout` | `logout()` | 吊销当前 session | 前端 |
| `GET /auth/me` | `me()` | 当前用户信息 + 工作区角色列表 | 前端 |

## 关键数据流

```
POST /auth/login → AuthService.login()
  → _lookup_active_user_by_email()    # 查询 + 状态检查
  → password_hasher.verify()          # bcrypt 校验
  → _issue_token_pair()              # JWT + Session 行
  → COMMIT
```

```
POST /auth/refresh → AuthService.refresh()
  → _consume_refresh_token()
    → 遍历活跃 Session，bcrypt 验证   # O(n) 暴力匹配
    → 未找到 → _lookup_revoked_session_owner()
      → 已吊销 token 重现 → revoke_all_user_sessions()  # 重用攻击
  → _mark_session_revoked()           # 吊销旧 session
  → _issue_token_pair()              # 新 token 对
  → COMMIT
```

```
应用启动 → bootstrap_admin_and_seed_rbac()
  → 检查 env vars → 查找/创建 admin User
  → 查找 workspace_owner Role
  → 为每个 Workspace 创建 UserWorkspaceRole
  → backfill created_by = admin.id
```

## 设计决策

| 决策 | 理由 | 来源 |
|------|------|------|
| Refresh token bcrypt 哈希存储 | 即使 DB 泄露也无法还原明文 token | references/15-authentication.md §3 |
| Refresh 轮换（消费→吊销→重签） | 限缩 token 暴露窗口 | references/15-authentication.md §3 |
| 重用攻击全量吊销 | 最保守策略，宁可让合法用户重登 | service.py docstring |
| MFA 列预留但 nullable | V1 不实现 MFA，后续迁移无需改表 | model.py docstring |
| Bootstrap 通过环境变量 | V1 无管理 UI，依赖 env 初始化首个用户 | service.py `bootstrap_admin_and_seed_rbac` |
| 用户登录不暴露 email 是否存在 | 常量错误消息防枚举 | service.py `_lookup_active_user_by_email` |

## 依赖关系

### 依赖本模块
- 所有模块的 `router.py`：通过 `require_permission` / `get_current_user` 注入认证
- `workspace/router.py`：RBAC 过滤工作区列表
- `core/auth_deps.py`：其他模块导入的认证依赖

### 本模块依赖
- `core/security`：JWT 签发/验证、bcrypt hash、refresh token 生成
- `core/config`：JWT 密钥、过期时间、bootstrap 环境变量
- `core/errors`：AuthInvalidCredentials、AuthRefreshReused 等 4 种错误
- `workspace/model`：Bootstrap 时查询 Workspace 表（延迟导入避免循环）

## 注意事项

- Refresh token 查询是 O(n) 全表扫描，V1（<1k 活跃 session）可接受，扩展需改为 jti + HMAC
- 登出对网络抖动幂等：未知/已吊销 token 返回 204 不报错
- `revoke_all_user_sessions` 使用 UPDATE WHERE 批量操作，不逐行处理
- Bootstrap 只在 `PLATFORM_BOOTSTRAP_ADMIN_EMAIL` 非空时执行，容器无 secret 时静默跳过
- `allowed_workspace_ids` 返回空列表时，前端路由会直接 `WHERE id IN ()` 阻止查询

## 变更索引

| 日期 | 变更 | 摘要 |
|------|------|------|
| 2026-05-31 | 初始归档 | 从代码逆向生成模块文档 |
