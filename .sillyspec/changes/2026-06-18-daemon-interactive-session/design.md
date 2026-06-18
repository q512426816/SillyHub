---
author: qinyi
created_at: 2026-06-18T13:40:53
---

# 交互式会话管控 Design — daemon-interactive-session

## 1. 背景

当前 daemon 是**批处理执行器**模型：服务端派发 lease → daemon `spawn` agent → readline 读到 `result`/exit → 结束 → `complete`。agent 进程跑完即销毁。

现状的"多轮"（quick-chat，变更 `2026-06-11-quick-chat-multiturn`）实为**伪多轮**：每轮用户输入都新建 AgentRun + 新进程，仅靠 agent 自身的 `--resume <session_id>` 续上下文（见 `backend/app/main.py:141-183`、`sillyhub-daemon/src/adapters/stream-json.ts:228` `--resume`）。这意味着：

- **正在跑的 agent 收不到中途追问**：`task-runner.ts:721-751` 写一次 prompt 后 stdin 不再写入，`result` 后 `stdin.end`。
- **无法实时权限往返**：`stream-json.ts:writeControlResponse` 只做自动批准，无暂停等远程机制。
- **打断即结束**：无"中断本轮保留会话"概念。

参考项目 `C:\Users\qinyi\IdeaProjects\happy`（Claude Code/Codex/Gemini 远程客户端）的**持久会话管理器**模型，目标是让 daemon 支持 happy 式交互式管控：中途追问、权限暂停往返、打断本轮与结束分离。

### 关键探索结论（已验证）

1. **R1 风险已排除**：`claude -p --input-format stream-json` 支持持续 stdin 多轮注入（官方语义 "realtime streaming input" + `--replay-user-messages` + happy 用 SDK `AsyncIterable` 生产验证 + 实验中 claude 成功接受 stdin 多消息流，仅被上游网关 529 临时阻断）。
2. **架构洞察**：**agent 子进程本身即长驻会话载体**（claude 的 stream-json stdin 流 / codex 的 thread 复用）。daemon **无需自建 happy 那套 worker 进程 + 输入队列**（那是 SDK in-process 才需要）。只需让 task-runner 的 `result` 不再触发 `stdin.end` + 提供 server→daemon 的 WS 控制注入通道。
3. **现成脚手架**：`protocol.ts:30-36` 与 `backend/app/modules/daemon/protocol.py:19-22` 已定义 `lease_messages`/`lease_claim`/`lease_start`/`lease_complete` 双向 WS 消息类型但从未接线；`ws_hub.py` 已具备 server→daemon 主动 send 能力。

## 2. 设计目标

- **G1 中途追问/多轮注入**：agent 跑完一轮后，服务端能向正在跑的会话注入新 prompt（claude 第二条 user message JSON / codex turn/start），用户看到第二轮响应。
- **G2 打断本轮与结束会话分离**：打断本轮 = SIGINT/turn interrupt（保留会话可继续）；结束会话 = kill 进程。
- **G3 权限暂停往返**：会话级 `manual_approval` 开关，开启后 `control_request` 暂停 → 推前端 → 远程决定 → 回写 stdin。
- **G4 resume 持久化 + 崩溃恢复**：daemon 持久化会话状态，重启后通过 `--resume`/`thread/resume` 重 attach。
- **G5 前端管控台**：演进现有 quick-chat 为交互式会话面板。
- **G6 最大复用**：复用 lease 调度 / spawn / 适配器 / 凭证 / submitMessages(REST) / SSE 全链路，最小改动。

## 3. 非目标

- ❌ **不**做 happy 式 E2E 加密中转（本项目是平台，需明文做业务）。
- ❌ **不**自建 worker 进程 + 输入队列层（探索已否定，agent 子进程即载体）。
- ❌ **不**支持多 agent 客户端铺通（gemini/cursor/copilot 等其余 10 provider 的真实跑通）—— 本变更聚焦 claude + codex 两条已实测线。
- ❌ **不**改批处理 lease 模型（workspace agent run 保持原生命周期不变）。
- ❌ **不**做多 daemon 跨主机负载均衡/亲和性。
- ❌ Wave 1/2 **不**做崩溃恢复（崩溃=会话结束标 failed），resume 持久化放 Wave 3。

## 4. 拆分判断

满足拆分条件（3+ 可独立交付模块 + 模块间可独立开发），但用户选择**全部一次性规划**（一个大 design，内部 Wave 分组），不生成 MASTER.md。execute 阶段按 Wave 分波次推进，Wave 间通过接口解耦：
- Wave 1（核心交互）是地基，Wave 2/3/4 均依赖其 session 抽象与 WS 控制通道。
- 每个 Wave 独立可交付、独立验收。

不走批量模式（无重复模式，非"模板×数据"）。

## 5. 总体方案

### 核心架构（方案 A：WS 双向 + 复用 task-runner）

```
┌──────────────┐  SSE 回显(复用)          ┌──────────────────────────────┐
│  前端会话面板 │◄═════════════════════════│      Backend (FastAPI)       │
│  (Wave4)     │  HTTP inject/interrupt   │  agent_sessions 表(新增)      │
│              │═════════════════════════►│  lease.kind=interactive(新增) │
└──────────────┘                          │  WS 控制路由(新增)            │
                                          └──────────────┬───────────────┘
                                              WS 双向(新增控制消息)
                                          ┌──────────────▼───────────────┐
                                          │      Daemon (TS)             │
                                          │  ws-client 接收控制消息       │
                                          │    → sessionStore            │
                                          │    → task-runner(session模式)│
                                          │       result 不 end stdin    │
                                          └──────────────┬───────────────┘
                                              spawn (长驻, 多turn复用)
                                          ┌──────────────▼───────────────┐
                                          │  agent 子进程                 │
                                          │  claude: stdin 流式多轮       │
                                          │  codex:  thread 复用+turn/start│
                                          └──────────────────────────────┘
```

**1 AgentSession = 1 长生命周期 DaemonTaskLease**（`kind=interactive`），多 turn 复用同一 spawn 进程；每 turn 一个 AgentRun（复用现有 AgentRunLog/SSE/resume_token 链路）。

### Wave 1 — 核心交互层（中途追问/多轮注入）

**数据模型**：新增 `agent_sessions` 表；`daemon_task_leases` 增加 `kind` 字段；`agent_runs` 增加 `agent_session_id` FK。

**task-runner session 模式**：引入 `SessionRunner`（task-runner 扩展，不新建独立模块）。`kind=interactive` 的 lease 走 session 路径：
- spawn 后保持 stdin 开放；
- `result` 事件只标记"当前 turn 完成"（更新 AgentRun，发 SSE turn-done），**不** end stdin、**不**退出 readline 循环；
- 等待下一个 `session_inject` 写 stdin。

**daemon sessionStore**：内存 `Map<sessionId, {leaseId, childProcess, stdin, adapter, status, currentRunId}>`，生命周期 = 会话；复用现有 spawn / 适配器 / 凭证 / submitMessages 上报。

**WS 控制通道（server→daemon）**：protocol 新增 `daemon:session_inject` / `daemon:session_interrupt` / `daemon:session_end`。ws-client 接收后路由到 sessionStore 对应 session。

**进度回显**：复用现有 `submitMessages`(REST) + SSE（`stream_run_logs`），每 turn 输出照常上报到对应 AgentRun 的 AgentRunLog。

### Wave 2 — 权限暂停往返

升级 `stream-json.ts:handleControlRequest`：`AgentSession.config.manual_approval=true` 时，不直接 `writeControlResponse(allow)`，而是：
- 暂停（stdin 不回写），发 `daemon:permission_request`（daemon→server，带 tool_name/input/request_id）；
- 前端展示，用户批准/拒绝；
- server 发 `daemon:permission_response`（server→daemon，approved/denied）→ daemon 据此 `writeControlResponse`（allow/deny）。
- 默认 `manual_approval=false` → 维持现状（自动批准）。

codex 侧 `json-rpc.ts` 的 approval 同理升级。

### Wave 3 — resume 持久化 + 崩溃恢复

- daemon 侧持久化 sessionStore 到磁盘（`~/.sillyhub/daemon/sessions.json`，类比 happy `persistSession`）：`{sessionId, leaseId, agentSessionId, provider, config}`。
- daemon 启动时加载，对 `status=active` 的 session 通过 `--resume <agentSessionId>`（claude）/ `thread/resume`（codex）重 spawn 恢复。
- `agent_sessions.status` 增加 `reconnecting` 态。

### Wave 4 — 前端管控台

演进 `frontend/src/app/(dashboard)/runtimes/page.tsx` 的 quick-chat：
- 实时 SSE 进度（复用 `streamQuickChat`）；
- 中途追问输入框（POST inject）；
- 打断本轮（POST interrupt）/ 结束会话（POST end）按钮；
- 权限批准弹窗（Wave2 permission_request 订阅）；
- 会话历史回看（拉 agent_sessions + 关联 AgentRunLog）。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | `sillyhub-daemon/src/protocol.ts` | 新增 `SESSION_INJECT`/`SESSION_INTERRUPT`/`SESSION_END`/`PERMISSION_REQUEST`/`PERMISSION_RESPONSE` 消息常量 + payload 类型 |
| 修改 | `sillyhub-daemon/src/ws-client.ts` | `_handleMessage` 分派新控制消息到 onControlMessage 回调 |
| 修改 | `sillyhub-daemon/src/daemon.ts` | `_executeTask` 按 lease.kind 分流：batch 走原 TaskRunner，interactive 走 SessionRunner；接收 ws 控制消息路由到 sessionStore |
| 修改 | `sillyhub-daemon/src/task-runner.ts` | 抽出 session 模式：`result` 不 end stdin、不退出 readline；新增 `injectPrompt`/`interrupt`/`end` 方法操作持有 child.stdin |
| 新增 | `sillyhub-daemon/src/session-store.ts` | 内存 Map<sessionId, SessionState> + Wave3 磁盘持久化 |
| 修改 | `sillyhub-daemon/src/adapters/stream-json.ts` | Wave2: handleControlRequest 支持 manual_approval 暂停往返 |
| 修改 | `sillyhub-daemon/src/adapters/json-rpc.ts` | Wave2: codex approval 暂停往返 |
| 新增 | `backend/app/modules/agent/model.py` | 新增 `AgentSession` 表；`AgentRun` 加 `agent_session_id` FK |
| 修改 | `backend/app/modules/daemon/model.py` | `DaemonTaskLease` 加 `kind` 字段（batch/interactive，默认 batch） |
| 修改 | `backend/app/modules/daemon/protocol.py` | 新增 session/permission 控制消息常量 + payload 模型 |
| 修改 | `backend/app/modules/daemon/ws_hub.py` | 新增 `send_session_control(runtime_id, msg)` server→daemon 推送 |
| 修改 | `backend/app/modules/daemon/router.py` | 新增 REST：`POST /sessions`（创建）/ `{id}/inject` / `{id}/interrupt` / `{id}/end`；WS 接收 daemon 上行 permission_request |
| 修改 | `backend/app/modules/daemon/service.py` | `create_session`/`inject`/`interrupt`/`end` 业务逻辑；interactive lease 调度 |
| 修改 | `backend/app/modules/agent/placement.py` | interactive lease dispatch（复用 dispatch_to_daemon，传 kind=interactive + agent_session_id） |
| 修改 | `backend/app/main.py` | quick-chat 端点升级：首次 prompt 创建 AgentSession + interactive lease；后续 prompt 走 inject |
| 修改 | `frontend/src/lib/daemon.ts` | 新增 `createSession`/`inject`/`interrupt`/`endSession` API + `streamSession` SSE |
| 修改 | `frontend/src/app/(dashboard)/runtimes/page.tsx` | quick-chat 升级会话面板（输入框/打断/结束/权限弹窗） |
| 新增 | alembic 迁移 | agent_sessions 表 + lease.kind + agent_runs.agent_session_id |

## 7. 接口定义

### 7.1 WS 控制消息（server → daemon，复用 DaemonMessage 信封）

```typescript
// protocol.ts
export const MSG = {
  // ...现有
  SESSION_INJECT: 'daemon:session_inject',       // 注入新 prompt
  SESSION_INTERRUPT: 'daemon:session_interrupt', // 打断本轮(SIGINT/turn interrupt)
  SESSION_END: 'daemon:session_end',             // 结束会话(kill)
  PERMISSION_RESPONSE: 'daemon:permission_response', // 批准往返: server→daemon
} as const;

// daemon → server
PERMISSION_REQUEST: 'daemon:permission_request', // 批准往返: daemon→server

// Payload
SessionInjectPayload { session_id, lease_id, run_id, prompt }
SessionControlPayload { session_id, lease_id }   // interrupt/end
PermissionRequestPayload { session_id, request_id, tool_name, input }
PermissionResponsePayload { session_id, request_id, decision: 'allow'|'deny' }
```

### 7.2 REST（前端 → backend）

```
POST /api/daemon/sessions
  body: { provider, prompt, manual_approval?, model? }
  → { session_id, run_id, stream_url }

POST /api/daemon/sessions/{id}/inject
  body: { prompt }
  → { run_id }   // 新 turn 的 AgentRun

POST /api/daemon/sessions/{id}/interrupt   // 打断本轮
POST /api/daemon/sessions/{id}/end         // 结束会话
GET  /api/daemon/sessions/{id}/stream      // SSE(session 级聚合,见下)
```

**session 级 SSE 聚合（Grill 修正 P1）**：现有 `stream_run_logs`（service.py:541）是 **run 级**订阅（Redis `agent_run:{run_id}`）。交互式会话跨 turn 切换 run_id，前端单订阅不能无缝续接。方案：backend 新增 **session 级 Redis channel** `agent_session:{session_id}`：
- daemon `submitMessages` 时，service.submit_messages 在 publish 到 `agent_run:{run_id}`（保留现有 run 级）**同时** publish 一条带 `run_id` 标记的事件到 `agent_session:{session_id}`；
- 新增 `stream_session_logs(session_id)`：订阅 `agent_session:{session_id}`，前端单连接接收所有 turn 的事件流（事件含 run_id 供前端区分 turn 边界）。
- 这样前端 `GET /sessions/{id}/stream` 一个 SSE 连接贯穿整个会话，无需在 turn 切换时重订阅。

### 7.3 SessionStore API（daemon 内部）

```typescript
class SessionStore {
  create(sessionId, leaseId, child, stdin, adapter): void;
  get(sessionId): SessionState | undefined;
  inject(sessionId, prompt): void;      // 写 stdin(claude user msg / codex turn/start)
  interrupt(sessionId): void;           // child.kill('SIGINT') 或 codex turn/interrupt
  end(sessionId): void;                 // child.kill(), 标 ended
  persist(): Promise<void>;             // Wave3 落盘
  restore(): Promise<void>;             // Wave3 重启恢复
}
```

## 8. 数据模型

### 8.1 新增 `agent_sessions` 表

| 字段 | 类型 | 说明 |
|---|---|---|
| id | Uuid PK | |
| user_id | Uuid FK users | |
| runtime_id | Uuid FK daemon_runtimes | 执行该会话的 daemon |
| lease_id | Uuid FK daemon_task_leases | 1:1 长生命周期 lease（D-002） |
| provider | String(30) | claude / codex |
| status | String(20) | pending/active/reconnecting/ended/failed |
| agent_session_id | String(255) nullable | agent 内部会话 id（claude session_id / codex thread_id），供 resume |
| config | JSON nullable | { manual_approval, model, ... } |
| turn_count | Integer default 0 | |
| created_at / last_active_at / ended_at | DateTime(tz) | |

### 8.2 `daemon_task_leases` 增加 `kind`

```python
kind: str = Field(default="batch", sa_column=Column(String(20), server_default="batch"))
# batch: 现有批处理(跑完即结束) | interactive: 交互式会话(长生命周期,多turn)
```

### 8.3 `agent_runs` 增加 `agent_session_id`

```python
agent_session_id: uuid.UUID | None = Field(
    default=None,
    sa_column=Column(Uuid(as_uuid=True), ForeignKey("agent_sessions.id", ondelete="SET NULL"), nullable=True),
)
# 注意:AgentRun 现有 session_id 字段保留语义为"agent 内部 claude resume id"(quick-chat-multiturn 在用),不改动。
# 新增 agent_session_id 指向本会话聚合。术语区分见 D-001。
```

> 因本项目未正式上线、数据可清空（CLAUDE.md 规则 7），迁移采用新增表 + 新增字段，无需保留旧数据兼容。

### 8.4 session / lease / run 三元关系（Grill 修正 P0）

`DaemonTaskLease.agent_run_id` 现有约束是 FK→agent_runs（1:1，`model.py:125`）。交互式会话"每 turn 一个 AgentRun"与之冲突，**关系必须重新厘清**：

```
daemon_task_leases (kind=interactive)          agent_sessions
   id ────────────────────────────────────────► lease_id    (1:1, session.lease_id)
   agent_run_id = NULL  ◄── interactive 不用     id
                                                   ┌─ agent_session_id (FK) ◄────┐
                                                   │                             │
                                               agent_runs (N)                  │
                                                   agent_session_id ────────────┘  (N:1)
                                                   session_id (保留,claude resume 用)
```

- **interactive lease.agent_run_id = NULL**（不直接关联单个 run）；batch lease 保持原 1:1 用法不变。
- **session ↔ lease 1:1**：`agent_sessions.lease_id` FK→daemon_task_leases。
- **session ↔ runs 1:N**：`agent_runs.agent_session_id` FK→agent_sessions，每 turn 一个 run。
- **进程层**：1 session = 1 长驻 spawn 进程（跨 turn 复用，D-002），与 run 的 N 关系解耦（run 是逻辑记录，进程是物理载体）。

### 8.5 interactive lease 的过期语义（Grill 修正 P1）

- `interactive` lease 创建时 `lease_expires_at = NULL`（不设过期），**不进** `handle_lease_expiry` 回收（service.py 该函数按 `status IN ('claimed','pending')` + expires_at 扫描，interactive lease status 走 active/completed 路径，天然跳过）。
- 会话结束（手动 end 或 D-004 空闲 30min）由 SessionStore 触发 → 通知 backend → 更新 `agent_sessions.status=ended` + `daemon_task_leases.status=completed`（同步）。
- 两条结束路径合一在 `service.end_session(session_id)`，避免 lease expiry 与 sessionStore 双重回收冲突（修正 R-04）。

## 9. 兼容策略（brownfield）

- **未配置交互式会话时行为完全不变**：`lease.kind` 默认 `batch`，所有现有 lease 走原 TaskRunner 路径；quick-chat 首次 prompt 仍可走旧 resume 路径（开关切换）。
- **批处理 lease 不受影响**：workspace agent run（change-detail 页）保持原生命周期，`kind=batch`，task-runner 行为零改动。
- **WS 控制消息是新增类型**：daemon 不识别时静默丢弃（ws-client 现有 `_handleMessage` 未知 type 不崩溃）。
- **权限默认自动批准**：`manual_approval` 默认 false，`stream-json.ts` 现有 `writeControlResponse(allow)` 行为不变。
- **回退路径**：交互式会话出问题可降级——前端 inject 失败时回退到旧 quick-chat（每轮新 run + resume）。
- **不改变的 API/表**：现有 `/api/daemon-chat`、`AgentRun.session_id`（claude resume）、所有批处理 lease 端点。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | claude `result` 后 stdin 持续开放时，agent 是否在第一轮就 exit（R1 剩余铁证缺口） | P0 | Wave1 首个任务即端到端验证（网关恢复后跑通两轮 result）；若 exit，回退到每轮新 spawn+resume（伪多轮）保底 |
| R-02 | WS 双向控制消息乱序/重连丢消息（inject 到已结束 session） | P1 | sessionStore 校验 status，inject 到非 active session 返回错误；WS 重连后 daemon 重放 sessionStore 状态对账 |
| R-03 | session 状态在 daemon 内存，daemon 重启丢失（Wave1/2） | P1 | Wave1/2 崩溃=会话结束标 failed 提示重开；Wave3 持久化解决 |
| R-04 | lease 语义从"单次任务"变"会话执行权"，可能破坏现有 lease 状态机/expire 逻辑 | P1 | 用 `kind` 字段隔离：interactive lease 走新路径，不进现有 expire 回收（`handle_lease_expiry` 跳过 kind=interactive） |
| R-05 | 术语碰撞：AgentRun.session_id（claude resume）vs 新 AgentSession | P2 | D-001 已规范：新表名 agent_sessions，FK 字段名 agent_session_id，不改现有 session_id |
| R-06 | codex thread 复用 + 多次 turn/start 在 daemon 侧的握手状态管理（json-rpc adapter 有状态） | P1 | SessionRunner 持有单 adapter 实例跨 turn（不复用工厂 new），thread_id 缓存在 sessionStore |
| R-07 | 并发：单 daemon 同时活跃 session 过多导致资源耗尽 | P2 | 复用现有 lease 并发上限；sessionStore 活跃 session 数受限并发池 |
| R-08 | session 级 SSE 聚合：跨 turn 切换 run_id 时前端事件流失序/断流 | P1 | 新增 session 级 Redis channel `agent_session:{session_id}`（§7.2），submit_messages 双 publish；事件带 run_id 供前端区分 turn 边界；Wave1 验证多 turn SSE 连续性 |

## 11. 决策追踪

详见 `decisions.md`。当前版本决策：

| 决策 ID | 标题 | 覆盖章节 |
|---|---|---|
| D-001@v1 | 交互式会话实体命名 `AgentSession` | §8.1, §8.3, R-05 |
| D-002@v1 | 1 AgentSession = 1 长生命周期 lease，多 turn 复用 spawn | §5, §8.1, R-04 |
| D-003@v1 | Wave1/2 不做崩溃恢复，Wave3 做 resume | §3 非目标, §5 Wave3, R-03 |
| D-004@v1 | session 空闲 30min 自动结束 | §5 Wave1 sessionStore, §8.5, 验收 |
| D-005@v1 | session/lease/run 三元关系 + session 级 SSE 聚合（Grill 修正） | §8.4, §7.2, §8.5, R-08 |

剩余风险：R-01（claude 第一轮后是否 exit）需 Wave1 首任务端到端验证补铁证。

## 12. 自审

> **Design Grill 修正记录**：初次自审后 Step12 交叉审查发现 3 个结构性问题并已修正：
> - **P0 一致性**：lease.agent_run_id 1:1 与"每 turn 一个 AgentRun"矛盾 → §8.4 厘清三元关系（interactive lease.agent_run_id=NULL，session↔lease 1:1，session↔runs 1:N）。
> - **P1 可行性**：session 级 SSE 跨 turn 聚合未定义 → §7.2 新增 session 级 Redis channel `agent_session:{session_id}` + `stream_session_logs`。
> - **P1 定义**：interactive lease 过期语义 → §8.5 明确 lease_expires_at=NULL + 结集中在 service.end_session。
> 三项均无业务判断成分，直接修正；新增 D-005@v1 记录。

- ✅ **需求覆盖**：G1-G6 全部对应 Wave/章节；Q1-Q4 需求点（演进quick-chat/session作lease上层/默认自动批准+手动开关/打断与结束分离）均有落点。
- ✅ **Grill 覆盖**：D-001~D-005 全部在 §11 引用并被设计章节覆盖。
- ✅ **约束一致性**：复用现有 lease/spawn/适配器/SSE 链路，符合 ARCHITECTURE.md 模块化分层；scan 文档把 daemon 标 Python 已过时，本 design 以实际 TS 代码为准。
- ✅ **真实性**：表名（daemon_task_leases/agent_runs）、字段（runtime_id/agent_run_id/session_id/resume_token）、类名（TaskRunner/SessionStore/WsClient/StreamJsonAdapter）、WS 端点（/ws + hub.connect）均来自真实代码；新增项标注"新增"。
- ✅ **YAGNI**：非目标明确排除 E2E 加密/worker 层/多 agent 铺通/跨主机均衡。
- ✅ **验收标准具体可测**：见下。
- ✅ **非目标清晰**：§3 列 6 项不做。
- ✅ **兼容策略**：§9 说明未配置时不变 + 回退路径 + 不改变的 API。
- ✅ **风险识别**：§10 列 8 项含 P0/P1/P2 + 对策。

### 验收标准

1. **[Wave1-核心]** quick-chat 发起会话，agent 跑完第一轮（出 result）后，中途追问能写入 stdin，看到第二轮响应（claude + codex 各一）。
2. **[Wave1-打断]** 打断本轮：agent 停止当前 turn，会话状态仍 active，可继续追问。
3. **[Wave1-结束]** 结束会话：进程 kill，agent_sessions.status=ended。
4. **[Wave1-回显]** 多 turn 的输出均经 SSE 实时回显，历史可在 AgentRunLog 回看。
5. **[Wave2-权限]** manual_approval=true 时，工具调用暂停，前端批准/拒绝后 agent 继续/中止。
6. **[Wave2-默认]** manual_approval=false（默认）时行为与现状一致（自动批准）。
7. **[Wave3-resume]** daemon 重启后 active 会话自动 reconnecting → 恢复，历史上下文不丢。
8. **[兼容]** 现有批处理 lease（workspace agent run）行为零变化。
