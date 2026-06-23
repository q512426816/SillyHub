---
schema_version: 1
doc_type: module-card
module_id: lib-agent-stream
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:01:57+08:00
---
# lib-agent-stream

## 定位
Agent Run 日志的高级 SSE 客户端（`frontend/src/lib/agent-stream.ts`，约 271 行）。以 `AgentRunStreamClient` 类封装单次运行的全双工订阅，提供自动重连、断线补帧、日志去重，并复用同一连接分流 `permission_request` / `permission_resolved` 权限审批事件。是 `lib-use-agent-run-stream` hook 的底层依赖。

## 契约摘要
- `new AgentRunStreamClient(workspaceId, runId)` — 构造客户端（不立即连接）。
- `connect(token)` — 建连：URL 为直连后端 `/api/workspaces/{ws}/agent/runs/{runId}/stream`，带 `after`(lastLogId) 与 `token` query。
- `disconnect()` — 关闭 EventSource、清重连定时器、状态置 disconnected。
- 回调订阅（均返回取消函数）：`onMessage(log)`、`onStatusChange(status)`、`onDone(StreamDoneData)`、`onPermissionRequest(req)`、`onPermissionResolved(resolved)`。
- `getStatus()` — 当前 `StreamStatus`：disconnected / connecting / connected / error。
- 类型：`StreamStatus`、`StreamDoneData`（status / exit_code）。

## 关键逻辑
```
connect(token):
  url = getApiBaseUrl() + /api/workspaces/{ws}/agent/runs/{runId}/stream?after={lastLogId}&token={token}
  es = new EventSource(url)
  es.onopen → 若 connecting 则置 connected  # 保证 loading 及时清除
  es.onmessage:
    data = JSON.parse(e.data)
    permEvt = parseSessionPermissionEvent(data)
    if permEvt: 走 permission 回调（有 tool_name→request，否则→resolved）; return
    _emitMessage(data)  # 仅当有 timestamp 才发，按 log_id 去重
  es.addEventListener("done"): 触发 onDone + disconnect
  es.onerror → _reconnect()
_reconnect(): 指数退避 [1,2,4,8,16]s，retryCount++；超 5 次置 error
_doReconnect(): 先 getAgentRunLogs(lastLogId) 补帧 → 再 connect(newToken)
```

## 注意事项
- permission_* 事件无 timestamp 字段，不能走 `_emitMessage`（会被当非 log 事件丢弃），故先专用解析再专用回调，否则审批卡片永不显示。
- `onopen` 标记 connected 是关键：后端 SSE 在 agent 挂起等 askuser 时只发 `: keepalive` 注释行（浏览器忽略不触发 onmessage），若靠 onmessage 则 status 永远停在 connecting、loading 卡死。
- 重连补帧用 `lastLogId` 游标拉取缺失日志，与 `seenLogIds` Set 双重去重防止 SSE 重复推送。
- EventSource 必须走直连后端（`getApiBaseUrl` 在浏览器返回 origin，但 SSE 端点本身直连后端 / 由 Next route handler 代理），token 入 query 因 EventSource 不支持自定义 header。
- 本客户端是 `streamAgentRunLogs`（lib-agent 轻封装）的增强替代，新页面应优先用 `lib-use-agent-run-stream` hook。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
