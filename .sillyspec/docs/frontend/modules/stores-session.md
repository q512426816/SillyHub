---
schema_version: 1
doc_type: module-card
module_id: stores-session
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:02:04
---
# stores-session

## 定位
客户端会话状态的全局 store（基于 zustand + persist 中间件）。持有当前登录用户信息、access/refresh token、hydration 标记，作为整个前端唯一的会话真相来源，被 `lib-api`（取 token/刷新）、`lib-auth`、`lib-permission`、布局与各页面订阅。持久化到 localStorage，刷新页面后恢复。

## 契约摘要
- `useSession` — zustand store hook（`create<SessionState>()(persist(...))`），组件内 `useSession(s => s.user)` 订阅；非组件场景用 `useSession.getState()`。
- `SessionUser`：`{ id, email, displayName, is_platform_admin?, permissions?: string[] }`。
- `SessionTokens`：`{ accessToken: string | null, refreshToken: string | null }`。
- `SessionState` 方法：`setUser(user | null)`、`setTokens({accessToken, refreshToken})`、`clear()`（登出清空）、`markHydrated()`。
- 状态字段：`user`、`accessToken`、`refreshToken`、`hydrated`（persist 恢复完成标记）。

## 关键逻辑
persist + 确定性 hydration：
```
useSession = create(persist(
  (set) => ({
    hydrated:false, accessToken:null, refreshToken:null, user:null,
    setUser/setTokens/clear/markHydrated: set(...),
  }),
  {
    name: "<session-storage-key>",
    onRehydrateStorage: () => (state) => {
      // zustand persist 的 hydration 是异步的；
      // 这里在恢复完成后调 markHydrated，让守卫逻辑确定性判断
      if (state) state.markHydrated();
    },
  },
))
```
非组件读取（`lib-api` 等）：`const { accessToken, refreshToken } = useSession.getState()`，避免 hook 规则限制。

## 注意事项
- **`hydrated` 是关键守卫标记**：persist 恢复是异步的，路由守卫/权限判定必须先等 `hydrated === true` 再读 user/token，否则首屏会闪现未登录态或丢失鉴权。
- token 通过 `getState()` 在 `apiFetch` / `downloadExcel` 等非组件场景读取，401 时用 refreshToken 刷新后 `setTokens` 回写。
- `clear()` 用于登出：必须同时清 user + token + 触发跳转，避免残留态。
- `is_platform_admin` 与 `permissions` 是 `lib-permission` 判定的输入，超管短路依赖前者。
- store key 写死在 persist 配置，改名会导致旧用户态丢失（本项目未上线可清数据，但仍需注意）。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
