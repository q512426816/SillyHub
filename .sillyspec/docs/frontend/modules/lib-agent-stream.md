---
schema_version: 1
doc_type: module-card
module_id: lib-agent-stream
author: qinyi
created_at: 2026-06-10T16:55:00
---

# lib-agent-stream

## 定位
Agent 运行日志的高级 SSE 客户端。提供自动重连、断线补漏、去重等能力，是 `streamAgentRunLogs`（lib-agent）的增强版。

## 契约摘要
- `AgentRunStreamClient` 类 — 封装 SSE 连接管理
  - `connect(token)` — 建立 SSE 连接
  - `disconnect()` — 断开连接
  - `onMessage(cb)` — 注册消息回调（返回取消函数）
  - `onStatusChange(cb)` — 注册状态变更回调
  - `onDone(cb)` — 注册完成回调
  - `getStatus()` — 获取当前连接状态
- 类型：`StreamStatus`（disconnected/connecting/connected/error）、`StreamDoneData`

## 关键逻辑
- 断线重连：指数退避（1s/2s/4s/8s/16s），最多重试 5 次
- 断线补漏：重连前通过 getAgentRunLogs 获取 lastLogId 之后的缺失日志
- 日志去重：通过 seenLogIds Set 过滤重复消息
- 重连时自动从 session store 获取新 token

## 注意事项
- 此模块是较新添加的增强版流客户端，部分页面可能仍在使用 lib-agent 的 streamAgentRunLogs
- EventSource URL 使用 getDirectApiBaseUrl() 直连后端

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
