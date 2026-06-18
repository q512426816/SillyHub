---
id: task-02
title: 协议契约（WS 控制消息两端对端 + 契约单测）
wave: W1
priority: P0
depends_on: [task-01]
covers: [FR-02, FR-04, FR-05, FR-07, NFR-05]
created_at: 2026-06-18 14:11:24
author: qinyi
---

# 协议契约 — daemon protocol.ts ↔ backend protocol.py 新增 WS 控制消息两端对端 + 契约单测

> 设计依据：
> - `design.md` §5 Wave1（WS 控制通道 server→daemon）、§7.1（WS 控制消息接口定义）、§9（兼容：未知 type 静默丢弃）、§10 R-02（消息类型漂移）。
> - `decisions.md` D-002@v1（1 session = 1 lease）、D-005@v1（三元关系 + SSE）。
> - `plan.md` task-02 行 + 全局验收标准「契约单测通过」。
> - 现有契约参考：`sillyhub-daemon/src/protocol.ts` 注释块（"所有字符串值逐字对齐 backend 对端"+ 跨文件对照清单）+ `sillyhub-daemon/tests/protocol.contract.test.ts`（断言每个 MSG 字面量 === 硬编码字符串）+ `backend/app/modules/daemon/protocol.py`（DAEMON_MSG_* + Pydantic Payload 模型）。

## 1. 目标

为 Wave1（核心交互：中途追问/打断/结束）和 Wave2（权限暂停往返）铺好两端协议契约地基，**只定义消息常量、payload 结构、契约单测**，不写任何业务 handler / WS 路由 / REST 端点（那些分别在 task-03 / task-04 / task-07）。

具体落地：

1. daemon 侧 `sillyhub-daemon/src/protocol.ts` 新增 5 个 WS 消息类型常量（含 server→daemon 3 个 + daemon→server 1 个 + 双向权限往返 2 个）+ 4 个 payload 类型。
2. backend 侧 `backend/app/modules/daemon/protocol.py` 新增对应 5 个 `DAEMON_MSG_*` 常量 + 4 个 Pydantic Payload 模型。
3. 两端逐字对齐（同一 `daemon:xxx` 字符串），扩展 `sillyhub-daemon/tests/protocol.contract.test.ts` 新增 5 条断言，确保任一端漂移即测试失败。
4. 明确契约规则：daemon `ws-client` 对未知 type 静默丢弃不崩溃（延续现有 `stream-json.ts`/`protocol.py` 对端约定）。

## 2. 前置依赖

- **task-01（数据模型迁移）**：本任务的 payload 大量引用 `session_id` / `lease_id` / `run_id` 概念，这些字段的语义和取值规则（`AgentSession.id` / `DaemonTaskLease.id` / `AgentRun.id`）来自 task-01 引入的 `agent_sessions` 表 + 三元关系（D-005）。task-02 只定义协议字符串和 payload 形状，不依赖具体表结构实现，但**字段命名必须与 task-01 落地的列名一致**（snake_case：`session_id`、`lease_id`、`run_id`）。
- **现有 RPC 契约参考**：`protocol.ts` 已落地 `MSG.RPC` / `MSG.RPC_RESULT` 与对端 `DAEMON_MSG_RPC` / `DAEMON_MSG_RPC_RESULT`（来自其他变更），本任务延续同样的对端约定与注释风格。
- **spike-01 独立**：本任务不依赖 spike-01（spike-01 是 R-01 行为铁证，影响 task-03/05 是否回退伪多轮，不影响协议字符串本身）。

## 3. 涉及文件

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | `sillyhub-daemon/src/protocol.ts` | `MSG` 对象追加 5 个常量；新增 payload 类型（接口或 type alias，放本文件或拆到 `types.ts`） |
| 修改 | `sillyhub-daemon/src/types.ts`（可选） | 若 payload 类型较大可放此文件；protocol.ts 仅留常量更贴近现有风格（决策见 §6 实现步骤 2） |
| 修改 | `backend/app/modules/daemon/protocol.py` | 追加 5 个 `DAEMON_MSG_*` 常量 + 4 个 Pydantic `BaseModel` payload |
| 修改 | `sillyhub-daemon/tests/protocol.contract.test.ts` | 新增 5 条 `expect(MSG.X).toBe('daemon:xxx')` 断言 + 更新「全部 N 个 MSG 以 daemon: 为前缀」计数 |
| 新增（可选） | `backend/tests/modules/daemon/test_protocol_contract.py` | 若 backend 侧也存在 pytest 契约断言（调研：当前无），可镜像新增；优先在 daemon 侧单测兜底 |

**不改动**（明确划界，避免越权）：
- `sillyhub-daemon/src/ws-client.ts`（控制消息路由由 task-03/04 落地）
- `sillyhub-daemon/src/daemon.ts` / `task-runner.ts` / `session-store.ts`（业务实现）
- `backend/app/modules/daemon/ws_hub.py` / `router.py` / `service.py`（REST + server→daemon 推送由 task-04 落地）

## 4. 消息定义细节

> 全部沿用 `design.md §7.1` 的字符串值，**逐字对齐 `daemon:xxx` 前缀**。任何字符漂移（含大小写、下划线 vs 连字符）即契约单测失败。

### 4.1 消息常量清单

| MSG key（TS）           | DAEMON_MSG_* （Py）               | 字符串值                          | 方向          | 用途                                       | 覆盖 |
|-------------------------|-----------------------------------|-----------------------------------|---------------|--------------------------------------------|------|
| `SESSION_INJECT`        | `DAEMON_MSG_SESSION_INJECT`       | `daemon:session_inject`           | server→daemon | 向 active session 注入新 prompt（新 turn） | FR-02 |
| `SESSION_INTERRUPT`     | `DAEMON_MSG_SESSION_INTERRUPT`    | `daemon:session_interrupt`        | server→daemon | 打断当前 turn（SIGINT/codex turn interrupt），保留会话 | FR-04 |
| `SESSION_END`           | `DAEMON_MSG_SESSION_END`          | `daemon:session_end`              | server→daemon | 结束整个会话（kill 进程 + status=ended）   | FR-05 |
| `PERMISSION_REQUEST`    | `DAEMON_MSG_PERMISSION_REQUEST`   | `daemon:permission_request`       | daemon→server | 工具调用暂停，请求远程批准（manual_approval=true 时） | FR-07 |
| `PERMISSION_RESPONSE`   | `DAEMON_MSG_PERMISSION_RESPONSE`  | `daemon:permission_response`      | server→daemon | 对 permission_request 的批准/拒绝回写      | FR-07 |

**字符串规则**：
- 一律小写 + 下划线分词，前缀 `daemon:`。
- 与现有 `daemon:task_available` / `daemon:lease_claim` / `daemon:rpc` 风格一致。
- **不要**写成 `daemon:sessionInject` / `daemon:permission-request`（驼峰或连字符都会破坏对齐）。

### 4.2 Payload 字段定义

> 字段名一律 snake_case（与 backend Pydantic + JSON 一致；daemon TS 侧 payload 接口也用 snake_case，对齐 `types.ts` 既有约定——见 `ExecutionContextPayload` 同样 snake_case）。`session_id` / `lease_id` / `run_id` 为 UUID 字符串（JSON 层为 string；Pydantic 用 `uuid.UUID`，TS 用 `string`）。

#### SessionInjectPayload（server→daemon，对应 `MSG.SESSION_INJECT`）

| 字段       | 类型            | 必填 | 说明 |
|------------|-----------------|------|------|
| `session_id` | string (UUID)   | 是   | AgentSession.id，路由 sessionStore 的 key |
| `lease_id`   | string (UUID)   | 是   | 长生命周期 interactive lease.id（D-002），用于鉴权 + 提交 messages |
| `run_id`     | string (UUID)   | 是   | 本 turn 对应的新 AgentRun.id（每 turn 一个 run，D-005），daemon 据此 submit_messages |
| `prompt`     | string          | 是   | 用户本轮追问文本（非空，空串由 backend 拒绝） |

> design §7.1 原型 `{ session_id, lease_id, run_id, prompt }`。

#### SessionControlPayload（server→daemon，对应 `MSG.SESSION_INTERRUPT` 和 `MSG.SESSION_END` 共用）

| 字段       | 类型            | 必填 | 说明 |
|------------|-----------------|------|------|
| `session_id` | string (UUID)   | 是   | 目标 session |
| `lease_id`   | string (UUID)   | 是   | 鉴权用（与 sessionStore 记录的 leaseId 比对） |

> interrupt 和 end 不需要 run_id（作用于整个会话/进程而非单 turn）。design §7.1 原型 `{ session_id, lease_id }`。

#### PermissionRequestPayload（daemon→server，对应 `MSG.PERMISSION_REQUEST`）

| 字段         | 类型                  | 必填 | 说明 |
|--------------|-----------------------|------|------|
| `session_id`   | string (UUID)         | 是   | 触发权限请求的 session |
| `request_id`   | string                | 是   | 本次请求唯一标识（daemon 生成，UUID 或递增串），用于 RESPONSE 回填配对 |
| `tool_name`    | string                | 是   | 工具名（claude Bash/Read/Write、codex shell 等） |
| `input`        | object / string       | 是   | 工具入参（claude control_request 的 tool_input / codex approval 的 params），结构因 provider 而异，backend 透传给前端 |

> `input` 字段在 backend 用 `dict`，TS 侧用 `Record<string, unknown> | string`（codex 可能传字符串化 JSON）。design §7.1 原型 `{ session_id, request_id, tool_name, input }`。

#### PermissionResponsePayload（server→daemon，对应 `MSG.PERMISSION_RESPONSE`）

| 字段         | 类型            | 必填 | 说明 |
|--------------|-----------------|------|------|
| `session_id`   | string (UUID)   | 是   | 回写目标 session |
| `request_id`   | string          | 是   | 与 REQUEST 配对的标识（daemon 据此找到 pending 的 control_request 回写 stdin） |
| `decision`     | `'allow' \| 'deny'` | 是   | 批准/拒绝；allow → daemon writeControlResponse(allow)，deny → writeControlResponse(deny) |

> design §7.1 原型 `{ session_id, request_id, decision: 'allow'|'deny' }`。`decision` 是字符串字面量联合，不要写成 boolean（更可读 + 易扩展 `modify` 等决策）。

### 4.3 方向性注释

protocol.ts / protocol.py 每个新增常量都要写 JSDoc / docstring 标注方向（server→daemon / daemon→server），延续现有 `MSG.RPC` 注释风格（见 `protocol.ts:38-63` 的详细注释块）。这避免后续 task-03/04 实现时方向搞反。

## 5. 完成标准（Definition of Done）

- [ ] `sillyhub-daemon/src/protocol.ts` 新增 5 个 MSG 常量，值与 §4.1 字符串逐字相等。
- [ ] `sillyhub-daemon/src/protocol.ts` 或 `types.ts` 新增 4 个 payload 类型（SessionInjectPayload / SessionControlPayload / PermissionRequestPayload / PermissionResponsePayload）。
- [ ] `backend/app/modules/daemon/protocol.py` 新增 5 个 `DAEMON_MSG_*` 常量 + 4 个 Pydantic `BaseModel`，字段名/类型与 TS 对端逐字对齐。
- [ ] `sillyhub-daemon/tests/protocol.contract.test.ts` 新增 5 条断言（每条 `expect(MSG.X).toBe('daemon:xxx')`），更新「全部 N 个 MSG 以 daemon: 为前缀」的计数断言。
- [ ] `cd sillyhub-daemon && pnpm test` 通过（vitest）。
- [ ] `cd backend && uv run pytest` 通过（Pydantic 模型可 import + 序列化测试，若有 protocol 相关 pytest 则一并跑）。
- [ ] **契约对齐铁律**：任一端字符串/字段名漂移 → daemon 契约单测失败（这是本任务的核心产出）。
- [ ] **未知 type 静默丢弃**：ws-client `_handleMessage` 对不在分发表里的 type 不抛错、不断连（本任务只声明规则，不实现路由；实现由 task-03 落地）。当前 ws-client `_handleMessage:337-370` 已具备该语义（未知 type 走 `onMessage` 兜底），task-03 在 daemon.ts 分派时延续"未命中分支静默 warn"约定。

## 6. 实现步骤（编号顺序）

> 总原则：**先 backend `protocol.py` 后 daemon `protocol.ts`**，原因同现有 RPC 契约（`protocol.ts` 注释里写"期望值硬编码自 backend protocol.py"）—— backend 是协议字符串的权威源。

1. **读 backend 现状对齐字段类型**：确认 `protocol.py` 已有的 `uuid.UUID` / `datetime` / `dict | None` 风格，新 payload 模型沿用同样 import（`from __future__ import annotations` + `uuid` + `pydantic.BaseModel`）。
2. **backend `protocol.py` 追加常量**：在现有 `# Server → Daemon` / `# Daemon → Server` 分组下分别追加（注意 PERMISSION_REQUEST 属于 daemon→server，PERMISSION_RESPONSE 属于 server→daemon，分组要放对）：
   ```python
   # Server → Daemon（追加到现有 RPC 之后）
   DAEMON_MSG_SESSION_INJECT = "daemon:session_inject"
   DAEMON_MSG_SESSION_INTERRUPT = "daemon:session_interrupt"
   DAEMON_MSG_SESSION_END = "daemon:session_end"
   DAEMON_MSG_PERMISSION_RESPONSE = "daemon:permission_response"

   # Daemon → Server（追加到现有 RPC_RESULT 之后）
   DAEMON_MSG_PERMISSION_REQUEST = "daemon:permission_request"
   ```
3. **backend `protocol.py` 追加 Pydantic payload 模型**（4 个 BaseModel，字段顺序与 §4.2 一致）：
   ```python
   class SessionInjectPayload(BaseModel):
       session_id: uuid.UUID
       lease_id: uuid.UUID
       run_id: uuid.UUID
       prompt: str

   class SessionControlPayload(BaseModel):
       """Shared payload for session_interrupt and session_end."""
       session_id: uuid.UUID
       lease_id: uuid.UUID

   class PermissionRequestPayload(BaseModel):
       session_id: uuid.UUID
       request_id: str
       tool_name: str
       input: dict | str  # claude tool_input(dict) / codex params(可能 str)

   class PermissionResponsePayload(BaseModel):
       session_id: uuid.UUID
       request_id: str
       decision: str  # "allow" | "deny"
   ```
   - `decision` 用 `str` + docstring 约束（Pydantic v2 的 `Literal["allow","deny"]` 也可，但与现有 `status: str` 风格保持一致，先用 str）。
4. **daemon `protocol.ts` 追加 MSG 常量**（与 backend 逐字对齐，附 JSDoc 方向注释）：
   ```typescript
   // 追加到 MSG 对象内 RPC_RESULT 之后
   /** Server → Daemon：向 active session 注入新 prompt（新 turn）。FR-02 */
   SESSION_INJECT: 'daemon:session_inject',
   /** Server → Daemon：打断当前 turn（SIGINT/codex turn interrupt），保留会话。FR-04 */
   SESSION_INTERRUPT: 'daemon:session_interrupt',
   /** Server → Daemon：结束整个会话（kill + status=ended）。FR-05 */
   SESSION_END: 'daemon:session_end',
   /** Daemon → Server：工具调用暂停，请求远程批准（manual_approval=true）。FR-07 */
   PERMISSION_REQUEST: 'daemon:permission_request',
   /** Server → Daemon：对 permission_request 的批准/拒绝回写。FR-07 */
   PERMISSION_RESPONSE: 'daemon:permission_response',
   ```
5. **daemon payload 类型落点决策**：放 `types.ts`（与现有 `LeasePayload` / `ExecutionContextPayload` 同文件，便于跨文件复用）。新增 4 个 interface，字段名 snake_case 与 backend Pydantic 对齐：
   ```typescript
   // types.ts 追加（与 §4.2 字段一致，此处省略重复，实现时按表落地）
   export interface SessionInjectPayload { session_id: string; lease_id: string; run_id: string; prompt: string; }
   export interface SessionControlPayload { session_id: string; lease_id: string; }
   export interface PermissionRequestPayload { session_id: string; request_id: string; tool_name: string; input: Record<string, unknown> | string; }
   export interface PermissionResponsePayload { session_id: string; request_id: string; decision: 'allow' | 'deny'; }
   ```
   - TS 侧 `decision` 用字面量联合（比 backend 严格，TS 编译期保证）。
6. **更新契约单测 `protocol.contract.test.ts`**：
   - 在「Server → Daemon 消息」it 块追加 3 条断言（SESSION_INJECT / SESSION_INTERRUPT / SESSION_END）+ PERMISSION_RESPONSE（也是 server→daemon）。
   - 在「Daemon → Server 消息」it 块追加 PERMISSION_REQUEST。
   - 更新「全部 N 个 MSG 以 daemon: 为前缀」的注释/计数（从 8 改为 13，或改为不写死数字只校验全部前缀——当前断言不绑定数字，仅注释提到 8，更新注释即可）。
7. **跑测试验证**：
   - `cd sillyhub-daemon && pnpm test -- protocol.contract`（快速验证契约单测）。
   - `cd sillyhub-daemon && pnpm typecheck`（确保新 payload 类型可被 import 且不破坏现有类型推导）。
   - `cd backend && uv run pytest tests/... -k protocol` 或全量（确保 Pydantic 模型可 import）。
8. **对照 §5 完成标准逐项打勾**。

## 7. 测试要点

### 7.1 daemon 侧契约单测（核心）

**文件**：`sillyhub-daemon/tests/protocol.contract.test.ts`

**新增断言**（参照现有 RPC/LEASE_COMPLETE 写法）：

```typescript
describe('protocol.MSG — session/permission 控制消息（task-02 新增）', () => {
  it('Server → Daemon 控制消息', () => {
    expect(MSG.SESSION_INJECT).toBe('daemon:session_inject');
    expect(MSG.SESSION_INTERRUPT).toBe('daemon:session_interrupt');
    expect(MSG.SESSION_END).toBe('daemon:session_end');
    expect(MSG.PERMISSION_RESPONSE).toBe('daemon:permission_response');
  });

  it('Daemon → Server 控制消息', () => {
    expect(MSG.PERMISSION_REQUEST).toBe('daemon:permission_request');
  });

  it('全部新增 MSG 仍以 daemon: 为前缀', () => {
    // 现有断言已覆盖全部 MSG，无需重复；若注释提到具体数字则更新为 13
    const vals = Object.values(MSG);
    expect(vals.length).toBeGreaterThanOrEqual(13);
    for (const v of vals) {
      expect(v.startsWith('daemon:')).toBe(true);
    }
  });
});
```

**类型守卫断言**（可选，延续现有「编译期字面量」it 块）：

```typescript
it('新增 MSG 是字面量联合', () => {
  const x: 'daemon:session_inject' = MSG.SESSION_INJECT;
  expect(x).toBe(MSG.SESSION_INJECT);
});
```

### 7.2 payload 序列化一致性（可选但推荐）

由于 daemon 是 TS、backend 是 Pydantic，序列化默认行为差异点：
- UUID：backend `uuid.UUID` 序列化为 string（Pydantic v2 默认 `mode="python"` 给 UUID 对象，`mode="json"` 给 string）；daemon 全用 string。**单测时 backend 侧用 `model_dump(mode="json")` 验证产出的是 string**。
- null 字段：本任务 4 个 payload 无可选字段（全部必填），规避 null 序列化分歧。
- `input` 字段：backend `dict | str`，TS `Record<string, unknown> | string`——确保 daemon 接收时按 `typeof input === 'string'` 分支处理（实现细节由 task-08 落地，本任务仅在类型上预留）。

**若新增 backend pytest**：`backend/tests/modules/daemon/test_protocol_contract.py` 可加：
```python
def test_session_inject_payload_serializes_uuid_as_string():
    p = SessionInjectPayload(
        session_id=uuid.uuid4(), lease_id=uuid.uuid4(),
        run_id=uuid.uuid4(), prompt="hi",
    )
    dumped = p.model_dump(mode="json")
    assert isinstance(dumped["session_id"], str)
    assert dumped["prompt"] == "hi"
```

（当前 backend 无 protocol 契约 pytest，本任务可不强求新增，daemon 侧单测已覆盖字符串对齐；backend 侧序列化测试若加则放 `backend/tests/modules/daemon/`。）

### 7.3 不验证的内容（划界）

- **不**测 ws-client 对 SESSION_INJECT 的路由（task-03）。
- **不**测 backend ws_hub.send_session_control（task-04）。
- **不**测 stream-json / json-rpc 的 control_request 暂停往返（task-08）。
- 本任务只锁**字符串 + payload 形状**。

## 8. 风险与注意事项

| 风险 | 等级 | 应对 |
|------|------|------|
| **R-02 协议字符串漂移**：两端字符串/字段名不一致导致 task-03/04 实现时对不上 | P0 | 本任务核心产出即契约单测，任一端改字符串/字段名立即失败；JSDoc + docstring 双向标注权威源是 backend |
| **字段名大小写/分隔符**：误用 `sessionId`（camelCase）或 `session-id`（kebab）破坏对齐 | P1 | 全部 snake_case，与现有 `runtime_id` / `lease_id` / `agent_run_id` 风格一致；types.ts 的 `ExecutionContextPayload` 已是 snake_case 先例 |
| **payload 类型落点漂移**：放 protocol.ts 还是 types.ts 不一致 | P2 | 决策：常量留 protocol.ts（延续现有风格），payload 接口放 types.ts（延续 `LeasePayload`/`ExecutionContextPayload` 落点） |
| **Pydantic UUID 序列化模式**：`model_dump()` vs `model_dump(mode="json")` 产出 UUID 对象 vs string | P1 | daemon 侧全 string 接收，backend 发送时统一用 `mode="json"`；契约单测若加则断言 string |
| **未知 type 静默丢弃约束**：design §9 要求 daemon 不识别新 type 时不崩溃，本任务只声明规则不实现 | P1 | 在 protocol.ts 注释块顶部追加一句"ws-client 对未识别的 MSG.X 静默 warn 不断连（task-03 实现）"；现有 `_handleMessage:337-370` 已具备兜底语义，task-03 在 daemon.ts 分派时延续 |
| **覆盖现有 RPC 注释**：误删 protocol.ts 顶部跨文件对照清单 | P2 | 只追加不删除；顶部注释块的对照路径（protocol.py / daemon.py / router.py / main.py）保持不变 |
| **decision 字段扩展性**：未来可能加 `modify`（修改后批准） | P2 | TS 用 `'allow' \| 'deny'` 字面量联合便于扩展；backend 用 str + docstring 约束，后续加 Literal 不破坏序列化 |

## 9. 与其他任务的接口边界

- **→ task-03（daemon session 侧）**：task-03 在 `daemon.ts` 的消息分派里消费 `MSG.SESSION_INJECT/INTERRUPT/END`，在 `session-store.ts` 实现 inject/interrupt/end。本任务只提供常量 + payload 类型。
- **→ task-04（backend session 侧）**：task-04 在 `ws_hub.send_session_control` 用 `DAEMON_MSG_SESSION_INJECT` 等 server→daemon 推送；在 WS 接收路径处理 `DAEMON_MSG_PERMISSION_REQUEST`。本任务只提供常量 + Pydantic 模型。
- **→ task-07/08（权限暂停往返）**：task-07 把 manual_approval 开关两端接通（用 PERMISSION_REQUEST/RESPONSE 常量）；task-08 在 stream-json/json-rpc 升级 control_request。本任务的 PERMISSION_* 常量 + payload 是它们的契约基础。
- **← task-01（数据模型）**：task-01 落地 `agent_sessions.id` / `daemon_task_leases.id` / `agent_runs.id`，本任务 payload 的 `session_id`/`lease_id`/`run_id` 字段语义和命名依赖 task-01 的列名。若 task-01 列名调整，本任务 payload 字段名需同步（契约单测不覆盖列名，由 task-01 自己的模型单测保证）。

## 10. 自检清单（对照 CLAUDE.md 流程）

- [x] 文档先行：本蓝图即文档，依据 design.md §7.1 + plan.md task-02。
- [x] 读现有代码：已 Read `protocol.ts` / `types.ts` / `protocol.py` / `protocol.contract.test.ts` / `model.py` / `ws-client.ts`。
- [ ] 写测试：§7 已规划契约单测断言（execute 阶段落地）。
- [ ] 写实现：§6 步骤已规划两端常量 + payload（execute 阶段落地）。
- [ ] 跑测试：§5 列出 `pnpm test` + `uv run pytest` 命令。
- [ ] 对照文档验收：§5 完成标准逐项可勾。
