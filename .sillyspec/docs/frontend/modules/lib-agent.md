---
schema_version: 1
doc_type: module-card
module_id: lib-agent
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 智能体运行客户端（lib-agent）

## 定位
Agent Run 领域 API 客户端（`lib/agent.ts`，324 行）。封装 Agent 运行的创建/查询/杀死/用户输入提交、日志游标拉取、daemon runtime 列表，以及 mission（多 worker 任务会话）系列接口与 workspace 维度 agent 会话列表。是 `lib-agent-stream` / `lib-use-agent-run-stream` / components-daemon / components-changes 的底层依赖。

边界：SSE 客户端逻辑（重连/去重/分流）在 lib-agent-stream；交互式会话域（createSession/injectSession/listAgentSessions 门户版/PROVIDER_META）在 lib-daemon，均不在本文件。

## 契约摘要
- 运行管理：
  - `createAgentRun(workspaceId, input: CreateAgentRunInput)`——input 含 `provider`（覆盖工作区 default_agent）、`task_id`（关联任务）。
  - `getAgentRun(workspaceId, runId)` / `listAgentRuns(workspaceId, taskId?)`。
  - `killAgentRun(workspaceId, runId)`。
- 日志：
  - `getAgentRunLogs(workspaceId, runId, after?)`——`after` 游标增量拉取 → `AgentRunLogEntry[]`。
  - `AgentRunLogChannel` 区分日志通道；`StreamLogEvent` 为 SSE 单条事件结构（lib-agent-stream 消费）。
- 输入：`submitAgentRunInput(workspaceId, runId, req: AgentRunInputRequest)` → `AgentRunInputResponse`（对 pending_input 的回复）。
- 展示辅助：`formatRunProviderLabel(...)`（provider 显示名格式化，导出）。
- Daemon：`listDaemonRuntimes()` → `DaemonRuntime[]`（供 provider 选择下拉）。
- 会话：`WorkspaceAgentSession` 类型 + `listWorkspaceAgentSessions(workspaceId, ...)`（workspace 维度 agent 会话列表）。
- Mission（多 worker 任务会话）：
  - 类型：`Mission` / `MissionArtifact` / `MissionWorkerRun`（worker 关联 run）/ `WorkerPresetItem` / `MainAgentConfig` / `CreateMissionInput`。
  - 函数：`createMission(workspaceId, input)` / `getMission(missionId)` / `cancelMission(workspaceId, missionId)` / `listMissions(...)`。
- 关键类型：
  - `AgentRun`——含 `agent_session_id` 与 `session_id` 两个易混 id、`total_cost_usd`、token 计数、`is_resume`。
  - `AgentRunStatus`（pending/running/completed/failed/killed）。
  - `DaemonRuntime`。

## 关键逻辑
```
createAgentRun(ws, input):
  POST /api/workspaces/{ws}/agent/runs { task_id?, provider?, ... } → AgentRun
getAgentRunLogs(ws, runId, after?):
  GET  /api/workspaces/{ws}/agent/runs/{runId}/logs?after={after}   → AgentRunLogEntry[]
submitAgentRunInput(ws, runId, { content }):
  POST /api/workspaces/{ws}/agent/runs/{runId}/input                → AgentRunInputResponse
listDaemonRuntimes():
  GET  /api/daemon/runtimes                                         → DaemonRuntime[]
```

## 注意事项
- `AgentRun.agent_session_id`（AgentSession 表 id）与 `session_id`（daemon 内部会话 id）是不同概念：查 agent_sessions 表的接口必须用 `agent_session_id`，用错查不到数据。
- `after` 游标用日志 id，配合 SSE 的 lastLogId 实现断线补帧；改游标语义须与 lib-agent-stream 对齐。
- `createAgentRun` 的 `provider` 覆盖工作区默认 agent，不传走默认；`AgentProviderSelect`（components-shared）用 `listDaemonRuntimes` 填充下拉。
- mission 系列与单次 AgentRun 是两条生命周期：MissionWorkerRun 关联各 worker 的 run，console 展示归 MissionConsole。
- 交互式会话域在 `lib/daemon.ts`（lib-daemon 模块），components-sessions 引的是那边，勿在本文件找 createSession/injectSession。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
