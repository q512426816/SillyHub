---
schema_version: 1
doc_type: module-card
module_id: app-api-routes
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:02:00
---
# app-api-routes

## 定位
Next.js Route Handler（`app/api/**/route.ts`）集合，当前仅含 3 个 SSE 流代理端点。它们是前端浏览器到后端长连接流的中转层：浏览器 EventSource 无法自定义 header 带 Bearer token，故由同源的 Next 路由把 token 放 query、再以服务端 fetch 转发到后端 SSE 并透传 body，解决鉴权与跨域。

## 契约摘要
- `GET /api/workspaces/[workspaceId]/agent/runs/[runId]/stream`：代理 agent run 日志流，供 `useAgentRunStream` / `AgentRunStreamClient` 订阅。
- `GET /api/daemon-chat/[runId]/stream`：代理 daemon quick-chat 流。
- `GET /api/daemon/sessions/[sessionId]/stream`：代理 daemon 运行时会话流，供 `SessionPermissionPanel` 等订阅 permission 事件。
- 三者均为 `export async function GET(req, { params })`，入参含 `token` / `after` 等 query。

## 关键逻辑
- 代理转发（以 agent run stream 为例）：
  ```
  const backendUrl = new URL(后端 SSE 地址)
  if (after) backendUrl.searchParams.set('after', after)
  if (token) backendUrl.searchParams.set('token', token)
  const resp = await fetch(backendUrl, { headers: { Accept: 'text/event-stream' } })
  if (!resp.ok || !resp.body) return new Response(报错, { status: resp.status })
  return new Response(resp.body, { headers: { 'content-type':'text/event-stream', ... } })
  ```
- 纯透传：不做事件解析/改写，原样把后端 ReadableStream 作为响应 body 返回。

## 注意事项
- token 走 query 而非 header，是 EventSource 限制的妥协；这些路由必须部署在同源前端域下才有意义，后端需校验 query token。
- 路由运行在 Node runtime（非 edge），透传长连接需确保部署环境允许长响应（Docker 部署已验证）。
- 新增 SSE 事件类型时无需改这里（透传）；但若要前端断线续传，需依赖 `after` 游标，后端必须支持。
- 改后端 SSE 路径时同步改这里拼接的 URL，否则流 404。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
