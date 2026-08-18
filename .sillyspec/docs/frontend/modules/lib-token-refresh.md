---
schema_version: 1
doc_type: module-card
module_id: lib-token-refresh
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 令牌单飞刷新器（lib-token-refresh）

## 定位

access token 的**单飞（single-flight）刷新器**：多个并发调用者（同时收到 401 的
N 个请求、AppShell 主动续期、auth.ts 登录后刷新）共享同一次 `POST /api/auth/refresh`
的结果。存在的意义是防并发刷新触发后端 reuse-attack 检测、误吊销全部 session。
仅负责「发起一次刷新 + 写回 store」，不决定哪个调用点触发。

## 契约摘要

- `ensureFreshAccessToken(): Promise<string | null>` — 已有进行中的刷新则复用其
  结果，否则发起一次；成功返回新 access token 并 `setTokens` 写回 session store；
  未登录 / 未 hydrate / 刷新失败返回 `null`（不抛）。
- `decodeJwtExp(token): { exp: number; iat: number } | null` — 只读 JWT payload
  推算剩余 TTL，**不验签**；格式非法静默返回 null。
- 刷新端点：`${getApiBaseUrl()}/api/auth/refresh`，body
  `{ refresh_token }`，响应 `{ access_token, refresh_token }`（轮换双 token）。

## 关键逻辑

```
if (!refreshToken || !hydrated) return null        // 不猜测，放行给上层
if (inflight) return await inflight                // 单飞核心：复用进行中请求
inflight = doRefresh(); try { ... } finally { inflight = null }
```

## 注意事项

- **finally 清空 inflight 是关键**：无论成功/失败/异常都清，否则后续调用会永远
  await 一个已 settle 的 Promise。
- `doRefresh` 失败返回 null 而非抛出，重试/登出决策交由调用方（401 收口点）。
- `decodeJwtExp` 的 base64url 解码走 `atob` 优先、`Buffer.from` 兜底，浏览器与
  Node（测试环境）双平台可用；主动刷新调度（AppShell）用它算 TTL。
- 消费方：`lib/api.ts`、`lib/auth.ts`、`components/app-shell.tsx`、
  `lib/ppm/problem.ts`、`lib/ppm/export.ts`、`lib/file/api.ts`；
  单测 `lib/__tests__/token-refresh.test.ts`。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
