---
schema_version: 1
doc_type: module-card
module_id: stores-session
author: qinyi
created_at: 2026-06-10T16:55:00
---

# stores-session

## 定位
客户端 Session Store。使用 Zustand + persist 中间件管理用户认证状态，是整个前端认证体系的核心状态源。

## 契约摘要
- State: `hydrated`（是否已从 localStorage 恢复）、`user`（SessionUser | null）、`accessToken`、`refreshToken`
- Actions: `setUser(user)`、`setTokens(tokens)`、`clear()`、`markHydrated()`
- Hook: `useSession` — Zustand hook
- 类型：SessionUser（id/email/displayName）、SessionTokens（accessToken/refreshToken）

## 关键逻辑
- 使用 `zustand/middleware/persist` 持久化到 localStorage（key: `multi-agent-platform.session`）
- `hydrated` 标志在 persist 的 `onRehydrateStorage` 回调中设置，用于解决水合时序问题
- `partialize` 确保只有指定字段被持久化
- Dashboard 布局等待 `hydrated === true` 后才做认证判断

## 注意事项
- 此 store 被 lib-api 直接引用（读取 accessToken、执行 token 刷新），是跨模块耦合点
- persist 版本为 1，未来如果修改 state 结构需要升级版本号

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
