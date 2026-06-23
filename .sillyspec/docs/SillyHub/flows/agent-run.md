---
author: qinyi
created_at: 2026-06-24T01:47:08
source_commit: ba87eec
---

# Agent 批量任务执行流程

## 目标
在用户本地 daemon 上安全执行 Claude Agent SDK 批量任务（AgentRun），实时流式回传日志、工具调用与审批事件。

## 参与模块
- **backend/agent**：AgentRun/Mission CRUD、上下文编排（`agent.service` / `coordinator` / `execution` / `context_builder`）
- **backend/worktree**：工作树租约（`acquire/release/extend`），隔离执行目录
- **backend/tool_gateway**：工具执行策略与审批（`execute` + `ToolPolicyService`）
- **backend/daemon**：lease 端点 + SSE 流转发（`/daemon/leases/*`、`/daemon/sessions/*/stream`）
- **daemon (sillyhub-daemon)**：`HubClient` 注册/心跳、`TaskRunner` spawn claude、`WsClient` 上行
- **frontend**：`agent-run-panel` + `useAgentRunStream` + EventSource 订阅 `/agent/runs/{id}/stream`

## 流程摘要

```text
(frontend)  POST /workspaces/{ws}/agent/runs  {task_id, spec}
     │
(backend)   AgentService.create → ExecutionCoordinatorService
     │        ├─ context_builder.build_*_bundle（拼 spec/CLAUDE.md）
     │        └─ 创建 daemon_task_lease 行（pending）
     ▼
(backend)   响应 AgentRun{id} → 前端立即 EventSource 连 /runs/{id}/stream
     │
(daemon)    poll/WS 收到 task_available → HubClient.claimLease → startLease
     │
(daemon)    TaskRunner.runTask：写 .claude/CLAUDE.md → spawn(claudePath)
     │        ├─ stream-json adapter 解析 stdout
     │        └─ 每条事件经 WsClient → backend /leases/{id}/messages
     ▼
(backend)   WSHub 把 message 写 AgentLog + 发布 SSE channel
     │
     ├─ tool_call 事件 → tool_gateway.execute（policy check + 可能挂审批）
     │      └─ 前端 permission-approval-dialog → POST /runs/{id}/approve
     ▼
(daemon)    claude 退出 → TaskRunner.filesChanged/durationMs
     │        → HubClient.completeLease + POST /leases/{id}/runs/{run_id}/result
     ▼
(backend)   AgentRun.status=done/failed → 发布 done 事件 → 前端 onDone fetch usage
```

## 失败回滚

| 失败点 | 处理 |
|--------|------|
| daemon 未在线 | lease 停留 pending，前端显示「无在线 daemon」 |
| spawn claude 失败 | TaskRunner 返回 failed，backend 标 AgentRun failed 保留已收日志 |
| lease 心跳超时 | worktree GC / lease_service 标 expired，释放工作树 |
| SSE 断连 | 前端 useAgentRunStream 指数退避重连（带 after log_id 游标去重） |
| 工具被 policy 拒 | tool_gateway 返回 denied，写 ToolOperationLog |
| 任务需人工 kill | POST /runs/{id}/kill → daemon 转发信号 SIGTERM 子进程 |

## 关键术语
- **AgentRun**：单次执行记录，含 workspace_id/runtime_id/task_id
- **daemon_task_lease**：backend 派给 daemon 的执行凭据，claim_token 防并发
- **TaskRunnerResult**：daemon 上报结构（filesChanged/durationMs/sessionId）
