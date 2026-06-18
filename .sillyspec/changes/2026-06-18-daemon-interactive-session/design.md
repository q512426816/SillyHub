---
author: qinyi
created_at: 2026-06-18T13:40:53
---

# 交互式会话管控 Design — daemon-interactive-session（D-002@v3 · SDK driver 层）

> 本 design 经 spike-02（§3.7）验证后由 D-002@v2（per-turn spawn+resume）升级为 D-002@v3（SDK 同进程 driver 层，与 TaskRunner 并存）。v2 总体方案（task-runner turn 模式）已废弃，数据模型/兼容框架复用。

## 1. 背景

当前 daemon 是**批处理执行器**模型：lease → `spawn` agent → 读 `result`/exit → `complete`，进程跑完即销毁。现有"多轮"（quick-chat，变更 `2026-06-11-quick-chat-multiturn`）实为**伪多轮**：每轮新建 AgentRun + 新进程，仅靠 `--resume <session_id>` 续上下文。后果：正在跑的 agent 收不到中途追问（`task-runner.ts:721-751` 写一次 prompt 后 stdin 不再写）；无实时权限往返（`stream-json.ts:writeControlResponse` 仅自动批准）；打断即结束。

### 关键探索结论（spike-01 → spike-02 收敛）

1. **spike-01**：未证明 CLI `-p` 同进程两轮（R1 证伪）→ D-002@v2 回退（per-turn spawn+resume）。
2. **spike-02（2026-06-18，§3.7）：D-002@v3 SDK 路线两硬门通过**——`@anthropic-ai/claude-agent-sdk@0.3.181` 在 Windows + 智谱/GLM 中转（`ANTHROPIC_BASE_URL=open.bigmodel.cn`）下：
   - **H1** `query()` 跑通，env 继承 `ANTHROPIC_AUTH_TOKEN`+`BASE_URL`，默认用内置 claude.exe（224MB）；**H2** `query({prompt:AsyncIterable})` 同进程两轮，第二轮含首轮上下文、同 session_id。
   - **D1** `interrupt()` turn 级（result=error_during_execution，query 不结束可续轮）；**D2** `canUseTool` 回调可 await 远程延迟不超时（caveat：GLM 后端 Write 失败）；**D3** 跨进程 `resume` 恢复上下文（SDK 自动持久化 `~/.claude/projects/`）；**D4** result 是干净边界、无孤儿后台事件；**S1** 不支持运行中注入（turn 级）。
3. **D-002@v3 立项**：新增 `InteractiveSessionManager` + `ClaudeSdkDriver`，与现有 `TaskRunner`（batch）**并存非替换**（方案 A）。

## 2. 设计目标

- **G1 多轮追问**：SDK 同进程 `query(AsyncIterable)` 多轮，turn 级串行（spike H2/S1）。
- **G2 打断本轮与结束分离**：`interrupt()`=终止当前 turn（run failed，session active）；`end`=终止+完成 lease（spike D1）。
- **G3 权限远程人审**：`canUseTool` 回调→WS→前端 allow/deny（D-007，spike D2）。
- **G4 resume + 崩溃恢复**：SDK 自动持久化 session_id，跨进程 resume（spike D3）；Wave1/2 崩溃=failed，Wave3 reconnecting。
- **G5 前端会话面板**。
- **G6 driver 与 TaskRunner 并存**：batch 路径零改动（D-002@v3）。

## 3. 非目标

- ❌ 不照搬 happy 控制面（E2E 加密 / Fastify / Socket.IO / TUI / machine API / 离线 session）。
- ❌ **不替换 TaskRunner**（batch 路径不动）。
- ❌ 不预禁工具 / per-provider 工具黑白名单（D-008 错误透传）。
- ❌ 不带 SDK 平台二进制包（D-009 用系统 claude.CMD）。
- ❌ 不承诺运行中注入（spike S1，turn 级）。
- ❌ 不做多 agent 铺通（聚焦 claude；codex 后续 `CodexAppServerDriver` 单独）。
- ❌ 不改批处理 lease 模型（workspace agent run 不变）。
- ❌ Wave 1/2 不做崩溃恢复（Wave 3）。

## 4. 拆分判断

全栈一次设计（D-006），不生成 MASTER.md，内部 Wave 分组（Wave1 核心交互地基 → Wave2 权限 → Wave3 resume → Wave4 前端）。不走批量模式（无重复模式）。

## 5. 总体方案

### 核心架构（方案 A：driver 层与 TaskRunner 并存，lease.kind 分流）

```
                 ┌─────────────────────────────────────────────┐
   backend       │ daemon_task_leases.kind 分流                 │
   (claim lease)▶│   kind=batch       → TaskRunner (不动)        │
                 │   kind=interactive → InteractiveSessionManager│
                 └──────────────┬──────────────────────────────┘
                                │ create session + 首 turn
                                ▼
        ┌──────────────────────────────────────────────────┐
        │ sillyhub-daemon/src/interactive/  (新增, 并存)     │
        │  session-manager.ts   session 生命周期 + 内存 Store │
        │  claude-sdk-driver.ts SDK query/streamInput/...    │
        │  input-queue.ts       per-session AsyncIterable     │
        └──────────────┬───────────────────────────────────┘
                       │ pathToClaudeCodeExecutable = 系统 claude (D-009)
                       ▼
           @anthropic-ai/claude-agent-sdk  query(AsyncIterable)
                       │ env 继承 ANTHROPIC_AUTH_TOKEN + BASE_URL (spike H1)
                       ▼
             系统 claude.exe 2.1.181 → bigmodel/GLM
```

**1 AgentSession = 1 长生命周期 interactive lease**（`kind=interactive`）；daemon `src/interactive/` 用 SDK `query(AsyncIterable)` 同进程跑多 turn；**每收到 SDK `result` 创建/关闭一个 AgentRun**（result=边界，spike D4）；`interrupt()` turn 级（spike D1）；resume 跨进程（spike D3）。现有 lease/WS/AgentRun/AgentRunLog/Redis/SSE/权限审计全部保留。

### Wave 1 — 核心交互层（SDK driver + session + lease 分流 + SSE）

- **数据模型**：新增 `agent_sessions` 表；`daemon_task_leases.kind`；`agent_runs.agent_session_id` FK（详见 §8）。
- **daemon `src/interactive/`**：
  - `claude-sdk-driver.ts`：封装 SDK `query()`。`pathToClaudeCodeExecutable`=agent-detector 检测的系统 claude（D-009）；`prompt: AsyncIterable<SDKUserMessage>`（input-queue 提供）；遍历 `Query`（AsyncGenerator），**每 `result` 创建/关闭一个 AgentRun**（spike D4）；`interrupt()` turn 级（spike D1）；`canUseTool` Wave2 接远程人审。
  - `session-manager.ts`：session 生命周期（create/inject/interrupt/end），内存 `SessionStore`（Map<session_id, SessionState>）；SessionState 持有 SDK Query 句柄 + input-queue + 当前 AgentRun + `agent_session_id`（SDK session_id）；空闲 30min 自动 end（D-004）。
  - `input-queue.ts`：per-session `AsyncIterable<SDKUserMessage>`，turn 级串行（spike H2/S1）。
- **lease 分流**：`daemon.ts:_executeTask` 按 `lease.kind` 路由（batch→TaskRunner 零改动；interactive→SessionManager）。
- **WS 控制通道**：`session_inject`/`session_interrupt`/`session_end`（server→daemon）。
- **session 级 SSE**：submitMessages 双 publish（run 级 + session 级）+ `stream_session_logs`（D-005）。

### Wave 2 — canUseTool 远程人审 + GLM 错误透传

- ClaudeSdkDriver `canUseTool` 回调（D-007）：WS 推 `tool_approval_request`（session_id/run_id/tool_use_id/tool/input）→ backend → 前端弹审批卡 → allow/deny 回传 → daemon resolve 回调。超时 5min 未响应→deny。复用现有 tool_gateway 审批框架。
- GLM 工具失败（D-008）：错误透传——`tool_result(is_error=true)` 经 SDK 返给模型自处理，不预禁工具。

### Wave 3 — resume 持久化 + 崩溃恢复

- SDK 自动持久化 session 到 `~/.claude/projects/<encoded-cwd>/<sid>.jsonl`（spike D3）。
- daemon SessionStore 持久化元数据（session_id/lease_id/agent_session_id/cwd）到 `~/.sillyhub/daemon/sessions.json`；启动加载 active 元数据；崩溃 currentRun 标 failed，session → reconnecting；下次 inject 用 `query({resume:agent_session_id})` 恢复（**固定/还原 cwd**，spike D3）。
- `agent_sessions.status` 增 `reconnecting`。

### Wave 4 — 前端会话面板

演进 `frontend/src/app/(dashboard)/runtimes/page.tsx` quick-chat：会话列表（active）+ 会话窗口（订阅 session 级 SSE）+ 输入框（inject）+ interrupt/end 按钮 + 审批弹窗（Wave2）+ 会话历史回看。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | `sillyhub-daemon/src/interactive/claude-sdk-driver.ts` | 封装 SDK `query`/`pathToClaudeCodeExecutable`/`canUseTool`/`interrupt`/result→AgentRun 映射 |
| 新增 | `sillyhub-daemon/src/interactive/session-manager.ts` | session 生命周期 + 内存 SessionStore + 30min 空闲扫描 |
| 新增 | `sillyhub-daemon/src/interactive/input-queue.ts` | per-session `AsyncIterable<SDKUserMessage>` |
| 修改 | `sillyhub-daemon/src/daemon.ts` | `_executeTask` 按 `lease.kind` 分流（batch→TaskRunner 不动，interactive→SessionManager）+ ws 控制消息路由 |
| 修改 | `sillyhub-daemon/src/protocol.ts` | `SESSION_INJECT`/`SESSION_INTERRUPT`/`SESSION_END`/`PERMISSION_REQUEST`/`PERMISSION_RESPONSE` 常量 + payload |
| 修改 | `sillyhub-daemon/src/ws-client.ts` | `_handleMessage` 分派新控制消息 |
| 修改 | `sillyhub-daemon/package.json` + `.npmrc` | `dependencies` 加 `@anthropic-ai/claude-agent-sdk` 主包；`.npmrc` 配 `optional=false`（或 pnpm `--omit=optional`）排除 win32-x64 平台二进制 224MB（D-009，Grill X-003 补） |
| 新增 | `backend/app/modules/agent/model.py` | `AgentSession` 表；`AgentRun` 加 `agent_session_id` FK |
| 修改 | `backend/app/modules/daemon/model.py` | `DaemonTaskLease` 加 `kind`（batch/interactive，默认 batch） |
| 修改 | `backend/app/modules/daemon/protocol.py` | session/permission 控制消息常量 + payload 模型 |
| 修改 | `backend/app/modules/daemon/ws_hub.py` | `send_session_control(runtime_id, msg)` server→daemon 推送 |
| 修改 | `backend/app/modules/daemon/router.py` | REST：`POST /sessions` / `{id}/inject` / `{id}/interrupt` / `{id}/end`；WS 接收 daemon 上行 permission_request |
| 修改 | `backend/app/modules/daemon/service.py` | `create_session`/`inject`/`interrupt`/`end_session` + interactive lease 调度 |
| 修改 | `backend/app/modules/agent/service.py` | `submit_messages` 双 publish（run 级 + session 级）+ `stream_session_logs` |
| 修改 | `backend/app/modules/agent/placement.py` | interactive lease dispatch（传 kind=interactive + agent_session_id） |
| 修改 | `backend/app/main.py` | quick-chat 端点升级（首 prompt 创建 AgentSession + interactive lease） |
| 修改 | `frontend/src/lib/daemon.ts` | `createSession`/`inject`/`interrupt`/`endSession`/`streamSession` |
| 修改 | `frontend/src/app/(dashboard)/runtimes/page.tsx` | quick-chat 升级会话面板 |
| 新增 | alembic 迁移 | `agent_sessions` 表 + `lease.kind` + `agent_runs.agent_session_id` |

> **v2→v3 关键差异**：v2 改 `task-runner.ts` 做 turn 模式；**v3 不改 task-runner**（batch 零改动），interactive 执行完全由新增 `src/interactive/` 独立承担（方案 A 并存）。

## 7. 接口定义

### 7.1 ClaudeSdkDriver（daemon 内部，TS）

```typescript
import { query, type Query, type SDKMessage, type SDKResultMessage, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';

interface ClaudeSdkDriverOptions {
  pathToClaudeCodeExecutable: string;   // D-009: agent-detector 检测的系统 claude（必需，不带内置 exe）
  cwd: string;                           // 固定（resume 按 cwd 分目录，spike D3）
  canUseTool?: (toolName, input, opts) => Promise<{behavior:'allow'} | {behavior:'deny', message?: string}>;  // D-007
  model?: string;                        // 走 ANTHROPIC_DEFAULT_*_MODEL 映射（spike H1）
  allowedTools?: string[];
  env?: Record<string, string>;          // 默认 {...process.env}（含 ANTHROPIC_AUTH_TOKEN+BASE_URL，spike H1）
}

class ClaudeSdkDriver {
  start(input: AsyncIterable<SDKUserMessage>, opts: ClaudeSdkDriverOptions & { resume?: string }): Query;
  interrupt(q: Query): Promise<void>;                 // turn 级（spike D1）
  // 遍历 Query：每 result → 回调（创建/关闭 AgentRun，spike D4）
  consume(q: Query, onResult: (r: SDKResultMessage) => void, onMessage?: (m: SDKMessage) => void): Promise<void>;
}
```

### 7.2 SessionManager + SessionStore（daemon 内部）

```typescript
interface SessionState {
  sessionId: string;            // agent_sessions.id
  leaseId: string;
  agentSessionId?: string;      // SDK session_id（spike D3 resume 用）
  query?: Query;                // SDK 句柄（长生命周期，跨 turn）
  inputQueue: InputQueue;       // AsyncIterable<SDKUserMessage>
  currentRunId?: string;        // 当前 turn 的 AgentRun
  status: 'active' | 'reconnecting' | 'ended' | 'failed';
  lastActiveAt: number;
  cwd: string;
}

class SessionManager {
  create(sessionId, leaseId, firstPrompt, opts): Promise<void>;
  inject(sessionId, prompt): Promise<{ runId: string }>;  // push inputQueue，新 turn（turn 级串行）
  interrupt(sessionId): Promise<void>;                     // q.interrupt()，当前 run→failed
  end(sessionId): Promise<void>;                           // 终止 + complete lease（service.end_session）
  // 30min 空闲扫描（D-004）
}
```

### 7.3 WS 控制消息（server↔daemon，复用 DaemonMessage 信封）

```typescript
// protocol.ts
SESSION_INJECT: 'daemon:session_inject';        // server→daemon，注入新 prompt
SESSION_INTERRUPT: 'daemon:session_interrupt';  // server→daemon，打断本轮
SESSION_END: 'daemon:session_end';              // server→daemon，结束会话
PERMISSION_REQUEST: 'daemon:permission_request';  // daemon→server，审批往返（D-007）
PERMISSION_RESPONSE: 'daemon:permission_response';// server→daemon，审批往返

SessionInjectPayload { session_id, lease_id, run_id, prompt }
SessionControlPayload { session_id, lease_id }
PermissionRequestPayload { session_id, run_id, request_id, tool_name, input }
PermissionResponsePayload { session_id, request_id, decision: 'allow' | 'deny', message? }
```

### 7.4 REST（前端→backend）

```
POST /api/daemon/sessions            { provider, prompt, manual_approval?, model? } → { session_id, run_id, stream_url }
POST /api/daemon/sessions/{id}/inject { prompt } → { run_id }
POST /api/daemon/sessions/{id}/interrupt
POST /api/daemon/sessions/{id}/end
GET  /api/daemon/sessions/{id}/stream   // SSE（session 级聚合）
```

### 7.5 session 级 SSE 聚合（D-005）

现有 `stream_run_logs`（service.py:541）是 run 级（Redis `agent_run:{run_id}`），跨 turn 切 run_id 前端单订阅断流。方案：新增 **session 级 Redis channel** `agent_session:{session_id}`：
- `submit_messages` 在 publish 到 `agent_run:{run_id}`（保留）**同时** publish 带 `run_id` 标记的事件到 `agent_session:{session_id}`；
- 新增 `stream_session_logs(session_id)` 订阅 session channel，前端单连接贯穿整个会话（事件含 run_id 区分 turn 边界）。

### 7.6 turn / AgentRun 生命周期时序（v3 同进程，Grill X-002 补）

v3 下 SDK driver 在 daemon 同进程跑多 turn，AgentRun（backend 实体）创建/关闭时序：

1. **inject**：前端 POST `/inject` → backend `create AgentRun`(agent_session_id, status=running) → WS `session_inject`(run_id, prompt) → daemon `SessionManager.inject` → `inputQueue.push(msg)`。
2. **SDK 继续**：driver `query(AsyncIterable)` 消费 inputQueue 下一条 → 跑 turn（SDK 内部同进程）。
3. **result**：`driver.consume` 收到 `result` → WS 通知 backend 关闭该 AgentRun(status=completed/failed) + publish session 级 SSE。
4. **下一 turn**：用户再 inject → 回到步骤 1。

> result 是 AgentRun 的干净边界（spike D4）；interrupt 的 result(is_error) → AgentRun=failed（spike D1）。**AgentRun 创建由 backend 驱动（inject 时），关闭由 daemon result 触发**；首 turn 的 AgentRun 在 `POST /sessions` 时由 backend 创建并发首 prompt。

## 8. 数据模型

### 8.1 新增 `agent_sessions` 表

| 字段 | 类型 | 说明 |
|---|---|---|
| id | Uuid PK | |
| user_id | Uuid FK users | |
| runtime_id | Uuid FK daemon_runtimes | 执行该会话的 daemon |
| lease_id | Uuid FK daemon_task_leases | 1:1 长生命周期 lease（D-002@v3） |
| provider | String(30) | claude（codex 后续） |
| status | String(20) | pending/active/reconnecting/ended/failed |
| agent_session_id | String(255) nullable | **SDK session_id**（query 返回，resume 用，spike D3） |
| config | JSON nullable | { manual_approval, model, ... } |
| turn_count | Integer default 0 | |
| cwd | String nullable | SessionManager 固定的工作目录（resume 按 cwd 分目录） |
| created_at / last_active_at / ended_at | DateTime(tz) | |

### 8.2 `daemon_task_leases` 增加 `kind`

```python
kind: str = Field(default="batch", sa_column=Column(String(20), server_default="batch"))
# batch: 现有批处理 | interactive: 交互式会话（长生命周期，SDK driver）
```

### 8.3 `agent_runs` 增加 `agent_session_id`

```python
agent_session_id: uuid.UUID | None = Field(
    default=None,
    sa_column=Column(Uuid(as_uuid=True), ForeignKey("agent_sessions.id", ondelete="SET NULL"), nullable=True),
)
# AgentRun 现有 session_id 保留（claude resume 语义，quick-chat 在用），不改动；新增 agent_session_id 指向本会话聚合（D-001）。
```

> 本项目未正式上线、数据可清空（CLAUDE.md 规则 7），迁移用新增表+字段，无需旧数据兼容。

### 8.4 session / lease / run 三元关系（D-005，v2 沿用）

- **interactive lease.agent_run_id = NULL**（不直接关联单 run）；batch lease 保持原 1:1。
- **session ↔ lease 1:1**：`agent_sessions.lease_id` FK→daemon_task_leases。
- **session ↔ runs 1:N**：`agent_runs.agent_session_id` FK→agent_sessions，每 turn（SDK result）一个 run（spike D4）。
- **进程层**：1 session = 1 长生命周期 SDK Query（同进程多 turn，spike H2）；崩溃后 `resume` 新 Query 恢复（spike D3）。

### 8.5 interactive lease 过期语义（D-005，v2 沿用）

- interactive lease 创建时 `lease_expires_at = NULL`，**不进** `handle_lease_expiry` 回收。
- 结束（手动 end 或 D-004 空闲 30min）由 SessionManager→backend→`service.end_session` 统一入口，更新 `agent_sessions.status=ended` + `daemon_task_leases.status=completed`。

## 9. 兼容策略（brownfield）

- **未配置 interactive 时行为不变**：`lease.kind` 默认 batch，所有现有 lease 走原 TaskRunner；quick-chat 首次 prompt 仍可走旧 resume 路径（开关切换）。
- **批处理 lease 不受影响**：workspace agent run 保持原生命周期，`kind=batch`，TaskRunner 零改动。
- **D-009（系统 claude）**：agent-detector 未检测到系统 claude 时，ClaudeSdkDriver 拒绝启动 interactive session（明确报错，前端提示安装）；batch 路径不受影响。
- **D-008（GLM 错误透传）**：工具失败不阻断 session，错误返模型自处理。
- **WS 控制消息是新增类型**：daemon 不识别时静默丢弃（ws-client 现有行为）。
- **回退路径**：interactive 出问题可降级回旧 quick-chat（每轮新 run + resume）。
- **不改变的 API/表**：现有 `/api/daemon-chat`、`AgentRun.session_id`（claude resume）、所有批处理 lease 端点。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | 同进程多轮缺铁证 | **已关闭** | spike-02 §3.7 H1/H2 通过，D-002@v3 立项 |
| R-exe | 显式 `pathToClaudeCodeExecutable`=系统 claude 未单独验证（spike H1 验证的是默认内置 exe） | **P0** | task-03 前置补验：复用 `%TEMP%\claude-sdk-spike` 脚本加 `pathToClaudeCodeExecutable` 对照跑通 |
| R-SDK0.x | SDK 0.3.181 是 0.x，API 可能变 | P1 | package.json pin 版本；ClaudeSdkDriver 封装隔离 SDK 调用；升级前用 spike 脚本回归 |
| R-GLM | GLM 中转工具调用兼容性差（spike D2 Write 失败） | P1 | D-008 错误透传；driver 不假设工具成功；监控 tool 失败率；结论对官方 Anthropic 后端需另证 |
| R-cwd | SDK resume 按 cwd 分目录，cwd 不一致 resume 失败 | P1 | SessionManager 固定 session cwd；agent_sessions.cwd 记录；resume 还原 cwd |
| R-conv | 一个 session 同时只允许一个 turn（turn 级串行，spike S1） | P2 | inject 到 running session 的 msg 进 inputQueue 自然排队到下一 turn（spike S1 QUEUED 语义），**不拒绝**；UI 可提示"排队中" |
| R-02 | WS 控制消息乱序/重连丢消息 | P1 | SessionStore 校验 status；WS 重连对账 |
| R-03 | daemon 重启 session 内存丢失（Wave1/2） | P1 | Wave1/2 崩溃=failed；Wave3 持久化 |
| R-04 | lease 语义变化破坏状态机 | P1 | kind 隔离，interactive lease 不进 handle_lease_expiry |
| R-05 | 术语碰撞 AgentRun.session_id vs AgentSession | P2 | D-001 已规范 |
| R-08 | session SSE 跨 turn 聚合 | P1 | D-005 session 级 channel + 双 publish |

## 11. 决策追踪

详见 `decisions.md`。当前版本决策：

| 决策 ID | 标题 | 覆盖章节 |
|---|---|---|
| D-001@v1 | 交互式会话实体命名 `AgentSession` | §8.1, §8.3, R-05 |
| D-002@v3 | driver 层（ClaudeSdkDriver）与 TaskRunner 并存，SDK 同进程多轮 | §5, §6, §7, R-01 |
| D-003@v1 | Wave1/2 不崩溃恢复，Wave3 resume | §3, §5 Wave3, R-03 |
| D-004@v1 | session 空闲 30min 自动结束 | §5 Wave1, §8.5 |
| D-005@v1 | session/lease/run 三元 + session 级 SSE 聚合 | §7.5, §8.4, R-08 |
| D-006@v1 | 全栈一次设计范围 | §4, §5 |
| D-007@v1 | canUseTool 远程人审（WS→前端） | §5 Wave2, §7.1, §7.3 |
| D-008@v1 | GLM 工具失败错误透传 | §5 Wave2, §9, R-GLM |
| D-009@v1 | 只用系统 claude.CMD（pathToClaudeCodeExecutable） | §5 Wave1, §7.1, R-exe |

**剩余风险**：R-exe（P0，execute 前补验）、R-SDK0.x、R-GLM（见 §10）。

## 12. 自审

- ✅ **需求覆盖**：G1-G6 + FR-01~10 全部有落点（FR-02 改 SDK 同进程多轮，FR-07 canUseTool 远程人审 D-007，FR-08 SDK resume D3）；Q1-Q4（演进 quick-chat / session 作 lease 上层 / 默认自动+手动开关 / 打断与结束分离）均覆盖。
- ✅ **决策覆盖**：D-001~D-009 全部在 §11 引用并被设计章节覆盖（含 spike-02 产生的 D-006~D-009）。
- ✅ **约束一致性**：复用现有 lease/SSE/凭证链路；scan 文档把 daemon 标 Python 已过时，本 design 以实际 TS 代码为准；driver 与 TaskRunner 并存符合 D-002@v3 方案 A。
- ✅ **真实性**：表名（daemon_task_leases/agent_runs）、字段（runtime_id/agent_run_id/session_id）、类名（TaskRunner/SessionManager/ClaudeSdkDriver/InputQueue/WsClient）均来自真实代码；SDK API（query/Query/canUseTool/interrupt/SDKUserMessage/SDKResultMessage）来自 `sdk.d.ts` + spike-02 实测；新增项标注"新增"。
- ✅ **YAGNI**：非目标明确排除 happy 控制面 / 替换 TaskRunner / 工具预禁 / SDK 平台包 / 运行中注入 / 多 agent 铺通。
- ✅ **验收标准具体可测**（见下）。
- ✅ **非目标清晰**：§3 列 8 项不做。
- ✅ **兼容策略**：§9 说明未配置时不变 + D-008/D-009 边界 + 回退路径 + 不改变的 API。
- ✅ **风险识别**：§10 含 spike caveat（R-exe/R-GLM/R-SDK0.x）+ P0/P1/P2 对策。

### 验收标准

1. **[Wave1-核心]** quick-chat 发起会话→首 turn result→追问创建新 AgentRun（SDK 同进程，第二轮含首轮上下文，同 `agent_session_id`）。
2. **[Wave1-interrupt]** `interrupt()`→当前 run failed，session 仍 active，可续轮（spike D1）。
3. **[Wave1-end]** end→session ended + lease completed（service.end_session）。
4. **[Wave1-SSE]** 多 turn 输出经 session 级 SSE 实时回显，历史可在 AgentRunLog 回看。
5. **[Wave1-batch]** 现有批处理 lease（workspace agent run）行为零变化（kind=batch 走 TaskRunner）。
6. **[Wave1-exe]** ClaudeSdkDriver 用系统 claude.CMD（`pathToClaudeCodeExecutable`）跑通（R-exe 补验，task-03 前置）。
7. **[Wave2-审批]** canUseTool 触发→前端 allow/deny→driver 继续/中止；5min 超时 deny（D-007）。
8. **[Wave2-GLM]** GLM 工具失败错误透传，session 不崩（D-008）。
9. **[Wave3-resume]** daemon 重启→reconnecting→`resume` 恢复上下文（spike D3）。
10. **[Wave4-UI]** 前端会话面板全功能（列表/窗口/SSE/输入/interrupt-end/审批弹窗）。
