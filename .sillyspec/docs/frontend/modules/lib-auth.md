---
schema_version: 1
doc_type: module-card
module_id: lib-auth
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 认证 API 客户端（lib-auth）

## 定位
认证领域 API 客户端（`frontend/src/lib/auth.ts`，94 行）。封装登录、当前用户拉取、登出、自助改密、登录点按式人机确认，落地到 zustand `useSession` store。类型全部从 OpenAPI 生成（`components["schemas"]`，后端 `auth/schema.py`），消除手写漂移。桌面/移动登录页、`(dashboard)` layout、account 页与 `ConfirmCaptcha` UI 的数据入口。

## 契约摘要
- `login(account, password, captchaToken?)` — POST `/api/auth/login`；成功 `setTokens` 后立即 `fetchMe()` 填充用户/权限，返回 `TokenPair`。
- `fetchMe()` — GET `/api/auth/me`；`setUser({ id, email, displayName, is_platform_admin, permissions })`。
- `logout()` — 原生 `fetch` POST `/api/auth/logout`（带 Bearer + `refresh_token` body），无论成败 `finally` 清空 session。
- `changePassword(oldPassword, newPassword)` — POST `/api/auth/change-password`；改密成功撤销该用户其他设备会话，当前 access_token 有效期内仍可用。
- 点按式人机确认（登录爆破防护，原拖拉滑块已下线）：
  - `fetchConfirmCaptcha()` — GET `/api/auth/captcha/confirm` → `ConfirmCaptchaData`。
  - `verifyConfirmCaptcha(captchaId)` — POST `/api/auth/captcha/verify` → `CaptchaVerifyResult`。
- 类型：`TokenPair` / `MeResponse` / `ConfirmCaptchaData` / `CaptchaVerifyResult`（均 OpenAPI 生成索引）。

## 关键逻辑
```
login(account, password, captchaToken?):
  pair = apiFetch POST /api/auth/login { account, password, captcha_token }
  session.setTokens(...); await fetchMe(); return pair
fetchMe():
  me = apiFetch GET /api/auth/me
  setUser(可空字段降级合并: email ?? username, displayName ?? email ?? username)
logout():
  无 refreshToken → 直接 clear
  try: 原生 fetch POST /api/auth/logout   # 故意不走 apiFetch
  finally: session.clear()
```

## 注意事项
- `login` 入参是 `account`（非纯 email，允许 username-only 登录）；`MeResponse.user` 的 email / username / display_name 均可空，`fetchMe` 内做降级合并保证 SessionUser 的非空 string 约定（类型诚实）。
- `logout` 故意用原生 `fetch` 而非 `apiFetch`，避免登出请求自身触发 401 刷新重试链死循环。
- 旧 `refreshTokens` 已删除（c2262cca 死代码清理，0 引用）；主动续期统一走 `lib-token-refresh.ensureFreshAccessToken`（由 `apiFetch` 401 路径调用），本模块不再自带刷新。
- `MeResponse` 携带 workspace 角色绑定与 `permissions` 字符串列表，是 `lib-permission` / `lib-menu-permissions` 细粒度控制的数据源。
- 移动端（`/m/login`、`/m/account`）与桌面共用本模块，无移动专属分支。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
