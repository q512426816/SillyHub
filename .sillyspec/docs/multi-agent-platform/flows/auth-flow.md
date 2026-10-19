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
- **frontend**：token 存储、自动注入 Authorization、401 刷新拦截（token-refresh 单飞 + 状态码分流）
- **database**：用户凭证、Session（`hash(refresh_token)` + `expires_at` + `family_id` 会话族）

## 流程摘要
```text
[frontend] POST /login (email/pwd)
      │
      ▼
[backend/auth] bcrypt 校验密码
      │ 通过
      ▼
[backend/core/security] 发放 Token Pair + 开新会话族
   access_token  (JWT HS256, 30min)
   refresh_token (随机串, 14 days)
      │ DB 存 hash(refresh_token) + expires_at + family_id(新族根 uuid4)
      ▼
[frontend] access→memory / refresh→secure

—— 正常请求 ——
[frontend] API 请求 (Bearer access)  ──► [backend] 鉴权通过
      │ access 30min 过期 → 401
      ▼
[frontend] POST /refresh (refresh_token)
      │ 校验 + 作废旧 refresh（写 rotated_at）+ 发放新 pair（继承族）
      │ grace 宽限窗（默认 300s）内旧 token 再提交 → 换发新对不吊销
      │ 超窗复用旧 token → 族级吊销（见失败回滚）
```
> API Key 备选：`X-API-Key` 头由 `auth_deps` 解析，走独立鉴权路径。

## 前端刷新契约（2026-10-16-fix-auth-random-logout）
- `/api/auth/refresh` 响应按状态码分流：**2xx** 换发新对；**401/403/其余 4xx** = 凭证明确失效 → 清会话跳登录；**5xx / 408 / 429（含超时/网络异常）** = 链路瞬态故障 → 抛错保持登录态（部署窗口/代理抖动不误踢在线用户，可重试自愈）。

## 失败回滚
| 失败点 | 处理 |
|--------|------|
| 密码错误 | 401，审计日志记录失败尝试 |
| access token 伪造/过期 | `decode_access_token` 抛 AccessTokenError → 401 |
| refresh token 重放（超 grace 窗复用已轮换的旧 token） | 族级吊销：仅注销该 token 所属**会话族**（同一次登录衍生的全部 session，含窃取者换出的后代），同用户其他设备登录不受影响；返 401 `auth_refresh_reused` 强制该设备重登 |
| refresh token 失配/无法解析 | `verify_refresh_token` 失败 → 401 `auth_token_invalid` |
| 用户已停用 | 403，拒绝发放 token |

## 关键术语
- **access_token**：HS256 JWT，30min TTL（`auth_access_ttl_minutes`），`typ=access`
- **refresh_token**：随机串（`{token_id}.{secret}` 两段式），14d（`auth_refresh_ttl_days`），DB 存 `hash_refresh_token`（bcrypt）+ `token_id_hmac` 索引
- **Session**：DB 记录，`hash(refresh_token)` + `expires_at` + `rotated_at`（轮换锚点）+ `family_id`（会话族；NULL=存量旧行自成一族）
- **会话族（family）**：同一次登录衍生的 session 谱系；refresh 轮换/grace 续期继承族值，复用检测按族吊销（2026-10-16-fix-auth-random-logout）
- **grace 宽限窗**：rotate 后 `auth_refresh_grace_seconds`（默认 300s）内旧 token 再提交换发新对不吊销——并发刷新/休眠恢复误杀兜底；0=关闭
- **TokenPair**：login/refresh 响应体
