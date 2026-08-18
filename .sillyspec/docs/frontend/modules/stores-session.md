---
schema_version: 1
doc_type: module-card
module_id: stores-session
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 会话状态全局 store（stores-session）

## 定位
客户端会话状态的全局 store（`frontend/src/stores/session.ts`，66 行，zustand + persist）。持有当前登录用户、access/refresh token、hydration 标记，是前端唯一的会话真相源。持久化到 localStorage（key `multi-agent-platform.session`，version 1）。被 lib-api / lib-auth / lib-token-refresh / lib-permission、各布局与几乎所有页面订阅，是全仓依赖最广的 store。

## 契约摘要
- `useSession` — `create<SessionState>()(persist(...))`；组件内 `useSession(s => s.user)` 选择性订阅，非组件场景 `useSession.getState()`。
- `SessionUser`：`{ id, email, displayName, is_platform_admin?, permissions?: string[] }`。
- `SessionTokens`：`{ accessToken: string | null, refreshToken: string | null }`。
- 方法：`setUser(user | null)`、`setTokens({accessToken, refreshToken})`、`clear()`（登出清 user+双 token）、`markHydrated()`。
- persist 配置：`partialize` 只落 4 字段（hydrated/user/accessToken/refreshToken）；`onRehydrateStorage` 恢复完成后调 `markHydrated()`。

## 关键逻辑
```
useSession = create(persist(
  (set) => ({ hydrated:false, user:null, accessToken:null, refreshToken:null, ...setters }),
  { name:"multi-agent-platform.session", version:1, partialize:4字段,
    onRehydrateStorage: () => (state) => { if (state) state.markHydrated() } }
))
非组件读取: useSession.getState().accessToken   // lib-api/apiFetch、401 刷新回写 setTokens
```

## 注意事项
- **`hydrated` 是守卫关键**：persist 恢复异步，路由守卫/权限判定必须等 `hydrated === true` 再读 user/token，否则首屏闪现未登录态。
- token 在 `apiFetch`（lib-token-refresh 单飞刷新）等非组件场景经 `getState()` 读写，不走 hook。
- `clear()` 登出必须同时清 user+token 并触发跳转，防残留态。
- `is_platform_admin` 与 `permissions` 是 lib-permission 判定输入（超管短路）。
- persist key/version 写死：改名或升 version 需迁移策略，否则旧用户态丢失（项目未上线可清数据，但多端本地开发环境会感知）。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
