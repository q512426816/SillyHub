---
id: task-08
title: claude stream-json + codex json-rpc control_request 升级为暂停往返（sessionStore pending permission map）
wave: W2
priority: P1
depends_on: [task-03, task-07]
covers: [FR-07]
created_at: 2026-06-18 14:11:24
author: qinyi
---

# stream-json + json-rpc control_request 升级为暂停往返（task-08 / Wave2）

> 设计依据：
> - `design.md` §5 Wave2（manual_approval=true 时暂停 → 推前端 → 远程决定 → 回写 stdin）、§7.1（PERMISSION_REQUEST/RESPONSE 消息 + payload）、§9（兼容策略：默认 `manual_approval=false` 自动批准不变）、§10 R-02（pending permission 跨 turn 状态）、验收标准 5（manual 暂停等远程决定）+ 6（默认自动批准不变）。
> - `plan.md` task-08 行 + 全局验收 AC-4（manual_approval=false 默认自动批准不变；=true 暂停等远程决定）。
> - `decisions.md` D-002@v1（1 session = 1 lease，pending map 归属 sessionStore）。
> - 现有自动批准铁证：`stream-json.ts:736-814` `handleControlRequest` / `writeControlResponse` 现状直接 `behavior: 'allow'`；`json-rpc.ts:48-54` `APPROVAL_RESPONSES` 五个 approval method 全 `{ decision: 'accept' }` + `parseServerRequest:343-378` 登记到 `pendingMap` 后由 TaskRunner 自动应答。
> - 参考实现：happy `packages/happy-cli/src/claude/utils/permissionHandler.ts:196-257` 的"返回未 resolve 的 Promise + 存 pendingRequests Map"模式（happy 是 SDK in-process 异步模型；daemon 是 stdio 流式**同步 parse**，不能直接照搬 await，需走回调式——见 §4 关键技术矛盾）。

## 1. 目标

把 daemon 两条 provider 适配器（claude `stream-json.ts` / codex `json-rpc.ts`）的**自动批准**行为升级为**可暂停往返**：

1. **claude `stream-json`**：`AgentSession.config.manual_approval=true` 时，`handleControlRequest` **不**直接调 `writeControlResponse(behavior:allow)`，而是：
   - 把 `{request_id, tool_name, input, resolve}` 存入 `sessionStore.pendingPermissions`（Map<request_id, {resolve, toolName, input, stdin, createdAt}>）；
   - 发 `MSG.PERMISSION_REQUEST`（daemon→server，payload 见 task-02 `PermissionRequestPayload`）；
   - **不回写 stdin**（claude 子进程在此 control_request 上 hang 等应答 —— design R-03 已注明：不回写则 hang，正是 manual 模式要的"暂停"语义）；
   - 收到 `MSG.PERMISSION_RESPONSE`（server→daemon，task-07 接通）→ 按 `decision` 调 `writeControlResponse(allow)` 或 deny → resolve 对应 pending。
2. **codex `json-rpc`**：同理升级 `APPROVAL_RESPONSES` 路径 —— manual 模式不直接 accept，存 pending + 发 PERMISSION_REQUEST（tool_name 从 approval method 反查 / input 取 params）→ 收 RESPONSE 后按 decision 写 accept/reject JSON-RPC response。
3. **默认行为零变化**（兼容硬约束，design §9 + 验收 6）：`manual_approval=false`（默认）→ 维持现状 `writeControlResponse(allow)` / `APPROVAL_RESPONSES accept`，不进 pending map、不发 PERMISSION_REQUEST。所有批处理 lease（`kind=batch`）天然走默认（无 sessionStore / 无 config.manual_approval），现有测试零改动通过。

## 2. 前置依赖

- **task-03（SessionStore，硬依赖）**：本任务在 `session-store.ts` 的 `SessionState` 上新增 `pendingPermissions: Map<request_id, PendingPermission>` 字段 + `addPendingPermission / resolvePendingPermission` API。task-03 的 SessionStore 五方法（create/get/inject/interrupt/end）必须先落地。本任务仅**扩展** SessionStore，不改其现有 API 形状。
- **task-07（permission 通道两端接通，硬依赖）**：task-07 把 `agent_sessions.config.manual_approval` 开关两端接通 + ws-client `PERMISSION_RESPONSE` 路由 + daemon `_handleSessionControl` 增加 PERMISSION_RESPONSE 分支（→ `sessionStore.resolvePendingPermission`）。本任务的"adapter 写 stdin"路径依赖 task-07 已让 RESPONSE 能到达 sessionStore.resolvePendingPermission 入口；adapter 发 PERMISSION_REQUEST 路径依赖 task-07 已让 ws 上行通道可用（`wsClient.send` 可发 daemon→server 消息）。
- **task-02（PERMISSION_REQUEST/RESPONSE 常量 + payload，软依赖，已在 task-02 落地）**：常量值 `daemon:permission_request` / `daemon:permission_response` + `PermissionRequestPayload` / `PermissionResponsePayload` 字段（session_id / request_id / tool_name / input / decision）。本任务 import 消费。
- **spike-01 已通过（Wave1 地基）**：claude/codex stream-json stdin 两轮 result 已验证；control_request 暂停往返基于同一 stdin 通道，无需额外 spike（control_request 协议语义已有 task-06 现有自动批准铁证 + happy 参考实现）。

## 3. 涉及文件

| 操作 | 文件路径 | 改动概要 |
|---|---|---|
| 修改 | `sillyhub-daemon/src/session-store.ts`（task-03 新建） | `SessionState` 增 `pendingPermissions: Map<string, PendingPermission>` + `manualApproval: boolean`（从 lease config 读取）；新增 `addPendingPermission / resolvePendingPermission / drainPendingPermissions` 三方法；`end()` 时 drain（reject 所有 pending） |
| 修改 | `sillyhub-daemon/src/adapters/stream-json.ts` | `handleControlRequest(msg)` 增加 `manualApproval` 分支：true → 调 `onPermissionRequest(msg)` 回调（不发 control_response）+ 返回 `[]`；false（默认）→ 现状 `writeControlResponse(allow)` 不变；新增 `resolvePermission(requestId, decision)` 公开方法（sessionStore 调，按 decision 写 allow/deny control_response） |
| 修改 | `sillyhub-daemon/src/adapters/json-rpc.ts` | `parseServerRequest` 增加 manualApproval 分支：approval method + manual=true → 不再用 APPROVAL_RESPONSES 自动 accept，改为产出 tool_use event 标记 `auto_accept=false` + 调 `onPermissionRequest` 回调；新增 `resolvePermission(rpcId, decision)` 写 accept/reject JSON-RPC response |
| 修改 | `sillyhub-daemon/src/adapters/protocol-adapter.ts` | `ProtocolAdapter` 接口增可选 `onPermissionRequest?: (req: {requestId, toolName, input}) => void` + `resolvePermission?(requestId, decision: 'allow'\|'deny'): void`（可选，批处理 adapter 不实现） |
| 修改 | `sillyhub-daemon/src/task-runner.ts` | `_spawnAndStream` 持有 sessionStore 后，构造 adapter 时注入 `onPermissionRequest` 回调（→ sessionStore.addPendingPermission + wsClient.send PERMISSION_REQUEST）；session 模式收尾点增 sessionStore.resolvePendingPermission 调用链（由 task-07 的 _handleSessionControl PERMISSION_RESPONSE 分支触发） |
| 不改 | `sillyhub-daemon/src/protocol.ts` | PERMISSION_* 常量由 task-02 落地，本任务仅 import 消费 |
| 不改 | `sillyhub-daemon/src/ws-client.ts` | PERMISSION_RESPONSE 路由由 task-07 落地，本任务不涉及 |
| 不改 | `sillyhub-daemon/src/daemon.ts` | _handleSessionControl PERMISSION_RESPONSE 分支由 task-07 落地（调 sessionStore.resolvePendingPermission），本任务仅确保 sessionStore 该方法可被正确调用 |
| 新增 | `sillyhub-daemon/tests/stream-json-permission.test.ts` | manual 模式暂停 + response resolve 单测 |
| 新增 | `sillyhub-daemon/tests/json-rpc-permission.test.ts` | codex approval 暂停 + response resolve 单测 |
| 新增 | `sillyhub-daemon/tests/session-store-permission.test.ts` | pendingPermissions map + add/resolve/drain 单测 |

## 4. 实现步骤（编号顺序）

### 4.1 SessionStore 扩展 pendingPermissions map（design §7.1 + happy L196-257 模式）

`session-store.ts` `SessionState` 增字段：

```typescript
export interface PendingPermission {
  requestId: string;        // claude control_request.request_id / codex json-rpc id（统一字符串化）
  toolName: string;         // claude tool name（Bash/Read/...）/ codex approval method（item/.../requestApproval）
  input: Record<string, unknown> | string;  // 透传给前端展示用
  resolve: (decision: 'allow' | 'deny') => void;  // 由 PERMISSION_RESPONSE 触发
  stdin: NodeJS.WritableStream;  // resolve 时回写 stdin（adapter.resolvePermission 用）
  adapter: ProtocolAdapter;  // resolve 时调 adapter.resolvePermission（claude/codex 各自写 control_response）
  createdAt: number;        // ms epoch，超时清理用（见 §4.5）
}

export interface SessionState {
  // ... task-03 现有字段
  manualApproval: boolean;  // 从 lease config 读取，default false
  pendingPermissions: Map<string, PendingPermission>;
}
```

新增三方法：

```typescript
/** adapter 收到 control_request/approval 且 manualApproval=true 时调用。
 *  存 pending + 触发 onPermissionRequestCallback（→ wsClient.send PERMISSION_REQUEST）。 */
addPendingPermission(
  sessionId: string,
  req: { requestId, toolName, input, stdin, adapter },
): void;

/** task-07 _handleSessionControl 收到 PERMISSION_RESPONSE 时调用。
 *  按 request_id 查 map → 调 entry.adapter.resolvePermission(requestId, decision) + entry.resolve(decision)。 */
resolvePendingPermission(
  sessionId: string,
  requestId: string,
  decision: 'allow' | 'deny',
): boolean;  // 返回是否命中（未命中 warn，不抛错——design §9 静默丢弃精神）

/** end() 时调用：reject 所有 pending（避免内存泄漏 + Promise 永久 pending）。 */
drainPendingPermissions(sessionId: string): void;
```

**注意**：本任务**不**在 sessionStore 直接写 stdin（claude control_response 和 codex rpc response 的 JSON 形状不同，必须由 adapter 各自的 `resolvePermission` 构造）。sessionStore 只负责"存 pending + 路由 resolve 到对应 adapter"，遵循 task-03 已有的"sessionStore 持 adapter 引用跨 turn 复用"模式（design R-06）。

### 4.2 关键技术矛盾：daemon parse 是同步的，happy 是异步 await

**这是本任务最核心的实现难点**，必须在蓝图标明避免 execute 阶段踩坑：

- happy 的 permissionHandler（L196-257）在 SDK 进程内**同步返回 Promise**，调用方 await 该 Promise 拿到 decision 再回写 SDK —— SDK 内部异步，天然支持。
- daemon 的 `StreamJsonAdapter.parse(line)` 是**同步**的（在 task-runner readline 的 for-await 循环里同步调用），返回 `AgentEvent[] | null`。**不能在 parse 内 await 一个永远不 resolve 的 Promise**（会阻塞整个 readline 循环 → stdin 后续消息全堵死）。

**解法（回调式，非 await 式）**：

`handleControlRequest` 在 manual 模式**不**回写 stdin、**不**await、**直接返回 `[]`**，把"待应答"状态外提到 sessionStore.pendingPermissions。readline 循环立刻继续读下一行（claude 子进程因为没收到 control_response 自己 hang 在工具调用处，不再推新行 —— 天然暂停）。RESPONSE 到来后由 sessionStore 触发 adapter.resolvePermission 异步回写 stdin → claude 收到 control_response → 继续推后续行 → readline 恢复。

**结论**：daemon 的"暂停"语义**不是**"adapter 函数挂起 await"，而是"adapter 不回写 stdin + claude 子进程自我 hang"。这是 stdio 流式模型与 SDK in-process 模型的本质区别，happy 的 await Promise 模式仅作为"pending map 存储"的参考，**不照搬 await 语义**。

### 4.3 claude `stream-json.ts` handleControlRequest 改造

`handleControlRequest(msg)` 现状（L736-743）：

```typescript
private handleControlRequest(msg: Record<string, unknown>): AgentEvent[] {
  if (this.stdin) {
    this.writeControlResponse(this.stdin, msg);  // 直接 allow
  }
  return [];
}
```

改造后（manualApproval 分流）：

```typescript
private handleControlRequest(msg: Record<string, unknown>): AgentEvent[] {
  const requestId = typeof msg.request_id === 'string' ? msg.request_id : '';
  // 提取 tool_name + input（复用 writeControlResponse L771-795 的 request 解析逻辑，
  // 抽成 _extractToolInfo(msg) → { requestId, toolName, input } 私有方法供两路径共用）
  const { toolName, input } = this._extractToolInfo(msg);

  if (this._manualApproval && requestId && this.stdin) {
    // manual 模式：不回写 stdin，登记 pending，触发回调发 PERMISSION_REQUEST
    this._onPermissionRequest?.({
      requestId, toolName, input,
      stdin: this.stdin, adapter: this,
    });
    return [];  // 不产 event，不回写——claude 子进程 hang
  }
  // 默认（现状不变）：自动批准
  if (this.stdin) {
    this.writeControlResponse(this.stdin, msg);
  }
  return [];
}

/** sessionStore.resolvePendingPermission 调用，按 decision 写 control_response。
 *  allow → behavior:'allow' + updatedInput；deny → behavior:'deny'（claude 协议 deny 无 updatedInput）。 */
resolvePermission(requestId: string, decision: 'allow' | 'deny'): void {
  if (!this.stdin) return;
  const response: ControlResponse = {
    type: 'control_response',
    response: {
      subtype: 'success',
      request_id: requestId,
      response: decision === 'allow'
        ? { behavior: 'allow', updatedInput: this._pendingInputs.get(requestId) ?? {} }
        : { behavior: 'deny' },
    },
  };
  try { this.stdin.write(JSON.stringify(response) + '\n'); } catch { /* BrokenPipe 静默 */ }
  this._pendingInputs.delete(requestId);
}
```

`_manualApproval` 字段由 task-runner 在构造 adapter 时注入（从 `sessionStore.get(sessionId).manualApproval` 读，batch 模式恒为 false/undefined → 走默认自动批准分支）。

`_pendingInputs: Map<requestId, toolInput>`：manual 模式提取的 input 暂存，resolve 时回填 updatedInput（claude allow 必须带 updatedInput，否则协议拒绝）。

### 4.4 codex `json-rpc.ts` approval 改造

`parseServerRequest` 现状（L343-378）：approval method 命中 `APPROVAL_RESPONSES` → 登记到 `pendingMap` + 产出 `auto_accept:true` tool_use event（TaskRunner 见 auto_accept 自动用 responseTemplate 应答）。

改造：approval method + manual 模式 → 改产 `auto_accept:false` tool_use event + 调 `_onPermissionRequest` 回调；approval method + 默认模式 → 现状不变；非 approval server request → 现状不变（仍是 error event）。

```typescript
private parseServerRequest(msg: Record<string, unknown>): AgentEvent[] {
  const id = msg.id as number | string;
  const method = typeof msg.method === 'string' ? msg.method : '';
  const params = (msg.params ?? {}) as Record<string, unknown>;
  const template = APPROVAL_RESPONSES[method] ?? null;

  const entry: PendingServerRequest = { id, method, params, responseTemplate: template };
  this.pendingMap.set(id, entry);

  if (template !== null) {
    // approval 类
    if (this._manualApproval) {
      // manual：不自动 accept，发 PERMISSION_REQUEST
      const requestId = String(id);
      this._onPermissionRequest?.({
        requestId,
        toolName: method,  // codex 用 method 当 tool_name（前端可映射显示）
        input: params,
        stdin: this.stdin!,  // stdin 由 task-runner 注入（task-03 已让 adapter 持有 stdin？——见 §6 风险）
        adapter: this,
      });
      return [{
        type: 'tool_use',
        content: '',
        metadata: { kind: 'approval', auto_accept: false, rpc_id: id, rpc_method: method },
      }];
    }
    // 默认：auto_accept（现状）
    return [{
      type: 'tool_use', content: '',
      metadata: { kind: 'approval', auto_accept: true, rpc_id: id, rpc_method: method, response_template: template },
    }];
  }
  // 非 approval：现状不变
  return [{ type: 'error', content: `unhandled server request: ${method}`, metadata: { rpc_id: id, rpc_method: method, kind: 'unhandled_server_request' } }];
}

/** sessionStore.resolvePendingPermission 调用，按 decision 写 accept/reject JSON-RPC response。 */
resolvePermission(requestId: string, decision: 'allow' | 'deny'): void {
  if (!this.stdin) return;
  const idNum = Number(requestId);  // codex id 是 number，pendingMap key 也是 number
  const entry = this.pendingMap.get(idNum);
  if (!entry || !entry.responseTemplate) return;
  const decisionField = decision === 'allow' ? { decision: 'accept' } : { decision: 'reject' };
  const response = {
    jsonrpc: '2.0',
    id: idNum,
    result: { ...entry.responseTemplate, ...decisionField },
  };
  try { this.stdin.write(JSON.stringify(response) + '\n'); } catch { /* 静默 */ }
  this.pendingMap.delete(idNum);
}
```

**注意**：codex 5 个 approval method 的 reject 字段语义 —— `decision: 'reject'` 是 codex app-server schema 约定（accept/reject 对偶），实现时对照 codex generate-json-schema 确认（`applyPatchApproval` / `execCommandApproval` 等都用 `decision` 字段）。`mcpServer/elicitation/request` 用 `action` 字段（非 decision），其 reject 形如 `{ action: 'reject' }` —— resolvePermission 实现时按 method 分支处理（不能一律写 `decision:'reject'`）。

### 4.5 ProtocolAdapter 接口扩展（可选方法）

`protocol-adapter.ts`:

```typescript
export interface PermissionRequestContext {
  requestId: string;
  toolName: string;
  input: Record<string, unknown> | string;
}

export interface ProtocolAdapter {
  // ... 现有
  /** manual 模式收到 control_request/approval 时被 adapter 内部调用。
   *  实现方：StreamJsonAdapter / JsonRpcAdapter 在 manual 模式注入；批处理 adapter 不注入（undefined → 默认自动批准）。 */
  _onPermissionRequest?: (ctx: PermissionRequestContext & { stdin: NodeJS.WritableStream; adapter: ProtocolAdapter }) => void;
  /** sessionStore.resolvePendingPermission 路由到 adapter 写 control_response / rpc response。
   *  未实现（undefined）的 adapter 由 sessionStore 兜底 reject（不应发生，因 pending 只在两 adapter 创建）。 */
  resolvePermission?(requestId: string, decision: 'allow' | 'deny'): void;
}
```

注入时机：task-runner `_spawnAndStream` 在持有 sessionStore 后（session 模式），构造 adapter 时：

```typescript
adapter._onPermissionRequest = (ctx) => {
  this._sessionStore!.addPendingPermission(sessionId, ctx);
  // 同时发 PERMISSION_REQUEST daemon→server（task-07 已接通 wsClient.send）
  this._wsClient!.send({
    type: MSG.PERMISSION_REQUEST,
    payload: {
      session_id: sessionId,
      request_id: ctx.requestId,
      tool_name: ctx.toolName,
      input: ctx.input,
    },
  });
};
```

batch 模式（无 sessionStore）：不注入 `_onPermissionRequest` → adapter 内 `this._onPermissionRequest?.()` 可选链不触发 → 走默认自动批准分支 → 行为与现状完全一致（兼容硬约束）。

### 4.6 resolvePendingPermission 回写链（由 task-07 PERMISSION_RESPONSE 分支触发）

```
[server → daemon WS] PERMISSION_RESPONSE { session_id, request_id, decision }
    ↓ task-07 daemon._handleSessionControl
sessionStore.resolvePendingPermission(sessionId, requestId, decision)
    ↓ 查 pendingPermissions map
entry.adapter.resolvePermission(requestId, decision)
    ↓ claude: 写 control_response(allow/deny)  /  codex: 写 rpc response(accept/reject)
claude/codex 子进程收到应答 → 继续推后续行 → readline 恢复 → 工具执行或中止
```

**deny 后的 agent 行为**：claude `behavior:'deny'` 会让 agent 收到 tool_use 被拒，通常产出错误说明 + 继续对话（不是进程退出）；codex `decision:'reject'` 同理 agent 收到拒绝后自行决定下一步。**本任务不保证 deny 后 agent 一定继续 turn** —— 取决于 agent 自身实现，但会话（child 进程 + stdin 流）必须保留（不 end）—— 验收 5 只要"批准继续/拒绝中止"，拒绝后 agent 自然结束本轮即算"中止"，无需特殊处理。

### 4.7 end() / drainPendingPermissions（防 Promise 泄漏）

`sessionStore.end(sessionId)` 现状（task-03）：`child.kill() + status='ended' + map.delete(sessionId)`。本任务在 delete 前先 `drainPendingPermissions`：

```typescript
end(sessionId: string): void {
  const state = this._sessions.get(sessionId);
  if (!state) return;
  this.drainPendingPermissions(sessionId);  // 新增：reject 所有 pending
  state.child.kill();
  state.status = 'ended';
  this._sessions.delete(sessionId);
}

drainPendingPermissions(sessionId: string): void {
  const state = this._sessions.get(sessionId);
  if (!state) return;
  for (const [id, entry] of state.pendingPermissions) {
    // adapter 已 kill，resolvePermission 会因 stdin destroyed 静默；直接 reject 让 Promise 不永久 pending
    entry.resolve('deny');  // 用 deny 兜底（agent 已被 kill，decision 无意义，仅清状态）
    state.pendingPermissions.delete(id);
  }
}
```

### 4.8 超时保护（design §10 R-02 + happy 同步阻塞模式参考）

happy 用 AbortSignal 控制超时；daemon 简化：SessionStore 在 addPendingPermission 时记录 `createdAt`，daemon 定时扫描（复用 task-06 空闲回收的同一定时器）超时阈值（默认 5min，可配 `permission_timeout_sec`）未 resolve 的 pending → 自动 resolve('deny') + warn 日志。**Wave2 可先不实现自动超时**（前端有取消按钮，手动 deny 即可），仅留 `createdAt` 字段供 task-11 前端展示"等待时长"。完整超时清理推后到 Wave4 / task-11 前端弹窗自带倒计时。

> 实现 step 顺序：4.1 → 4.5（接口） → 4.3（claude） → 4.4（codex） → 4.6（resolve 链由 task-07 触发，本任务仅确保 adapter.resolvePermission 正确） → 4.7（drain） → 4.8（可选）。

## 5. 完成标准（验收对照 design 验收 5-6）

- **AC-1 [默认自动批准不变 / 验收 6]**：`manual_approval=false`（默认）时，`stream-json.handleControlRequest` 仍调 `writeControlResponse(allow)`（断言 stdin.write 收到 `behavior:"allow"`），`json-rpc.parseServerRequest` approval 仍产 `auto_accept:true` event —— 现有 `stream-json.test.ts` / `json-rpc.test.ts` 全部断言零改动通过。
- **AC-2 [批处理零变化]**：`kind=batch` lease（无 sessionStore、无 config.manual_approval）→ adapter 未注入 `_onPermissionRequest` → 走默认自动批准分支 → 现有 task-runner.test.ts / daemon.test.ts 零改动通过（兼容硬约束，design §9）。
- **AC-3 [claude manual 暂停]**：manual=true 时 FakeChild 推一行 control_request → `handleControlRequest` 调 `onPermissionRequest` 回调（断言被调，参数含 requestId/toolName/input）+ **stdin 未被写入 control_response**（断言 `stdin.write` 调用次数为 0 或不含 control_response）+ sessionStore.pendingPermissions 有该 entry + wsClient.send 被调发 PERMISSION_REQUEST。
- **AC-4 [claude response resolve allow]**：AC-3 后调 `sessionStore.resolvePendingPermission(sid, rid, 'allow')` → FakeChild stdin 收到 `behavior:"allow"` + `updatedInput` 含原 tool_input → pending map 移除该 entry。
- **AC-5 [claude response resolve deny]**：同 AC-4 但 decision='deny' → stdin 收到 `behavior:"deny"`（无 updatedInput）→ pending 移除。
- **AC-6 [codex manual 暂停]**：manual=true 时 FakeChild 推 approval server request（如 `item/commandExecution/requestApproval`）→ `parseServerRequest` 产 `auto_accept:false` event + 调 `onPermissionRequest` + pending map 有 entry + PERMISSION_REQUEST 发出。
- **AC-7 [codex response resolve allow]**：调 resolvePendingPermission allow → stdin 收到 `{"jsonrpc":"2.0","id":N,"result":{"decision":"accept"}}` → pending 移除。
- **AC-8 [codex response resolve deny]**：deny → result 含 `decision:"reject"`（`mcpServer/elicitation/request` 则 `action:"reject"`，按 method 分支）→ pending 移除。
- **AC-9 [drain on end]**：pending 有 2 个 entry 时调 `sessionStore.end(sid)` → 两 entry resolve 被调（'deny' 兜底）+ map 移除 session + 无 Promise 泄漏（断言 pendingPermissions.size === 0）。
- **AC-10 [resolve 未命中静默]**：调 `resolvePendingPermission(sid, 'unknown_id', 'allow')` → 返回 false + warn 日志 + **不抛错**（design §9 未知 type 静默丢弃精神，应对 RESPONSE 重复 / race）。

## 6. 测试要点（vitest，**daemon 用 pnpm test 非 pytest**）

### 6.1 session-store permission 单测（`tests/session-store-permission.test.ts`）

- `addPendingPermission` 后 `get(sid).pendingPermissions.has(rid)` 为 true，entry 含 resolve/toolName/input/adapter。
- `resolvePendingPermission` allow → 调 entry.adapter.resolvePermission（mock adapter，断言被调用 decision='allow'）+ entry.resolve 被调 + map 移除。
- `resolvePendingPermission` 未命中 → 返回 false + 不抛错。
- `drainPendingPermissions`（经 `end` 触发）→ 所有 entry resolve 被调（'deny'）+ map 清空。
- manualApproval=false 时 addPendingPermission **不应被调**（adapter 走默认分支不触发回调，本测试由 adapter 侧覆盖，sessionStore 只验 API 自身）。

**Mock 模式**：adapter 用 `vi.fn()` mock（仅断言 resolvePermission 被调），stdin 用 FakeWritable（task-runner.test.ts 已有 helper）。

### 6.2 stream-json permission 单测（`tests/stream-json-permission.test.ts`）

- **默认分支**：adapter.manualApproval=false/undefined + 推 control_request JSON 行 → `parse()` 返回 `[]` + FakeWritable 收到 `control_response` 含 `behavior:"allow"`（回归测试，对照现有 stream-json.test.ts 同类断言）。
- **manual 分支**：adapter.manualApproval=true + 注入 mock onPermissionRequest + 推 control_request → `parse()` 返回 `[]` + FakeWritable **未**收到 control_response（write 调用为 0 或内容不含 control_response）+ onPermissionRequest 被调（参数含 requestId/toolName=input.command 等）。
- **resolve allow**：调 adapter.resolvePermission(rid, 'allow') → FakeWritable 收到 `behavior:"allow"` + `updatedInput` 含原 tool_input。
- **resolve deny**：调 resolvePermission(rid, 'deny') → FakeWritable 收到 `behavior:"deny"` 且无 updatedInput。
- **BrokenPipe 静默**：mock stdin.write 抛错 → resolvePermission 不抛（try/catch 兜底）。
- **tool_input 各种形态**（dict / string / 字符串化 JSON）→ `_extractToolInfo` 正确解析（复用 writeControlResponse L771-795 已验证逻辑的回归）。

**fixture**：control_request JSON 行参考现有 stream-json.test.ts 的 control_request fixture（若有），或从 happy claude fixture 抓取真实样本。

### 6.3 json-rpc permission 单测（`tests/json-rpc-permission.test.ts`）

- **默认分支**：manualApproval=false + 推 `item/commandExecution/requestApproval` server request → `parseServerRequest` 产 `auto_accept:true` event（回归测试）。
- **manual 分支**：manualApproval=true + 推同上 → 产 `auto_accept:false` event + onPermissionRequest 被调（toolName=method 字符串，input=params）。
- **resolve allow/reject 决策字段**：
  - `execCommandApproval` / `applyPatchApproval` / `item/commandExecution/requestApproval` / `item/fileChange/requestApproval` allow → result 含 `decision:"accept"`；deny → `decision:"reject"`。
  - `mcpServer/elicitation/request` allow → `action:"accept"`；deny → `action:"reject"`（**按 method 分支**，不能一律 decision 字段）。
- **resolve 未在 pendingMap**：调 resolvePermission(rid) → 不写 stdin + 不抛（pendingMap.delete 不存在的 key 安全）。
- **batch 模式（无 manualApproval 注入）**：approval 仍走 auto_accept:true，与现状一致（AC-2 回归）。

### 6.4 端到端链路（可选，集成测试，可推后到 Wave4 task-11 联调）

manual 模式下 FakeChild 推 control_request → 断言 wsClient.send PERMISSION_REQUEST → 手动触发 daemon._handleSessionControl PERMISSION_RESPONSE allow → 断言 FakeChild stdin 收到 control_response allow + 后续行恢复（FakeChild 再推 result 行验证 readline 未死锁）。

本任务优先单测层覆盖（AC-1~10），集成测试推后到 Wave4（task-11 前端联调时端到端跑通）。

## 7. 风险 / 注意

| 风险 | 等级 | 应对 |
|---|---|---|
| **同步 parse 不能 await（核心矛盾）** | P0 | §4.2 明确解法：回调式不 await，"暂停"语义靠 claude 子进程自我 hang（不回写 control_response），不是 adapter 函数挂起。execute 阶段若误用 await 会死锁整个 readline → 立即回退回调式。 |
| **adapter 需持有 stdin 引用** | P1 | task-03 现状 adapter 是否持有 stdin 待 execute 阶段确认（stream-json.ts L737 `this.stdin` 已是实例字段 → 已持有；json-rpc.ts 未明显持有 stdin，pendingMap 是状态但 stdin 由 task-runner 代写）。codex 侧若 adapter 无 stdin，需 task-runner 在 session 模式把 stdin 注入 adapter（构造后 setter 或构造参数），否则 resolvePermission 无法回写。**execute 第一步先确认两 adapter 的 stdin 持有方式**。 |
| **codex reject 字段 method 分歧** | P1 | §4.4 注：`mcpServer/elicitation/request` 用 `action` 字段而非 `decision`；其余 4 个用 `decision`。resolvePermission 必须按 method 分支，否则 elicitation deny 写成 `decision:'reject'` 被 codex 拒绝为 schema 错误。execute 时对照 codex app-server generate-json-schema 逐 method 验证。 |
| **跨 turn pending 残留** | P1 | manual 模式下 agent 在 turn 内可能发多个 control_request（前一个未 resolve 又来一个）→ pendingPermissions 多 entry 共存，requestId 唯一即可（claude request_id 天然唯一 / codex rpc id 自增）。turn/completed 时若仍有 pending（agent 未等批准就结束 turn？理论不应发生）→ turn 收尾点不主动 drain（留给 sessionStore.end），仅 warn。drain 集中在 end（§4.7）。 |
| **WS 重连丢 RESPONSE（R-02）** | P1 | RESPONSE 到达时 session 已 end（race）→ resolvePendingPermission 返回 false（未命中）+ warn，不抛错（AC-10）。session 已 end 时 child 已 kill，即便 resolve 也写不进 stdin，静默即可。 |
| **PERMISSION_RESPONSE 重复 / 乱序** | P2 | 同 request_id 的 RESPONSE 到达两次：第一次 resolve + map.delete，第二次 resolvePendingPermission 未命中 → 返回 false 静默（AC-10）。不引入去重逻辑（YAGNI，backend 侧保证不重发）。 |
| **happy permissionHandler 模式差异** | P2 | design 引用 happy L196-257 作"pending map 存储"参考，但 happy 是 SDK await Promise 模型，daemon 是 stdio 回调式（§4.2）。execute 阶段**不照搬 await**，仅借鉴 pendingRequests Map 结构 + resolve 回调模式。 |
| **adapter 跨 turn 状态（R-06 延续）** | P2 | task-03 已定 sessionStore 持同一 adapter 实例跨 turn（不 new 新实例）。本任务的 `_pendingInputs`（claude 暂存 tool_input）/ `pendingMap`（codex 已有）跨 turn 共存于同一 adapter 实例，与 task-03 一致。resetAccumulator **不**清这两个 map（仅清 streamedAgentMessageIds/agentMessageBuf，task-03 已约定）。 |
| **batch 模式不能误触发 PERMISSION_REQUEST** | P0 | `_onPermissionRequest` 仅在 session 模式（task-runner 持 sessionStore 且 lease.kind=interactive）注入；batch 模式 adapter._onPermissionRequest=undefined → 可选链 `?.()` 不触发 → 默认自动批准分支。**execute 必须保证不破坏此约束**，否则批处理 lease 会发 PERMISSION_REQUEST 到 server 导致 backend 报未知消息（design §9 兼容）。单测 AC-2 兜底。 |
| **测试用 vitest 非 pytest** | P1 | 同 task-03：daemon 是 TypeScript，`cd sillyhub-daemon && pnpm test`（vitest）。CONVENTIONS.md / local.yaml / scan 标 Python 已过时。 |

## 8. 验收对照

| AC | 验证手段 | 对应 design 章节 |
|---|---|---|
| AC-1 默认自动批准不变（验收 6） | stream-json-permission.test.ts + json-rpc-permission.test.ts 默认分支 + 现有 stream-json/json-rpc 测试零改动 | §9 兼容策略 / 验收 6 |
| AC-2 批处理零变化 | 现有 task-runner.test.ts / daemon.test.ts 零改动通过 | §9 / AC-6 全局 |
| AC-3 claude manual 暂停 | stream-json-permission.test.ts manual 分支 | §5 Wave2 / 验收 5 |
| AC-4 claude resolve allow | stream-json-permission.test.ts resolve allow | §5 Wave2 |
| AC-5 claude resolve deny | stream-json-permission.test.ts resolve deny | §5 Wave2 |
| AC-6 codex manual 暂停 | json-rpc-permission.test.ts manual 分支 | §5 Wave2 / 验收 5 |
| AC-7 codex resolve allow | json-rpc-permission.test.ts resolve allow（decision 字段） | §5 Wave2 |
| AC-8 codex resolve deny（含 method 分支） | json-rpc-permission.test.ts resolve deny（decision / action 两字段） | §5 Wave2 |
| AC-9 drain on end | session-store-permission.test.ts end + drain | §4.7 / R-02 |
| AC-10 resolve 未命中静默 | session-store-permission.test.ts 未命中 | §9 静默丢弃精神 |

全局验收：`cd sillyhub-daemon && pnpm test` 通过（vitest，含 task-03 现有 session-store/task-runner-session 测试 + 本任务新增 3 测试文件）；`pnpm typecheck` 通过（ProtocolAdapter 接口扩展 + PendingPermission 类型可被 import）。

## 9. 与其他任务的接口边界

- **← task-02（PERMISSION_* 常量 + payload）**：本任务 import `MSG.PERMISSION_REQUEST` / `MSG.PERMISSION_RESPONSE` + `PermissionRequestPayload` / `PermissionResponsePayload`。task-02 已落地。
- **← task-03（SessionStore）**：本任务扩展 SessionState（pendingPermissions / manualApproval）+ 新增 add/resolve/drain 三方法。task-03 的 create/get/inject/interrupt/end 不改形状，仅 end 内部加 drain 调用。
- **← task-07（permission 通道两端）**：task-07 落地 ws-client PERMISSION_RESPONSE 路由 + daemon._handleSessionControl PERMISSION_RESPONSE 分支（→ sessionStore.resolvePendingPermission）。本任务确保 sessionStore.resolvePendingPermission + adapter.resolvePermission 可被 task-07 正确调用；adapter 发 PERMISSION_REQUEST 路径依赖 task-07 已让 wsClient.send 可发 daemon→server 消息。
- **→ task-11（前端权限弹窗）**：task-11 订阅 PERMISSION_REQUEST（经 backend SSE/WS 转发到前端）展示弹窗 + 用户决定后 POST → backend 发 PERMISSION_RESPONSE。本任务的 PermissionRequestPayload.input 字段（tool_name + input）是前端弹窗展示数据源；decision 字段是前端回写。本任务不实现前端，仅保证 payload 透传正确。
- **← spike-01（Wave1 可行性）**：control_request 暂停往返基于 claude/codex stream-json stdin 通道，与中途追问同一通道，无需额外 spike。

## 10. 自检清单（对照 CLAUDE.md 流程）

- [x] 文档先行：本蓝图即文档，依据 design.md §5 Wave2 + §7.1 + §9 + 验收 5-6 + plan.md task-08。
- [x] 读现有代码：已 Read `stream-json.ts:700-814`（handleControlRequest/writeControlRequest）、`json-rpc.ts` 全文（APPROVAL_RESPONSES + parseServerRequest + pendingMap）、`session-store.ts`（task-03 未落地，按 task-03 蓝图 §4.1 推断结构）、`protocol.ts`（PERMISSION_* 待 task-02 落地，task-02 蓝图已确认常量值）、`happy/.../claude/permissionHandler.ts:150-257`（pending Promise map 模式）、`happy/.../codex/permissionHandler.ts`（CodexPermissionHandler.handleToolCall 同模式）。
- [ ] 写测试：§6 已规划 3 个测试文件 + AC-1~10 断言（execute 阶段落地）。
- [ ] 写实现：§4 已规划 SessionStore 扩展 + 两 adapter 改造 + ProtocolAdapter 接口扩展（execute 阶段落地）。
- [ ] 跑测试：§8 列出 `pnpm test` + `pnpm typecheck` 命令。
- [ ] 对照文档验收：§5 AC-1~10 逐项可勾，对应 design 验收 5（AC-3/6 manual 暂停）+ 6（AC-1/2 默认不变）。
