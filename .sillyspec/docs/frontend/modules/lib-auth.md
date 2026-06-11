---
schema_version: 1
doc_type: module-card
module_id: lib-auth
author: qinyi
created_at: 2026-06-10T16:55:00
---

# lib-auth

## 定位
认证 API 客户端。封装登录、登出、token 刷新逻辑。

## 契约摘要
- `login(email, password)` — 登录：获取 token pair + 用户信息，存入 session store
- `refreshTokens()` — 刷新 token：用 refresh_token 换取新 token pair
- `logout()` — 登出：调用后端注销接口，清除 session store
- 类型：`TokenPair`、`MeResponse`

## 关键逻辑
- login 成功后自动调用 `/api/auth/me` 获取用户信息
- refreshTokens 从 Zustand store 读取 refreshToken，刷新后写回
- logout 在 finally 块中清除 session（即使后端调用失败也清除本地状态）

## 注意事项
- lib-api 的 401 自动刷新机制不依赖此模块的 refreshTokens，而是在 apiFetch 内联处理

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
