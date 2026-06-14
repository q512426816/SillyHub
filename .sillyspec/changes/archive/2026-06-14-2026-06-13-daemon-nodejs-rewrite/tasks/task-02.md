---
author: qinyi
created_at: 2026-06-14T00:08:01+0800
id: task-02
title: 共享类型定义（src/types.ts：AgentEvent / TaskResult / DaemonMessage / Lease payload）
priority: P0
estimated_hours: 2
depends_on: [task-01]
blocks: [task-05, task-17, task-19, task-20, task-22]
allowed_paths:
  - sillyhub-daemon/src/types.ts
---

# task-02: 共享类型定义（src/types.ts：AgentEvent / TaskResult / DaemonMessage / Lease payload）

> 变更：`2026-06-13-daemon-nodejs-rewrite`，Wave W0，依赖 task-01（Node 工程 + tsconfig strict）。
> 本蓝图产出 `sillyhub-daemon/src/types.ts`——所有 daemon 模块共享的纯类型定义。
> 字段名/语义与 Python 源 1:1 对应；AgentEvent IR 按 design.md §7.1 的方案B 深化版（type 5 元组）落地，而 Python dataclass 的 6 种 event_type 收敛于此 IR（thinking/status 合入 metadata）。

---

## 修改文件

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | `sillyhub-daemon/src/types.ts` | 全模块共享 TS 类型定义，纯 type/interface，零运行时代码 |

依赖文件（仅 type-only import，避免运行时耦合）：

| 文件路径 | 引用内容 |
|---|---|
| `sillyhub-daemon/src/protocol.ts`（task-03 产出） | `MsgType`（消息类型字符串字面量 union），由 `DaemonMessage.type` 引用 |

> 注意：types.ts 与 protocol.ts 之间通过 `import type { MsgType } from './protocol.js'` 建立依赖。protocol.ts 只导出常量值与 `MsgType` union，不反向依赖 types.ts，无循环。

---

## 实现要求

逐条列出要定义的类型 + 来源 Python 文件 + 对应关系：

1. **AgentEventType**（union）— 来源：design.md §7.1（方案B IR 深化）；Python `backends/__init__.py:23` 的 `event_type: str` 注释 "text/tool_use/tool_result/thinking/status/error" 收敛为 5 元组（thinking/status 通过 metadata 携带）。

2. **AgentEvent**（interface）— 来源：design.md §7.1 + Python `backends/__init__.py:19-31` 的 dataclass。字段扁平化为 `{ type, content, metadata? }`，Python 的 `tool_name`/`call_id`/`tool_input`/`tool_output`/`status`/`level`/`session_id` 全部收进 `metadata`（避免每个事件都带一长串可选字段）。

3. **TaskResultStatus**（union）— 来源：Python `backends/__init__.py:38` 注释 "completed/failed/timeout/aborted"。

4. **BackendTaskResult**（interface）— 来源：Python `backends/__init__.py:34-43` 的 `TaskResult` dataclass（backend 层返回的执行结果，字段：status, output, error, duration_ms, session_id, events）。对应 design.md §7.2 的 `BackendExecResult`，但字段名对齐 Python 真实定义。

5. **TaskResult**（interface）— 来源：Python `task_runner.py:36-48` 的 `TaskResult` dataclass（TaskRunner 返回给 daemon 的最终结构，字段：success, exit_code, patch, files_changed, insertions, deletions, output, error, duration_ms, metadata）。这是 `complete_lease` 提交给 server 的数据来源。

6. **TaskState**（union）— 来源：Python `protocol.py:23-27` 的 `STATE_*` 常量（pending/running/completed/failed/cancelled）。本 types.ts 只放 union 类型字面量，常量值在 task-03 protocol.ts。

7. **DaemonMessage**（interface，通用信封）— 来源：Python `daemon.py:239-256` 的 WS 消息结构 `{ type: str, payload: dict }`。`type` 字段为 `MsgType`（从 protocol.ts import type），`payload` 为 `unknown`（具体形状由各消息 handler 在使用点收窄）。

8. **LeaseCtx / LeasePayload**（interface，task_available 携带的执行上下文）— 来源：Python `task_runner.py:77-105` 的 `payload: dict[str, Any]` 字段提取 + `daemon.py:199-206` 的 poll fallback payload。字段：`lease_id, agent_run_id, runtime_id, workspace_name, repo_url, branch, claude_md, provider, cmd_path, cmd, prompt, model, session_id, resume_session_id, timeout, tool_config`。Python 用 `payload.get("cmd_path")` 和 `payload.get("cmd")` 两种命名（不同来源），Node 版统一为可选双字段。

9. **LeaseClaimResult**（interface）— 来源：Python `daemon.py:280-306` 的 `claim_lease` 响应结构（claim_resp.get 提取的字段）：`lease_id, claim_token, payload, lease_expires_at`。

10. **LeaseMessage**（interface，submit_messages 单条消息）— 来源：Python `task_runner.py:285-311` 的 `_event_to_message` 构造的 dict + `client.py:151-168` 的 messages list 元素。字段：`event_type, content?, tool_name?, call_id?, status?, level?, session_id?`（后 6 个在 Python 中条件加入）。

11. **LeaseCompleteResult**（interface）— 来源：Python `daemon.py:318-329` 的 `complete_lease` result 字段构造（TaskResult 序列化形态）：`success, output, error, patch, files_changed, insertions, deletions, duration_ms, session_id`。

---

## 接口定义（完整 TS 代码，照抄即可）

> 文件：`sillyhub-daemon/src/types.ts`
> 规则：strict 模式下零 `any`；可选字段用 `?`；空值用 `string | null`（Python `str | None`）或可选（Python 默认空串）；JSON 可序列化（不嵌函数/Class）。

```ts
/**
 * sillyhub-daemon 共享类型定义。
 *
 * 本文件只导出 type / interface，不含任何运行时代码。
 * 字段名与 Python 源 dataclass 1:1 对应（snake_case → snakeCase 不做，
 * 保持 Python 原名以便对照调试；与 server JSON 契约一致）。
 *
 * 来源对照：
 *   - AgentEvent IR:        design.md §7.1（方案B 深化）+ backends/__init__.py:19-31
 *   - TaskResult:           task_runner.py:36-48
 *   - BackendTaskResult:    backends/__init__.py:34-43
 *   - TaskState:            protocol.py:23-27
 *   - DaemonMessage:        daemon.py:239-256
 *   - LeaseCtx / payload:   task_runner.py:77-105 + daemon.py:199-206
 *   - LeaseClaimResult:     daemon.py:280-306
 *   - LeaseMessage:         task_runner.py:285-311
 *   - LeaseCompleteResult:  daemon.py:318-329
 */

// 消息类型字符串字面量 union，来自 protocol.ts（task-03 产出）。
// 仅 type-only import，不引入运行时依赖。
import type { MsgType } from './protocol.js';

// ─────────────────────────────────────────────────────────────────────────────
// 1. Agent 事件 IR（统一中间表示）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Agent 事件类型字面量 union（方案B IR 深化版）。
 *
 * 对应 Python `backends/__init__.py:23` 的 event_type 注释，但收敛为 5 元组：
 *   - Python 原 6 种：text, tool_use, tool_result, thinking, status, error
 *   - Node IR 5 种：text, tool_use, tool_result, error, complete
 * thinking / status 两类事件合入 `type: 'text'` + metadata.status/thinking。
 */
export type AgentEventType =
  | 'text'
  | 'tool_use'
  | 'tool_result'
  | 'error'
  | 'complete';

/**
 * 单条 agent 事件 IR。所有协议 adapter 的 parse() 产出此结构。
 *
 * 对照 Python `backends/__init__.py:19-31` 的 AgentEvent dataclass：
 *   event_type      → type（rename，避免与 JS 联想混淆）
 *   content         → content（保留）
 *   tool_name       → metadata.tool_name
 *   call_id         → metadata.call_id
 *   tool_input      → metadata.tool_input
 *   tool_output     → metadata.tool_output
 *   status          → metadata.status
 *   level           → metadata.level
 *   session_id      → metadata.session_id
 */
export interface AgentEvent {
  /** 事件类型，穷举见 AgentEventType。 */
  type: AgentEventType;
  /** 文本内容 / 工具入参 JSON / 工具结果 / 错误信息。空字符串表示无文本。 */
  content: string;
  /**
   * 可选元数据，开放结构。
   * 已知 key（来自 Python dataclass 收敛）：tool_name, call_id, tool_input,
   * tool_output, status, level, session_id, usage, model 等。
   */
  metadata?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Backend 执行结果（adapter 子进程返回）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * backend 层任务状态字面量。
 * 对照 Python `backends/__init__.py:38` 注释："completed/failed/timeout/aborted"。
 */
export type TaskResultStatus =
  | 'completed'
  | 'failed'
  | 'timeout'
  | 'aborted';

/**
 * Agent 后端（adapter）执行返回的结构化结果。
 *
 * 对照 Python `backends/__init__.py:34-43` 的 TaskResult dataclass：
 *   status, output, error, duration_ms, session_id, events
 * 对应 design.md §7.2 的 BackendExecResult（字段名对齐 Python 原定义）。
 */
export interface BackendTaskResult {
  /** 终态：completed | failed | timeout | aborted。 */
  status: TaskResultStatus;
  /** 累积的文本输出。 */
  output: string;
  /** 错误信息（失败时非空）。Python 默认空串 → 此处可选。 */
  error?: string;
  /** 执行耗时（毫秒）。Python 默认 0。 */
  durationMs?: number;
  /** 会话 ID（多轮续跑用）。Python 默认空串 → 此处可选。 */
  sessionId?: string;
  /** 事件流（若后端保留了完整事件序列）。Python 默认空 list。 */
  events?: AgentEvent[];
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. TaskRunner 最终结果（提交给 server）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * TaskRunner 执行完一个 lease 后产出的最终结果。
 * 被 complete_lease 序列化为 LeaseCompleteResult 提交。
 *
 * 对照 Python `task_runner.py:36-48` 的 TaskResult dataclass 字段 1:1：
 *   success, exit_code, patch, files_changed, insertions, deletions,
 *   output, error, duration_ms, metadata
 */
export interface TaskResult {
  /** 任务是否成功。 */
  success: boolean;
  /** 子进程退出码，0 成功 / 1 失败 / -1 未执行。Python 默认 -1。 */
  exitCode: number;
  /** git diff patch 文本（unified diff）。空串表示无变更。 */
  patch: string;
  /** 变更文件数。 */
  filesChanged: number;
  /** diff 新增行数。 */
  insertions: number;
  /** diff 删除行数。 */
  deletions: number;
  /** 截断后的文本输出（≤ 10000 字符）。 */
  output: string;
  /** 截断后的错误信息（≤ 5000 字符）。 */
  error: string;
  /** 执行耗时（毫秒）。 */
  durationMs: number;
  /** 额外元数据（如 session_id）。Python 默认空 dict。 */
  metadata: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. 任务状态
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 任务 / lease 状态字面量 union。
 * 对照 Python `protocol.py:23-27` 的 STATE_* 常量值。
 * （常量值定义在 protocol.ts，此处仅类型。）
 */
export type TaskState =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

// ─────────────────────────────────────────────────────────────────────────────
// 5. WebSocket 消息信封
// ─────────────────────────────────────────────────────────────────────────────

/**
 * daemon ↔ server 之间的通用 WS 消息信封。
 *
 * 对照 Python `daemon.py:239-256` 的 `msg = json.loads(raw_msg)` 结构：
 *   { "type": "daemon:task_available", "payload": { ... } }
 *
 * type 为 MsgType 字面量 union（来自 protocol.ts），
 * payload 为 unknown，由各消息 handler 在使用点用类型守卫/断言收窄。
 */
export interface DaemonMessage<T extends MsgType = MsgType> {
  /** 消息类型字符串，如 "daemon:task_available"。 */
  type: T;
  /** 消息负载，具体形状取决于 type；使用点收窄。 */
  payload: unknown;
}

/**
 * task_available 消息的 payload 形状（DaemonMessage<'daemon:task_available'>）。
 * 对照 Python `daemon.py:259-263` + `_execute_task(payload)`。
 * 实质与 LeasePayload 同构（claim_lease 后再注入 claim_token 等）。
 */
export type TaskAvailablePayload = LeasePayload;

// ─────────────────────────────────────────────────────────────────────────────
// 6. Lease 相关类型
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 凭据占位符配置（tool_config 的形态）。
 * Python `task_runner.py:129` `credential_config = payload.get("tool_config", {})`
 * 传给 credential_manager.build_env，本质是 Record<string, string>。
 */
export type ToolConfig = Record<string, string>;

/**
 * Lease 执行上下文（claim_lease 响应中的 payload 或 task_available 直带）。
 *
 * 对照 Python `task_runner.py:77-150` 的 payload.get(...) 全部字段 +
 * `daemon.py:199-206` 的 poll fallback payload（lease_id, agent_run_id,
 * runtime_id, prompt, provider, cmd_path）。
 *
 * 注：Python 同时出现 `cmd_path`（task_runner:135）和 `cmd`（design §7.5）
 * 两种命名（不同来源/版本），Node 版统一保留双字段可选以兼容。
 */
export interface LeaseCtx {
  /** 服务端 lease 唯一标识。 */
  leaseId: string;
  /** 当前 runtime 标识（注册后由 server 分配）。 */
  runtimeId: string;
  /** agent run 标识（用于 submit_messages 路由）。Python 默认空串。 */
  agentRunId?: string;
  /** workspace 名称（本地 mirror 目录名）。Python 默认 "default"。 */
  workspaceName?: string;
  /** git 仓库 URL。Python 默认 None → null。 */
  repoUrl?: string | null;
  /** git 分支名。Python 默认 "main"。 */
  branch?: string;
  /** 写入 .claude/CLAUDE.md 的内容。Python 默认空串。 */
  claudeMd?: string;
  /** agent provider 名称（claude/codex/...）。Python 默认 "claude"。 */
  provider?: string;
  /** agent CLI 可执行路径（Python 字段名 cmd_path）。 */
  cmdPath?: string;
  /** agent CLI 命令（与 cmdPath 同义，design.md 命名，二选一）。 */
  cmd?: string;
  /** 任务 prompt 文本。 */
  prompt?: string;
  /** 模型名（覆盖 provider 默认）。 */
  model?: string;
  /** 续跑用 session ID。 */
  sessionId?: string;
  /** 恢复指定 session（Python `resume_session_id`）。 */
  resumeSessionId?: string;
  /** 执行超时秒数，0 表示不限。 */
  timeout?: number;
  /** 凭据/工具配置，渲染成环境变量。 */
  toolConfig?: ToolConfig;
}

/**
 * task_available 消息直接携带的 lease 初始 payload。
 * 与 LeaseCtx 同构（task_available 阶段尚无 claim_token）。
 */
export type LeasePayload = LeaseCtx;

/**
 * claim_lease 接口的响应结构。
 *
 * 对照 Python `daemon.py:280-306`：
 *   claim_resp.get("claim_token")
 *   claim_resp.get("lease_expires_at")
 *   claim_resp.get("payload")  # 内嵌执行上下文
 */
export interface LeaseClaimResult {
  /** lease 唯一标识（回显）。 */
  leaseId?: string;
  /** 后续 start/messages/complete 必须携带的令牌。 */
  claimToken: string;
  /** claim 过期时间（ISO 字符串或 epoch）。 */
  leaseExpiresAt?: string;
  /** 内嵌的执行上下文（task_available payload 形态）。 */
  payload?: LeasePayload;
}

/**
 * submit_messages 单条消息的序列化结构。
 *
 * 对照 Python `task_runner.py:285-311` 的 _event_to_message 构造：
 *   event_type（必填）, content?, tool_name?, call_id?, status?, level?,
 *   session_id?（条件加入，空值不写）。
 * 此结构与 server `POST /api/daemon/leases/{id}/messages` body.messages 元素对齐。
 */
export interface LeaseMessage {
  /** 事件类型（Python 原始 event_type 字符串，未做 IR 收敛）。 */
  eventType: string;
  /** 文本内容（非空时才序列化）。 */
  content?: string;
  /** 工具名（非空时才序列化）。 */
  toolName?: string;
  /** 工具调用 ID。 */
  callId?: string;
  /** 状态值（status 事件用）。 */
  status?: string;
  /** 日志级别（log/error 事件用）。 */
  level?: string;
  /** 会话 ID（system/result 事件用）。 */
  sessionId?: string;
}

/**
 * complete_lease 提交的 result 字段结构。
 *
 * 对照 Python `daemon.py:318-329` 显式构造的 dict：
 *   success, output, error, patch, files_changed, insertions, deletions,
 *   duration_ms, session_id（从 metadata 取）
 * 即 TaskResult 的「线上序列化形态」。
 */
export interface LeaseCompleteResult {
  success: boolean;
  output: string;
  error?: string;
  patch?: string;
  filesChanged?: number;
  insertions?: number;
  deletions?: number;
  durationMs?: number;
  /** 从 TaskResult.metadata.session_id 提取。 */
  sessionId?: string;
}
```

---

## 边界处理

1. **可选字段统一用 `?`，JSON 序列化时省略键**：Python dataclass 中「默认空串 / 默认 0 / 默认 None」的字段，TS 中若语义是「可选/可能缺失」则用 `?`（如 `error?: string`），若语义是「必有但可能空」则不带 `?` 且赋默认值（如 `TaskResult.patch: string`，空时为 `""`）。区分依据：Python 默认值是 `""`/`0` 的「占位」语义 → `?`；Python 默认值是 `field(default_factory=...)` 或必填 → 必填。

2. **union 类型穷举，禁用 `string` 通配**：`AgentEventType` / `TaskResultStatus` / `TaskState` 全部用字面量 union 显式列出。新增成员需改本文件，触发 tsc 全量类型检查，防止拼写错误。

3. **metadata 开放结构**：`AgentEvent.metadata` 与 `TaskResult.metadata` 用 `Record<string, unknown>` 而非具体 interface——协议多样、字段会演进，开放结构避免频繁改类型。已知 key 在 JSDoc 注释中列出（tool_name/call_id/tool_input/tool_output/status/level/session_id/usage/model）供消费方参考。

4. **与 protocol.ts 的循环引用避免**：`types.ts` 只 `import type { MsgType } from './protocol.js'`（type-only，编译后抹除），protocol.ts 不反向 import types.ts。单向依赖，无 cycle。若未来 protocol.ts 需要引用类型，改为在被引文件中定义或抽 `types-internal.ts`。

5. **null vs undefined 约定**：Python `str | None` 对应 TS `string | null`（显式 null 表达「服务端明确返回 null」），Python「字段不存在」对应 TS optional `?`（undefined）。例：`LeaseCtx.repoUrl?: string | null`——可能不存在（undefined）或服务端返回 null（仓库未配置）。两者不混用：序列化时 `undefined` 省略键，`null` 写入 JSON null。

6. **零 `any`，strict 兼容**：所有 `Record<string, unknown>` 而非 `Record<string, any>`；`DaemonMessage.payload: unknown` 而非 `any`，强制使用点收窄（类型守卫或断言）。`tsconfig.json` 中 `strict: true` + `noImplicitAny: true` 下本文件零报错。

7. **字段命名：保留 Python 原名以便对照**：Python snake_case 字段（如 `files_changed`、`duration_ms`、`agent_run_id`）在 TS 接口中转为 camelCase（`filesChanged`、`durationMs`、`agentRunId`），因为 JSON 序列化时 Node 端默认按字段名输出——但 server 端 Python 字段是 snake_case。**关键约定**：提交给 server 的请求体（`LeaseMessage`/`LeaseCompleteResult`）字段名保持 snake_case 与 server JSON 契约一致（见接口注释），内部流转的 TS interface 用 camelCase，序列化层（task-19 HubClient）负责 case 转换。

8. **泛型 DaemonMessage**：`DaemonMessage<T extends MsgType = MsgType>` 支持精确收窄，如 `DaemonMessage<'daemon:task_available'>` 时 payload 类型可进一步约束为 `TaskAvailablePayload`。默认 `MsgType` 保持信封通用。

---

## 非目标（本任务明确不做）

- **N1**：不在本文件定义消息类型常量值（`MSG_TASK_AVAILABLE = 'daemon:task_available'` 等），常量在 task-03 `protocol.ts`。本文件只 `import type { MsgType }` 引用其字面量 union。
- **N2**：不写任何运行时代码（无 `const`/`function`/`class`/`enum`），纯 type/interface/type alias。`enum` 会产生运行时对象，违背「types.ts 零运行时」约定。
- **N3**：不导入除 protocol.ts 以外的任何模块（不引 `ws`/`http`/`commander` 等运行时依赖）。
- **N4**：不定义 DetectedAgent / AgentInfo（agent 探测结果类型）——放 task-21 agent-detector.ts 或单独文件，本任务聚焦 Event/Result/Lease 核心数据类型。
- **N5**：不定义 ProtocolAdapter 接口（design.md §7.2 的 adapter 抽象）——属 task-05 W1 协议抽象层范畴。
- **N6**：不定义 DaemonConfig / CredentialStore / WorkspaceInfo 等模块私有类型——各自模块文件内定义。

---

## 参考

### Python 源文件（字段提取依据）

| 文件 | 提取内容 |
|---|---|
| `sillyhub-daemon/sillyhub_daemon/backends/__init__.py:19-31` | `AgentEvent` dataclass（event_type, content, tool_name, call_id, tool_input, tool_output, status, level, session_id） |
| `sillyhub-daemon/sillyhub_daemon/backends/__init__.py:34-43` | `TaskResult` dataclass（backend 层：status, output, error, duration_ms, session_id, events） |
| `sillyhub-daemon/sillyhub_daemon/protocol.py:23-27` | `STATE_PENDING/RUNNING/COMPLETED/FAILED/CANCELLED` → TaskState union |
| `sillyhub-daemon/sillyhub_daemon/task_runner.py:36-48` | `TaskResult` dataclass（TaskRunner 层：success, exit_code, patch, files_changed, insertions, deletions, output, error, duration_ms, metadata） |
| `sillyhub-daemon/sillyhub_daemon/task_runner.py:77-150` | `execute_task(payload)` 的 payload 字段（workspace_name, repo_url, branch, claude_md, tool_config, provider, cmd_path, prompt, timeout, model, session_id, resume_session_id, agent_run_id） |
| `sillyhub-daemon/sillyhub_daemon/task_runner.py:285-311` | `_event_to_message` 构造的 dict（event_type, content, tool_name, call_id, status, level, session_id） → LeaseMessage |
| `sillyhub-daemon/sillyhub_daemon/client.py:112-182` | `claim_lease` / `start_lease` / `submit_messages` / `complete_lease` 的请求体结构 |
| `sillyhub-daemon/sillyhub_daemon/daemon.py:199-206` | poll fallback 的 payload 结构（lease_id, agent_run_id, runtime_id, prompt, provider, cmd_path） |
| `sillyhub-daemon/sillyhub_daemon/daemon.py:239-267` | WS 消息 `{ type, payload }` 信封 + `_handle_ws_message` 分发 |
| `sillyhub-daemon/sillyhub_daemon/daemon.py:280-340` | `_execute_task` 的 claim_resp 字段提取 + complete_lease result 构造 |

### 模块文档

| 文档 | 说明 |
|---|---|
| `.sillyspec/docs/sillyhub-daemon/modules/backends.md` | AgentEvent/TaskResult 契约摘要、event_type 值域（text/tool_use/tool_result/thinking/status/error） |
| `.sillyspec/docs/sillyhub-daemon/modules/task-runner.md` | TaskResult 字段、execute_task 编排链、output/error 截断限制 |
| `.sillyspec/docs/sillyhub-daemon/modules/client.md` | lease 生命周期 REST 端点、submit_messages/complete_lease 请求体形态 |
| `.sillyspec/docs/sillyhub-daemon/modules/protocol.md` | WS 消息类型常量清单、STATE_* 任务状态 |
| `.sillyspec/changes/2026-06-13-daemon-nodejs-rewrite/design.md` §7.1-7.5 | 方案B IR 定义（AgentEvent 5 元组）、ProtocolAdapter 接口、lease 编排骨架 |

---

## TDD 步骤

> 类型定义无运行时单测（纯 type，无逻辑可断言）。验证靠 TypeScript 编译器本身。

### 步骤 1：编写 types.ts（本蓝图接口定义照抄）

按上文「接口定义」章节完整写入 `sillyhub-daemon/src/types.ts`。

### 步骤 2：编写 protocol.ts 的 MsgType 占位（如 task-03 未产出）

若 task-03 protocol.ts 尚未产出，先在 types.ts 同目录创建最小占位：

```ts
// protocol.ts（占位，task-03 会覆盖）
export const MSG = {
  TASK_AVAILABLE: 'daemon:task_available',
  HEARTBEAT: 'daemon:heartbeat',
  HEARTBEAT_ACK: 'daemon:heartbeat_ack',
  REGISTER: 'daemon:register',
  LEASE_CLAIM: 'daemon:lease_claim',
  LEASE_START: 'daemon:lease_start',
  LEASE_COMPLETE: 'daemon:lease_complete',
  LEASE_MESSAGES: 'daemon:lease_messages',
} as const;

export type MsgType = (typeof MSG)[keyof typeof MSG];
```

### 步骤 3：类型断言测试（可选，确保类型可用）

在 `sillyhub-daemon/tests/types.test.ts`（task-04 脚手架就绪后）写 type-level 断言：

```ts
import { describe, it, expectTypeOf } from 'vitest';
import type {
  AgentEvent, AgentEventType, TaskResult, TaskState,
  DaemonMessage, LeaseCtx, LeaseClaimResult, LeaseMessage,
} from '../src/types.js';

describe('types.ts type assertions', () => {
  it('AgentEvent.type is exactly the 5-value union', () => {
    expectTypeOf<AgentEventType>().toEqualTypeOf<
      'text' | 'tool_use' | 'tool_result' | 'error' | 'complete'
    >();
  });

  it('TaskResult has all 10 required fields', () => {
    expectTypeOf<TaskResult>().toMatchTypeOf<{
      success: boolean;
      exitCode: number;
      patch: string;
      filesChanged: number;
      insertions: number;
      deletions: number;
      output: string;
      error: string;
      durationMs: number;
      metadata: Record<string, unknown>;
    }>();
  });

  it('TaskState is exactly the 5-value union', () => {
    expectTypeOf<TaskState>().toEqualTypeOf<
      'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
    >();
  });

  it('DaemonMessage payload is unknown by default', () => {
    expectTypeOf<DaemonMessage['payload']>().toEqualTypeOf<unknown>();
  });

  it('LeaseCtx.repoUrl accepts string | null | undefined', () => {
    const ctx: LeaseCtx = { leaseId: 'l1', runtimeId: 'r1', repoUrl: null };
    expectTypeOf(ctx.repoUrl).toEqualTypeOf<string | null | undefined>();
  });
});
```

### 步骤 4：tsc --noEmit 编译验证

```bash
cd sillyhub-daemon && npx tsc --noEmit
```

预期：零错误。若 protocol.ts 未产出，types.ts 的 `import type { MsgType }` 会报「找不到模块」，此时按步骤 2 创建占位。

---

## 验收标准

| AC | 标准 | 验证方法 |
|---|---|---|
| AC-01 | `npx tsc --noEmit` 在 `sillyhub-daemon/` 下零错误、零警告（strict + noImplicitAny） | 在 sillyhub-daemon 目录执行 tsc，exit code 0 |
| AC-02 | `AgentEventType` union 恰为 5 元组：`'text' \| 'tool_use' \| 'tool_result' \| 'error' \| 'complete'`，无多余成员 | grep `export type AgentEventType` 行，字面量数 = 5；或 expectTypeOf 断言通过 |
| AC-03 | `LeaseCtx` 字段与 Python `task_runner.py` payload.get 全部字段 1:1：leaseId, runtimeId, agentRunId, workspaceName, repoUrl, branch, claudeMd, provider, cmdPath, cmd, prompt, model, sessionId, resumeSessionId, timeout, toolConfig（共 16 个） | 人工对照 `task_runner.py:77-150` 逐字段核对 |
| AC-04 | 全文件零 `any` 类型（含隐式 any）；strict 模式下无 `// @ts-ignore` / `// @ts-expect-error` | grep `any\|@ts-ignore\|@ts-expect-error` 返回空 |
| AC-05 | `TaskResult` 字段与 Python `task_runner.py:36-48` 1:1：success, exitCode, patch, filesChanged, insertions, deletions, output, error, durationMs, metadata（共 10 个） | 人工对照 dataclass 字段 |
| AC-06 | `TaskState` union 恰为 5 元组：`'pending' \| 'running' \| 'completed' \| 'failed' \| 'cancelled'`，与 Python `protocol.py:23-27` 值一致 | grep + 对照 |
| AC-07 | types.ts 无运行时代码：grep `export const \|export function \|export class \|export enum ` 全空（只允许 `export type`/`export interface`） | grep 验证 |
| AC-08 | 唯一外部 import 为 `import type { MsgType } from './protocol.js'`，无其他模块依赖 | grep `^import ` 仅一行且为 type-only |
| AC-09 | `LeaseMessage` 字段对照 Python `_event_to_message`：eventType 必填，content/toolName/callId/status/level/sessionId 全部 `?` 可选 | 人工对照 `task_runner.py:285-311` |
| AC-10 | `LeaseCompleteResult` 字段对照 Python `daemon.py:318-329` 的 result dict：success, output, error, patch, filesChanged, insertions, deletions, durationMs, sessionId | 人工对照 |

---

## 自审清单（生成者自查）

- [x] 所有 interface/type 字段名来自真实 Python 源（backends/__init__.py, task_runner.py, protocol.py, daemon.py, client.py），未臆造
- [x] AgentEvent IR 按 design.md §7.1 的方案B 深化版（5 元组），不照搬 Python 6 元组
- [x] 可选字段用 `?`，null/undefined 语义在边界处理 #5 明确
- [x] 零运行时代码（只 export type/interface）
- [x] 与 protocol.ts 单向依赖，type-only import，无循环
- [x] 验收标准 10 条全部可机器/人工验证，非笼统「正确」
- [x] 非目标 6 条明确划界（不定义 DetectedAgent/ProtocolAdapter/DaemonConfig 等）
- [x] 边界处理 ≥ 5 条（实际 8 条）
