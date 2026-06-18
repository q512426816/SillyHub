---
author: qinyi
created_at: 2026-06-18T13:54:52
---

# Requirements — 交互式会话管控（D-002@v3 · SDK driver 层）

## 角色

| 角色 | 说明 |
|---|---|
| 终端用户（开发者） | 前端会话面板发起会话、中途追问、打断/结束、远程批准权限 |
| Daemon（TS） | `src/interactive/`：ClaudeSdkDriver 用 SDK `query(AsyncIterable)` 同进程跑多 turn；SessionManager 管 session 生命周期 + 内存 SessionStore；Wave3 元数据持久化 |
| Backend（FastAPI） | 创建 AgentSession + interactive lease、WS 控制路由、session 级 SSE 聚合、权限请求路由、状态同步 |
| 系统 claude.exe | SDK 内部 spawn 的执行载体（`pathToClaudeCodeExecutable` 指向 agent-detector 检测的系统 claude 2.1.181，D-009） |

## 功能需求（FR）

### FR-01 创建交互式会话 [Wave1]
- **Given** 用户在前端会话面板选择 provider（claude）并发起首条 prompt
- **When** 前端 POST `/api/daemon/sessions`（provider + prompt + 可选 manual_approval/model）
- **Then** backend 创建 `agent_sessions`（status=pending）+ `kind=interactive` DaemonTaskLease（lease_expires_at=NULL）+ 首个 AgentRun 并 dispatch → daemon SessionManager.create → ClaudeSdkDriver 启动 SDK `query`，产出经 session 级 SSE 回显，session status=active
- **覆盖**：D-002@v3（driver 与 TaskRunner 并存）、D-005（三元关系）、D-009（系统 claude）

### FR-02 多轮追问（SDK 同进程，新 turn）[Wave1]
- **Given** 一个 status=active 的会话，SDK 已产出当前 turn 的 result
- **When** 用户发送追问 → POST `/sessions/{id}/inject`
- **Then** backend 创建新 AgentRun（agent_session_id）→ WS `session_inject` → daemon SessionManager.inject → inputQueue.push → SDK `query(AsyncIterable)` 消费下一条跑下一 turn（**同进程同 session，第二轮含首轮上下文**）；产出经 session 级 SSE 回显，turn_count+1
- **覆盖**：D-002@v3（SDK 同进程多轮，spike H2）

### FR-03 多 turn 进度回显（session 级 SSE）[Wave1]
- **Given** 一个活跃交互式会话
- **When** 前端 GET `/sessions/{id}/stream` 建立单 SSE 连接
- **Then** backend 订阅 session 级 Redis channel `agent_session:{session_id}`，跨多个 turn 持续推送（事件含 run_id 区分 turn 边界），连接贯穿整个会话直到 ended
- **覆盖**：D-005（session 级聚合）、R-08

### FR-04 打断本轮 [Wave1]
- **Given** 会话 status=active 且 SDK 正在执行某 turn
- **When** 用户点"打断本轮" → POST `/sessions/{id}/interrupt`
- **Then** daemon `ClaudeSdkDriver.interrupt(query)` → SDK 当前 turn 产 `result(subtype=error_during_execution)` → 该 AgentRun=failed，**会话 status 仍 active**，用户可继续追问创建下一 turn
- **覆盖**：spike D1（interrupt turn 级）

### FR-05 结束会话 [Wave1]
- **Given** 一个活跃交互式会话
- **When** 用户点"结束会话" → POST `/sessions/{id}/end` → WS `daemon:session_end`
- **Then** 如有当前 turn 则先 interrupt/终止，随后清理 SessionStore，backend 经 `service.end_session` 统一入口更新 `agent_sessions.status=ended` + `daemon_task_leases.status=completed`
- **覆盖**：D-005（结集中在 service.end_session）

### FR-06 空闲自动回收 [Wave1]
- **Given** 一个 active 会话超过 30min（`session_idle_timeout_sec` 可配）无 inject/无活动
- **When** daemon SessionStore 定时扫描检测到空闲超时
- **Then** 自动结束会话（同 FR-05 路径），status=ended
- **覆盖**：D-004

### FR-07 权限远程人审（canUseTool）[Wave2]
- **Given** ClaudeSdkDriver 的 `canUseTool` 回调被 SDK 触发（claude 要调工具）
- **When** daemon 收到 canUseTool 调用
- **Then** daemon **不**本地自动批准，发 `daemon:permission_request`（session_id/run_id/tool_use_id/tool/input）→ backend → 前端弹审批卡 → 用户 allow/deny → `daemon:permission_response` → daemon resolve 回调（allow/deny）；**5min 未响应→deny**
- **覆盖**：D-007（远程人审，spike D2 回调可 await）

### FR-08 resume 持久化恢复 [Wave3]
- **Given** daemon 持有 active 会话，SDK 已自动持久化 session 到 `~/.claude/projects/<cwd>/<sid>.jsonl`，daemon SessionStore 元数据已落盘
- **When** daemon 重启
- **Then** daemon 加载 SessionStore 元数据；崩溃时的 currentRun 标 failed，session 从 reconnecting 回到 active；下一次 inject 用 `query({resume:agent_session_id})` 恢复（固定 cwd），历史上下文不丢
- **覆盖**：D-003、spike D3（SDK 自动持久化 + 跨进程 resume）

### FR-08b GLM 工具失败错误透传 [Wave2]
- **Given** GLM 中转后端工具调用失败（如 spike D2 Write permission error）
- **When** SDK 工具返回 is_error
- **Then** ClaudeSdkDriver 把 `tool_result(is_error=true)` 原样经 SDK 返给模型自处理，**不阻断 session、不预禁工具**
- **覆盖**：D-008（错误透传，spike D2 caveat）

### FR-09 兼容性（批处理 lease 不变）[Wave1]
- **Given** 现有批处理 lease（workspace agent run）`kind=batch`
- **When** 走现有 TaskRunner 原路径执行
- **Then** 行为、生命周期、AgentRun/lease 关系零变化；interactive 新路径完全隔离（src/interactive/ 独立模块）
- **覆盖**：D-002@v3（kind 隔离 + 并存）、§9 兼容策略

### FR-10 前端会话面板 [Wave4]
- **Given** runtimes 页 quick-chat
- **When** 升级为交互式会话面板
- **Then** 提供：实时 session SSE 进度 + 中途追问输入框 + 打断本轮/结束会话按钮 + 权限批准弹窗（Wave2）+ 会话历史回看（agent_sessions + AgentRunLog）
- **覆盖**：D-006（全栈）

## 非功能需求

- **NFR-01 实时性**：inject/interrupt 端到端延迟 < 2s（WS 直达）。
- **NFR-02 兼容性**：未用交互式会话时，所有现有端点/表/批处理 lease 行为零变化（§9）。
- **NFR-03 健壮性**：Wave1/2 daemon 崩溃=会话结束标 failed；Wave3 resume 恢复。
- **NFR-04 资源**：单 daemon 活跃 session 受现有 lease 并发池约束；空闲 30min 回收；不带 SDK 平台二进制（D-009，体积不增）。
- **NFR-05 协议契约**：新增 WS 消息逐字对齐 daemon `protocol.ts` ↔ backend `protocol.py`，未知 type 静默丢弃不崩溃。

## 决策覆盖矩阵

| 决策 | 覆盖 FR | 说明 |
|---|---|---|
| D-001@v1 命名 AgentSession | FR-01, FR-09 | 新表 agent_sessions，FK agent_session_id，不碰现有 session_id |
| D-002@v3 driver 层与 TaskRunner 并存（SDK 同进程多轮） | FR-01, FR-02, FR-04, FR-09 | kind 分流，src/interactive/ 独立，TaskRunner 零改动 |
| D-003@v1 Wave1/2 不恢复 | FR-08 | resume 放 Wave3 |
| D-004@v1 空闲 30min | FR-06 | 可配 |
| D-005@v1 三元关系 + SSE | FR-01, FR-03, FR-05 | lease.agent_run_id=NULL，session 级 channel |
| D-006@v1 全栈范围 | FR-10, §4 | 一次设计 daemon+backend+frontend |
| D-007@v1 canUseTool 远程人审 | FR-07 | WS→前端 allow/deny，5min 超时 |
| D-008@v1 GLM 错误透传 | FR-08b | 不预禁工具 |
| D-009@v1 系统 claude.CMD | FR-01, FR-02 | pathToClaudeCodeExecutable，不带平台二进制 |
