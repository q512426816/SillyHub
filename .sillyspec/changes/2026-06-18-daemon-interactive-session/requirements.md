---
author: qinyi
created_at: 2026-06-18 13:54:52
---

# Requirements — 交互式会话管控

## 角色

| 角色 | 说明 |
|---|---|
| 终端用户（开发者） | 通过前端会话面板发起会话、中途追问、打断/结束、批准权限 |
| Daemon（TS） | 每 turn spawn agent 进程、接收 WS 控制消息创建下一 turn/打断/结束、sessionStore 元数据管理、Wave3 磁盘持久化 |
| Backend（FastAPI） | 创建 AgentSession + interactive lease、WS 控制路由、session 级 SSE 聚合、权限请求路由、状态同步 |
| Agent 子进程 | Claude/Codex 的单 turn 执行载体；跨 turn 上下文通过 `--resume`/thread resume 续接 |

## 功能需求（FR）

### FR-01 创建交互式会话 [Wave1]
- **Given** 用户在前端会话面板选择 provider（claude/codex）并发起首条 prompt
- **When** 前端 POST `/api/daemon/sessions`（provider + prompt + 可选 manual_approval/model）
- **Then** backend 创建 `agent_sessions` 记录（status=pending）+ `kind=interactive` 的 DaemonTaskLease（lease_expires_at=NULL）→ 创建首个 AgentRun 并 dispatch 到 daemon → daemon 为该 turn spawn agent 进程，产出经 SSE 回显，session status=active
- **覆盖**：D-002@v2（1 session=1 lease、每 turn 独立 spawn）、D-005（三元关系）

### FR-02 多轮追问（新 turn + resume）[Wave1]
- **Given** 一个 status=active 的交互式会话，agent 已完成当前 turn（result 已出）
- **When** 用户发送追问 → POST `/sessions/{id}/inject`
- **Then** backend 为该 session 创建新的 AgentRun 并 dispatch；daemon 为新 turn 独立 spawn，Claude 使用 `--resume <agent_session_id>`，Codex 恢复 thread 后启动 turn；产出经 session 级 SSE 回显，turn_count+1
- **覆盖**：D-002@v2（每 turn 独立 spawn + resume）

### FR-03 多 turn 进度回显（session 级 SSE） [Wave1]
- **Given** 一个活跃交互式会话
- **When** 前端 GET `/sessions/{id}/stream` 建立单 SSE 连接
- **Then** backend 订阅 session 级 Redis channel `agent_session:{session_id}`，跨多个 turn 持续推送事件（事件含 run_id 区分 turn 边界），连接贯穿整个会话直到 ended
- **覆盖**：D-005（session 级聚合）、R-08

### FR-04 打断本轮 [Wave1]
- **Given** 会话 status=active 且 agent 正在执行某 turn
- **When** 用户点"打断本轮" → POST `/sessions/{id}/interrupt`
- **Then** backend/daemon 终止当前 AgentRun 对应进程并标记该 run cancelled/failed，**会话 status 仍 active**，用户可继续追问并创建下一 turn
- **覆盖**：Q4（打断与结束分离）

### FR-05 结束会话 [Wave1]
- **Given** 一个活跃交互式会话
- **When** 用户点"结束会话" → POST `/sessions/{id}/end` → WS `daemon:session_end`
- **Then** 如有当前 turn 则先终止其进程，随后清理 sessionStore 元数据，backend 更新 `agent_sessions.status=ended` + `daemon_task_leases.status=completed`（经 service.end_session 统一入口）
- **覆盖**：D-005（结集中 service.end_session）、Q4

### FR-06 空闲自动回收 [Wave1]
- **Given** 一个 active 会话超过 30min（`session_idle_timeout_sec` 可配）无 inject/无活动
- **When** daemon sessionStore 定时扫描检测到空闲超时
- **Then** 自动结束会话（同 FR-05 路径），status=ended
- **覆盖**：D-004

### FR-07 权限暂停往返 [Wave2]
- **Given** 会话 `config.manual_approval=true`，agent 发起 control_request（claude）/ approval（codex）
- **When** daemon 收到工具批准请求
- **Then** daemon **不**自动批准，发 `daemon:permission_request`（tool_name/input/request_id）→ backend 推前端 → 用户批准/拒绝 → backend 发 `daemon:permission_response`（allow/deny）→ daemon 据此回写 stdin
- **And** `manual_approval=false`（默认）时维持现状自动批准（行为零变化）
- **覆盖**：Q3

### FR-08 resume 持久化恢复 [Wave3]
- **Given** daemon 持有 active 会话且已持久化 sessionStore 到磁盘
- **When** daemon 重启
- **Then** daemon 加载磁盘 sessionStore；崩溃时的 currentRun 标记失败，session 从 reconnecting 回到 active/可继续；下一次追问按 `--resume <agent_session_id>`（Claude）/ thread resume（Codex）新 spawn，历史上下文不丢
- **覆盖**：D-003

### FR-09 兼容性（批处理 lease 不变） [Wave1]
- **Given** 现有批处理 lease（workspace agent run）`kind=batch`
- **When** 走现有 task-runner 原路径执行
- **Then** 行为、生命周期、AgentRun/lease 关系零变化；interactive 新路径完全隔离
- **覆盖**：D-002（kind 隔离）、§9 兼容策略

### FR-10 前端会话面板 [Wave4]
- **Given** runtimes 页 quick-chat
- **When** 升级为交互式会话面板
- **Then** 提供：实时 SSE 进度 + 中途追问输入框 + 打断本轮/结束会话按钮 + 权限批准弹窗（Wave2）+ 会话历史回看（拉 agent_sessions + AgentRunLog）
- **覆盖**：Q1（演进 quick-chat）

## 非功能需求

- **NFR-01 实时性**：inject/interrupt 端到端延迟 < 2s（WS 直达，非轮询）。
- **NFR-02 兼容性**：未使用交互式会话时，所有现有端点/表/批处理 lease 行为零变化（§9）。
- **NFR-03 健壮性**：Wave1/2 进程崩溃=会话结束标 failed（不丢其他会话）；Wave3 支持 resume 恢复。
- **NFR-04 资源**：单 daemon 活跃 session 数受现有 lease 并发池约束；空闲 30min 回收。
- **NFR-05 协议契约**：新增 WS 消息类型逐字对齐 daemon `protocol.ts` 与 backend `protocol.py`（已有先例），未知 type 静默丢弃不崩溃。

## D-xxx 覆盖关系

| 决策 | 覆盖 FR | 说明 |
|---|---|---|
| D-001 命名 AgentSession | FR-01, FR-09 | 新表 agent_sessions，FK 字段 agent_session_id，不碰现有 session_id |
| D-002@v2 1 session=1 lease、每 turn 独立 spawn + resume | FR-01, FR-02, FR-04, FR-09 | kind 隔离 + 多 AgentRun 聚合 |
| D-003 Wave1/2 不恢复 | FR-08 | resume 放 Wave3 |
| D-004 空闲 30min | FR-06 | 默认值可配 |
| D-005 三元关系+SSE | FR-01, FR-03, FR-05 | lease.agent_run_id=NULL，session 级 channel |
