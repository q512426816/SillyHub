# 15 — 用户认证设计

## 1. 选型

| 阶段 | 方案 | 理由 |
|---|---|---|
| V1-V2 | FastAPI + python-jose JWT + bcrypt + Postgres | 零外部依赖、AI 写 auth 模板成熟、可平滑升级 OIDC |
| V3 | 评估接入 Keycloak / Authelia | 多组织场景需要 OIDC、SAML、社交登录 |
| V5 | 强制 MFA / SSO | 企业级安全 |

不选 Auth.js / Clerk / Auth0 的原因：

- Auth.js 把会话存在浏览器 cookie，多服务进程取用户信息需要回调，增加复杂度
- Clerk / Auth0 SaaS 锁定 + 数据出境合规问题
- 后端自管用户 = 与 Workspace、Git Identity 双向关联最简单

## 2. 数据表

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  display_name VARCHAR(100),
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  is_platform_admin BOOLEAN NOT NULL DEFAULT false,
  mfa_secret VARCHAR(64),
  mfa_enabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ
);

CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash VARCHAR(255) NOT NULL,
  user_agent TEXT,
  ip INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);
CREATE INDEX idx_sessions_user ON sessions(user_id, revoked_at);

CREATE TABLE login_attempts (
  id BIGSERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  ip INET,
  user_agent TEXT,
  success BOOLEAN NOT NULL,
  failure_reason VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_login_attempts_email_time ON login_attempts(email, created_at DESC);
```

## 3. Token 策略

| Token | 算法 | 有效期 | 存储 | 用途 |
|---|---|---|---|---|
| Access Token | JWT HS256 | 15 min | 内存 / sessionStorage | API 鉴权 |
| Refresh Token | 随机 32 字节 → bcrypt | 14 天 | bcrypt 入库 | 刷新 Access |

Access JWT 载荷：

```json
{
  "sub": "<user_id>",
  "email": "user@example.com",
  "is_admin": false,
  "iat": 1716625200,
  "exp": 1716626100,
  "jti": "<token_id>"
}
```

Refresh 策略：

- 单次使用后立即作废，签发新 refresh
- 检测到旧 refresh 被重复使用 → 视为被盗，吊销该用户所有 session
- 退出登录 = 写入 `sessions.revoked_at`

## 4. 密码策略

- 最少 12 位
- 必须包含大写、小写、数字、特殊字符各一
- bcrypt cost=12
- 密码错误超过 5 次锁定账号 15 分钟
- 同一 IP 1 分钟内尝试超过 20 次直接 429

## 5. API 列表

```http
POST   /api/auth/register          # V1 关闭，由 admin 在管理面板创建
POST   /api/auth/login             # email + password (+ totp)
POST   /api/auth/refresh           # refresh_token -> 新 access + 新 refresh
POST   /api/auth/logout            # 当前 session
POST   /api/auth/logout-all        # 吊销所有 session
GET    /api/auth/me                # 当前用户 + 已绑定的 GitIdentity 概览
POST   /api/auth/change-password
POST   /api/auth/mfa/enable
POST   /api/auth/mfa/verify
POST   /api/auth/mfa/disable
```

## 6. FastAPI 依赖样例

```python
async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=["HS256"])
    except JWTError as exc:
        raise HTTPException(401, "invalid_token") from exc

    user_id = payload.get("sub")
    user = await db.get(User, user_id)
    if not user or user.deleted_at:
        raise HTTPException(401, "user_inactive")
    return user
```

## 7. 与 Git Identity 的关系

- 平台账号（User）≠ Git Identity
- 一个 User 可绑定 0..N 个 GitIdentity（GitHub / GitLab / Gitea / 自建）
- 执行 Git 操作时：必须存在 `user_id == current_user.id` 且未过期的 GitIdentity，否则拒绝
- 详见 `04-git-identity-and-worktree-isolation.md`

## 8. 安全审计事件

下列事件必须写入 `audit_events`，事件类型 = `AUTH_*`：

| event_type | 说明 |
|---|---|
| AUTH_LOGIN_SUCCESS | 登录成功 |
| AUTH_LOGIN_FAILED | 登录失败 |
| AUTH_LOGOUT | 主动登出 |
| AUTH_PASSWORD_CHANGED | 改密 |
| AUTH_MFA_ENABLED / AUTH_MFA_DISABLED | MFA 变更 |
| AUTH_SESSION_REVOKED | 会话被吊销 |
| AUTH_ACCOUNT_LOCKED | 账号被锁 |
| AUTH_ADMIN_CREATED_USER | 管理员新建用户 |

## 9. V1 验收点

- [ ] admin 能新建用户
- [ ] 普通用户能登录
- [ ] Access 过期 15 分钟后必须刷新
- [ ] Refresh 单次使用后失效
- [ ] 重复使用旧 refresh 时所有 session 被吊销
- [ ] 5 次密码错误锁定 15 分钟
- [ ] 所有 auth 事件被写入 audit_events
- [ ] 注销后旧 access 在剩余有效期内仍可调用（已知妥协），但不能 refresh

## 10. 未来扩展点

- OIDC：实现 `/api/auth/oidc/login` + `/callback`，把 OIDC sub 映射到 users.email
- LDAP：增加 `external_id` 字段
- SSO：增加 `identity_providers` 表，多对多关联
- 设备指纹 / 异地登录提醒：用 `login_attempts` 表统计
