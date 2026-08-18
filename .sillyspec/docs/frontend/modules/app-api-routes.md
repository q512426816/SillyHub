---
schema_version: 1
doc_type: module-card
module_id: app-api-routes
author: qinyi
created_at: 2026-08-18 01:45:00
---

# SSE 流中继路由（app-api-routes）

## 定位
Next.js Route Handler（`src/app/api/**/route.ts`）集合，当前仅 3 个 SSE 流中继端点，是浏览器到后端长连接流的同源中转层。存在原因：前端流客户端（lib-fetch-sse）需带鉴权访问后端 SSE，经 Next 路由中转可把 token 放 `Authorization` header 转发（后端 auth 已 header-only），并顺带解决跨域。三条路由均为纯透传——不解析、不改写事件，事件语义演进无需动这里。

## 契约摘要
- `GET /api/workspaces/[workspaceId]/agent/runs/[runId]/stream`：workspace agent-run 级日志流，供 `useAgentRunStream` / `AgentRunStreamClient` 订阅；透传 `after` 断线续传游标。
- `GET /api/daemon-chat/[runId]/stream`：daemon quick-chat run 级流。
- `GET /api/daemon/sessions/[sessionId]/stream`：daemon session 级流（sessions 门户 / 会话权限面板用），透传 `cursor` / `lastEventId` / `Last-Event-ID` 续传参数；sessionId 做 `encodeURIComponent`。
- 共性：`export const runtime = "nodejs"` + `dynamic = "force-dynamic"`；BACKEND_URL = `INTERNAL_API_BASE_URL ?? NEXT_PUBLIC_API_BASE_URL ?? http://localhost:8000`（去尾斜杠）；非 2xx / 无 body 时原样回 backend status（body 有则透传，无则文本 `Backend error: <status>`）。

## 关键逻辑
```
token 转发: 优先透传入站 Authorization header（fetch-sse 客户端）；
            入站 query token 兜底 → 转 Authorization: Bearer
            （token 绝不拼 backend URL——URL 会进 backend access log 明文泄漏）
响应头:     Content-Type: text/event-stream + no-cache + keep-alive
            + X-Accel-Buffering: no（Nginx 等反代禁缓冲）
session 级: 额外透传 request.signal（客户端中断即断后端）
            + undici compress:false + Accept-Encoding: identity
            （防 SSE data 帧攒在解压缓冲里"200 OK 但无实时事件"）
```

## 注意事项
- token 从 query 改 header 转发是安全修复后的既定形态（P0-2 / task-12 两轮改造）；backend URL 只留业务参数（after / cursor / lastEventId）。新增同类路由必须沿用该模式，勿把 token 拼回 URL。
- `compress:false` / `signal` 目前只有 session 级路由做了；run 级两条（agent runs / daemon-chat）如遇"连接成功但事件不到"，按 session 路由对齐补齐。
- 断线续传依赖 `after`/`cursor` 游标且后端支持游标回放；改后端 SSE 路径须同步改这三处拼接 URL，否则流 404。
- 路由跑 Node runtime 长连接，Docker 部署与 Nginx 反代均已验证可行；勿改成 edge runtime（undici 特性依赖 Node fetch）。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
