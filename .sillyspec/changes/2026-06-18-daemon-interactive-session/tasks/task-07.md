---
author: qinyi
created_at: 2026-06-18 15:31:03
change: 2026-06-18-daemon-interactive-session
id: task-07
title: 当前 turn 的 manual_approval 与 permission request/response 传输闭环
wave: W3
priority: P1
depends_on: [task-02, task-03, task-04]
blocks: [task-08, task-11]
requirement_ids: [FR-07]
decision_ids: [D-002@v2]
allowed_paths:
  - sillyhub-daemon/src/active-turn-permissions.ts
  - sillyhub-daemon/src/task-runner.ts
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/src/types.ts
  - sillyhub-daemon/tests/active-turn-permissions.test.ts
  - sillyhub-daemon/tests/daemon-permission-route.test.ts
  - backend/app/modules/daemon/schema.py
  - backend/app/modules/daemon/router.py
  - backend/app/modules/daemon/service.py
  - backend/app/modules/daemon/ws_hub.py
  - backend/app/modules/daemon/tests/test_session_permissions.py
  - backend/app/modules/daemon/tests/test_ws.py
---

# task-07 — 当前 turn 的 permission 传输闭环

> 依据：`plan.md` task-07；`requirements.md` FR-07；`design.md` §5 Wave 2、§7.1、§9；`decisions.md` D-002@v2；task-02 的 `PERMISSION_REQUEST` / `PERMISSION_RESPONSE` 协议；task-03 的 spawn + resume 与“每个 turn 结束即释放进程”约束；task-04 的 AgentSession、interactive lease 与 REST/service 边界。
>
> 关键修正：permission 只属于**当前 turn 的短生命周期进程**。本任务不得把 adapter、child、stdin、readline 或 resolver 塞入 `SessionState` 跨 turn 保存；每轮 `runTurn` 退出时必须清理该轮全部 pending permission。远程暂停以及 Claude/Codex 协议级 allow/deny 写回由 task-08 实现，本任务只建立开关传播、当前 turn 关联、daemon/backend 双向传输和清理契约。

## 1. 目标

1. 将 `AgentSession.config.manual_approval` 从 backend interactive claim payload 传入 daemon 当前 session/turn；缺失或非 `true` 一律视为 `false`。
2. 建立 daemon → backend 的 `daemon:permission_request` 上行链路，以及 backend → daemon 的 `daemon:permission_response` 下行链路。
3. 使用 daemon 生成的、跨进程/跨 turn 唯一的 wire `request_id` 关联请求和响应，避免 Codex 每个新 app-server 进程重新从相同 JSON-RPC id 起步造成串轮误批。
4. pending resolver 只保存在当前活动 turn 注册表；`result`、`turn/completed`、失败、超时、interrupt、end 或 spawn 异常均在 `runTurn` 的 `finally` 中清理。
5. `manual_approval=false`（默认）时不注册 pending、不发送 permission WS 消息，保留现有 Claude `allow` / Codex `accept` 自动批准行为。
6. 为 task-08 提供 provider 无关的当前 turn permission hook；task-08 再负责识别 control_request/approval 和构造 provider-specific response。

## 2. 当前源码与上游任务契约

实现前必须用 `rg` 再确认下表方法存在；源码变化时先更新本文档，禁止按旧行号编造接口。

| 事实 | 源码/任务锚点 | 本任务用法 |
|---|---|---|
| daemon WS 出站 | `sillyhub-daemon/src/ws-client.ts`：`send(msg): boolean` | 复用现有 envelope，不新增第二套 socket |
| daemon WS 入站 | `daemon.ts`：`_handleWsMessage`；task-03 增加 session control 路由 | 增加 `PERMISSION_RESPONSE` 分支，未知/迟到响应只 warn |
| backend WS 入站 | `backend/app/modules/daemon/router.py`：`websocket.receive_json()` 循环 | 增加 `PERMISSION_REQUEST` 分支并调用 service；router 不直接查写 ORM |
| backend WS 出站 | `DaemonWsHub.send_to_runtime()`；task-04 增加 `send_session_control()` | response 复用 hub 单 runtime 定向发送 |
| 会话配置 | task-01 `AgentSession.config`；task-04 `create_session(... manual_approval=False)` | config 写库并进入 interactive claim payload，daemon 只接受严格布尔 `true` |
| turn 生命周期 | task-03 `SessionStore.startTurn()` + `TaskRunner.runTurn()` | currentRunId 是归属真值；resolver 不进入 SessionState |
| 单 turn 进程释放 | task-03：每轮完成后 stdin.end、等待 child exit、释放 adapter | pending permission 必须在同一 finally 中同步关闭 |
| 协议常量 | task-02 `MSG.PERMISSION_*` / Python `DAEMON_MSG_PERMISSION_*` | 不修改消息名和 `{session_id, request_id, ...}` payload |

## 3. 范围与责任边界

### 3.1 本任务修改

| 操作 | 文件 | 责任 |
|---|---|---|
| 新增 | `sillyhub-daemon/src/active-turn-permissions.ts` | 当前 turn pending registry、唯一 wire request id、resolve/close 语义 |
| 修改 | `sillyhub-daemon/src/types.ts` | provider 无关 permission hook/result 类型；不放进持久化 SessionState |
| 修改 | `sillyhub-daemon/src/task-runner.ts` | 每个 interactive `runTurn` 建立/关闭 permission scope；默认 false 不启用 |
| 修改 | `sillyhub-daemon/src/daemon.ts` | 将 session/config/currentRun 绑定到 scope；上发 request；路由 response |
| 修改 | `backend/app/modules/daemon/schema.py` | 用户 response DTO 与 request event DTO |
| 修改 | `backend/app/modules/daemon/router.py` | WS 上行 request 分支 + 用户 response REST endpoint |
| 修改 | `backend/app/modules/daemon/service.py` | runtime/session/current run 校验、session SSE publish、response 下发 |
| 修改 | `backend/app/modules/daemon/ws_hub.py` | 定向发送 permission response 的薄封装 |
| 新增/修改 | 表列测试文件 | daemon registry/路由与 backend service/router/WS 契约测试 |

### 3.2 非目标（明确不做）

- 不在本任务解析 Claude `control_request` 或 Codex approval 方法；task-08 负责。
- 不在本任务写 Claude `control_response` 或 Codex JSON-RPC response；task-08 负责。
- 不实现前端批准弹窗、队列或历史页面；task-11 负责。
- 不新增 permission 数据库表，不把 resolver/adapter/stdin 持久化到 AgentSession 或 SessionStore。
- 不改变 batch lease、run 级 SSE、现有 RPC、heartbeat、claim/start/complete 行为。
- 不等待下一 turn 复用旧 pending；turn 结束即作废，迟到响应不得写入新进程。

## 4. 精确接口

### 4.1 manual_approval 传播

task-04 的 interactive lease metadata/claim payload 必须包含 session 配置的只读副本：

```json
{
  "kind": "interactive",
  "agent_session_id": "<platform session uuid>",
  "session_config": {
    "manual_approval": false,
    "model": "..."
  }
}
```

daemon 归一化规则：

```typescript
const manualApproval = rawConfig.manual_approval === true;
```

- 缺失、`null`、`0`、`1`、`"true"` 均不得开启 manual 模式。
- `SessionState.config` 只保存 JSON 元数据；不保存 pending map、callback 或流对象。
- 后续 turn 复用 session 创建时已固定的 config；inject payload 不重复携带或覆盖开关。

### 4.2 当前 turn registry

新增 provider 无关、内存态、不可持久化的注册表：

```typescript
export type PermissionDecision = 'allow' | 'deny';

export interface ProviderPermissionRequest {
  providerRequestId: string;
  toolName: string;
  input: Record<string, unknown> | string;
  respond(decision: PermissionDecision): Promise<void> | void;
}

export interface ActiveTurnPermissionScope {
  readonly sessionId: string;
  readonly leaseId: string;
  readonly runId: string;
  readonly manualApproval: boolean;

  request(input: ProviderPermissionRequest):
    | { mode: 'auto' }
    | { mode: 'pending'; requestId: string };
  close(reason: 'completed' | 'failed' | 'timeout' | 'interrupted' | 'ended'): number;
}

export type PermissionResolveResult =
  | 'resolved'
  | 'unknown_request'
  | 'stale_turn'
  | 'session_mismatch';

export class ActiveTurnPermissionRegistry {
  open(input: {
    sessionId: string;
    leaseId: string;
    runId: string;
    manualApproval: boolean;
    sendRequest(payload: PermissionRequestPayload): boolean;
  }): ActiveTurnPermissionScope;

  resolve(payload: PermissionResponsePayload): Promise<PermissionResolveResult>;
  closeTurn(sessionId: string, runId: string, reason: string): number;
}
```

强制语义：

1. `requestId` 是 daemon 生成的全局唯一 opaque id（推荐 `crypto.randomUUID()`），不能直接暴露 `providerRequestId`。registry 内部保存 `{requestId, providerRequestId, sessionId, runId, respond}`。
2. `manualApproval=false` 时 `request()` 返回 `{mode:'auto'}`，不保存 responder、不调用 `sendRequest`。task-08 收到该结果后继续执行现有自动批准分支。
3. `manualApproval=true` 时先注册 pending，再发 WS；若 `sendRequest()` 返回 false，立即删除 pending 并抛/返回明确失败，不能让当前进程无限等待一个未上送的请求。
4. `resolve()` 只命中仍在 active registry 且 sessionId 一致的 wire request；先原子删除，再调用一次 `respond`，保证重复 response 不会执行两次。
5. `closeTurn()` 只清理指定 `sessionId + runId`；不得清理其他 session 并发 turn。
6. registry 不是 `SessionState` 字段，不进入 task-09 sessions.json；它只存在于 daemon 进程中正在运行的 turn。

### 4.3 TaskRunner/daemon 生命周期接线

task-03 的 `runTurn` 增加可选、仅 interactive 使用的 hook：

```typescript
export interface InteractiveTurnHooks {
  permissions?: ActiveTurnPermissionScope;
}

class TaskRunner {
  runTurn(ctx: LeaseCtx, hooks?: InteractiveTurnHooks): Promise<TaskRunnerResult>;
}
```

固定顺序：

1. daemon 从 `SessionStore.get(sessionId)` 读取 `currentRunId`、leaseId、config，调用 registry `open()`。
2. scope 仅传给本次 `runTurn`，不得写回 SessionState/baseCtx 或缓存到下一 turn。
3. task-08 的 adapter 通过本 turn hook 调 `scope.request()`。
4. `runTurn` 无论从正常 result、turn/completed、spawn error、parse error、timeout、AbortController、interrupt/end 哪条路径退出，都在最外层 `finally` 调 `scope.close(reason)`。
5. close 完成后才允许 `SessionStore` 清空 currentRunId/回 active 或删除 session；迟到 response 因 registry 已无 entry 被忽略。

### 4.4 daemon → backend permission_request

沿用 task-02 payload，不增加第二个协议版本：

```json
{
  "type": "daemon:permission_request",
  "payload": {
    "session_id": "<platform session uuid>",
    "request_id": "<daemon opaque uuid>",
    "tool_name": "Bash",
    "input": {"command": "..."}
  }
}
```

- `request_id` 已隐式绑定 daemon registry 的 current `runId`；backend 不得改写。
- daemon 日志只记录 session_id/run_id/request_id/tool_name，不记录完整 input、prompt、token 或凭证。
- send=false 时 registry 立即撤销该 pending；task-08 将当前 turn 收敛为失败，不自动 allow。

### 4.5 backend 上行处理与前端事件

```python
@dataclass(frozen=True, slots=True)
class PermissionRequestDispatch:
    session_id: uuid.UUID
    run_id: uuid.UUID
    request_id: str
    tool_name: str

class DaemonService:
    async def handle_permission_request(
        self,
        runtime_id: uuid.UUID,
        payload: PermissionRequestPayload,
    ) -> PermissionRequestDispatch: ...
```

校验顺序：

1. Pydantic 解析 task-02 `PermissionRequestPayload`；非法 payload 只拒绝该消息，不断开 WS。
2. 查询 AgentSession；必须存在、`status='active'`、`runtime_id` 与当前 WS `rid` 一致、`config.manual_approval is True`。
3. 查询该 session 当前唯一非终态 AgentRun（沿用 task-04 `_get_current_run`）；必须存在且状态为 `pending|running|pending_approval`。
4. publish 到 task-05 session channel `agent_session:{session_id}`：

```json
{
  "event": "permission_request",
  "session_id": "...",
  "run_id": "...",
  "request_id": "...",
  "tool_name": "Bash",
  "input": {"command": "..."}
}
```

5. Redis publish 失败记录结构化 error；不能伪装已通知用户。task-08 决定当前 turn 的失败收敛策略，不在 WS router 吞异常继续永久暂停。

本任务不新建 permission 表；request 的有效性最终以 daemon 当前 turn registry 为准。

### 4.6 用户 response REST 与 server → daemon

```python
class PermissionResponseRequest(BaseModel):
    decision: Literal["allow", "deny"]

class PermissionResponseRead(BaseModel):
    session_id: uuid.UUID
    request_id: str
    accepted: bool

class DaemonService:
    async def respond_permission(
        self,
        user_id: uuid.UUID,
        session_id: uuid.UUID,
        request_id: str,
        decision: Literal["allow", "deny"],
    ) -> PermissionResponseRead: ...
```

路由：

```text
POST /api/daemon/sessions/{session_id}/permissions/{request_id}/response
body: {"decision":"allow"|"deny"}
```

- 使用与 task-04 session 控制端点相同的 `Permission.TASK_RUN_AGENT` 鉴权，并校验 `AgentSession.user_id == user.id`。
- service 校验 session active、runtime_id/lease_id/current run 存在后，调用 hub：

```python
async def send_permission_response(
    self,
    runtime_id: uuid.UUID,
    payload: PermissionResponsePayload,
) -> bool: ...
```

- WS payload 严格为 task-02 `{session_id, request_id, decision}`。
- daemon 离线或发送失败返回稳定 503/504 错误，不返回假成功。
- 后端无法仅凭数据库证明 request 仍 pending；daemon `resolve()` 是最终防线。迟到/重复 response 到 daemon 后返回 `unknown_request` 并 warn，不得影响新 turn。

## 5. 边界条件（必须全部覆盖）

1. **默认关闭**：manual_approval 缺失/false/非法类型时不注册 pending、不发 permission_request，现有自动 allow/accept 零变化。
2. **Codex id 跨 turn 重复**：两个新进程都产生 provider rpc id=`1`，wire request_id 必须不同；第一轮迟到 response 不得批准第二轮。
3. **正常 turn 完成时仍有 pending**：finally 删除全部 resolver；其后 response 返回 unknown/stale，不写已关闭 stdin。
4. **interrupt/end 与 response 竞态**：删除 pending 与 resolve 必须单次生效；最多调用 responder 一次，ended session 不被复活。
5. **spawn/handshake/parse 异常**：即使 adapter 尚未完全初始化，scope 也必须关闭，不残留 callback/stream 引用。
6. **permission WS 上送失败**：撤销刚注册 entry，当前 turn 走明确失败；不得自动批准，也不得无限 hang。
7. **重复 response**：第一条原子消费，第二条 unknown；provider stdin/RPC response 只写一次。
8. **错误 session_id + 正确 request_id**：返回 session_mismatch，不消费正确 pending。
9. **backend runtime 冒用**：WS runtime A 上报绑定 runtime B 的 session，拒绝且不 publish 前端事件。
10. **manual=false session 上报 request**：backend 拒绝/记录协议违约，不向前端制造无法响应的事件。
11. **无 current run**：backend 不 publish；daemon 若本地 turn 已退出则 request 已被 close。
12. **session 已 ended/failed**：request/response 均拒绝；不得向旧 runtime 发消息。
13. **Redis publish 失败**：错误可观察，不记录敏感 input；不能把“未送达前端”当成功闭环。
14. **不同 session 并发**：registry、backend 校验与响应按 session 隔离，不用全局串行锁。
15. **同一 turn 多个请求**：每个 wire id 独立；可乱序响应，各 responder 恰好一次。
16. **input 形态**：dict/string 均原样传输；日志只含 tool_name 和关联 id。
17. **batch lease**：没有 permission scope；现有 adapter 自动批准和 TaskRunner 测试不变。
18. **daemon 重连**：内存 pending 不恢复；当前 turn 随断线失败/清理，禁止把旧 resolver 写入 task-09 持久化文件。

## 6. TDD 实施顺序

必须保留至少一次目标测试按预期失败的证据，再写最小实现。

### Step 1：registry 单元测试（Red）

新增 `active-turn-permissions.test.ts`：

- manual=false 返回 auto 且 send/respond 均未调用；
- manual=true 生成 opaque wire id，两个相同 providerRequestId 得到不同 wire id；
- resolve 正确 decision，重复 resolve 不重复 responder；
- session mismatch 不消费 entry；
- closeTurn 清空指定 run 且不影响其他 session；
- send=false 回滚 pending；
- close/resolve 竞态最多一次 responder。

确认因模块不存在而失败，再实现 registry。

### Step 2：daemon 当前 turn 接线（Red → Green）

新增 `daemon-permission-route.test.ts` 并扩展 task-runner turn 测试：

- session config strict boolean 归一化；
- permission request 使用 `wsClient.send` 发 task-02 envelope；
- PERMISSION_RESPONSE 路由到 registry；未知/迟到响应只 warn；
- 正常、失败、timeout、interrupt、end 五条退出路径都 close 当前 run scope；
- SessionState 对象 key 不包含 pendingPermissions/adapter/stdin/respond；
- batch run 不创建 scope。

实现最小接线，暂不改 adapter 自动审批逻辑。

### Step 3：backend WS 上行与 service 校验（Red → Green）

新增/扩展 `test_ws.py`、`test_session_permissions.py`：

- 合法 request 调 service 并 publish session channel，事件带 current run_id；
- 非法 payload不关闭 WS；
- runtime mismatch、manual=false、ended、无 current run 均不 publish；
- Redis 失败被记录并暴露明确失败路径；
- 日志断言不含 input 中的 secret。

router 只解析/分派；业务校验全部进入 service。

### Step 4：response REST 与 hub 下行（Red → Green）

- allow/deny 正例；
- 非法 decision 422；
- 非 session owner 404/403（沿项目既有资源隐藏策略）；
- session 非 active 409；
- hub 离线/发送失败映射稳定错误；
- payload 与 task-02 字段逐字一致；
- 重复 response 仍可到 daemon，但 daemon 只消费一次。

### Step 5：task-08 集成契约与回归

为 task-08 留出 hook contract 测试桩：manual=true adapter 将 provider request 注册到当前 scope；manual=false 保持原自动批准。task-08 落地前，本任务测试不得假装已实现 provider stdin 写回。

```powershell
Set-Location sillyhub-daemon
pnpm test -- active-turn-permissions daemon-permission-route
pnpm test -- task-runner-turn
pnpm typecheck
pnpm test

Set-Location ../backend
uv run pytest app/modules/daemon/tests/test_session_permissions.py -q
uv run pytest app/modules/daemon/tests/test_ws.py -q
uv run pytest app/modules/daemon/tests -q
```

## 7. 验收表

| ID | 验收条件 | 自动化证据 |
|---|---|---|
| AC-07-01 | `manual_approval=false`/缺失时不创建 pending、不发 permission WS，Claude/Codex 现有自动批准断言不变 | registry + adapter 既有回归 |
| AC-07-02 | manual=true 的 request 经 daemon WS → backend service → session SSE，事件含 session_id/run_id/request_id/tool_name/input | daemon 路由 + backend WS/service 测试 |
| AC-07-03 | 用户 allow/deny 经鉴权 REST → runtime WS → daemon 当前 turn registry，payload 与 task-02 一致 | router/service/hub + daemon 路由测试 |
| AC-07-04 | wire request_id 不直接复用 provider id；相同 Codex rpc id 跨 turn 不碰撞 | registry 唯一性测试 |
| AC-07-05 | result、turn/completed、失败、timeout、interrupt、end 后 pending 全清；迟到 response 不写旧进程 | 生命周期参数化测试 |
| AC-07-06 | SessionStore/持久化 SessionState 不含 child/stdin/adapter/resolver/pending map | 对象结构测试 + diff 审查 |
| AC-07-07 | runtime/session/user/manual/currentRun 校验失败时不 publish、不下发到错误 runtime | backend 反例测试 |
| AC-07-08 | 重复/错 session/stale response 最多消费一次，不影响当前或下一 turn | registry 并发/幂等测试 |
| AC-07-09 | WS/Redis 失败不会假成功或静默无限等待，日志不泄露 input/prompt/token | 故障注入 + 日志断言 |
| AC-07-10 | 不同 session 与同 turn 多 permission 可并发且相互隔离 | registry 并发测试 |
| AC-07-11 | batch lease、RPC、heartbeat、claim/start/complete 行为零变化 | daemon/backend 全量回归 |
| AC-07-12 | daemon typecheck/test 与 backend daemon 测试通过 | 命令输出 |

## 8. 对 task-08 的硬约束

1. task-08 只能把 provider request 注册到本任务的**当前 turn scope**；不得在 `SessionStore` 新增 `pendingPermissions`，不得保存 adapter/stdin 跨 turn。
2. task-08 的 responder 负责 provider-specific 映射：Claude allow/deny control_response；Codex approval accept/reject/elicitation action。registry 不拼协议 JSON。
3. manual=false 时 task-08 必须走现有直接自动批准路径，不能先注册再自动 resolve。
4. manual=true 时 task-08 若注册/上送失败，当前 turn 必须失败收敛；禁止为了“可用性”降级自动批准。
5. task-08 必须复用 wire request_id；前端/backend 不接触 providerRequestId。

## 9. 完成检查清单

- [ ] 写代码前重新读取 `.claude/CLAUDE.md`、daemon/backend CONVENTIONS 与 ARCHITECTURE。
- [ ] 用 `rg` 确认 `WsClient.send`、`DaemonWsHub.send_to_runtime`、task-03 `runTurn/currentRunId`、task-04 `_get_current_run` 与鉴权依赖真实存在。
- [ ] 记录 Red 失败证据，再做最小实现。
- [ ] 当前 turn finally 覆盖所有退出路径，且 close 发生在 session 回 active/删除之前。
- [ ] wire request id 全局唯一，不直接使用 provider rpc/control id。
- [ ] SessionState 和持久化 JSON 无进程/流/resolver 引用。
- [ ] 默认自动批准与 batch 路径回归通过。
- [ ] 对照 AC-07-01～AC-07-12 逐项记录证据。
