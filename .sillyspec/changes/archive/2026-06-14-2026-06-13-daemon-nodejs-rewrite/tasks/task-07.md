---
author: qinyi
created_at: 2026-06-14T00:08:01+0800
id: task-07
title: json_rpc adapter（src/adapters/json-rpc.ts，codex/hermes/kimi/kiro）
priority: P0
estimated_hours: 4
depends_on: [task-05]
blocks: [task-11]
allowed_paths:
  - sillyhub-daemon/src/adapters/json-rpc.ts
  - sillyhub-daemon/tests/fixtures/json-rpc/
---

# task-07：json_rpc adapter（src/adapters/json-rpc.ts，codex/hermes/kimi/kiro）

> JSON-RPC 2.0 over stdio 协议的纯解析 adapter，覆盖 codex / hermes / kimi / kiro 四 provider。子进程（如 codex CLI `app-server --listen stdio://`）通过 stdin/stdout 双向交换 JSON-RPC 2.0 消息：daemon 发 request（initialize / thread/start / turn/start），子进程回 response，并主动推 notification（turn/started / item/completed / item/started / turn/completed）和 server request（`*Approval` 需 daemon 应答）。本任务实现 `JsonRpcAdapter.parse(line)` 把每行 JSON-RPC 消息映射到统一 IR `AgentEvent`，并维护「待应答 server request id」队列供 task-19 TaskRunner 层取用。

- Wave：W1（协议抽象层，5 个 adapter 之一）
- 依赖：task-05（`ProtocolAdapter` 接口 + `AgentEvent` IR 已就绪）
- 阻塞：task-11（`getBackend` 工厂 + `PROTOCOL_PROVIDERS` 注册 `codex/hermes/kimi/kiro`）
- Python 源对照：`sillyhub_daemon/backends/json_rpc.py`（核心 `parse_output` L678-750 + `_handle_line` 三分支 L174-201 + `_handle_server_request` approval L230-249）
- 测试对照：`sillyhub_daemon/tests/test_json_rpc.py`（`_make_rpc_response` / `_make_rpc_notification` / `_make_rpc_server_request` 三个 helper 构造的样本，1:1 提取到 fixture）

---

## 修改文件

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | `sillyhub-daemon/src/adapters/json-rpc.ts` | `JsonRpcAdapter` 类（implements `ProtocolAdapter`）+ parse 三分支 + 四 provider 共享的 method→event 映射 + 待应答 id 状态 |
| 新增 | `sillyhub-daemon/tests/fixtures/json-rpc/codex/*.json` | codex provider 三类样本各 ≥1：notification（item/completed agentMessage）+ server request（commandExecution approval）+ response（thread/start reply） |
| 新增 | `sillyhub-daemon/tests/fixtures/json-rpc/hermes/*.json` | hermes 同上三类（验证 method 名与 codex 等价，无子命令差异） |
| 新增 | `sillyhub-daemon/tests/fixtures/json-rpc/kimi/*.json` | kimi 同上三类 |
| 新增 | `sillyhub-daemon/tests/fixtures/json-rpc/kiro/*.json` | kiro 同上三类（含 fileChange approval 样本） |
| 新增 | `sillyhub-daemon/tests/adapters/json-rpc.test.ts` | vitest 用例，从 fixture 读样本断言 `parse()` 等价 `AgentEvent` |

> **fixture 源**：全部从 `test_json_rpc.py` 的 `_make_rpc_notification` / `_make_rpc_response` / `_make_rpc_server_request` helper 实际调用处 1:1 提取为 `.json` 文件（不是手写）。每个 fixture 文件是单行 JSON（与 stdout 一行对齐），测试读入后 `JSON.parse` 喂给 `adapter.parse(JSON.stringify(obj))`。

---

## 实现要求

1. **类定义**：`export class JsonRpcAdapter implements ProtocolAdapter`。构造函数接收 `provider: 'codex' | 'hermes' | 'kimi' | 'kiro'`，存为 `readonly provider` 字段（满足 `ProtocolAdapter.provider: string` 契约）。**不实现 `onControl`**（json_rpc 协议的 stdin 应答走 server request 的 `*Approval` 分支，由 task-19 TaskRunner 在解析到 server request event 时统一写 stdin，不通过 `onControl` 钩子——见 N-07-2）。

2. **parse(line) 三分支**：`JSON.parse(line)` → 校验为 object → 按 JSON-RPC 2.0 结构分三条路径（顺序与 Python `_handle_line` L186-200 严格一致）：
   - **response**：`has(id) && !has(method)` → daemon 之前发出的 request 的回复。映射到 `complete` event（携带 sessionId / usage metadata），并从「待应答 request id」集合移除该 id（若在集合内）。Python `parse_output` 对 response 返回 None，但 Node 版升级：response 也是有业务意义的事件（turn/start 的 reply 标记 turn 进入 running），故产出 event 而非丢弃。**注意**：与 Python 行为差异须在 JSDoc 写明。
   - **server request**：`has(id) && has(method)` → 子进程主动发起、需 daemon 应答（如 `item/commandExecution/requestApproval`）。产出 `tool_use` 或专用 control event，**记录 id+method+params+responseTemplate 到 `pendingMap: Map<number|string, PendingServerRequest>`**，供 task-19 取出后按 template 写 `{jsonrpc:"2.0", id, result:{decision:"accept"}}` 应答。本 adapter **不直接写 stdin**（纯解析职责，应答 I/O 在 TaskRunner）。
   - **notification**：`!has(id) && has(method)` → 单向通知，按 method 名映射到 text / tool_use / tool_result / status event（见下文 method→event 映射表）。
   - **既无 id 也无 method**：返回 `null`（坏行，对应 Python L201 `Unhandled` 分支）。

3. **method→event 映射（notification 分支，1:1 对照 Python parse_output L705-750）**：

   | method | params.item.type | 产出 AgentEvent |
   |---|---|---|
   | `item/completed` | `agentMessage` | `{ type:'text', content: item.text }` |
   | `item/completed` | `commandExecution` | `{ type:'tool_result', content: item.aggregatedOutput, metadata:{ tool_name:'exec_command', call_id: item.id } }` |
   | `item/completed` | `fileChange` | `{ type:'tool_result', content:'', metadata:{ tool_name:'patch_apply', call_id: item.id } }` |
   | `item/started` | `commandExecution` | `{ type:'tool_use', content: item.command, metadata:{ tool_name:'exec_command', call_id: item.id } }` |
   | `item/started` | `fileChange` | `{ type:'tool_use', content:'', metadata:{ tool_name:'patch_apply', call_id: item.id } }` |
   | `turn/started` | （无 item） | `{ type:'status', content:'running' }`（映射到 IR 的 status 语义，用 `type:'status'` 复用，metadata.level 标记） |
   | `turn/completed` | （turn 对象） | **返回 null**（lifecycle 事件，编排层 task-19 监听 turn_done；与 Python L1033 行为一致） |
   | 其他 method | — | `null`（未知 notification，不产出） |

   > **AgentEvent 字段映射说明**：Python `AgentEvent` 有 `event_type/content/tool_name/call_id/tool_input/tool_output/status` 七字段扁平；task-02 的 TS IR 是 `{ type, content, metadata? }` 三字段。`tool_name` / `call_id` / `tool_output` / `session_id` / `usage` 全部塞进 `metadata: Record<string, unknown>`。`type` 用联合 `'text'|'tool_use'|'tool_result'|'error'|'complete'`——`turn/started` 的 status running 映射到 `type:'status'`（需 task-02 的 `AgentEventType` 含 `'status'`，若未含则降级为 `'text'` content='[status] running'，决策见 §接口定义注释）。

4. **四 provider 差异处理（关键决策）**：Python `parse_output` **完全无视 provider**（codex/hermes/kimi/kiro 共享同一套 method 名 `item/*` / `turn/*` / `*Approval`）。Python 的 provider 差异仅在 `_PROVIDER_COMMANDS`（codex 加 `app-server --listen stdio://` 子命令，其余空数组）——这是 **spawn 层差异，不是 parse 层差异**。故本 adapter 的 parse 逻辑**对所有 provider 完全一致**，`provider` 字段仅用于：① task-11 工厂注册 ② JSDoc 标注 ③ 未来若 hermes/kimi/kiro 出现 method 名分歧时的分支钩子（预留 `private mapMethodName(method): string` 钩子方法，当前 identity 返回原 method）。**禁止臆造 provider 专属 method 名**——若实际 provider 有差异须在 fixture 用例中体现，否则一律走 codex 同款映射。

5. **待应答状态（adapter 有状态）**：实例字段 `private pendingMap = new Map<number | string, PendingServerRequest>()`，其中 `PendingServerRequest = { id, method, params, responseTemplate }`。parse 到 server request 时 `pendingMap.set(id, entry)`。提供 `public getPendingServerRequests(): readonly PendingServerRequest[]` 供 task-19 TaskRunner 取出后按 `responseTemplate` 写 stdin 应答，并在应答后调用 `public markResponded(id)` 移除。**为什么用 Map 而非 Set**：TaskRunner 不仅要拿到 id，还要知道该回什么（`responseTemplate` 因 method 而异），Map 存完整条目避免 TaskRunner 二次查 method→template 映射。**注意**：Python 版是在 `_handle_server_request` 内**同步 auto-respond**（L243 `await self.respond`），Node 版拆开——adapter 只记录条目，应答 I/O 下沉 TaskRunner（R-03 应对：解析与 I/O 分离，便于单测无 stdin mock）。

6. **server request approval method 名（1:1 对照 Python L237-247）**：以下 method 触发「自动接受」语义（TaskRunner 应答 `{decision:"accept"}` 或 `{action:"accept",content:null,_meta:null}`）：
   - `item/commandExecution/requestApproval` → `{decision:"accept"}`
   - `execCommandApproval` → `{decision:"accept"}`
   - `item/fileChange/requestApproval` → `{decision:"accept"}`
   - `applyPatchApproval` → `{decision:"accept"}`
   - `mcpServer/elicitation/request` → `{action:"accept", content:null, _meta:null}`
   adapter parse 时把这些 method 的 server request 产出一个 `{ type:'tool_use', content:'', metadata:{ kind:'approval', auto_accept:true, response_template:{...} } }` event，让 task-19 知道该 id 应回什么。其余未知 server request method 产出 `{ type:'error', content:'unhandled server request: <method>', metadata:{ id, method } }` 并同样记录 id（TaskRunner 决定如何应答）。

7. **response 分支的 thread_id 提取**：daemon 发 `thread/start` / `thread/resume` request 后，response 的 `result.thread.id` 是关键 sessionId。parse 到 response 时若 `result.thread?.id` 存在，产出 `{ type:'complete', content:'', metadata:{ session_id: thread.id, source:'thread_start_response' } }`，供 TaskRunner 记录 session 用于后续 notification 的 threadId 过滤（Python `on_notification` L348-350 的 threadId 过滤逻辑下沉到 TaskRunner，adapter 只负责把 thread_id 透出到 event metadata）。

8. **纯函数约束（继承 task-05 B-03）**：parse 方法本身不发起 I/O、不抛异常（坏行返回 null）。状态只存在实例字段（`pendingMap`）。每个 lease 一个 adapter 实例（task-11 工厂按需 new），状态隔离。


---

## 接口定义

以下是 `sillyhub-daemon/src/adapters/json-rpc.ts` 的完整骨架（搬砖工照抄实现细节，签名 / 分支 / method 名 / 字段映射均已定型）：

```ts
/**
 * JsonRpcAdapter —— JSON-RPC 2.0 over stdio 的纯解析 adapter。
 *
 * 覆盖 provider：codex / hermes / kimi / kiro（共享同一套 method 名）。
 *
 * 协议特征（对照 Python json_rpc.py）：
 *   - 双向通信：daemon 发 request（initialize/thread/start/turn/start），
 *     子进程回 response；子进程主动推 notification 和 server request。
 *   - 三类入站消息（_handle_line L186-200 分支顺序）：
 *       1. response   (has id, no method)  —— daemon 之前 request 的回复
 *       2. server request (has id + method) —— 子进程发起、需 daemon 应答
 *       3. notification (no id, has method) —— 单向通知
 *
 * 与 Python 版的关键差异（写在 JSDoc 防止误读）：
 *   - Python `parse_output` 只处理 notification，response 返回 None，
 *     server request 不进 parse_output（在 transport 层 auto-respond）。
 *   - Node 版 parse 统一处理三类（方案B：解析职责全在 adapter，I/O 全在
 *     TaskRunner）。server request 的「待应答 id」记录到实例字段，
 *     TaskRunner 轮询取出写 stdin。
 *   - response 也产出 event（携带 session_id / usage），Python 版丢弃。
 *
 * provider 差异说明：
 *   Python `_PROVIDER_COMMANDS` 显示 codex 用 `app-server --listen stdio://`
 *   子命令，hermes/kimi/kiro 无子命令——但这是 spawn 层差异（task-19），
 *   parse 层四 provider 共享 method 名，无分支。
 *
 * @see design.md §7.1 AgentEvent IR / §7.3 PROTOCOL_PROVIDERS json_rpc 条目
 */

import type { AgentEvent } from '../types.js';
import type { ProtocolAdapter } from './protocol-adapter.js';

/** JSON-RPC 2.0 四 provider 联合（工厂 task-11 会做 narrowing） */
export type JsonRpcProvider = 'codex' | 'hermes' | 'kimi' | 'kiro';

/** 自动应答模板（对照 Python L237-247 的 5 个 approval method） */
const APPROVAL_RESPONSES: Record<string, Record<string, unknown>> = {
  'item/commandExecution/requestApproval': { decision: 'accept' },
  'execCommandApproval': { decision: 'accept' },
  'item/fileChange/requestApproval': { decision: 'accept' },
  'applyPatchApproval': { decision: 'accept' },
  'mcpServer/elicitation/request': { action: 'accept', content: null, _meta: null },
};

/** server request 待应答条目（TaskRunner 取出后据此写 stdin） */
export interface PendingServerRequest {
  id: number | string;
  method: string;
  params: Record<string, unknown>;
  /** 预填应答模板（approval 类有，未知 method 为 null，TaskRunner 自决） */
  responseTemplate: Record<string, unknown> | null;
}

export class JsonRpcAdapter implements ProtocolAdapter {
  readonly provider: JsonRpcProvider;

  /** 待应答 server request（id → 完整条目），task-19 轮询消费 */
  private readonly pendingMap = new Map<number | string, PendingServerRequest>();

  constructor(provider: JsonRpcProvider) {
    this.provider = provider;
  }

  /**
   * 解析一行 JSON-RPC 2.0 消息，返回 0..N 个 AgentEvent。
   *
   * 三分支顺序严格对照 Python _handle_line L186-200：
   *   1. response        : has id && !has method
   *   2. server request  : has id && has method
   *   3. notification    : !has id && has method
   *
   * 坏行（非 JSON / 非 object / 既无 id 又无 method）返回 null。
   */
  parse(line: string): AgentEvent[] | null {
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      return null; // B-04: 坏 JSON 不抛异常
    }
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      return null; // 非对象
    }
    const msg = raw as Record<string, unknown>;
    const hasId = Object.prototype.hasOwnProperty.call(msg, 'id');
    const hasMethod = Object.prototype.hasOwnProperty.call(msg, 'method');

    // 分支 1：response（daemon 之前 request 的回复）
    if (hasId && !hasMethod) {
      return this.parseResponse(msg);
    }
    // 分支 2：server request（子进程发起，需应答）
    if (hasId && hasMethod) {
      return this.parseServerRequest(msg);
    }
    // 分支 3：notification（单向通知）
    if (!hasId && hasMethod) {
      return this.parseNotification(msg);
    }
    // 既无 id 又无 method：未识别
    return null;
  }

  // -- 分支 1：response -----------------------------------------------

  private parseResponse(msg: Record<string, unknown>): AgentEvent[] | null {
    const id = msg.id as number | string;
    // 从待应答集合移除（若在）——注：request 是 daemon 发出的，正常不在
    // pendingMap（pendingMap 只存 server request）。但保留清理逻辑防漂移。
    this.pendingMap.delete(id);

    // error response
    if (Object.prototype.hasOwnProperty.call(msg, 'error')) {
      const err = msg.error as Record<string, unknown> | undefined;
      const errMsg = (err && typeof err === 'object' && 'message' in err)
        ? String((err as Record<string, unknown>).message)
        : 'unknown rpc error';
      const code = (err && typeof err === 'object' && 'code' in err)
        ? (err as Record<string, unknown>).code
        : -1;
      return [{
        type: 'error',
        content: errMsg,
        metadata: { rpc_error_code: code, rpc_id: id },
      }];
    }

    // success response：提取 thread.id 作为 session_id
    const result = (msg.result ?? {}) as Record<string, unknown>;
    const events: AgentEvent[] = [];

    const thread = result.thread as Record<string, unknown> | undefined;
    if (thread && typeof thread === 'object' && 'id' in thread) {
      events.push({
        type: 'complete',
        content: '',
        metadata: {
          session_id: String(thread.id),
          source: 'thread_response',
          rpc_id: id,
        },
      });
    }

    // 提取 usage（turn/start reply 可能带）
    const usage = (result.usage ?? result.token_usage ?? result.tokens) as
      | Record<string, unknown>
      | undefined;
    if (usage && typeof usage === 'object') {
      events.push({
        type: 'complete',
        content: '',
        metadata: { usage, source: 'usage_response', rpc_id: id },
      });
    }

    return events.length > 0 ? events : null;
  }

  // -- 分支 2：server request -----------------------------------------

  private parseServerRequest(msg: Record<string, unknown>): AgentEvent[] | null {
    const id = msg.id as number | string;
    const method = String(msg.method ?? '');
    const params = (msg.params ?? {}) as Record<string, unknown>;
    const template = APPROVAL_RESPONSES[method] ?? null;

    // 记录待应答（无论是否 approval，都登记让 TaskRunner 决策）
    const entry: PendingServerRequest = { id, method, params, responseTemplate: template };
    this.pendingMap.set(id, entry);

    if (template !== null) {
      // 已知 approval：产出 tool_use event，标记 auto_accept
      return [{
        type: 'tool_use',
        content: '',
        metadata: {
          kind: 'approval',
          auto_accept: true,
          rpc_id: id,
          rpc_method: method,
          response_template: template,
        },
      }];
    }

    // 未知 server request：产出 error event 但仍登记 id（TaskRunner 可自定义应答）
    return [{
      type: 'error',
      content: `unhandled server request: ${method}`,
      metadata: { rpc_id: id, rpc_method: method, kind: 'unhandled_server_request' },
    }];
  }

  // -- 分支 3：notification -------------------------------------------

  private parseNotification(msg: Record<string, unknown>): AgentEvent[] | null {
    const method = String(msg.method ?? '');
    const params = (msg.params ?? {}) as Record<string, unknown>;

    // provider method 名钩子（预留，当前 identity；未来 provider 分歧时扩展）
    const canonicalMethod = this.mapMethodName(method);

    if (canonicalMethod === 'item/completed') {
      return this.parseItemCompleted(params);
    }
    if (canonicalMethod === 'item/started') {
      return this.parseItemStarted(params);
    }
    if (canonicalMethod === 'turn/started') {
      return [{ type: 'status', content: 'running', metadata: { source: 'turn_started' } }];
    }
    if (canonicalMethod === 'turn/completed') {
      // lifecycle 事件，编排层 task-19 监听 turn_done；parse 不产出内容 event
      // 但产出 status event 让 TaskRunner 知道 turn 结束（含 usage/error 提取）
      return this.parseTurnCompleted(params);
    }
    // 未知 notification：丢弃
    return null;
  }

  private parseItemCompleted(params: Record<string, unknown>): AgentEvent[] | null {
    const item = params.item as Record<string, unknown> | undefined;
    if (!item || typeof item !== 'object') return null;
    const itemType = String(item.type ?? '');
    const itemId = String(item.id ?? '');

    if (itemType === 'agentMessage') {
      const text = String(item.text ?? '');
      if (!text) return null;
      return [{ type: 'text', content: text, metadata: { call_id: itemId } }];
    }
    if (itemType === 'commandExecution') {
      const out = String(item.aggregatedOutput ?? '');
      return [{
        type: 'tool_result',
        content: out,
        metadata: { tool_name: 'exec_command', call_id: itemId },
      }];
    }
    if (itemType === 'fileChange') {
      return [{
        type: 'tool_result',
        content: '',
        metadata: { tool_name: 'patch_apply', call_id: itemId },
      }];
    }
    return null;
  }

  private parseItemStarted(params: Record<string, unknown>): AgentEvent[] | null {
    const item = params.item as Record<string, unknown> | undefined;
    if (!item || typeof item !== 'object') return null;
    const itemType = String(item.type ?? '');
    const itemId = String(item.id ?? '');

    if (itemType === 'commandExecution') {
      const cmd = String(item.command ?? '');
      return [{
        type: 'tool_use',
        content: cmd,
        metadata: { tool_name: 'exec_command', call_id: itemId },
      }];
    }
    if (itemType === 'fileChange') {
      return [{
        type: 'tool_use',
        content: '',
        metadata: { tool_name: 'patch_apply', call_id: itemId },
      }];
    }
    return null;
  }

  private parseTurnCompleted(params: Record<string, unknown>): AgentEvent[] | null {
    const turn = params.turn as Record<string, unknown> | undefined;
    if (!turn || typeof turn !== 'object') return null;
    const status = String(turn.status ?? '');
    const events: AgentEvent[] = [];

    if (status === 'failed') {
      const errObj = turn.error as Record<string, unknown> | undefined;
      const errMsg = (errObj && typeof errObj === 'object' && 'message' in errObj)
        ? String((errObj as Record<string, unknown>).message)
        : 'turn failed';
      events.push({
        type: 'error',
        content: errMsg,
        metadata: { source: 'turn_completed', turn_status: 'failed' },
      });
    }

    // usage 提取（对照 Python L368-372 三种字段名兜底）
    const usage = (turn.usage ?? turn.token_usage ?? turn.tokens) as
      | Record<string, unknown>
      | undefined;
    if (usage && typeof usage === 'object') {
      events.push({
        type: 'complete',
        content: '',
        metadata: { usage, source: 'turn_completed', turn_status: status },
      });
    } else {
      // 即使无 usage 也产出一个 complete 标记 turn 结束
      events.push({
        type: 'complete',
        content: '',
        metadata: { source: 'turn_completed', turn_status: status },
      });
    }
    return events;
  }

  /**
   * provider method 名映射钩子。当前 identity（四 provider 共享 method 名）。
   * 未来若 hermes/kimi/kiro 出现 method 名分歧，在此按 this.provider 分支。
   * 禁止臆造——必须有 fixture 证据才加分支。
   */
  private mapMethodName(method: string): string {
    return method;
  }

  // -- TaskRunner 消费接口（task-19 调用） -----------------------------

  /** 取出所有待应答 server request（不消费，TaskRunner 应答后调 markResponded） */
  getPendingServerRequests(): readonly PendingServerRequest[] {
    return Array.from(this.pendingMap.values());
  }

  /** TaskRunner 写完 stdin 应答后调用，移除该 id */
  markResponded(id: number | string): void {
    this.pendingMap.delete(id);
  }
}
```

> **搬砖工注意**：
> 1. `import type` 保证零运行时副作用（task-05 同款约束）。
> 2. `AgentEvent.type` 的 `'status'` 值依赖 task-02 的 `AgentEventType` 联合含 `'status'`。若 task-02 未含，搬砖工应**先回头给 task-02 补 `'status'`**（Python `AgentEvent.event_type` 值域明确含 status，见 backends.md「注意事项」），不能在本 adapter 里降级成 `'text'`——那样会丢失语义。
> 3. `PendingServerRequest` 和 `getPendingServerRequests` / `markResponded` 是 task-19 TaskRunner 依赖的公共 API，签名已定型，task-19 会 import。
> 4. `APPROVAL_RESPONSES` 常量的 5 个 method 名**逐字来自 Python L237-247**，禁止改动。


---

## 边界处理

| 编号 | 边界场景 | 处理策略 |
|---|---|---|
| **B-07-1** | notification 缺 `params` 字段或 `params` 非 object | `parseNotification` 开头 `(msg.params ?? {})` 兜底为空对象；后续 `params.item` 取不到时 `parseItemCompleted` / `parseItemStarted` 返回 null。对照 Python L701-703 `if not isinstance(params, dict): params = {}`。fixture `codex/notification-no-params.json` 覆盖。 |
| **B-07-2** | 重复 server request id（子进程重发同一 id） | `pendingMap.set(id, entry)` 覆盖旧条目（Map 语义）。不抛异常、不报错——可能子进程重试，TaskRunner 应答一次后 `markResponded` 移除，重发的会在下次 parse 重新登记。日志可 warn 但不阻塞。 |
| **B-07-3** | response 的 id 无对应「待应答」（孤儿 response） | `parseResponse` 调 `pendingMap.delete(id)`——若 id 不在 Map，delete 是 no-op（Map.delete 对不存在 key 返回 false 不报错）。仍产出 event（session_id/usage 提取不依赖 pendingMap）。Python 版用 `_early_responses` 缓存提前到达的 response（L64-66），Node 版简化：response 直接产出 event，编排层自行关联。 |
| **B-07-4** | `params.item` 结构不合规（缺 type / type 未知 / item 非 object） | `parseItemCompleted` / `parseItemStarted` 三层守卫：① `params.item` 非对象返回 null ② `itemType` 不在已知枚举（agentMessage/commandExecution/fileChange）返回 null ③ 必要字段缺失（如 agentMessage 无 text）返回 null。对照 Python L705-727 各分支早返回。fixture `codex/notification-item-unknown-type.json` 覆盖。 |
| **B-07-5** | JSON-RPC 版本字段 `jsonrpc` 不是 `"2.0"` | **不校验**（与 Python 一致——Python `_handle_line` 全程未检查 `jsonrpc` 字段）。理由：实测 codex/hermes/kimi/kiro 子进程都发 `"2.0"`，加校验反而可能误杀边缘实现。若未来出现版本漂移，再加 `if (msg.jsonrpc !== '2.0') return null` 守卫并补 fixture。JSDoc 标注此决策。 |
| **B-07-6** | 四 provider method 名冲突（如 kimi 的 `item/completed` 与 codex 语义不同） | 当前 `mapMethodName` 是 identity（四 provider 共享）。若 fixture 运行时发现某 provider 的 method 语义偏差，在 `mapMethodName` 内按 `this.provider` 分支重映射（如 `if (this.provider === 'kimi' && method === 'item/done') return 'item/completed'`）。**必须有 fixture 证据**，禁止预先臆造分支。当前无证据 → 无分支。 |
| **B-07-7** | id 为非 number（字符串 / null） | JSON-RPC 2.0 spec 允许 id 为 string/number，禁止 null（但实现可能违规）。本 adapter 用 `number \| string` 联合类型接 id，`pendingMap: Map<number\|string, ...>`。null id 按 JSON-RPC 规范是非法 request（应是 notification），走 `hasId` 判断时 `Object.prototype.hasOwnProperty.call(msg,'id')` 为 true 但值为 null——额外加守卫 `if (msg.id === null) return null`。fixture `codex/server-request-null-id.json` 覆盖。 |
| **B-07-8** | 空行 / 仅空白 / 非 JSON 噪声（git 提示、ANSI 残片） | `JSON.parse` 抛错 → catch 返回 null（对照 Python L177-179 `except JSONDecodeError: return None`）。不产出 error event（避免 backend 被噪声刷屏）。fixture `codex/malformed-line.txt`（非 JSON 文本）覆盖。 |
| **B-07-9** | `turn/completed` 缺 `turn` 对象或 `turn.status` | `parseTurnCompleted` 守卫 `if (!turn \|\| typeof turn !== 'object') return null`。`turn.status` 缺失走 `String(turn.status ?? '')` 得空串，不进 failed 分支，产出 `{type:'complete', metadata:{turn_status:''}}`。 |

---

## 非目标

本任务**不做**以下事项（明确排除，防止 scope creep）：

- **N-07-1**：不实现子进程执行（spawn / stdin 写入 / handshake 序列 / 超时看门狗）。Python `JsonRpcBackend.execute` + `_run_lifecycle`（L282-626）的全部执行逻辑下沉到 task-19 TaskRunner。本 adapter 只解析 stdout 行，不 spawn、不写 stdin（除 `markResponded` 提供 id 给 TaskRunner）。
- **N-07-2**：不实现 stdin 自动应答的 I/O。`APPROVAL_RESPONSES` 常量定义在本 adapter（因为 method 名是协议知识），但实际写 stdin 由 task-19 TaskRunner 调 `getPendingServerRequests()` 取条目后执行。本 adapter 的 `onControl` **不实现**（json_rpc 的 control 走 server request 分支，不走 `onControl` 钩子——`onControl` 是 stream_json 专用）。
- **N-07-3**：不实现 `getBackend` 工厂和 `PROTOCOL_PROVIDERS` 映射。在 task-11。本 adapter 只导出 `JsonRpcAdapter` 类 + `JsonRpcProvider` 类型 + `PendingServerRequest` 接口。
- **N-07-4**：不实现 thread_id 过滤（Python `on_notification` L348-350 的 `if current_thread_id and params.threadId != current_thread_id: return`）。这是编排层基于 session 状态的过滤，不是协议解析职责。adapter 把 thread_id 透到 event metadata，TaskRunner（task-19）持有 session_id 后自行过滤。
- **N-07-5**：不迁移全部 Python 测试用例。本任务的 fixture 仅覆盖「四 provider × 三分支（notification/server request/response）」的核心等价样本（约 12-16 个 fixture 文件）。完整的 16 个 Python 测试文件迁移在 task-22（含 handshake 全流程 / timeout / cmd_not_found 等集成测试，依赖 task-19 TaskRunner）。
- **N-07-6**：不处理 codex 的 `app-server --listen stdio://` 子命令构造。这是 spawn 层差异（Python `_PROVIDER_COMMANDS` L32-37），在 task-19 TaskRunner 的 spawn 命令构造逻辑里处理。本 adapter 的 `provider` 字段不参与命令构造。
- **N-07-7**：不重新定义 `AgentEvent` / `AgentEventType`。从 task-02 的 `types.ts` import。若 task-02 的 `AgentEventType` 未含 `'status'`（turn/started 需要），搬砖工应回头补 task-02，不在本 adapter 里 hack。

---

## 参考

- **Python 源**：`sillyhub-daemon/sillyhub_daemon/backends/json_rpc.py`
  - `parse_output`（L678-750）：method→event 映射的核心逻辑，本 adapter 的 `parseNotification` + `parseItemCompleted` + `parseItemStarted` 1:1 翻译自此。
  - `_handle_line`（L174-201）：三分支判断顺序（response / server request / notification），本 adapter 的 `parse` 三分支顺序对齐。
  - `_handle_server_request`（L230-249）：5 个 approval method 名 + auto-accept 语义，本 adapter 的 `APPROVAL_RESPONSES` 常量逐字拷贝。
  - `_handle_response`（L203-228）：error/result 分支 + thread.id 提取，本 adapter 的 `parseResponse` 翻译自此（Node 版额外产出 event，Python 版只 resolve Future）。
  - `on_notification`（L343-432）：execute 内联的 notification 处理，含 usage 三字段兜底（L368-372 `usage ?? token_usage ?? tokens`）——本 adapter 的 `parseTurnCompleted` 复用此兜底逻辑。
  - `_PROVIDER_COMMANDS`（L32-37）：四 provider 的 spawn 子命令差异——**本 adapter 不用**（spawn 层，task-19），仅作 provider 差异定位参考。
- **Python 测试**：`sillyhub-daemon/tests/test_json_rpc.py`
  - `_make_rpc_response` / `_make_rpc_notification` / `_make_rpc_server_request`（L81-108）：三个 helper，fixture 样本 1:1 提取自此处的实际调用。
  - `test_backend_parse_output_*`（L579-733）：7 个 parse_output 单测，是本 adapter vitest 用例的等价目标。
  - `test_transport_server_request_auto_approval`（L203-239）：approval 样本来源。
- **AgentEvent 字段定义**：`sillyhub-daemon/sillyhub_daemon/backends/__init__.py`
  - `AgentEvent` dataclass（L19-31）：七字段（event_type/content/tool_name/call_id/tool_input/tool_output/status/level/session_id）→ task-02 TS IR 的 `{type, content, metadata}` 映射依据。
  - `PROTOCOL_PROVIDERS`（L81-87）：`json_rpc: ['codex','hermes','kimi','kiro']`——本 adapter 覆盖范围。
- **design.md**：
  - §7.1 统一中间表示 AgentEvent（IR）—— `type` / `content` / `metadata` 三字段，本 adapter 产出的 event 结构。
  - §7.3 工厂与映射 —— `json_rpc: ['codex','hermes','kimi','kiro']` 注册在 task-11。
  - §10 R-01（协议解析翻译偏差 P0）→ 本任务用 fixture 1:1 复用应对。
  - §10 R-03（stdin control_request hang P1）→ 本任务的 `PendingServerRequest` + `markResponded` 把应答 I/O 下沉 TaskRunner，解析层无 stdin 依赖。
- **模块文档**：`.sillyspec/docs/sillyhub-daemon/modules/backends.md`
  - 「契约摘要」AgentEvent 字段列表。
  - 「注意事项」`AgentEvent.event_type` 值域含 `'status'`（turn/started 映射依据）。
- **task-05**：`ProtocolAdapter` 接口契约（parse 返回 `AgentEvent[] | null`、onControl 可选、实例可有状态 B-03）。
- **plan.md**：task-07 行（L83）「codex/hermes/kimi/kiro；JSON-RPC 2.0 stdio（method/params/id）」。

---

## TDD 步骤

遵循「提取 Python 样本 → RED → GREEN → REFACTOR」循环。所有 fixture 从 `test_json_rpc.py` 的三个 helper 实际调用处提取，不手写。

### Step 1：提取 fixture（RED 前置）

在 `sillyhub-daemon/tests/fixtures/json-rpc/` 下按 provider 建子目录，每个 `.json` 文件是单行 JSON（stdout 一行对齐）。**样本来源标注**（注释在相邻的 `.source.md` 或文件名后缀）：

```
tests/fixtures/json-rpc/
├── codex/
│   ├── notification-item-completed-agentMessage.json      # 源: test L585-591
│   ├── notification-item-completed-commandExecution.json  # 源: test L626-636
│   ├── notification-item-completed-fileChange.json        # 源: test L665-671
│   ├── notification-item-started-commandExecution.json    # 源: test L605-611
│   ├── notification-item-started-fileChange.json          # 源: test L652-658
│   ├── notification-turn-started.json                     # 源: test L705-711
│   ├── notification-turn-completed.json                   # 源: test L1023-1029
│   ├── notification-turn-completed-failed.json            # 源: test L919-932
│   ├── server-request-commandExecution-approval.json      # 源: test L210-217
│   ├── response-thread-start.json                         # 源: test L128 response_line
│   ├── response-initialize.json                           # 源: test L257
│   └── malformed-line.txt                                 # 源: test L526 "this is not valid json"
├── hermes/   # 复用 codex 同款样本（验证 method 名等价）
│   ├── notification-item-completed-agentMessage.json
│   ├── server-request-fileChange-approval.json            # applyPatchApproval
│   └── response-thread-start.json
├── kimi/     # 复用 codex 同款
│   ├── notification-item-started-commandExecution.json
│   └── server-request-execCommandApproval.json            # execCommandApproval method
├── kiro/     # 复用 + mcpServer/elicitation
│   ├── notification-item-completed-fileChange.json
│   └── server-request-mcp-elicitation.json                # mcpServer/elicitation/request
└── README.md  # 标注每个 fixture 的 Python 源行号
```

### Step 2：RED（写测试，跑失败）

`tests/adapters/json-rpc.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JsonRpcAdapter } from '../../src/adapters/json-rpc.js';
import type { AgentEvent } from '../../src/types.js';

const FIXTURE_DIR = join(__dirname, '../fixtures/json-rpc');

function loadFixture(provider: string, name: string): string {
  return readFileSync(join(FIXTURE_DIR, provider, name), 'utf-8').trim();
}

describe('JsonRpcAdapter - codex notification', () => {
  const adapter = new JsonRpcAdapter('codex');

  it('item/completed agentMessage → text event', () => {
    const line = loadFixture('codex', 'notification-item-completed-agentMessage.json');
    const events = adapter.parse(line);
    expect(events).not.toBeNull();
    expect(events!.length).toBe(1);
    expect(events![0].type).toBe('text');
    expect(events![0].content).toBe('Hello');  // 源 test L596
  });

  it('item/completed commandExecution → tool_result', () => {
    const line = loadFixture('codex', 'notification-item-completed-commandExecution.json');
    const events = adapter.parse(line);
    expect(events![0].type).toBe('tool_result');
    expect(events![0].metadata?.tool_name).toBe('exec_command');
    expect(events![0].content).toContain('file1.txt');  // 源 test L642
  });

  it('item/started commandExecution → tool_use', () => {
    const line = loadFixture('codex', 'notification-item-started-commandExecution.json');
    const events = adapter.parse(line);
    expect(events![0].type).toBe('tool_use');
    expect(events![0].metadata?.call_id).toBe('i2');  // 源 test L617
    expect(events![0].content).toBe('ls -la');
  });

  it('turn/started → status running', () => {
    const line = loadFixture('codex', 'notification-turn-started.json');
    const events = adapter.parse(line);
    expect(events![0].type).toBe('status');
    expect(events![0].content).toBe('running');
  });

  it('turn/completed → complete event (not null)', () => {
    const line = loadFixture('codex', 'notification-turn-completed.json');
    const events = adapter.parse(line);
    // Node 版差异：Python 返回 None，Node 产出 complete event
    expect(events).not.toBeNull();
    expect(events!.some(e => e.type === 'complete')).toBe(true);
  });
});

describe('JsonRpcAdapter - server request (pending id)', () => {
  it('commandExecution approval → tool_use + records pending id', () => {
    const adapter = new JsonRpcAdapter('codex');
    const line = loadFixture('codex', 'server-request-commandExecution-approval.json');
    const events = adapter.parse(line);
    expect(events![0].type).toBe('tool_use');
    expect(events![0].metadata?.auto_accept).toBe(true);
    expect(events![0].metadata?.response_template).toEqual({ decision: 'accept' });
    // AC-03: pending id 已记录
    const pending = adapter.getPendingServerRequests();
    expect(pending.length).toBe(1);
    expect(pending[0].id).toBe(10);  // 源 test L238
  });

  it('markResponded removes pending id', () => {
    const adapter = new JsonRpcAdapter('codex');
    const line = loadFixture('codex', 'server-request-commandExecution-approval.json');
    adapter.parse(line);
    adapter.markResponded(10);
    expect(adapter.getPendingServerRequests().length).toBe(0);
  });
});

describe('JsonRpcAdapter - response', () => {
  it('thread/start response → complete event with session_id', () => {
    const adapter = new JsonRpcAdapter('codex');
    const line = loadFixture('codex', 'response-thread-start.json');
    const events = adapter.parse(line);
    const complete = events!.find(e => e.type === 'complete');
    expect(complete).toBeDefined();
    expect(complete!.metadata?.session_id).toBe('t_abc');  // 源 test L149
  });
});

describe('JsonRpcAdapter - four providers equivalence', () => {
  // AC-01: 四 provider 同款样本产出等价 event
  it.each(['codex', 'hermes', 'kimi', 'kiro'] as const)(
    '%s parses item/completed agentMessage identically',
    (provider) => {
      const adapter = new JsonRpcAdapter(provider);
      const line = loadFixture(provider, 'notification-item-completed-agentMessage.json');
      const events = adapter.parse(line);
      expect(events![0].type).toBe('text');
    },
  );
});

describe('JsonRpcAdapter - boundary', () => {
  it('malformed line → null', () => {
    const adapter = new JsonRpcAdapter('codex');
    const line = loadFixture('codex', 'malformed-line.txt');
    expect(adapter.parse(line)).toBeNull();
  });

  it('empty string → null', () => {
    const adapter = new JsonRpcAdapter('codex');
    expect(adapter.parse('')).toBeNull();
  });
});
```

跑 `npx vitest run tests/adapters/json-rpc.test.ts` → **全部失败**（adapter 未实现）。

### Step 3：GREEN（实现 adapter）

按 §接口定义 的骨架实现 `src/adapters/json-rpc.ts`，逐个用例跑通。优先级：notification → server request → response（与 Python parse_output 的覆盖密度对齐）。

### Step 4：REFACTOR

- 提取 `parseItemCompleted` / `parseItemStarted` / `parseTurnCompleted` 为独立私有方法（已在骨架中）。
- 检查 `metadata` 字段命名一致性（`call_id` / `tool_name` / `session_id` / `usage` 全小写下划线，与 Python 字段名对齐便于 task-22 测试迁移时语义对照）。
- 跑 `npx tsc --noEmit` 确认零错误。

---

## 验收标准

| 编号 | 验收项 | 验证方法 | 通过标准 |
|---|---|---|---|
| **AC-01** | 四 provider 各样本产出等价 AgentEvent | `npx vitest run tests/adapters/json-rpc.test.ts` 的 `four providers equivalence` describe 块 | codex/hermes/kimi/kiro 四组 `it.each` 全绿；每组至少 1 个 notification + 1 个 server request + 1 个 response 样本断言通过 |
| **AC-02** | notification / server request / response 三分支正确分流 | vitest 用例 `JsonRpcAdapter - codex notification` + `server request` + `response` 三个 describe 块 | notification 5 用例（agentMessage/commandExecution/fileChange/item-started/turn-started）+ server request 2 用例（approval+markResponded）+ response 1 用例（thread_id 提取）全绿 |
| **AC-03** | 待应答 server request id 正确记录与消费 | vitest 用例 `commandExecution approval → records pending id` + `markResponded removes pending id` | parse 后 `getPendingServerRequests().length === 1` 且 id 匹配 fixture；`markResponded(id)` 后 length === 0 |
| **AC-04** | vitest 全绿 | `cd sillyhub-daemon && npx vitest run tests/adapters/json-rpc.test.ts` | 退出码 0，全部用例通过，无 skip/only |
| **AC-05** | TypeScript 编译零错误 | `cd sillyhub-daemon && npx tsc --noEmit` | 退出码 0，无 error/warning；`JsonRpcAdapter` 满足 `ProtocolAdapter` 接口（implements 通过） |
| **AC-06** | fixture 覆盖四 provider × 三分支 | `find tests/fixtures/json-rpc -name '*.json' \| wc -l` | ≥12 个 fixture 文件；codex/hermes/kimi/kiro 各 ≥1 份；notification/server-request/response 三类各 ≥1 份 |
| **AC-07** | `APPROVAL_RESPONSES` 5 个 method 名逐字对齐 Python | `grep -E 'item/commandExecution/requestApproval\|execCommandApproval\|item/fileChange/requestApproval\|applyPatchApproval\|mcpServer/elicitation/request' src/adapters/json-rpc.ts` | 命中 5 行，method 名与 Python json_rpc.py L237-247 完全一致 |
| **AC-08** | 坏行不抛异常 | vitest `boundary` describe 块 + `malformed-line.txt` / 空字符串用例 | 返回 null，不抛异常，退出码 0 |
| **AC-09** | 仅触碰 allowed_paths 内文件 | `git diff --name-only` + `git status --porcelain` | 只有 `src/adapters/json-rpc.ts` + `tests/fixtures/json-rpc/**` + `tests/adapters/json-rpc.test.ts`（test 文件计入 allowed_paths 的 fixture 目录同级，验收时确认） |
| **AC-10** | `onControl` 未实现（json_rpc 不需要） | `grep 'onControl' src/adapters/json-rpc.ts` | 0 命中（json_rpc 的应答走 server request 分支 + TaskRunner，不走 onControl 钩子） |

---

## 实现顺序建议（搬砖工参考）

1. 先建 fixture 目录 + 提取 4-5 个核心样本（codex notification agentMessage / commandExecution / server request approval / response thread-start / malformed）。
2. 写 `json-rpc.test.ts` 的 RED 用例，跑失败确认测试能跑。
3. 实现 `JsonRpcAdapter` 骨架（constructor + parse 三分支路由 + 三个私有 parse 方法）。
4. 逐用例 GREEN，每绿一个 commit 一次。
5. 补 hermes/kimi/kiro fixture（复用 codex 样本，验证四 provider 等价）。
6. REFACTOR + tsc 全绿 + vitest 全绿 → 交付。
