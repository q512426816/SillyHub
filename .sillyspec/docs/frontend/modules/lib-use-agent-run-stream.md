---
schema_version: 1
doc_type: module-card
module_id: lib-use-agent-run-stream
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:01:57+08:00
---
# lib-use-agent-run-stream

## 定位
Agent Run SSE 客户端的 React 封装 hook（`frontend/src/lib/use-agent-run-stream.ts`，约 343 行）。统一收口运行日志、连接状态、权限审批卡片、用户输入控件的订阅与状态管理，替代各页面内联的 `connectBootstrapStream` 逻辑。是 daemon 面板与 agent 页面消费实时运行数据的标准入口。

## 契约摘要
- `useAgentRunStream(workspaceId, runId, isActive, onDone?): UseAgentRunStreamResult` — 主 hook。
- `UseAgentRunStreamOptions`：`workspaceId` / `runId`（null 则不连）/ `isActive`（false 仅预取历史不连 SSE）/ `onDone(status)`。
- `UseAgentRunStreamResult`：`logs`、`status`(AgentRunStatus|null)、`streaming`、`loading`、`error`、`perms`(权限请求列表)、`dismissPerm(requestId)`、`input`(AgentRunInputStream)、`clear()`。
- `AgentRunInputStream`：`values` / `submitting` / `errors` / `replied`（按 logId 索引）+ `set(logId, value)` / `submit(logId)`，用 useMemo 稳定引用。

## 关键逻辑
```
useEffect([workspaceId, runId, isActive]):
  if !runId: return no-op          # Guard 1
  if !accessToken: setError; return  # Guard 2
  cancelled = false; client = new AgentRunStreamClient(ws, runId)
  注册 onStatusChange/onMessage(按 log_id 去重追加)/onPermissionRequest(按 request_id 去重)
       /onPermissionResolved(dismissPerm)/onDone(白名单校验 status + setStreaming(false) + disconnect)
  FR-07: getAgentRun → agent_session_id → fetchPendingDialogs → 合并 perms（恢复未答 dialog）
  if !isActive: getAgentRunLogs 预取历史 → setLogs; return   # D-001 不连 SSE
  client.connect(token)
  cleanup: cancelled=true; client.disconnect()
```

## 注意事项
- `isActive=false` 时（D-001）只预取历史日志不建 EventSource，但 FR-07 的 dialog 恢复仍执行（askuser pending 的 run 可能因轮询延迟误判为 inactive，仍需展示审批卡片让用户作答）。
- dialog 恢复必须用 `agent_session_id`（AgentSession 表 id），非 `session_id`（daemon 内部 id），否则 `fetchPendingDialogs` 查不到。
- done 事件的 status 是裸 string，按 `AGENT_RUN_STATUSES` 白名单校验后再入库，防后端脏值污染（P3.2）；`setStreaming(false)` 显式置位不依赖 disconnect 间接链路（P2.2）。
- `cancelled` flag 防 StrictMode 双调用与卸载后异步写 state；`input` 用 useMemo 稳定引用避免子组件 memo 失效（P2.3）。
- 权限决策 API 由审批卡片自调（D-003），`dismissPerm` 仅本地移除 perms 列表。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
