---
schema_version: 1
doc_type: module-card
module_id: app-api-routes
author: qinyi
created_at: 2026-06-10T16:55:00
---

# app-api-routes

## 定位
Next.js Route Handler（API 路由），作为后端 API 的代理层。主要解决 SSE 流式连接通过 Next.js rewrite 代理时被缓冲的问题。

## 契约摘要
- `app/api/workspaces/[workspaceId]/agent/runs/[runId]/stream/route.ts` — Agent 运行日志 SSE 流代理
  - GET 方法：接收 token/after 参数，转发到后端 SSE 端点
  - 返回 `text/event-stream` 响应，设置 `X-Accel-Buffering: no` 禁用 Nginx 缓冲

## 关键逻辑
- 从环境变量 `INTERNAL_API_BASE_URL` 或 `NEXT_PUBLIC_API_BASE_URL` 解析后端地址
- 直接使用 Node.js fetch 转发后端响应流（pipe-through），不做数据解析
- `runtime = "nodejs"`、`dynamic = "force-dynamic"` 确保不缓存

## 注意事项
- 目前只有 SSE 流代理一个路由，未来如果需要其他需要绕过 Next.js rewrite 的端点（如文件上传），也应在此添加
- 此路由运行在 Node.js runtime，不在 Edge runtime

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
