---
schema_version: 1
doc_type: module-card
module_id: lib-agent-stream
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 智能体日志 SSE 客户端（lib-agent-stream）

## 定位
Agent Run 日志的高级 SSE 客户端（`frontend/src/lib/agent-stream.ts`，317 行）。`AgentRunStreamClient` 类封装单次运行的全双工订阅：连接前持久化日志补拉、自动重连、断线补帧、按 `log_id` 去重，并在同一连接上分流 permission 与 gate 三类非日志事件到专用回调。底层经 `lib-fetch-sse.fetchSse`（原生 fetch 解析 SSE）。是 `lib-use-agent-run-stream` hook 的底层依赖。

## 契约摘要
- `new AgentRunStreamClient(workspaceId, runId)` — 构造（不立即连接）。
- `connect(token)` — 建连；URL 为 `/api/workspaces/{ws}/agent/runs/{runId}/stream`，带 `after={lastLogId}` query。
  - token 由 fetchSse 放 **Authorization Bearer header**（不再拼 URL query，防访问日志明文泄漏，task-12）。
- `disconnect()` — 关连接、清重连定时器、retryCount 归零、置 disconnected。
- `getStatus(): StreamStatus` — disconnected / connecting / connected / error。
- 回调订阅（均返回取消函数）：
  - `onMessage(log: StreamLogEvent)` — 普通日志行。
  - `onStatusChange(status)` / `onDone(StreamDoneData{status?, exit_code?})`。
  - `onPermissionRequest(req)` / `onPermissionResolved(resolved)` — 会话权限事件（daemon 侧 askuser 人审卡片）。
  - `onGateStatusChanged(evt: GateStatusEvent)` — gate 决策后台任务完成通知（task-12 / design §5.7）。
- 类型：`StreamStatus`、`StreamDoneData`、`GateStatusEvent`（`event:"gate_status_changed"` + `gate_status` + `errors_summary` 截断 500 字符或 null）。

## 关键逻辑
```
connect(token):
  status=connecting; 先 getAgentRunLogs() 补拉持久化日志(Bootstrap/晚连防丢行)
  es = fetchSse(url, {token})
  onopen → connected        # SSE 仅发 :keepalive 注释行时保证 loading 清除
  onmessage: parse 后先分流:
    permission 事件(parseSessionPermissionEvent, 有 tool_name→request 否则 resolved)
    gate_status_changed → gateStatusCallbacks
    其余 → _emitMessage(仅认有 timestamp 的日志行, log_id 去重 + lastLogId 游标)
  done → onDone + disconnect;  onerror → _reconnect()
_reconnect: 退避 [1,2,4,8,16]s, 超 5 次置 error
_doReconnect: 重读 store token(无则再退避) → after=lastLogId 补帧 → connect
```

## 注意事项
- permission_* 与 gate_status_changed 事件无 timestamp 字段，不能进 `_emitMessage`（会被当非日志行丢弃），必须专用解析→专用回调，否则审批卡片 / gate 徽标永不更新。
- `onopen` 标记 connected 是关键：agent 挂起等 askuser 时后端只发 `: keepalive` 注释行（不触发 onmessage），靠 onmessage 判连接则 status 停在 connecting、loading 卡死。
- 竞态防护两处：
  - 并发重入 `connecting` 直接 return（但重连路径 status 是 connected，不挡，否则重连失效）；
  - `getAgentRunLogs` await 期间被外部 `disconnect()` 则不再建连——防 StrictMode 双调用 / 快速重连产生无人持有的孤儿连接。
- 重连补帧用 `lastLogId` 游标拉缺失日志，与 `seenLogIds` Set 双重去重防 SSE 重复推送；非日志类事件（status_changed / messages 聚合等）在 `_emitMessage` 内按 timestamp 缺失过滤。
- 历史演进：旧版用 EventSource + token 入 query，task-12 迁移 `fetchSse` 后 token 入 header；勿按旧卡写法新建连接。
- 新页面订阅优先用 `lib-use-agent-run-stream` hook，本类是底层原语。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
