---
author: qinyi
created_at: 2026-06-24T01:50:01
source_commit: ba87eec
---

# 用户认证流程

## 目标
验证用户身份并发放短期访问凭证，确保 API 安全访问；支持 access/refresh 轮换与 API Key 备选。

## 参与模块
- **backend/auth**：`/login`、`/refresh`、`/logout`、`/me`、`/api-keys`（`app/modules/auth/router.py`）
- **backend/core/security**：JWT 签发/校验（HS256）、refresh token 生成/bcrypt 存储
- **backend/core/auth_deps**：`Authorization: Bearer` 与 `X-API-Key` 依赖注入、权限校验
- **frontend**：token 存储、自动注入 Authorization、401 刷新拦截
- **database**：用户凭证、Session（`hash(refresh_token)` + expires_at）

## 流程摘要
```text
[frontend] POST /login (email/pwd)
      │
      ▼
[backend/auth] bcrypt 校验密码
      │ 通过
      ▼
[backend/core/security] 发放 Token Pair
   access_token  (JWT HS256, 15min)
   refresh_token (随机串, 7days)
      │ DB 存 hash(refresh_token) + expires_at
      ▼
[frontend] access→memory / refresh→secure

—— 正常请求 ——
[frontend] API 请求 (Bearer access)  ──► [backend] 鉴权通过
      │ access 15min 过期 → 401
      ▼
[frontend] POST /refresh (refresh_token)
      │ 校验 + 作废旧 refresh + 发放新 pair
```
> API Key 备选：`X-API-Key` 头由 `auth_deps` 解析，走独立鉴权路径。

## 失败回滚
| 失败点 | 处理 |
|--------|------|
| 密码错误 | 401，审计日志记录失败尝试 |
| access token 伪造/过期 | `decode_access_token` 抛 AccessTokenError → 401 |
| refresh token 重放/失配 | `verify_refresh_token` 失败 → 撤销会话，强制重登 |
| 用户已停用 | 403，拒绝发放 token |

## 关键术语
- **access_token**：HS256 JWT，15min TTL，`typ=access`
- **refresh_token**：随机串，7d，DB 存 `hash_refresh_token`（bcrypt）
- **Session**：DB 记录，`hash(refresh_token)` + `expires_at`
- **TokenPair**：login/refresh 响应体
