---
schema_version: 1
doc_type: module-card
module_id: lib-agent
author: qinyi
created_at: 2026-06-10T16:55:00
---

# lib-agent

## 定位
Agent Run API 客户端。封装 Agent 运行管理的所有操作，包括创建、查询、日志获取、流式订阅、杀死运行、提交用户输入。

## 契约摘要
- `createAgentRun(workspaceId, input)` — 创建运行
- `getAgentRun`、`listAgentRuns` — 查询运行
- `getAgentRunLogs(workspaceId, runId, after?)` — 获取日志（支持 after 游标）
- `streamAgentRunLogs(workspaceId, runId, onMessage, onDone, onError?)` — SSE 流式订阅
- `killAgentRun(workspaceId, runId)` — 杀死运行
- `submitAgentRunInput(workspaceId, runId, input)` — 提交用户输入
- `listDaemonRuntimes()` — 列出 Daemon 运行时（复用此模块）
- 类型：AgentRun、AgentRunLogEntry、StreamLogEvent、CreateAgentRunInput

## 关键逻辑
- SSE 连接使用 Next.js Route Handler 代理（token 通过 query 参数传递）
- streamAgentRunLogs 返回 EventSource 实例，调用方负责关闭
- AgentRunStatus: pending / running / completed / failed / killed

## 注意事项
- listDaemonRuntimes 实际调用的是 `/api/daemon/runtimes`，与 lib/daemon.ts 中有重复定义

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
