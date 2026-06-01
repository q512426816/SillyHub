---
author: qinyi
created_at: 2026-05-28 13:25:00
---

# Requirements

## 角色

| 角色 | 说明 |
|---|---|
| 项目维护者 | 观看 Agent 运行日志，判断执行状态 |
| Agent 执行者 | 触发 Agent run，查看实时输出和历史记录 |

## 功能需求

### FR-01: Agent stdout 逐行流式发布

Given Agent 运行中（status=running）
When ClaudeCodeAdapter 收到子进程 stdout 的一行输出
Then 平台通过 Redis Pub/Sub 发布到 channel `agent_run:{run_id}`，payload 包含 `channel`（stdout/stderr）、`content`（格式化后的行）、`timestamp`

### FR-02: SSE 实时日志端点

Given 客户端连接 `GET /api/workspaces/{id}/agent/runs/{run_id}/stream`
When Redis Pub/Sub channel `agent_run:{run_id}` 收到消息
Then SSE 端点将消息作为 `data` event 推送给客户端

Given Agent 运行结束（status 变为 completed/failed）
When SSE 端点检测到运行结束
Then 发送 `event: done` 并关闭连接

Given 客户端连接 SSE 端点时 Agent 状态不为 running
When 端点收到请求
Then 返回 200 并立即发送 `event: done` 关闭连接

### FR-03: 前端实时日志消费

Given Agent 状态为 running
When 用户打开 Agent Console 或 Task Detail 页面
Then 前端通过 EventSource 连接 SSE 端点，实时显示日志行

Given SSE 连接断开
When 浏览器自动重连
Then 重连后继续接收新日志（不回放断连期间的历史）

Given Agent 状态变为 completed/failed
When 前端收到 `event: done` 或检测到状态变更
Then 关闭 EventSource，切换为 DB 日志查询模式展示完整历史

### FR-04: DB 日志持久化不受影响

Given Agent 运行结束
When 平台处理完 stdout/stderr
Then 仍按现有逻辑写入 `AgentRunLog` 表，现有 `/logs` 端点行为不变

## 非功能需求

- 实时性：stdout 产生后 1 秒内到达前端
- 兼容性：现有 DB 日志接口、前端已完成状态的日志展示不受影响
- 可靠性：SSE 断连不影响 Agent 运行和 DB 日志写入
- 可测试：SSE 端点、Redis 发布逻辑需要单元测试
- 安全性：SSE 端点需要与现有 `/logs` 端点相同的认证和权限校验
