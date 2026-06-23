---
schema_version: 1
doc_type: module-card
module_id: lib-agent
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:01:57+08:00
---
# lib-agent

## 定位
Agent Run 领域 API 客户端（`frontend/src/lib/agent.ts`，约 235 行）。封装 Agent 运行的创建、查询、日志拉取（含游标）、流式订阅封装、杀死、用户输入提交，以及 daemon runtime 列表与 mission（任务会话）相关接口。是 `lib-agent-stream` / `lib-use-agent-run-stream` 与 daemon 面板的底层依赖。

## 契约摘要
- 运行管理：`createAgentRun(workspaceId, input)`（input 含 `provider` 覆盖默认 agent）、`getAgentRun`、`listAgentRuns(workspaceId, taskId?)`、`killAgentRun`。
- 日志：`getAgentRunLogs(workspaceId, runId, after?)` 支持游标增量拉取；`StreamLogEvent` 为 SSE 单条事件结构。
- 输入：`submitAgentRunInput(workspaceId, runId, { content })` 提交用户对 pending_input 的回复。
- Daemon：`listDaemonRuntimes()` 列运行时（供 provider 选择）。
- 会话：`listWorkspaceAgentSessions`、`createMission` / `getMission` / `cancelMission`（mission 任务会话）。
- 关键类型：`AgentRun`（含 `agent_session_id` 与 `session_id` 两个易混 id、`total_cost_usd`、token 计数、`is_resume`）、`AgentRunStatus`（pending/running/completed/failed/killed）、`AgentRunLogEntry`、`DaemonRuntime`、`Mission`。

## 关键逻辑
```
getAgentRunLogs(ws, runId, after?):
  GET /api/workspaces/{ws}/agent/runs/{runId}/logs?after={after} → AgentRunLogEntry[]
createAgentRun(ws, input):
  POST /api/workspaces/{ws}/agent/runs { task_id, provider, ... } → AgentRun
submitAgentRunInput(ws, runId, { content }):
  POST .../runs/{runId}/input { content } → AgentRunInputResponse
listDaemonRuntimes(): GET /api/daemon/runtimes → DaemonRuntime[]
```

## 注意事项
- `AgentRun.agent_session_id`（AgentSession 表 id）与 `session_id`（daemon 内部会话 id）是两个不同概念：`fetchPendingDialogs` 等查 agent_sessions 表的接口必须用 `agent_session_id`，用错会查不到数据。
- `getAgentRunLogs` 的 `after` 游标用日志 id，配合 SSE 的 `lastLogId` 实现断线补帧。
- `createAgentRun` 的 `provider` 参数覆盖工作区 `default_agent`，不传走默认；`AgentProviderSelect` 组件用 `listDaemonRuntimes` 填充下拉。
- `streamAgentRunLogs` 仅是 SSE 订阅的轻封装，真正的流式客户端逻辑在 `lib-agent-stream`（重连/去重/权限事件分流）。
- mission 系列接口（createMission 等）服务于"任务会话"场景，与单次 AgentRun 不同。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
