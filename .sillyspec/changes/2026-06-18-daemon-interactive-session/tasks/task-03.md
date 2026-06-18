---
author: qinyi
created_at: 2026-06-18T22:41:08
change: 2026-06-18-daemon-interactive-session
id: task-03
title: "WS 协议契约——session/permission 控制消息 daemon↔backend（SDK driver turn 语义）"
wave: W1
priority: P0
estimated_hours: 8
depends_on: []
blocks: [task-04, task-05]
requirement_ids: [FR-02, FR-04, FR-05, FR-07]
decision_ids: [D-002@v3]
nfr_ids: [NFR-05]
allowed_paths:
  - sillyhub-daemon/src/protocol.ts
  - backend/app/modules/daemon/protocol.py
  - sillyhub-daemon/tests/protocol-session-contract.test.ts
  - backend/tests/modules/daemon/test_protocol_session_contract.py
---

# WS 协议契约——session/permission 控制消息 daemon↔backend（SDK driver turn 语义）

## 1. 目标与硬约束

依据 `design.md`（§7.3 WS 控制消息、§7.6 turn/AgentRun 时序）、`decisions.md` 的 **D-002@v3**（SDK 同进程 driver 层，与 TaskRunner 并存）和 `plan.md` Wave 1，本任务为交互式会话建立 **WS 控制通道协议契约**：

- 新增 5 个 WS 控制消息类型常量（daemon↔backend），**逐字对齐** daemon `protocol.ts` ↔ backend `protocol.py`；
- 定义 4 类 payload 模型（TS interface + Python pydantic 对端）；
- 新增**契约单测**（TS + Python 双侧），任一字符漂移即失败；
- **turn 调度语义改 SDK**（v2 是 per-turn spawn + `--resume`/`thread/resume`；v3 是 SDK 同进程 `query(AsyncIterable)` 多 turn，每 `result` 对应一个 AgentRun，spike D4）；
- daemon 不识别的控制消息类型**静默丢弃不崩溃**（NFR-05）。

本任务**只定契约**：常量字符串值 + payload 类型定义 + 契约单测。**不实现** daemon `ws-client` 路由、`SessionManager`、backend `ws_hub.send_session_control`、REST 端点等业务逻辑（分别由 task-04、task-05 负责）。WS 控制消息复用现有 `DaemonMessage` 信封（`{type, payload}`，protocol.py 已有），不新增信封结构。

### v2 → v3 关键差异（保留 v2 内容，更新 turn 调度描述）

v2 蓝图把协议绑定到 "per-turn spawn + resume"（每 turn 一个独立 agent 子进程，Claude 用 `--resume`，Codex 用 `thread/resume`）。**v3 改为 SDK 同进程 driver 层**（D-002@v3 方案 A）：

- **SESSION_INJECT** 语义：v2 是"daemon 调 `TaskRunner.runTurn` spawn 新进程"；**v3 是"backend 创建新 AgentRun 后 WS 通知 daemon，daemon `SessionManager.inject` 把新 prompt push 进 `inputQueue`，SDK `query(AsyncIterable)` 消费下一条跑下一 turn"**（spike H2，同进程同 session，第二轮含首轮上下文）。
- **SESSION_INTERRUPT** 语义：v2 是"SIGTERM 当前 child"；**v3 是"`ClaudeSdkDriver.interrupt(query)` → SDK turn 级中断，result(subtype=error_during_execution)"**（spike D1）。
- **SESSION_END** 语义：v2 是"取消 currentRun + 删除内存 session 元数据"；**v3 是"终止 SDK Query + 清理 SessionStore + backend `service.end_session` 统一入口"**。
- **PERMISSION_REQUEST/RESPONSE** 语义：v2 是 control_request 协议；**v3 是 SDK `canUseTool` 回调 → WS permission_request/response 往返**（spike D2，D-007）。

契约字符串值与 v2 完全一致（`daemon:session_inject` 等），差异仅在注释/文档描述 turn 调度为 SDK 而非 spawn。前端、SSE、数据库（task-02）、batch lease 行为不在本任务。

## 覆盖来源

| 来源 | 要求/决策 | 本任务落实 |
|---|---|---|
| `plan.md` task-03 | Wave 1 协议契约，覆盖 FR-02, FR-04, FR-05, FR-07 / NFR-05 / D-002@v3 | 5 个 WS 控制消息常量 + 4 类 payload TS/Python 对端 + 契约单测 |
| FR-02 多轮追问 | inject 触发 backend 创建 AgentRun + WS session_inject + daemon inputQueue.push | `SESSION_INJECT` payload 含 `session_id/lease_id/run_id/prompt` |
| FR-04 打断本轮 | interrupt 仅 turn 级，session 仍 active | `SESSION_INTERRUPT` payload（turn 级，非 session 级） |
| FR-05 结束会话 | end 终止 session + lease，统一收口 | `SESSION_END` payload |
| FR-07 权限远程人审 | canUseTool 回调 → WS permission_request/response 往返，5min 超时 deny | `PERMISSION_REQUEST`/`PERMISSION_RESPONSE` payload（D-007） |
| NFR-05 协议契约 | 新增 WS 消息逐字对齐 protocol.ts ↔ protocol.py；未知 type 静默丢弃不崩溃 | TS+Python 对端逐字对齐 + 契约单测；ws-client 不识别 type 静默丢弃（task-04 落地路由，本任务单测验证常量值不破坏现有分发） |
| D-002@v3 | SDK 同进程 driver 层，turn 调度语义改 SDK | payload 注释与契约单测断言 turn 调度为 SDK `query(AsyncIterable)`/`interrupt(query)`/`result` 边界 |

## 2. 当前源码依据

实现前必须用 `rg` 确认以下真实接口仍存在；若源码已变化，先更新本任务文档再写代码：

| 事实 | 当前源码锚点 | 本任务使用方式 |
|---|---|---|
| WS 消息信封 | `backend/.../protocol.py:30` `DaemonMessage(type: str, payload: dict \| None)` | 复用，不新增信封；5 个新 type 字符串进入 payload-less / payload 模型 |
| 现有消息常量模式 | `protocol.py:13-24` `DAEMON_MSG_*` 常量；`protocol.ts:19-64` `MSG` 对象 | 新增 5 个常量遵循同前缀 `daemon:` + 命名风格 |
| 现有 payload 模式 | `protocol.py:40-99` pydantic `*Payload(BaseModel)` | 新增 4 类 pydantic payload（SessionInject/SessionControl/PermissionRequest/PermissionResponse） |
| TS 消息类型联合 | `protocol.ts:67` `MsgType = (typeof MSG)[keyof typeof MSG]` | 新增常量自动并入联合；契约单测断言联合成员 |
| ws-client 分发 | `sillyhub-daemon/src/ws-client.ts` `_handleMessage` 现有 RPC 分支 | task-04 扩展路由；本任务契约单测只断言"未识别 type 不抛错"（NFR-05） |
| backend ws_hub | `backend/.../daemon/ws_hub.py` 现有 `send_to_daemon`/broadcast | task-05 新增 `send_session_control`；本任务不实现 |

## 3. 修改文件（必填）

| 操作 | 文件 | 责任 |
|---|---|---|
| 修改 | `sillyhub-daemon/src/protocol.ts` | `MSG` 对象新增 5 个常量（SESSION_INJECT/SESSION_INTERRUPT/SESSION_END/PERMISSION_REQUEST/PERMISSION_RESPONSE）+ 注释说明方向；新增 4 个 payload interface（TS） |
| 修改 | `backend/app/modules/daemon/protocol.py` | 新增 5 个 `DAEMON_MSG_*` 常量 + 4 个 pydantic payload 模型（与 TS 对端**逐字对齐**） |
| 新增 | `sillyhub-daemon/tests/protocol-session-contract.test.ts` | 契约单测：常量字符串值、payload 字段、TS↔Python 字段名一致、未识别 type 不抛错 |
| 新增 | `backend/tests/modules/daemon/test_protocol_session_contract.py` | 对端契约单测：常量值、payload schema、与 TS 字段名一致 |

不修改 daemon `ws-client.ts` 路由（task-04）、backend `ws_hub.py`/`router.py`/`service.py`（task-05）、`agent` 模块模型（task-02）、SSE（task-06）、前端（task-11/12）。

## 4. 实现要求与精确接口

### 4.1 WS 控制消息常量（5 个）

daemon `protocol.ts` 的 `MSG` 对象新增（值前缀 `daemon:` 不可漏，与现有常量风格一致）：

```typescript
// protocol.ts — MSG 对象新增成员
export const MSG = {
  // ... 现有 TASK_AVAILABLE / HEARTBEAT / REGISTER / HEARTBEAT_ACK /
  //     LEASE_CLAIM / LEASE_START / LEASE_COMPLETE / LEASE_MESSAGES / RPC / RPC_RESULT ...

  /**
   * Server → Daemon：注入新 prompt 触发新 turn（FR-02）。
   *
   * v3 SDK 语义：backend 已创建新 AgentRun（status=running），
   * daemon 收到后 SessionManager.inject → inputQueue.push(prompt)，
   * SDK query(AsyncIterable) 消费下一条跑下一 turn（同进程同 session，
   * 第二轮含首轮上下文，spike H2）。payload: SessionInjectPayload。
   */
  SESSION_INJECT: 'daemon:session_inject',

  /**
   * Server → Daemon：打断当前 turn（FR-04）。
   *
   * v3 SDK 语义：daemon 收到后 ClaudeSdkDriver.interrupt(query)，
   * SDK 当前 turn 产 result(subtype=error_during_execution)，当前
   * AgentRun=failed，session 仍 active（spike D1）。仅 turn 级，非 session 级。
   * payload: SessionControlPayload。
   */
  SESSION_INTERRUPT: 'daemon:session_interrupt',

  /**
   * Server → Daemon：结束会话（FR-05）。
   *
   * v3 SDK 语义：如有当前 turn 则先 interrupt，随后清理 SessionStore +
   * backend service.end_session 统一入口更新 agent_sessions.status=ended +
   * daemon_task_leases.status=completed。payload: SessionControlPayload。
   */
  SESSION_END: 'daemon:session_end',

  /**
   * Daemon → Server：权限审批请求（FR-07 / D-007）。
   *
   * v3 SDK 语义：ClaudeSdkDriver.canUseTool 回调被 SDK 触发时，
   * daemon 不本地自动批准，发本消息 → backend → 前端弹审批卡。
   * payload: PermissionRequestPayload。
   */
  PERMISSION_REQUEST: 'daemon:permission_request',

  /**
   * Server → Daemon：权限审批响应（FR-07 / D-007）。
   *
   * 用户 allow/deny 后 backend 经本消息回传 daemon，daemon resolve
   * canUseTool 回调；5min 未响应 backend 自动发 deny。
   * payload: PermissionResponsePayload。
   */
  PERMISSION_RESPONSE: 'daemon:permission_response',
} as const;
```

backend `protocol.py` 对端常量（**与 TS 逐字对齐**）：

```python
# protocol.py — 新增常量（紧随现有 DAEMON_MSG_RPC_RESULT 之后）

# Server → Daemon：交互式会话控制（D-002@v3，FR-02/04/05）
DAEMON_MSG_SESSION_INJECT = "daemon:session_inject"
DAEMON_MSG_SESSION_INTERRUPT = "daemon:session_interrupt"
DAEMON_MSG_SESSION_END = "daemon:session_end"
DAEMON_MSG_PERMISSION_RESPONSE = "daemon:permission_response"

# Daemon → Server：权限审批请求（FR-07 / D-007，canUseTool 远程人审）
DAEMON_MSG_PERMISSION_REQUEST = "daemon:permission_request"
```

**对齐硬规则**：任一字符串值漂移（大小写、下划线、前缀冒号）即双侧契约单测失败。

### 4.2 Payload 接口定义（TS + Python 对端，逐字对齐字段名）

#### SessionInjectPayload（SESSION_INJECT，Server → Daemon）

```typescript
// protocol.ts
/**
 * SESSION_INJECT payload（Server → Daemon，FR-02）。
 * 触发 backend 已创建的新 AgentRun 的执行：daemon inputQueue.push 跑下一 turn。
 */
export interface SessionInjectPayload {
  /** 目标会话 ID（agent_sessions.id，UUID 字符串）。 */
  session_id: string;
  /** 该会话绑定的长生命周期 interactive lease ID（校验匹配）。 */
  lease_id: string;
  /** 本次 turn 对应的 AgentRun ID（backend 在 inject 时已创建，status=running）。 */
  run_id: string;
  /** 用户追问文本（非空字符串）。 */
  prompt: string;
}
```

```python
# protocol.py
class SessionInjectPayload(BaseModel):
    """SESSION_INJECT payload (Server → Daemon, FR-02).

    Daemon pushes prompt into inputQueue for SDK query(AsyncIterable) to
    consume the next turn (D-002@v3 SDK in-process multi-turn, spike H2).
    """

    session_id: uuid.UUID
    lease_id: uuid.UUID
    run_id: uuid.UUID
    prompt: str  # non-empty
```

#### SessionControlPayload（SESSION_INTERRUPT / SESSION_END，Server → Daemon）

```typescript
// protocol.ts
/**
 * SESSION_INTERRUPT / SESSION_END 公共 payload（Server → Daemon，FR-04 / FR-05）。
 * interrupt 仅 turn 级；end 终止 session + lease。
 */
export interface SessionControlPayload {
  session_id: string;
  lease_id: string;
}
```

```python
# protocol.py
class SessionControlPayload(BaseModel):
    """SESSION_INTERRUPT / SESSION_END payload (Server → Daemon, FR-04 / FR-05)."""

    session_id: uuid.UUID
    lease_id: uuid.UUID
```

#### PermissionRequestPayload（PERMISSION_REQUEST，Daemon → Server）

```typescript
// protocol.ts
/**
 * PERMISSION_REQUEST payload（Daemon → Server，FR-07 / D-007）。
 * canUseTool 回调触发，backend 转发前端弹审批卡。
 */
export interface PermissionRequestPayload {
  session_id: string;
  /** 当前 turn 的 AgentRun ID（定位审批上下文）。 */
  run_id: string;
  /** 审批请求唯一标识（daemon 生成，response 原样回填做关联）。 */
  request_id: string;
  /** SDK 传来的工具名（如 Write/Bash）。 */
  tool_name: string;
  /** 工具调用输入（工具参数 JSON，原样转发）。 */
  input: Record<string, unknown>;
  /** 工具调用 ID（可选，SDK tool_use_id，便于追溯）。 */
  tool_use_id?: string;
}
```

```python
# protocol.py
class PermissionRequestPayload(BaseModel):
    """PERMISSION_REQUEST payload (Daemon → Server, FR-07 / D-007)."""

    session_id: uuid.UUID
    run_id: uuid.UUID
    request_id: str
    tool_name: str
    input: dict  # tool call args JSON, forwarded as-is
    tool_use_id: str | None = None
```

#### PermissionResponsePayload（PERMISSION_RESPONSE，Server → Daemon）

```typescript
// protocol.ts
/**
 * PERMISSION_RESPONSE payload（Server → Daemon，FR-07 / D-007）。
 * 用户 allow/deny 或 5min 超时 deny（由 backend 发）。
 */
export interface PermissionResponsePayload {
  session_id: string;
  /** 关联 PERMISSION_REQUEST.request_id（原样回填）。 */
  request_id: string;
  /** 'allow' | 'deny'（deny 映射 SDK canUseTool deny behavior）。 */
  decision: 'allow' | 'deny';
  /** deny 时的原因（可选，透传给模型）。 */
  message?: string;
}
```

```python
# protocol.py
from typing import Literal

class PermissionResponsePayload(BaseModel):
    """PERMISSION_RESPONSE payload (Server → Daemon, FR-07 / D-007).

    decision='deny' with 5min timeout backend-side (D-007).
    """

    session_id: uuid.UUID
    request_id: str
    decision: Literal["allow", "deny"]
    message: str | None = None
```

### 4.3 契约单测要求

#### TS 侧 `sillyhub-daemon/tests/protocol-session-contract.test.ts`

至少覆盖：

1. **常量值断言**：`MSG.SESSION_INJECT === 'daemon:session_inject'` 等 5 个常量字符串逐字断言（与对端 Python 字符串字面量复制粘贴一致）。
2. **联合成员**：5 个新常量均属 `MsgType` 联合（类型层面 + 运行时 `Object.values(MSG)` 包含）。
3. **payload 字段存在性**：构造合法 `SessionInjectPayload`/`SessionControlPayload`/`PermissionRequestPayload`/`PermissionResponsePayload` 对象通过 TS 类型检查；构造缺字段对象触发编译期错误（`@ts-expect-error` 断言）。
4. **decision 取值约束**：`PermissionResponsePayload.decision` 仅接受 `'allow' | 'deny'`，其它值 `@ts-expect-error`。
5. **prompt 非空契约**（运行时契约单测可选，但需在文档标注由 task-05 backend 校验；本任务断言类型为 string）。
6. **NFR-05 静默丢弃**：模拟 ws-client 收到未识别 type（如 `'daemon:unknown_future_type'`），断言不抛错（仅记录或忽略）。可用 spy/mock `_handleMessage` 验证现有分发路径不崩溃。

#### Python 侧 `backend/tests/modules/daemon/test_protocol_session_contract.py`

至少覆盖：

1. **常量值断言**：`DAEMON_MSG_SESSION_INJECT == "daemon:session_inject"` 等 5 个；与 TS 侧字符串**逐字相同**。
2. **pydantic 模型 schema**：4 个 payload 模型构造合法实例成功；缺必填字段抛 `ValidationError`；`SessionInjectPayload.prompt=""` 是否允许（按 FR-02 非空，但本任务模型层只声明 `str`，非空校验由 task-05 service 层做，单测文档化此边界）。
3. **decision Literal**：`PermissionResponsePayload(decision="maybe")` 抛 `ValidationError`。
4. **UUID 解析**：`session_id`/`lease_id`/`run_id` 接受 UUID 字符串与 UUID 对象；非法字符串抛 `ValidationError`。
5. **DaemonMessage 信封兼容**：`DaemonMessage(type=DAEMON_MSG_SESSION_INJECT, payload={...})` 能正常序列化/反序列化（复用现有信封）。
6. **跨语言对齐断言**（可选但推荐）：单测内 hardcode 一份 TS 字面量字符串集合，断言 Python 常量与之相等（漂移即失败）。

## 5. 边界条件（至少全部覆盖，≥5）

1. **未知 type 静默丢弃不崩溃（NFR-05）**：daemon `ws-client` 收到未在 `MSG` 注册的 type（如未来版本新增类型、拼写错误、恶意构造），契约单测断言不抛异常；现有 TASK_AVAILABLE/RPC/LEASE_* 分发不受影响。具体路由由 task-04 在 `_handleMessage` 落地（默认分支 return 并记录 warn），本任务单测锁定"未识别不抛"语义。
2. **SESSION_INJECT 到非 active session**：payload 的 `session_id` 存在但 session status=`ended`/`failed`/`reconnecting`，daemon 应拒绝执行 inject（不 push inputQueue）。**本任务只定义 payload 与语义注释**，落地拒绝逻辑由 task-04（SessionManager.inject 校验 status）+ task-05（backend 校验 status 后才发 WS）；契约单测标注此边界归属。
3. **SESSION_INTERRUPT 到无 running turn**：session `active` 但无 currentRun（空闲），interrupt 应为 no-op（不改变 status，不误杀下一 turn）。落地由 task-04 SessionManager.interrupt；契约单测标注。
4. **PERMISSION_RESPONSE 超时**：5min 未响应，backend 自动发 `decision='deny'`（D-007）。超时定时器由 task-05 backend 持有；本任务 payload 已含 `message?` 字段承载超时原因，契约单测断言 deny + message 合法。
5. **WS 控制消息乱序/重连丢消息（R-02）**：daemon 重连后可能收到历史 inject（已结束的 session）或丢失 interrupt。`request_id`（permission）与 `run_id`（inject）用于幂等关联；重复 inject 同 run_id 应被 task-04 幂等处理。本任务契约单测断言 `run_id`/`request_id` 字段存在且为必填，为幂等提供协议基础。
6. **lease_id 不匹配**：控制消息 `session_id` 存在但 `lease_id` 与 SessionStore 记录不一致，daemon 拒绝操作并记录结构化 warn（防误操作他人 session）。落地由 task-04，契约 payload 已含 `lease_id` 必填字段提供校验基础。
7. **PERMISSION_REQUEST/RESPONSE 方向约束**：`PERMISSION_REQUEST` 只能 Daemon → Server，`PERMISSION_RESPONSE` 只能 Server → Daemon。本任务在注释中标注方向；运行时方向校验由 task-04（ws-client 只 dispatch 反向）+ task-05（ws_hub 只 send 反向）落地。
8. **batch lease 不受影响（FR-09）**：新增的 5 个 type 仅 interactive session 使用；batch lease 路径（TASK_AVAILABLE → LEASE_CLAIM/START/COMPLETE）零改动。契约单测断言现有 8 个常量值不变 + 新增 5 个常量并存，互不干扰。
9. **prompt 空字符串/纯空白**：`SessionInjectPayload.prompt=""` 协议层不拒绝（类型为 string），但 FR-02 语义要求非空。非空校验归属 task-05 backend service 层（inject 入口校验），本任务单测文档化此分工。
10. **DaemonMessage 信封 payload=null**：现有 `DaemonMessage.payload: dict | None`。SESSION_INTERRUPT/END 理论上 payload 必填（含 session_id/lease_id），但若 daemon 收到 payload=null 的控制消息应静默丢弃（NFR-05），不抛 KeyError。落地由 task-04 路由层 try/except。

## 6. 非目标

- 不实现 daemon `ws-client._handleMessage` 的控制消息路由分发（task-04）。
- 不实现 daemon `SessionManager`/`ClaudeSdkDriver`/`inputQueue`（task-04，SDK 调用与 turn 调度落地）。
- 不实现 backend `ws_hub.send_session_control`/`router` REST 端点/`service.create_session`/`inject`/`interrupt`/`end_session`（task-05）。
- 不实现数据模型迁移（task-02：agent_sessions 表、lease.kind、agent_runs.agent_session_id）。
- 不实现 session 级 SSE 聚合（task-06，D-005）。
- 不实现 canUseTool 回调逻辑、前端审批 UI（task-08/09/12）。
- 不实现 resume 持久化（task-10）。
- 不修改现有 batch lease 协议常量（TASK_AVAILABLE/LEASE_*）值，仅新增。

## 7. 参考

- `design.md` §7.3（WS 控制消息定义）、§7.6（turn/AgentRun 时序，SDK 同进程）、§5 Wave1（控制通道）、§10 R-02（乱序/重连）。
- `requirements.md` FR-02（多轮追问 SDK 同进程）、FR-04（打断本轮）、FR-05（结束会话）、FR-07（canUseTool 远程人审）、NFR-05（协议契约逐字对齐）。
- `decisions.md` D-002@v3（SDK driver 层与 TaskRunner 并存）、D-007@v1（canUseTool 远程人审）。
- `spike-02-architecture-validation.md` §3.7：H2（同进程两轮）、D1（interrupt turn 级）、D2（canUseTool 回调可 await）。
- 现有对端：`sillyhub-daemon/src/protocol.ts`（MSG/LEASE_STATE/MsgType）、`backend/app/modules/daemon/protocol.py`（DAEMON_MSG_*/DaemonMessage/*Payload）。

## 8. TDD 实施顺序

严格按"测试先失败 → 最小实现 → 重构 → 全量回归"执行。

### Step 1：契约字符串单测先行

先在双侧新增契约单测文件，断言 5 个常量字符串值（先 hardcode 预期值），运行 → **红**（常量未定义，编译/导入失败）。

### Step 2：TS 侧新增常量 + payload interface

在 `protocol.ts` 的 `MSG` 对象新增 5 个成员 + 注释；新增 4 个 `export interface`。运行 TS 单测 → **绿**（常量值断言通过）；payload 字段单测（合法构造 + `@ts-expect-error` 缺字段）→ **绿**。

### Step 3：Python 侧新增常量 + pydantic 模型

在 `protocol.py` 新增 5 个 `DAEMON_MSG_*` 常量 + 4 个 pydantic 模型。运行 Python 单测 → **绿**（常量值 + schema + Literal decision + UUID 解析 + DaemonMessage 信封）。

### Step 4：跨语言对齐回归

- TS 单测内的字符串字面量与 Python 单测内的字符串字面量**逐字相等**（人工核对 + 推荐 hardcode 对照表单测）。
- 现有 batch 协议常量值回归（确认未误改 TASK_AVAILABLE/LEASE_*）。

### Step 5：全量回归

```powershell
# daemon
Set-Location sillyhub-daemon
pnpm test -- protocol-session-contract
pnpm typecheck
pnpm test   # 现有测试不回归

# backend
Set-Location backend
uv run pytest tests/modules/daemon/test_protocol_session_contract.py -v
uv run pytest tests/modules/daemon/  # 现有 protocol/ws 单测不回归
```

## 9. 验收标准

| AC | 验收场景 | 可观察证据 | 状态 |
|---|---|---|---|
| AC-01 | 5 个 WS 控制消息常量定义 | `protocol.ts` MSG 对象与 `protocol.py` DAEMON_MSG_* 各含 SESSION_INJECT/INTERRUPT/END/PERMISSION_REQUEST/PERMISSION_RESPONSE；字符串值前缀 `daemon:` | [ ] |
| AC-02 | TS↔Python 常量逐字对齐 | 双侧契约单测各 hardcode 同一组字符串字面量并断言相等；任一端改值即双侧红 | [ ] |
| AC-03 | 4 类 payload 模型字段对齐 | SessionInjectPayload(session_id/lease_id/run_id/prompt)、SessionControlPayload(session_id/lease_id)、PermissionRequestPayload(session_id/run_id/request_id/tool_name/input/tool_use_id?)、PermissionResponsePayload(session_id/request_id/decision/message?) 双侧字段名/类型逐字一致 | [ ] |
| AC-04 | decision Literal 约束 | TS `decision: 'allow'\|'deny'`（`@ts-expect-error` 其它值）；Python `Literal["allow","deny"]`（ValidationError 其它值） | [ ] |
| AC-05 | UUID 字段解析 | Python payload 接受 UUID 字符串/对象，非法字符串 ValidationError；TS 类型为 string（序列化 UUID） | [ ] |
| AC-06 | DaemonMessage 信封兼容 | `DaemonMessage(type=DAEMON_MSG_SESSION_INJECT, payload={...})` 可序列化/反序列化；复用现有信封不新增结构 | [ ] |
| AC-07 | 未知 type 静默丢弃（NFR-05） | 契约单测断言收到未注册 type（如 `daemon:unknown`）不抛异常；现有 TASK_AVAILABLE/RPC 分发不受影响 | [ ] |
| AC-08 | batch 协议回归 | 现有 8 个常量（TASK_AVAILABLE/HEARTBEAT/REGISTER/HEARTBEAT_ACK/LEASE_CLAIM/START/COMPLETE/MESSAGES/RPC/RPC_RESULT）值与行为零变化；现有 daemon/backend 测试全绿 | [ ] |
| AC-09 | SDK turn 语义文档化 | 常量注释明确 SESSION_INJECT=inputQueue.push+SDK 下一 turn、INTERRUPT=interrupt(query) turn 级、END=清理 SessionStore+end_session；非 v2 spawn+resume 描述 | [ ] |
| AC-10 | 类型检查与全量测试 | daemon `pnpm typecheck` + `pnpm test`、backend `uv run pytest tests/modules/daemon/` 退出码 0 | [ ] |
