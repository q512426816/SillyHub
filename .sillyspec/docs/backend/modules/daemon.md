---
schema_version: 1
doc_type: module-card
module_id: daemon
author: qinyi
created_at: 2026-06-19T19:40:00+08:00
---

# daemon

## 定位

管理本地 Daemon 运行时、任务租约、交互式 AgentSession，以及 daemon 与平台之间的 WebSocket/RPC 协议。

## 契约摘要

- `DaemonService`：运行时注册、心跳、租约调度、交互式会话控制与历史读取。
- `GET /api/daemon/runtimes`：读取当前用户可见的运行时。
- `GET /api/daemon/sessions`：按用户隔离并分页读取交互式会话。
- `DELETE /api/daemon/sessions/{id}`：仅删除当前用户的终态会话；活动会话返回 409，越权与不存在统一返回 404。

## 关键逻辑

- 会话状态 `pending/active/reconnecting` 视为活动态，必须先结束再删除。
- 删除会话前显式清空关联 `AgentRun.agent_session_id`，保留 AgentRun 与 AgentRunLog 作为运行历史。
- 所有会话查询和写入都以 `AgentSession.user_id` 在数据库层隔离。

## 变更记录

- 2026-06-19-runtimes-layout：增加终态会话安全删除能力及所有权、状态冲突和运行历史保留测试。
