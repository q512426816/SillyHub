---
schema_version: 1
doc_type: module-card
module_id: lib-auth
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:01:57+08:00
---
# lib-auth

## 定位
认证领域 API 客户端（`frontend/src/lib/auth.ts`，约 95 行）。封装登录、登出、token 刷新、当前用户信息拉取，落地到 zustand `useSession` store。仅登录页与 session 初始化逻辑调用，是认证状态进入前端 store 的唯一入口。

## 契约摘要
- `login(account, password): Promise<TokenPair>` — 账号密码登录，成功后写入 tokens 并立即拉取 `/api/auth/me`。
- `fetchMe(): Promise<MeResponse>` — 拉取当前用户 + 工作区角色 + 权限列表，写入 session 的 user 状态。
- `refreshTokens(): Promise<SessionTokens>` — 用 refreshToken 换新 token pair 并写回 store；缺 refreshToken 抛错。
- `logout(): Promise<void>` — 调后端注销 refresh_token，无论成败都在 finally 清空 session。
- 类型：`TokenPair`（access/refresh token + 过期）、`MeResponse`（user + workspaces 角色绑定 + permissions）。

## 关键逻辑
```
login(account, password):
  pair = apiFetch POST /api/auth/login { account, password }
  session.setTokens({ accessToken, refreshToken })
  await fetchMe()   # 立即填充用户/工作区/权限
  return pair

fetchMe():
  me = apiFetch GET /api/auth/me
  session.setUser({ id, email, displayName, is_platform_admin, permissions })
  return me

logout():
  if !refreshToken: session.clear(); return
  try: fetch POST /api/auth/logout { refresh_token }  # 直连 fetch，非 apiFetch
  finally: session.clear()
```

## 注意事项
- `login` 入参是 `account`（账号，非纯 email），后端账号字段更宽泛，调用方不要按 email 校验。
- `logout` 故意用原生 `fetch` 而非 `apiFetch`，避免登出请求自身触发 `apiFetch` 的 401 刷新重试链导致死循环。
- `MeResponse.workspaces` 携带 `workspace_id` / `role_key` / `role_name`，是前端判断当前用户在某工作区角色的数据源。
- `permissions` 字段是菜单/操作权限字符串列表，供 `lib-permission` / `lib-menu-permissions` 做细粒度控制。
- 本模块的 `refreshTokens` 与 `lib-api` 中内联的 401 自动刷新是两套独立路径：apiFetch 内联刷新用于一般请求兜底，本函数用于主动续期场景。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
