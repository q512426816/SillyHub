---
author: qinyi
created_at: 2026-06-18 15:31:03
change: 2026-06-18-daemon-interactive-session
id: task-08
title: "Claude/Codex 当前 turn 审批暂停与退出收敛"
wave: W4
priority: P1
depends_on: [task-03, task-07]
blocks: [task-11]
requirement_ids: [FR-07]
decision_ids: [D-002@v2]
allowed_paths:
  - sillyhub-daemon/src/adapters/protocol-adapter.ts
  - sillyhub-daemon/src/adapters/stream-json.ts
  - sillyhub-daemon/src/adapters/json-rpc.ts
  - sillyhub-daemon/src/task-runner.ts
  - sillyhub-daemon/src/session-store.ts
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/tests/adapters/stream-json-permission.test.ts
  - sillyhub-daemon/tests/adapters/json-rpc.test.ts
  - sillyhub-daemon/tests/task-runner-permission.test.ts
  - sillyhub-daemon/tests/session-store.test.ts
  - sillyhub-daemon/tests/daemon.test.ts
---

# Task-08｜Claude/Codex 当前 turn 审批暂停与退出收敛

## 1. 目标与设计约束

依据 `plan.md` task-08、全局验收第 6 条、`requirements.md` FR-07 与 `decisions.md` D-002@v2：

1. `manual_approval=true` 时，Claude `control_request`、Codex approval server request 必须暂停**当前 turn**，经 task-07 的 `permission_request/response` 通道取得远程 `allow/deny` 后再回写当前 child stdin。
2. pending permission 的生命周期严格小于等于当前 turn；`result`、`turn/completed`、interrupt、end、spawn error、child exit 任一发生时立即清理，绝不带到下一次 spawn/resume。
3. `SessionStore` 继续只持有 session/当前 run/内部 resume id 等元数据，不持有 child、stdin、adapter 或跨 turn responder。D-002@v2 禁止恢复旧蓝图中的“sessionStore 跨 turn 保存 stdin/adapter”。
4. `manual_approval=false`（默认）和 `kind=batch` 继续自动批准，不发 `PERMISSION_REQUEST`，行为零变化。
5. 仅支持 interactive Claude/Codex；不得把 permission 暂停扩展到其他 provider，不修改 backend REST、SSE 或前端 UI（分别由 task-07/task-11 负责）。

## 2. 覆盖来源

| 来源 | 本任务落实内容 |
|---|---|
| `plan.md` task-08 / Wave 4 | Claude/Codex 当前 turn 的 control_request 暂停、远程批准/拒绝、进程退出收敛 |
| `plan.md` 全局验收第 6 条 | `manual_approval=false` 行为不变；true 时审批绑定当前 turn，turn 结束即清理 |
| `requirements.md` FR-07 | daemon 发 `permission_request`，接收 `permission_response` 后按 allow/deny 回写 stdin |
| `decisions.md` D-002@v2 | 每 turn 独立 spawn + resume；不得把 child/stdin/pending responder 跨 turn 保存 |
| task-03 接口 | SessionStore 只保存元数据；TaskRunner 是当前 turn 进程及 stdin 的唯一所有者 |
| task-07 接口 | permission WS 上下行与 backend/frontend 通道已接通，本任务只消费 daemon 侧接口 |
| 当前源码 | `stream-json.ts` 自动 allow、`json-rpc.ts` approval pendingMap、`task-runner.ts` 的 stdin/退出收口 |

现有源码锚点：

- `stream-json.ts:736-814`：`handleControlRequest` 当前通过已注入 stdin 直接写 `behavior:'allow'`。
- `json-rpc.ts:48-54,343-378,659-667`：五类 approval 模板、`pendingMap`、`getPendingServerRequests/markResponded`。
- `task-runner.ts:676-935,974-1070`：spawn、stdin、逐行解析、`result/turn/completed` 关闭 stdin；这是每 turn 进程资源的唯一所有者。
- `task-runner.ts:187-250`：现有 lease 级 controller/cancel 注册表，可扩展当前 turn runtime，但不得建立跨 turn child 池。
- task-03：每次 `runTurn` 新 adapter + 新 child，turn 完成等待 child exit；SessionStore state 禁止出现进程/流字段。
- task-07：提供 permission WS 上下行及 daemon 收到 `PERMISSION_RESPONSE` 的路由入口。

## 3. 前置依赖与边界

| 依赖 | 本任务消费的稳定接口 | 未满足时处理 |
|---|---|---|
| task-03 | `SessionStore.get/startTurn/interrupt/end`、`TurnRunner.runTurn/cancel`、每 turn 新 spawn、`SessionState.currentRunId/config` | 阻塞，不得回退长驻进程 |
| task-07 | `sendPermissionRequest(payload)`、`onPermissionResponse(payload)` 或等价控制消息回调；payload 含 `session_id/request_id/tool_name/input/decision` | 阻塞，不在本任务重复实现 backend/REST/SSE |
| task-02 | daemon/backend 消息常量和 payload 类型逐字对齐 | 只 import，不另造字符串 |

本任务只修改 daemon。task-07 若最终 API 名与蓝图不同，先用 `rg` 确认真实方法，再按其已落地签名接入；禁止同时保留两套 permission 路由。

## 4. 涉及文件

| 操作 | 文件 | 责任 |
|---|---|---|
| 修改 | `sillyhub-daemon/src/adapters/protocol-adapter.ts` | 声明统一的 permission request/response 构造接口 |
| 修改 | `sillyhub-daemon/src/adapters/stream-json.ts` | Claude request 归一化；manual 时不自动写 stdin；按 allow/deny 构造 control_response |
| 修改 | `sillyhub-daemon/src/adapters/json-rpc.ts` | Codex approval 归一化；按 method 构造 accept/reject response；清理本 turn pendingMap |
| 修改 | `sillyhub-daemon/src/task-runner.ts` | 当前 turn pending registry、远程响应回写、所有退出路径清理 |
| 修改 | `sillyhub-daemon/src/session-store.ts` | 只增加 response 路由委托；不保存 pending responder/child/stdin/adapter |
| 修改 | `sillyhub-daemon/src/daemon.ts` | task-07 的 permission response 回调转发到 SessionStore |
| 修改 | `sillyhub-daemon/tests/adapters/stream-json-permission.test.ts` | Claude 自动/暂停/allow/deny 契约 |
| 修改 | `sillyhub-daemon/tests/adapters/json-rpc.test.ts` | Codex 五类 approval response 契约与清理 |
| 新增 | `sillyhub-daemon/tests/task-runner-permission.test.ts` | 当前 turn 闭环、竞态和退出清理 |
| 修改 | `sillyhub-daemon/tests/session-store.test.ts` | session/run 校验及 runner 委托测试（以 task-03 最终文件名为准） |

不修改 `backend/`、`frontend/`、session SSE 聚合及 session 数据模型。

## 5. 精确接口

### 5.1 Adapter 契约：只解析/构造，不拥有远程生命周期

在 `protocol-adapter.ts` 增加：

```typescript
export type PermissionDecision = 'allow' | 'deny';

export interface AdapterPermissionRequest {
  requestId: string;
  toolName: string;
  input: Record<string, unknown>;
}

export interface PermissionAwareAdapter {
  /** 每次 parse 后取出本行新产生的审批请求；读取即消费。 */
  takePermissionRequests(): AdapterPermissionRequest[];

  /** 根据本 turn 内已登记的原始 request 构造一行协议响应；未知/已清理返回 null。 */
  buildPermissionResponse(
    requestId: string,
    decision: PermissionDecision,
  ): string | null;

  /** turn finally 调用；清掉 adapter 内仅用于响应构造的原始请求。 */
  clearPermissionRequests(): void;
}
```

用类型守卫识别可审批 adapter；不把三个方法强制到 jsonl/ndjson/text。adapter 不发 WS、不决定 manual 模式、不保存跨 turn stdin。

### 5.2 Claude 映射

`StreamJsonAdapter.handleControlRequest` 不再直接决定批准：

- 解析 `request_id`、`request.tool_name`、`request.input`，登记到 adapter 本 turn map，并由 `takePermissionRequests()` 暴露。
- `buildPermissionResponse(id,'allow')` 返回现有 success control_response，`behavior:'allow'` 且 `updatedInput` 为原 input。
- `buildPermissionResponse(id,'deny')` 返回 success control_response，`behavior:'deny'`，不得携带伪造的 `updatedInput`。
- 构造成功后删除该 request；重复 response 返回 `null`。
- `attachStdin` 可暂时保留供兼容，但本任务后 response 写入统一由 TaskRunner 完成；删除 parse 内部 I/O，避免同一请求被写两次。

请求缺少有效 `request_id` 时不进入 pending、不发远程请求，产结构化 warn/error event；不得用空字符串作为 map key。

### 5.3 Codex 映射

复用 `PendingServerRequest`/`pendingMap`，仅已知五类 approval 进入 permission 流：

| method | allow result | deny result | tool_name/input |
|---|---|---|---|
| `item/commandExecution/requestApproval` | `{decision:'accept'}` | `{decision:'reject'}` | method / params |
| `execCommandApproval` | `{decision:'accept'}` | `{decision:'reject'}` | method / params |
| `item/fileChange/requestApproval` | `{decision:'accept'}` | `{decision:'reject'}` | method / params |
| `applyPatchApproval` | `{decision:'accept'}` | `{decision:'reject'}` | method / params |
| `mcpServer/elicitation/request` | `{action:'accept',content:null,_meta:null}` | `{action:'reject',content:null,_meta:null}` | method / params |

`buildPermissionResponse` 返回完整 JSON-RPC 2.0 response（保留原始 number/string id 类型）。未知 server request 继续走现有 error 路径，不得伪装成 permission；重复/迟到 response 返回 `null`。

### 5.4 TaskRunner：pending 只属于当前 turn

扩展 task-03 的 runner 接口：

```typescript
export interface PermissionResponseTarget {
  sessionId: string;
  runId: string;
  requestId: string;
  decision: PermissionDecision;
}

export type PermissionResolveResult =
  | 'resolved'
  | 'session_not_running'
  | 'stale_run'
  | 'request_not_found'
  | 'stdin_closed';

export interface TurnRunner {
  runTurn(ctx: LeaseCtx): Promise<TaskRunnerResult>;
  cancel(leaseId: string): Promise<boolean>;
  resolvePermission(target: PermissionResponseTarget): PermissionResolveResult;
}
```

TaskRunner 增加仅执行期存在的 registry：

```typescript
interface ActiveTurnPermissionState {
  sessionId: string;       // AgentSession.id；来自 interactive ctx
  runId: string;           // 当前 AgentRun.id
  manualApproval: boolean;
  stdin: NodeJS.WritableStream;
  adapter: PermissionAwareAdapter;
  pending: Set<string>;
}

private readonly _activeTurnPermissions =
  new Map<string, ActiveTurnPermissionState>(); // key = leaseId；同 session 同时最多一 turn
```

执行规则：

1. `runTurn` spawn 后，仅 `kind=interactive` 且 adapter 支持 permission 时注册 runtime；`sessionId` 使用 task-03 最终落地的 AgentSession id 字段（若 `LeaseCtx.agentSessionId`，不得与 `resumeSessionId` 混用），`runId=ctx.agentRunId`。
2. `_handleLine` 先 `adapter.parse(line)`，随后 `takePermissionRequests()`；每个请求按模式分流：
   - `manualApproval=false`：立即 `buildPermissionResponse(...,'allow')` 并写 stdin；不发 WS、不加入 `pending`。
   - `manualApproval=true`：加入当前 runtime.pending，再调用 task-07 `sendPermissionRequest({session_id,request_id,tool_name,input,run_id})`；不写 stdin，child 因等待协议响应而暂停。
3. `resolvePermission` 必须同时匹配 sessionId、runId、requestId，且 stdin 尚可写；匹配后只写一次并从 pending 删除。
4. send permission request 失败时立即 fail closed：本地写 deny（若可写）并删除 pending；不得静默 allow，也不得让 child 永久挂起。
5. `_spawnAndStream/runTurn` 的 `finally` 无条件调用 `cleanupTurnPermissions(leaseId)`：清 adapter map、清 runtime.pending、删除 registry；然后才允许 SessionStore 把 session 恢复 active/启动下一 turn。

### 5.5 SessionStore 与 daemon 路由

SessionStore 只做一致性校验和委托：

```typescript
respondPermission(input: {
  sessionId: string;
  requestId: string;
  decision: PermissionDecision;
  runId?: string;
}): PermissionResolveResult;
```

- session 必须存在且状态为 `running|interrupting`，`currentRunId` 必须存在。
- task-07 payload 若已有 `run_id`，必须等于 `currentRunId`；若协议最终未携带 run_id，则以收到时的 `currentRunId` 补齐，但 TaskRunner 仍校验自身 active runtime，防止旧 response 命中新 turn。
- daemon 的 `onPermissionResponse` 仅调用 `sessionStore.respondPermission` 并按结果结构化 warn；不得直接访问 TaskRunner 私有 map。
- SessionState 不新增 `pendingPermissions`，避免把旧 turn responder 带入 resume turn。

## 6. 边界条件（必须覆盖）

1. **默认模式**：manual 缺失/false 立即 allow；不发 permission WS。
2. **批处理兼容**：batch 即使 payload 意外带 manual=true 也按现有自动批准，不注册 active turn permission runtime。
3. **重复 response**：第一次写 stdin 并清理；第二次返回 `request_not_found`，不得重复执行工具。
4. **迟到 response 命中新 turn**：旧 run_id 与 currentRunId 不同返回 `stale_run`；不得批准新 turn 中同名/同 id 请求。
5. **interrupt/end 与 response 竞态**：cleanup 与 resolve 以“先删除/先消费”为原子边界；最多一次 stdin.write，之后返回非 resolved。
6. **child 自然/异常退出**：无论 exit code、spawn error、parse error、result 或 turn/completed，finally 后 registry 和 adapter pending 都为空。
7. **WS 发送失败**：fail closed 写 deny；若 stdin 已关闭则只清理并记录 `stdin_closed`，不得遗留 pending。
8. **stdin BrokenPipe/destroyed**：捕获同步 throw 和 callback error，清 pending，不让 `runTurn` 因审批回写二次失败覆盖原始退出结果。
9. **无效 request_id**：不使用空 key、不发远程请求；记录可观察错误。
10. **多个 pending**：同一 turn 可并存多个不同 request_id，响应乱序各自正确；重复 id 后到者不得覆盖前者。
11. **Codex id 类型**：number/string 均原样回写；不得强转导致 JSON-RPC correlation 失效。
12. **拒绝语义差异**：四类 Codex approval 用 `decision:'reject'`，elicitation 用 `action:'reject'`；Claude 用 `behavior:'deny'`。

## 7. TDD 实施顺序

严格执行“先红测试 → 最小实现 → 重构 → 全量回归”。

### Step 1：adapter response 契约

- Claude fixture 覆盖 take request、allow、deny、缺 request_id、重复 resolve、clear。
- Codex 逐一覆盖五类 method 的 allow/deny schema、number/string id、未知 method、clear。
- 先观察目标测试因接口不存在或现有自动写入而失败，再修改 adapter。

### Step 2：TaskRunner 自动与 manual 分流

- fake child 推 permission request；默认模式断言立即 allow、WS 0 次。
- manual 模式断言 stdin 暂无 response、WS payload 含 session/run/request/tool/input。
- 注入远程 allow/deny，断言当前 child stdin 恰好写一次正确响应。
- WS send 失败断言 fail closed deny。

### Step 3：所有退出路径收敛

- 分别覆盖 result、turn/completed、interrupt、end/cancel、spawn error、child non-zero exit。
- 每例断言 `_activeTurnPermissions`/adapter pending 清空（通过公开测试观察器或依赖行为验证，不暴露生产可变 Map）。
- exit 后迟到 response 返回非 resolved 且 stdin 无新增写入。

### Step 4：SessionStore/daemon 路由

- running/currentRun 匹配时委托 runner；active/ended/failed 拒绝。
- run_id 不匹配返回 stale；缺 run_id 时使用当前 run。
- daemon callback 不直连 child，不因未知/重复 response 抛异常。

### Step 5：回归

```powershell
Set-Location sillyhub-daemon
pnpm test -- stream-json-permission
pnpm test -- json-rpc
pnpm test -- task-runner-permission
pnpm test -- session-store daemon
pnpm typecheck
pnpm test
```

## 8. 验收表

| AC | 验收条件 | 证据 |
|---|---|---|
| AC-08.1 | Claude manual request 不自动写 stdin；远程 allow/deny 回写对应 control_response | `stream-json-permission.test.ts` |
| AC-08.2 | Codex 五类 approval 的 allow/deny schema 正确，JSON-RPC id 原样保留 | `json-rpc.test.ts` |
| AC-08.3 | 默认 false 与 batch 自动批准，不发 PERMISSION_REQUEST | adapter + task-runner permission 回归测试 |
| AC-08.4 | manual 请求 payload 绑定 session_id、run_id、request_id；只可响应当前 turn | `task-runner-permission.test.ts` |
| AC-08.5 | 重复、乱序、旧 run response 不会二次写入或命中新 turn | runner/session-store 竞态测试 |
| AC-08.6 | result、turn/completed、interrupt、end、spawn/child error 后 pending 全清 | 退出矩阵参数化测试 |
| AC-08.7 | WS 发送失败和 stdin 关闭均 fail closed 且无泄漏 | failure-path 测试 |
| AC-08.8 | SessionStore 未持有 child/stdin/adapter/pending responder | state key/type 断言 + code review |
| AC-08.9 | 第二 turn 新 spawn 时没有第一 turn 的 permission request | 两 turn fake-child 集成测试 |
| AC-08.10 | daemon typecheck 与全量测试通过 | `pnpm typecheck && pnpm test` |

## 9. 非目标

- 不实现或修改 backend permission 落库、REST response 端点、WS hub 或 session SSE；这些属于 task-07。
- 不实现前端审批弹窗、审批队列或历史回看；这些属于 task-11。
- 不改变 task-03 的 spawn + resume 进程模型，不恢复跨 turn 长驻 child/stdin。
- 不做 daemon 重启后的 in-flight permission 恢复；进程退出/重启即清理，session 元数据恢复属于 task-09。
- 不改变 Claude/Codex 之外 provider 的协议；batch 及其他 provider 保持既有行为。
- 不引入跨 turn permission 超时持久化或新的数据库表；本任务只保证当前 turn 内存态闭环和退出清理。

## 10. 实现检查清单

- [ ] 开工前重新读取 `.claude/CLAUDE.md`、daemon CONVENTIONS/ARCHITECTURE，并用 `rg` 确认 task-03/task-07 最终接口存在。
- [ ] 测试先行，保留至少一次预期红测试证据。
- [ ] 没有恢复跨 turn child/stdin/adapter 或 sessionStore pending responder。
- [ ] permission registry 仅在 `runTurn` 执行期存在，所有退出路径走同一 finally 清理。
- [ ] response 同时校验 session/run/request，写入最多一次。
- [ ] 默认/batch 行为通过原测试和新增回归测试。
- [ ] 对照 AC-08.1～AC-08.10 逐项验收。
