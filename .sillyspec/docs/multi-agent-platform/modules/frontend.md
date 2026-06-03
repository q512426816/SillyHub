---
author: qinyi
created_at: 2026-06-03T09:24:16
---

# frontend

## Current State

- Next.js 14.2.5 + React 18 + TypeScript + Tailwind CSS
- API 代理：`next.config.mjs` rewrites `/api/*` 到后端，但 SSE 流式端点由 Route Handler 直接透传（绕过 rewrite 缓冲）
- SSE 流：`AgentRunStreamClient`（`agent-stream.ts`）提供指数退避重连（最多 5 次），`after` cursor 去重重放
- 认证：`useSession` store 管理 access/refresh token，`apiFetch` 自动附加 Authorization header，EventSource 通过 `?token=` query param 传递

## Change Index

| Date | Change | Summary |
|---|---|---|
| 2026-06-03 | fix-sse-nextjs-rewrite-buffering | 创建 `app/api/.../stream/route.ts` Route Handler 透传后端 SSE 流，修复 Next.js rewrites 缓冲导致 EventSource 5 秒断开重连 |
