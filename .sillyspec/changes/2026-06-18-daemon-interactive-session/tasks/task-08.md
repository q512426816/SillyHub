---
author: qinyi
created_at: 2026-06-18T22:41:08
change: 2026-06-18-daemon-interactive-session
id: task-08
title: "canUseTool 远程人审闭环（SDK 回调 await WS 往返 + backend permission 链路 + 前端审批卡 + 5min 超时 deny）"
wave: W4
priority: P0
estimated_hours: 16
depends_on: [task-04, task-05]
blocks: [task-09, task-12]
requirement_ids: [FR-07]
decision_ids: [D-007@v1]
allowed_paths:
  - sillyhub-daemon/src/interactive/claude-sdk-driver.ts
  - sillyhub-daemon/src/interactive/session-manager.ts
  - sillyhub-daemon/src/interactive/permission-resolver.ts
  - sillyhub-daemon/src/ws-client.ts
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/tests/interactive/claude-sdk-driver-canuse.test.ts
  - sillyhub-daemon/tests/interactive/permission-resolver.test.ts
  - sillyhub-daemon/tests/ws-client-permission-route.test.ts
  - backend/app/modules/daemon/router.py
  - backend/app/modules/daemon/service.py
  - backend/app/modules/daemon/ws_hub.py
  - backend/app/modules/daemon/permission_service.py
  - backend/app/modules/daemon/tests/test_session_permissions.py
  - backend/app/modules/daemon/tests/test_ws_hub_permission.py
  - frontend/src/app/(dashboard)/runtimes/page.tsx
  - frontend/src/lib/daemon.ts
  - frontend/src/components/permission-approval-card.tsx
  - frontend/src/lib/__tests__/daemon-permission.test.ts
---

# task-08｜canUseTool 远程人审闭环（D-007@v1）

> v3 重做。依据 `plan.md` task-08（Wave4 P0，depends_on=[task-04, task-05]，blocks=[task-09, task-12]）、`requirements.md` FR-07、`design.md` §5 Wave2 / §7.1 / §7.3 / §7.6、`decisions.md` **D-007@v1**、`spike-02-architecture-validation.md` §3.7 **D2**（canUseTool 回调可 `await` 任意延迟、带 `AbortSignal`、claude 全程等待不超时）。
>
> **v2 → v3 关键差异**：v2（task-07 旧版）走 Claude `control_request` 流式协议，daemon 解析 stdin 行 + 构造 control_response 写回 child stdin；**v3 改为 `ClaudeSdkDriver` 的 `canUseTool` 回调（SDK `query({ options: { canUseTool } })` 注入）**，回调是 `async (toolName, input, { signal }) => Promise<{behavior:'allow'} | {behavior:'deny', message?}>`，daemon 在回调内 `await` WS 往返拿用户的 allow/deny，然后 resolve 回调（spike D2 已证明 SDK 等待回调 resolve 不超时、回调带 `AbortSignal`）。SDK 内部 stdin/stdout 管理权已转移给 SDK，**本任务不再碰 stdin / control_response**。
>
> **D-007@v1 三段链路（spike D2 不丢）**：
> 1. **daemon → backend**：canUseTool 回调被 SDK 触发时，daemon **不本地批准**，发 `PERMISSION_REQUEST`（session_id/run_id/request_id/tool_name/input/tool_use_id?）→ ws-client.send。
> 2. **backend → frontend → 用户**：backend WS 入站校验 → `_publish_session_event(permission_request)` 到 `agent_session:{session_id}` → 前端 session SSE 接住 → 弹审批卡 → 用户点 allow/deny → `POST /api/daemon/sessions/{id}/permissions/{request_id}/response`。
> 3. **backend → daemon resolve**：backend WS 下发 `PERMISSION_RESPONSE`（session_id/request_id/decision/message?）→ daemon ws-client 路由到 permission-resolver.resolve() → resolve 回调 → SDK 收到 allow/deny 继续执行或中止。**5min 未响应 backend 自动发 deny**（D-007 硬规则）。

## 1. 目标与硬约束

1. `ClaudeSdkDriver.canUseTool` 回调（task-04 已留 `canUseTool?` 钩子字段）落地为远程人审 await 往返：回调内构造 wire `request_id` → `wsClient.send(PERMISSION_REQUEST)` → `await` 一个 pending Promise（带 `AbortSignal` 透传 + 5min 兜底定时器双重保险）→ backend `PERMISSION_RESPONSE` 到达后 resolve 回调返回 `{behavior:'allow'}` 或 `{behavior:'deny', message}`。
2. daemon 不本地批准、不写 child stdin（v3 SDK 已管 stdin）；`manual_approval=false`（默认）时 driver 不注入 `canUseTool`，SDK 走内置默认策略（spike H1 行为不变）。
3. pending permission resolver 只活在当前 turn 的 SDK Query 协程内；`result` / interrupt / end / driver error / session ended 任一发生立即 abort 所有未决回调，绝不让回调悬空或跨 turn 命中。
4. backend 复用 task-05 建立的 `_publish_session_event` + `agent_session:{session_id}` channel + `_get_owned_session_for_update` 所有权模式；新增 `permission_service.py`（5min 超时定时器 + REST response 端点 + WS 双向路由），不新建 permission 数据库表（FR-07 审批是会话内瞬态，最终真值以 daemon `resolve()` 为准）。
5. 前端在 `runtimes/page.tsx`（D-006 全栈范围里前端会话面板的承载页；task-11/12 之前先在此挂审批卡）订阅 session SSE，识别 `event:"permission_request"` 后弹出 `PermissionApprovalCard`；用户 allow/deny 调 `lib/daemon.ts:respondSessionPermission()`。
6. 5min 超时由 **backend** 持有定时器（同一进程便于保证 daemon 必收 deny、便于日志审计），daemon 侧另设兜底定时器（5min + 容差， AbortSignal abort 时 deny），双保险防 WS 丢消息导致回调永久 hang。

## 覆盖来源

| 来源 | 要求/决策 | 本任务落实 |
|---|---|---|
| `plan.md` task-08 | Wave4 P0，depends_on=[task-04,task-05]，blocks=[task-09,task-12]；FR-07 / D-007@v1 | driver canUseTool 回调 await 往返 + backend permission REST/WS + 前端审批卡 |
| `requirements.md` FR-07 | canUseTool 触发 → daemon 不本地批准 → WS permission_request → 前端弹卡 → allow/deny → daemon resolve；**5min 未响应→deny** | 三段链路 + 5min 超时（backend 主 + daemon 兜底） |
| `decisions.md` **D-007@v1** | canUseTool 回调必须 await 远程人审结果（非本地策略自动放行）；经 WS→backend→frontend；默认 5min 超时 deny；复用 tool_gateway 审批框架理念 | 回调 async + await Promise + AbortSignal；backend REST response 端点 + ws_hub 下发；前端弹卡 UI 借鉴 `tool_gateway/approvals` 卡片样式 |
| `design.md` §5 Wave2 | Wave2 canUseTool 远程人审 + GLM 错误透传 | 本任务落 canUseTool 链路（GLM 透传属 task-09） |
| `design.md` §7.1 | ClaudeSdkDriver.canUseTool 回调签名 `{behavior:'allow'} | {behavior:'deny', message?}` | 回调返回类型逐字搬砖级对齐 |
| `design.md` §7.3 | PERMISSION_REQUEST/RESPONSE 协议 + payload（task-03 已定常量） | 本任务只消费，不重定义 |
| `design.md` §7.6 | turn/AgentRun 时序（每 result 边界） | pending resolver 在 result 后已 abort；不存在跨 run 命中 |
| `spike-02` §3.7 **D2** | canUseTool 回调内 `await 6000ms×3` claude 全程等待不超时，**回调带 AbortSignal**；caveat：GLM 后端 Write 失败非路线阻塞 | 回调 `await` WS 往返；AbortSignal 透传给 SDK；GLM caveat 归 task-09 |
| task-03 契约 | MSG.PERMISSION_REQUEST/RESPONSE 常量 + PermissionRequestPayload(session_id/run_id/request_id/tool_name/input/tool_use_id?) + PermissionResponsePayload(session_id/request_id/decision/message?) | daemon/backend 双侧 import，不另造字段名 |
| task-04 钩子 | ClaudeSdkDriverOptions.canUseTool? + SessionManager 持有 SDK Query 句柄 | 本任务把 `canUseTool` 接到 permission-resolver + ws-client |
| task-05 入口 | `_publish_session_event(session_id, payload)` channel `agent_session:{session_id}` + `_get_owned_session_for_update` + router 鉴权 `Permission.TASK_RUN_AGENT` + DaemonRuntimeOffline/AppError 模式 | permission_service 复用这些建好的入口 |
| task-06 SSE | `stream_session_logs(session_id)` SSE 聚合 session channel 事件 | 前端审批卡订阅同一 SSE；task-06 未落时本任务先用 task-05 的 publish channel，前端先用最小订阅（事件名 `permission_request`） |
| 现有 tool_gateway 审批框架 | `backend/app/modules/tool_gateway/{service,policy_router,router}.py` + `frontend/src/app/(dashboard)/workspaces/[id]/approvals/page.tsx` + `frontend/src/lib/approvals.ts` | D-007 "复用 tool_gateway 审批框架" = 借鉴其 **卡片 UI 风格 + allow/deny REST 模式 + 审计日志理念**，session permission 是独立瞬态链路，不接 worktree lease policy |

## 2. 当前源码依据

实现前必须用 `rg` 再次核对以下事实；源码变化则先改本任务文档再写代码：

| 事实 | 当前源码锚点 | 本任务使用方式 |
|---|---|---|
| SDK query options.canUseTool | `@anthropic-ai/claude-agent-sdk` 0.3.181 `CanUseTool` 类型（spike D2 实测签名 `(toolName, input, options: { signal?: AbortSignal }) => Promise<{behavior:'allow'} \| {behavior:'deny', message?}>`） | task-04 ClaudeSdkDriver.start 已透传 `canUseTool` 到 `query({ options })`；本任务提供具体回调实现 |
| ClaudeSdkDriver.canUseTool 字段 | task-04 `ClaudeSdkDriverOptions.canUseTool?: CanUseTool`（Wave2 地基默认 undefined） | 本任务把 SessionManager 注入的真实回调传进来 |
| SessionManager.create/inject/end/fail | task-04 `session-manager.ts` + SessionState.query/inputQueue/currentRunId | 本任务在 create 时注入 permission-resolver 实例 + 真实 canUseTool 回调 |
| daemon WS 入站 | `sillyhub-daemon/src/ws-client.ts` `_handleMessage` + task-04 daemon.ts `_handleWsMessage`（SESSION_* 路由） | 新增 `PERMISSION_RESPONSE` case → `permissionResolver.resolve(payload)` |
| daemon WS 出站 | `ws-client.ts` `send(msg): boolean` | canUseTool 回调内 `wsClient.send({ type: MSG.PERMISSION_REQUEST, payload })` |
| backend WS 入站 | `backend/app/modules/daemon/router.py` WS 循环 `websocket.receive_json()`（task-05 已有 session control 分支模式） | 新增 `DAEMON_MSG_PERMISSION_REQUEST` 分支 → `permission_service.handle_request()` |
| backend WS 出站 | `ws_hub.py:send_to_runtime()` + task-05 `send_session_control()` | 复用：新增 `send_permission_response(runtime_id, payload)` 薄封装 |
| backend SSE publish | task-05 `_publish_session_event(session_id, payload)` → `agent_session:{session_id}` Redis | 本任务 publish `{"event":"permission_request","session_id","run_id","request_id","tool_name","input","tool_use_id"?}` |
| backend session 所有权 | task-05 `_get_owned_session_for_update(session_id, user_id)` + AppError 模式（404 不泄露 / 409 状态） | response REST 端点复用 |
| 前端 session SSE | task-06 `streamSession(session_id)`（事件源）；task-11/12 之前 runtimes/page.tsx 持有 | 本任务在 page.tsx 订阅 session channel，识别 permission_request |
| 现有 approval UI 样式 | `frontend/src/app/(dashboard)/workspaces/[id]/approvals/page.tsx` + `frontend/src/lib/approvals.ts` | PermissionApprovalCard 借鉴卡片 + allow/deny 按钮风格 |
| tool_gateway policy | `backend/app/modules/tool_gateway/tool_policy.py` PolicyLimits/ToolPolicy | 仅作"审批"概念参考；session permission 不走 worktree lease policy |
| AbortSignal 透传 | SDK canUseTool options.signal | 回调内 `options.signal?.addEventListener('abort', ...)` 链接 pending Promise 的 reject 分支 |

## 3. 修改文件

| 操作 | 文件 | 责任 |
|---|---|---|
| 新增 | `sillyhub-daemon/src/interactive/permission-resolver.ts` | pending permission Map（request_id → Promise resolver）、register/resolve/abort、5min 兜底定时器 |
| 修改 | `sillyhub-daemon/src/interactive/claude-sdk-driver.ts` | SessionManager 注入的 `canUseTool` 回调实现：构造 wire request_id → wsClient.send(PERMISSION_REQUEST) → permissionResolver.register(id, { signal }) → await Promise → 返回 `{behavior}` |
| 修改 | `sillyhub-daemon/src/interactive/session-manager.ts` | create 时持有 permissionResolver；end/fail/interrupt/result 收尾时 `resolver.abortAll(reason)`；把 canUseTool 回调作为 driver 选项传入 |
| 修改 | `sillyhub-daemon/src/ws-client.ts` | `_handleMessage` 路由 `PERMISSION_RESPONSE`（若 task-04 已通配则只补回调分发） |
| 修改 | `sillyhub-daemon/src/daemon.ts` | daemon 启动 SessionManager 时注入 `permissionResolver` + `wsClient`；`_handleWsMessage` 的 PERMISSION_RESPONSE case 委托给 resolver |
| 新增 | `sillyhub-daemon/tests/interactive/permission-resolver.test.ts` | register/resolve/abortAll/重复 resolve/AbortSignal/超时兜底 |
| 新增 | `sillyhub-daemon/tests/interactive/claude-sdk-driver-canuse.test.ts` | mock SDK canUseTool 调用：allow/deny/abort/5min 兜底/wire id 唯一 |
| 新增 | `sillyhub-daemon/tests/ws-client-permission-route.test.ts` | PERMISSION_RESPONSE 路由到 resolver；未知 request_id 只 warn |
| 新增 | `backend/app/modules/daemon/permission_service.py` | handle_permission_request（WS 上行→publish SSE）+ respond_permission（REST 下行→ws_hub）+ 5min 超时定时器 + 校验 session/run/manual_approval |
| 修改 | `backend/app/modules/daemon/router.py` | WS 循环新增 PERMISSION_REQUEST 分支；REST 新增 `POST /api/daemon/sessions/{id}/permissions/{request_id}/response` |
| 修改 | `backend/app/modules/daemon/service.py` | 暴露 `_get_owned_session_for_update` / `_get_current_run` / `_publish_session_event` 供 permission_service 复用（task-05 已建，本任务如需提升为公开方法则最小补丁） |
| 修改 | `backend/app/modules/daemon/ws_hub.py` | 新增 `send_permission_response(runtime_id, payload)` 薄封装（内部调 send_to_runtime） |
| 新增 | `backend/app/modules/daemon/tests/test_session_permissions.py` | permission_service：request→publish、response→ws_hub、5min 超时 deny、session/run/manual 校验 |
| 新增 | `backend/app/modules/daemon/tests/test_ws_hub_permission.py` | WS 上行 request 分支 + WS 下行 response；非法 payload 不断 WS |
| 修改 | `frontend/src/lib/daemon.ts` | `respondSessionPermission(sessionId, requestId, decision, message?)` REST 封装；`streamSession` SSE 中 `permission_request` 事件类型定义 |
| 新增 | `frontend/src/components/permission-approval-card.tsx` | 审批卡组件（tool_name + input 摘要 + allow/deny 按钮 + 5min 倒计时提示） |
| 修改 | `frontend/src/app/(dashboard)/runtimes/page.tsx` | 订阅当前活动 session 的 SSE，permission_request 事件 → 渲染 PermissionApprovalCard；用户操作 → respondSessionPermission |
| 新增 | `frontend/src/lib/__tests__/daemon-permission.test.ts` | respondSessionPermission payload + SSE 事件解析 |

**不修改**：`task-runner.ts`（batch 零改动）、`backend/app/modules/daemon/protocol.py`（task-03 已定常量/payload）、`backend/app/modules/agent/model.py` 与 migration（task-02，不新增 permission 表）、`backend/app/modules/agent/service.py` SSE 路由（task-06，本任务用 task-05 publish 入口）、Codex provider（D-002@v3 codex 后续单独）、tool_gateway 业务逻辑（仅借鉴 UI/policy 概念）。

## 4. 实现要求与精确接口（搬砖级）

### 4.1 daemon PermissionResolver（`interactive/permission-resolver.ts`）

```typescript
import { randomUUID } from 'node:crypto';
import type { PermissionResponsePayload } from '../protocol.js';

/**
 * canUseTool 回调的远程人审 pending 注册表。
 *
 * 生命周期（spike D2 + D-007）：
 *   - driver canUseTool 回调被 SDK 触发时，调 register() 拿到 wire request_id 和
 *     一个 Promise；同时 wsClient.send(PERMISSION_REQUEST)；
 *   - 回调 await 这个 Promise，直到 backend PERMISSION_RESPONSE 到达 resolve()，
 *     或 abortAll() / 5min 兜底定时器触发（fail-closed deny）；
 *   - resolver 只活在当前 SessionManager 的 SDK Query 协程内；end/fail/interrupt/
 *     result 收尾时 SessionManager 调 abortAll()，未决回调全部 resolve deny。
 *
 * wire request_id 用 crypto.randomUUID()，跨进程跨 turn 唯一；不直接暴露 SDK tool_use_id。
 */
export type CanUseToolDecision =
  | { behavior: 'allow' }
  | { behavior: 'deny'; message?: string };

/** 5min 兜底超时（ms）。backend 主超时也 5min；daemon 兜底 5min + 5s 容差防 WS 丢消息。 */
export const PERMISSION_FALLBACK_TIMEOUT_MS = 5 * 60 * 1000 + 5_000;

interface PendingEntry {
  requestId: string;
  resolve: (decision: CanUseToolDecision) => void;
  fallbackTimer: NodeJS.Timeout;
  abortListener?: () => void;
}

export class PermissionResolver {
  private readonly _pending = new Map<string, PendingEntry>();

  /**
   * 注册一个 pending 审批请求。返回 wire request_id + canUseTool 回调应 await 的 Promise。
   *
   * @param input.sessionId  当前 AgentSession.id
   * @param input.runId      当前 turn 的 AgentRun.id
   * @param input.toolName   SDK 传来的工具名（Write/Bash/...）
   * @param input.toolInput  SDK 传来的工具参数（原样转发）
   * @param input.toolUseId? SDK tool_use_id（可选，便于追溯）
   * @param input.signal?    SDK canUseTool options.signal（interrupt 时 SDK abort）
   * @param input.send       实际 wsClient.send 函数（注入便于测试 mock）
   * @returns { requestId, promise }；promise resolve 后 canUseTool 回调返回该 decision
   *
   * 语义：
   *   1. 生成 requestId = randomUUID()；
   *   2. 构造 PERMISSION_REQUEST payload 并 send；send 返回 false 立即从 pending 移除
   *      并 promise resolve deny（fail-closed），不阻塞 SDK；
   *   3. 注册 pending + 启 5min 兜底定时器（到点 resolve deny 并清理）；
   *   4. 若 signal 已 aborted 或后续 abort，立即 resolve deny 并清理；
   *   5. promise 在 resolve()/abortAll()/定时器/abort 任一路径只 settle 一次。
   */
  register(input: {
    sessionId: string;
    runId: string;
    toolName: string;
    toolInput: Record<string, unknown>;
    toolUseId?: string;
    signal?: AbortSignal;
    send: (msg: { type: string; payload: unknown }) => boolean;
  }): { requestId: string; promise: Promise<CanUseToolDecision> };

  /**
   * 收到 backend PERMISSION_RESPONSE 时调用。
   * 命中 pending → resolve 对应 promise + 清理；未命中（迟到/重复/未知）→ 返回 false，只 warn。
   *
   * @param payload  PermissionResponsePayload（session_id/request_id/decision/message?）
   * @param expectedSessionId  当前 SessionManager 的 sessionId；不匹配返回 session_mismatch
   */
  resolve(
    payload: PermissionResponsePayload,
    expectedSessionId: string,
  ): 'resolved' | 'unknown_request' | 'session_mismatch';

  /**
   * SessionManager.end/fail/interrupt/result 收尾时调用。所有未决回调立即 resolve deny
   * （带 reason message），清 pending、清定时器、移除 abort listener。
   * 幂等：重复调用无副作用。
   */
  abortAll(reason: string): number;

  /** 测试用：当前 pending 数量。 */
  get pendingCount(): number;
}
```

强制语义：

1. **wire request_id 全局唯一**：`crypto.randomUUID()`，不直接复用 SDK tool_use_id（与 task-07 v2 决策一致：防跨 turn 串扰）。
2. **fail-closed**：`register` 时 send 返回 false → promise 立即 resolve `{behavior:'deny', message:'permission request send failed'}`，不本地 allow。
3. **5min 兜底定时器**：注册时同时启 `PERMISSION_FALLBACK_TIMEOUT_MS` 定时器；到点 resolve deny 并清理 pending。backend 主超时（5min）先到的话 WS PERMISSION_RESPONSE(decision=deny) 也会到达，resolver 以"先到先 settle + 重复返回 unknown"保证只 settle 一次。
4. **AbortSignal 链接**：`register` 时若 signal 已 aborted 立即 deny；否则 `signal.addEventListener('abort', ...)`，SDK 在 interrupt 时 abort signal → deny。listener 在 settle 时移除防泄漏。
5. **settle 一次**：promise 内部用 `let settled=false`，resolve()/abortAll()/定时器/abort 任一路径先置 `settled=true` 再 `resolveFn(decision)`；后续路径 return。
6. **abortAll 在 SessionManager 收尾时调用**：end/fail/interrupt/result 四条路径均触发（result 正常完成时也应 abortAll，确保本 turn 内 SDK 后续可能触发的 canUseTool 不悬空——虽然 spike D4 说 result 后无孤儿事件，但防御性 fail-closed）。

### 4.2 ClaudeSdkDriver.canUseTool 回调接线（`interactive/claude-sdk-driver.ts`）

task-04 已在 `ClaudeSdkDriverOptions` 留 `canUseTool?: CanUseTool` 字段；本任务在 SessionManager.create 时构造具体回调并传入：

```typescript
// session-manager.ts 内（create 时构造 driver 选项）
const canUseTool: CanUseTool = async (toolName, toolInput, options) => {
  const state = this._store.get(sessionId);
  if (!state || state.status !== 'running' || !state.currentRunId) {
    // session 已不在 running turn：fail-closed deny，不让 SDK 永久等待
    return { behavior: 'deny', message: 'session not in running turn' };
  }
  const { requestId, promise } = this._permissionResolver.register({
    sessionId,
    runId: state.currentRunId,
    toolName,
    toolInput: toolInput as Record<string, unknown>,
    toolUseId: undefined, // SDK 0.3.181 canUseTool 入参不含 tool_use_id；按 toolName+input 关联
    signal: options?.signal,
    send: (msg) => this._wsClient.send(msg),
  });
  // 日志只记 id/toolName，不记完整 input/prompt/token（隐私 + spike D2 实测）
  this._log('permission_request_sent', { requestId, sessionId, runId: state.currentRunId, toolName });
  return promise;
};

// 然后 driver.start(inputQueue, { ...opts, canUseTool });
```

约束：

- canUseTool 回调内**不读 credentials.json / 不本地批准**；唯一出口是 `permissionResolver.register(...).promise`（spike D2 await 不超时）。
- `state.status !== 'running'` 时立即 deny（防 interrupt 后 SDK 仍触发回调，spike D1 result 边界已收敛，但防御性 fail-closed）。
- 回调异常（resolver.register 抛错等）由 SDK 自己 catch；本任务保证 register 不抛（内部 try/catch 转为 deny）。
- **manual_approval=false（默认）时**：SessionManager.create 检测 `config.manual_approval !== true` → driver 选项不传 `canUseTool`（SDK 走内置默认策略），permissionResolver 不实例化。task-04 的 SessionManagerDeps 可选注入 `permissionResolver?`，缺省即 manual=false。

### 4.3 daemon WS 路由 PERMISSION_RESPONSE（`ws-client.ts` / `daemon.ts`）

ws-client `_handleMessage` 已有 onMessage/onControlMessages 分发（task-04 已实现 SESSION_* 路由）；本任务新增：

```typescript
// daemon.ts _handleWsMessage
case MSG.PERMISSION_RESPONSE: {
  const payload = msg.payload as PermissionResponsePayload;
  const state = this._sessionManager.get(payload.session_id);
  if (!state) {
    log.warn('permission_response_unknown_session', { session_id: payload.session_id });
    return;
  }
  const result = this._permissionResolver.resolve(payload, payload.session_id);
  if (result !== 'resolved') {
    log.warn('permission_response_not_resolved', {
      request_id: payload.request_id, result, session_id: payload.session_id,
    });
  }
  return;
}
```

- payload schema 非法（缺 request_id/decision 非 allow|deny）→ warn 丢弃，不抛（NFR-05 兼容 task-03 未知消息静默原则的延伸）。
- session_id 在 SessionStore 中不存在 → warn 丢弃（迟到 response，turn 已结束）。
- resolver.resolve 返回 unknown_request/session_mismatch → warn（已记日志），不影响新 turn。

### 4.4 backend permission_service.py（`backend/app/modules/daemon/permission_service.py`）

```python
from __future__ import annotations
import asyncio
import uuid
from typing import Literal

from app.core.errors import AppError
from app.modules.daemon.protocol import (
    DAEMON_MSG_PERMISSION_REQUEST,
    PermissionRequestPayload,
    PermissionResponsePayload,
)

PERMISSION_TIMEOUT_SEC = 5 * 60  # D-007: 5min 未响应 → deny（backend 主超时）


class DaemonPermissionNotFound(AppError):
    code = "HTTP_404_DAEMON_PERMISSION_NOT_FOUND"
    http_status = 404


class DaemonPermissionAlreadyResolved(AppError):
    code = "HTTP_409_DAEMON_PERMISSION_ALREADY_RESOLVED"
    http_status = 409


class DaemonPermissionService:
    """session 级 canUseTool 审批编排。

    依赖 task-05 DaemonService 的 _publish_session_event / _get_owned_session_for_update /
    _get_current_run / DaemonWsHub.send_permission_response。无独立 DB 表——pending 审批
    瞬态存活，真值以 daemon resolver 为准（D-007）。
    """

    def __init__(self, daemon_service: "DaemonService", ws_hub: "DaemonWsHub") -> None:
        self._svc = daemon_service
        self._hub = ws_hub
        # request_id → asyncio.Task（5min 超时定时器）；同进程内存态
        self._timers: dict[str, asyncio.Task[None]] = {}

    async def handle_permission_request(
        self,
        runtime_id: uuid.UUID,
        payload: PermissionRequestPayload,
    ) -> None:
        """WS 上行 PERMISSION_REQUEST 分支：校验 + publish SSE + 启 5min 超时定时器。

        校验顺序：
          1. session 存在且 active（不锁，只读校验；写操作在 response 端点锁）；
          2. runtime_id 与 session.runtime_id 一致；
          3. session.config.manual_approval is True（防 manual=false 的协议违约）；
          4. _get_current_run(session_id) 存在且 status IN ACTIVE_TURN_STATUSES，
             且 run.id == payload.run_id；
          5. 任意校验失败：记 warn 不 publish、不启定时器、不断 WS（task-03 NFR-05 延伸）。

        通过后：
          - _publish_session_event(session_id, {event:'permission_request', session_id,
             run_id, request_id, tool_name, input, tool_use_id?})；
          - 启 5min 定时器 asyncio.Task → 到点发 deny（response via ws_hub）+ publish
            SSE {event:'permission_resolved', decision:'deny', reason:'timeout'}。
        """

    async def respond_permission(
        self,
        user_id: uuid.UUID,
        session_id: uuid.UUID,
        request_id: str,
        decision: Literal["allow", "deny"],
        message: str | None = None,
    ) -> "PermissionResponseRead":
        """REST POST /sessions/{id}/permissions/{request_id}/response：用户 allow/deny。

        1. _get_owned_session_for_update(session_id, user_id) → 404 不泄露；
        2. session.status active；session.config.manual_approval is True；
        3. _get_current_run 存在（无 run 说明 turn 已结束）；
        4. request_id 在 _timers 中存在（pending）；已 resolve/超时 → 409 already_resolved；
        5. 取消该 request 的超时定时器；
        6. ws_hub.send_permission_response(runtime_id, {session_id, request_id, decision, message?})
           → 发送失败抛 DaemonRuntimeOffline；
        7. _publish_session_event({event:'permission_resolved', session_id, request_id, decision});
        8. 返回 PermissionResponseRead。
        """

    async def _on_timeout(self, session_id: uuid.UUID, request_id: str) -> None:
        """5min 到点：best-effort 发 deny + publish SSE；发失败只 warn。"""
```

校验与错误码沿用 task-05 AppError 模式（`DaemonSessionNotFound`/`DaemonSessionNotActive`/`DaemonRuntimeOffline`/新增 `DaemonPermissionNotFound`/`DaemonPermissionAlreadyResolved`）。**无独立 permission 表**——pending 状态靠 `_timers` dict 内存追踪；daemon 重启/掉线则 `_timers` 失效，下次 response 端点返回 404（daemon resolver 是最终防线，spike D2 已证 SDK 不会因 WS 断永久等待，AbortSignal/兜底定时器会 deny）。

### 4.5 backend router.py 端点

```python
# WS 循环新增（task-05 已有 SESSION_* 分支，本任务新增 PERMISSION_REQUEST 上行）
elif msg_type == DAEMON_MSG_PERMISSION_REQUEST:
    try:
        payload = PermissionRequestPayload(**raw_payload)
    except ValidationError:
        log.warning("permission_request_invalid_payload", ...)
        continue  # 不断 WS
    await permission_service.handle_permission_request(runtime_id, payload)


# REST 新增
@router.post(
    "/sessions/{session_id}/permissions/{request_id}/response",
    response_model=PermissionResponseRead,
)
async def respond_session_permission(
    session_id: uuid.UUID,
    request_id: str,
    body: PermissionResponseRequest,
    user: TaskRunAgentUser,  # task-05 已定义的 require_permission_any(TASK_RUN_AGENT)
    service: DaemonPermissionService,
) -> PermissionResponseRead:
    """用户对某条 permission_request 给 allow/deny。"""
    return await service.respond_permission(
        user_id=user.id,
        session_id=session_id,
        request_id=request_id,
        decision=body.decision,
        message=body.message,
    )


class PermissionResponseRequest(BaseModel):
    decision: Literal["allow", "deny"]
    message: str | None = Field(default=None, max_length=2000)


class PermissionResponseRead(BaseModel):
    session_id: uuid.UUID
    request_id: str
    decision: Literal["allow", "deny"]
    accepted: bool  # 是否成功送达 daemon
```

### 4.6 backend ws_hub.py 新增

```python
async def send_permission_response(
    self,
    runtime_id: uuid.UUID,
    payload: PermissionResponsePayload,
) -> bool:
    """封装 task-03 PERMISSION_RESPONSE 下行；内部调 send_to_runtime。"""
    return await self.send_to_runtime(
        runtime_id,
        {"type": DAEMON_MSG_PERMISSION_RESPONSE, "payload": payload.model_dump(mode="json")},
    )
```

### 4.7 frontend lib/daemon.ts + PermissionApprovalCard

```typescript
// lib/daemon.ts 新增
export interface SessionPermissionRequest {
  session_id: string;
  run_id: string;
  request_id: string;
  tool_name: string;
  input: Record<string, unknown>;
  tool_use_id?: string;
}

export interface SessionPermissionResolved {
  session_id: string;
  request_id: string;
  decision: 'allow' | 'deny';
  reason?: string; // 'timeout' | 'manual'
}

export async function respondSessionPermission(
  sessionId: string,
  requestId: string,
  decision: 'allow' | 'deny',
  message?: string,
): Promise<{ accepted: boolean }> {
  // POST /api/daemon/sessions/{id}/permissions/{request_id}/response
}

// runtimes/page.tsx：订阅 streamSession(sessionId) SSE，事件类型新增：
//   event: permission_request   → 推入 approvalCards state
//   event: permission_resolved  → 从 state 移除该 request_id
//   event: session_ended        → 清空 approvalCards
```

`PermissionApprovalCard`（新组件，借鉴 `workspaces/[id]/approvals/page.tsx` 卡片风格）：

- 展示：tool_name + input 摘要（JSON.stringify 前 N 字符 + 折叠展开）+ 创建时间 + 5min 倒计时（前端基于 `permission_request` 到达时间本地计时，仅 UI 提示，不替代 backend 超时）。
- 两个按钮：Allow / Deny；Deny 可选填 reason。
- 点击后调 `respondSessionPermission`；accepted 后置灰等待 `permission_resolved` SSE 移除。
- 并发多 card：同一 session 可能同时多条 pending（spike D2 三次 canUseTool 串行但界面允许并行展示）；按 request_id 去重。

## 5. 边界条件（必须全部覆盖，≥5）

| # | 场景 | 必须行为 |
|---|---|---|
| 1 | **5min 未响应 deny（D-007 硬规则）** | backend `_on_timeout` 到点发 `PERMISSION_RESPONSE(decision=deny)` + publish `permission_resolved{reason:'timeout'}`；daemon resolver 收到后 settle deny；daemon 5min+5s 兜底定时器双保险（防 WS 丢消息），到点也 deny。前端倒计时 UI 在 5min 时禁用按钮 |
| 2 | **用户 deny 带 message** | daemon resolver settle `{behavior:'deny', message}`；SDK 拿到 message 透传给 claude（claude 可换方法/告知用户），不崩 session |
| 3 | **用户 allow** | resolver settle `{behavior:'allow'}`；SDK 执行该工具调用；后续 canUseTool 继续走远程人审链路 |
| 4 | **并发多 tool 审批** | 同一 turn SDK 串行触发 canUseTool（spike D2 三次），resolver 内 `_pending` Map 按 request_id 隔离；任一 response 只 settle 对应 entry；其它 entry 不受影响 |
| 5 | **审批期间 session ended/interrupted/failed** | SessionManager.end/fail/interrupt 调 `resolver.abortAll(reason)`，所有 pending promise settle deny + 清定时器 + 移除 abort listener；backend 迟到的 PERMISSION_RESPONSE 到 daemon 时 resolver 已空 → warn unknown_request；backend 端 `respond_permission` 看到 session 非 active 返回 404/409 |
| 6 | **审批期间 currentRun result 完成** | SessionManager._onResult 收尾调 `resolver.abortAll('turn_completed')`；SDK 按 spike D4 result 后无孤儿 canUseTool；防御性 deny |
| 7 | **AbortSignal 中断（SDK interrupt abort 回调）** | resolver.register 注册的 `signal.addEventListener('abort')` 触发 → 立即 settle deny + 清理；SDK 收到 deny 继续中断流程 |
| 8 | **重复 PERMISSION_RESPONSE（backend 重试/WS 重放）** | resolver.resolve 第一次 settle，第二次返回 `unknown_request`，不重复执行；backend `respond_permission` 第二次看到 `_timers` 已取消返回 409 already_resolved |
| 9 | **错误 session_id + 正确 request_id** | resolver.resolve 检查 expectedSessionId，不匹配返回 `session_mismatch`，不消费 entry |
| 10 | **wire request_id 全局唯一** | `crypto.randomUUID()`；跨 turn 跨进程不碰撞；旧 turn 的迟到 response 因 resolver 已 abortAll 不会被新 turn 命中 |
| 11 | **manual_approval=false（默认）** | SessionManager.create 不注入 canUseTool 回调；SDK 走内置默认策略；permissionResolver 不实例化；不发 PERMISSION_REQUEST；frontend 不弹卡；spike H1 行为零变化 |
| 12 | **WS send 失败（daemon 上行 PERMISSION_REQUEST）** | resolver.register send 返回 false → promise 立即 settle deny（fail-closed）；不本地 allow；SDK 收到 deny 后由 claude 自处理；session 不崩 |
| 13 | **backend WS runtime 离线（response 下行）** | `send_permission_response` 返回 False → respond_permission 抛 DaemonRuntimeOffline（503/504）；REST 返回明确错误，前端提示重试；daemon 5min 兜底定时器到点仍 deny |
| 14 | **backend 收到 manual=false session 的 request** | handle_permission_request 校验 `config.manual_approval is True`，false 时记 warn 不 publish、不启定时器（防 daemon 协议违约） |
| 15 | **backend 收到 run_id 与 currentRun 不一致** | 校验 `_get_current_run(session_id).id == payload.run_id`，不一致记 warn 不 publish（防跨 turn 串扰） |
| 16 | **backend 收到非 active session 的 request** | 校验 status active；ended/failed/reconnecting 时不 publish |
| 17 | **前端审批卡未关闭就 session ended** | SSE `session_ended` 事件清空 approvalCards state；避免对已结束 session 发 REST response |
| 18 | **input 含敏感字段（token/密钥）** | daemon 日志只记 request_id/tool_name，不记完整 input；backend publish 的 SSE input 原样转发（前端展示需考虑脱敏，但本任务不强行——与 task-07 v2 隐私原则一致，前端展示工具参数 JSON，工具自身不应把密钥当参数） |
| 19 | **GLM 后端工具调用失败（spike D2 caveat）** | allow 后 SDK 执行工具失败 → tool_result(is_error) 经 SDK 返 claude 自处理（D-008 透传）；本任务不预禁工具，**错误透传归 task-09**；本任务只保证 allow/deny 链路 |
| 20 | **batch lease** | 不走 SessionManager → 无 permissionResolver → 不触发 canUseTool 回调；现有 TaskRunner batch 路径零改动（FR-09） |

## 6. 非目标（明确不做）

- **不做 GLM 工具错误透传验证**：D-008 错误透传（allow 后工具失败 → tool_result is_error 返模型）的端到端验证归 **task-09**；本任务只保证 allow/deny 链路本身工作。
- **不做 Codex provider 审批**：D-002@v3 codex 后续独立 CodexAppServerDriver；本任务 provider 非 claude → SessionManager.create 已抛 UnsupportedProviderError（task-04 约束）。
- **不新建 permission 数据库表**：审批瞬态，pending 状态靠 daemon resolver + backend `_timers` 内存追踪；真值以 daemon resolver 为准（D-007）。
- **不实现 Codex approval server / JSON-RPC 审批**：那是 v2 task-08 的内容（Codex `execCommandApproval` 等 5 类 method），v3 只覆盖 Claude SDK canUseTool。
- **不改 tool_gateway 业务逻辑**：D-007 "复用 tool_gateway 审批框架" 是概念借鉴（卡片 UI + allow/deny REST 模式 + 审计理念），不把 session permission 接入 worktree lease policy。
- **不改 protocol.ts 常量/payload**：task-03 已定；本任务只消费。
- **不改 task-runner.ts**：batch 零改动（D-002@v3）。
- **不实现会话面板完整 UI（列表/历史/窗口）**：task-11/12 负责；本任务只在 runtimes/page.tsx 挂最小审批卡 + SSE 订阅。
- **不实现 resume 持久化**：daemon 重启 pending resolver 内存丢失（D-003 Wave1/2）；本任务不持久化 `_pending`/`_timers`。
- **不修改 `_publish_session_event` channel 命名或 task-05/06 已建入口**：本任务复用，不改签名。

## 7. 参考

- `design.md` §5 Wave2（canUseTool 远程人审 + GLM 透传）、§7.1（ClaudeSdkDriver.canUseTool 回调签名）、§7.3（PERMISSION_REQUEST/RESPONSE 协议）、§7.6（turn/AgentRun 时序，result 边界）、§11 D-007@v1、§12 AC-7。
- `requirements.md` FR-07（5min 超时 deny 硬规则）。
- `decisions.md` D-007@v1（canUseTool 回调 await 远程人审）、D-002@v3（driver 与 TaskRunner 并存）、D-008@v1（GLM 错误透传=task-09）。
- `spike-02-architecture-validation.md` §3.7 **D2**（canUseTool 回调 await 6000ms×3 不超时、带 AbortSignal、caveat GLM Write 失败非路线阻塞）。
- task-03 `protocol.ts`/`protocol.py` PERMISSION_* 常量与 payload。
- task-04 `ClaudeSdkDriver.canUseTool?` 字段 + `SessionManager.create/end/fail/interrupt/_onResult`。
- task-05 `_publish_session_event` / `_get_owned_session_for_update` / `_get_current_run` / `send_session_control` / AppError 模式。
- 现有 `backend/app/modules/tool_gateway/{service,router}.py` + `frontend/src/app/(dashboard)/workspaces/[id]/approvals/page.tsx` + `frontend/src/lib/approvals.ts`（审批卡片 UI + REST 模式参考）。
- 现有 `sillyhub-daemon/src/ws-client.ts:_handleMessage`（SESSION_* 路由模式参考）。

## 8. TDD 实施顺序

严格"测试先失败 → 最小实现 → 重构 → 全量回归"。SDK/WS/HTTP 调用一律 mock，不连真实 bigmodel/不依赖网络。

### Step 1：daemon PermissionResolver 单测（红）

新增 `tests/interactive/permission-resolver.test.ts`：

- `register`：返回 wire request_id（uuid v4 格式）+ pending Promise；send 返回 true 时 promise pending；两次 register 得到不同 request_id。
- `register` send=false：promise 立即 settle `{behavior:'deny', message:'...send failed'}`；pending Map 不残留。
- `resolve`：合法 payload（session_id/request_id/decision）→ promise settle 对应 decision；重复 resolve 返回 `unknown_request`；session_mismatch 不消费 entry。
- `abortAll`：所有未决 promise settle deny（带 reason）；pending 清空；定时器清；幂等（二次调用无副作用）。
- AbortSignal 已 aborted：register 时立即 deny；signal 后续 abort：listener 触发 deny 且 listener 移除。
- 5min 兜底定时器：用 fake timer 推进 `PERMISSION_FALLBACK_TIMEOUT_MS` → promise settle deny + 清理。

红后实现 `permission-resolver.ts`。

### Step 2：ClaudeSdkDriver.canUseTool 回调单测（红）

新增 `tests/interactive/claude-sdk-driver-canuse.test.ts`（mock SDK + mock SessionManager 依赖）：

- 构造 SessionManager 实例（manual=true），mock driver + wsClient.send + permissionResolver；
- 模拟 SDK 调 canUseTool('Bash', {command:'ls'}, {signal})：
  - send 被调一次，payload 是 PERMISSION_REQUEST + 含 session_id/run_id/request_id（uuid）/tool_name='Bash'/input；
  - resolver.register 被调一次；
  - 回调 await，注入 backend response allow → 回调返回 `{behavior:'allow'}`；
  - 注入 deny + message → 返回 `{behavior:'deny', message}`。
- session 非 running（status=active/end/fail）调 canUseTool：立即返回 deny，不调 send/register。
- wsClient.send 返回 false：回调立即返回 deny（fail-closed）。
- AbortSignal abort：回调返回 deny。

红后修改 `claude-sdk-driver.ts` + `session-manager.ts`。

### Step 3：daemon WS PERMISSION_RESPONSE 路由单测（红）

新增 `tests/ws-client-permission-route.test.ts`：

- 构造 PERMISSION_RESPONSE msg → 路由到 resolver.resolve；
- resolver.resolve 返回 unknown/session_mismatch → warn 不抛；
- session 不存在 → warn；
- payload 非法（缺字段/decision 非 allow|deny）→ warn 丢弃不抛。

### Step 4：backend permission_service 单测（红）

新增 `backend/app/modules/daemon/tests/test_session_permissions.py`：

- `handle_permission_request`：合法 payload → publish SSE `{event:'permission_request',...}` 到 `agent_session:{session_id}` → 启 5min 定时器；
- 校验反例：session 不 active / runtime_id 不一致 / manual=false / run_id 不匹配 currentRun / 无 currentRun → 不 publish、不启定时器；
- 5min 超时：fake timer 推进 → 发 deny via ws_hub + publish `{event:'permission_resolved',reason:'timeout'}`；
- `respond_permission`：合法 allow/deny → 取消定时器 + ws_hub.send + publish + 返回 accepted=True；
- 反例：session 非 owner 404 / session 非 active 409 / request_id 已 resolve 409 already_resolved / ws_hub 离线 DaemonRuntimeOffline；
- 重复 response：第二次 409（_timers 已取消）。

红后实现 `permission_service.py`。

### Step 5：backend router/ws_hub 单测（红）

新增 `backend/app/modules/daemon/tests/test_ws_hub_permission.py`：

- WS 上行 PERMISSION_REQUEST → 调 permission_service.handle_permission_request；
- 非法 payload 不断 WS（continue）；
- `send_permission_response` 封装正确 envelope `{type, payload}`；
- REST POST `/sessions/{id}/permissions/{req}/response`：合法 200 / 非法 decision 422 / 非 owner 404 / 已 resolved 409。

### Step 6：frontend 单测（红）

新增 `frontend/src/lib/__tests__/daemon-permission.test.ts`：

- `respondSessionPermission` 构造正确 POST payload + URL；
- SSE `permission_request` 事件解析为 SessionPermissionRequest；
- SSE `permission_resolved` 事件解析为 SessionPermissionResolved。

PermissionApprovalCard 组件用 vitest + testing-library 渲染测试（allow/deny 点击触发回调 + 倒计时 UI）。

### Step 7：回归

```bash
# daemon
cd sillyhub-daemon
pnpm test -- permission-resolver claude-sdk-driver-canuse ws-client-permission-route
pnpm typecheck
pnpm test   # batch 回归全绿

# backend
cd ../backend
uv run pytest app/modules/daemon/tests/test_session_permissions.py app/modules/daemon/tests/test_ws_hub_permission.py -v
uv run ruff check app/modules/daemon
uv run pytest app/modules/daemon app/modules/agent  # session/batch 回归

# frontend
cd ../frontend
pnpm test -- daemon-permission
pnpm typecheck
```

## 9. 验收表

| AC | 验收场景 | 可观察证据 | 状态 |
|---|---|---|---|
| AC-08.1 | manual=true 时 SDK 触发 canUseTool → daemon 发 PERMISSION_REQUEST（含 session_id/run_id/request_id/tool_name/input） | `claude-sdk-driver-canuse.test.ts` 断言 wsClient.send payload | [ ] |
| AC-08.2 | 用户 allow → 回调返回 `{behavior:'allow'}`；SDK 继续执行工具调用（mock 验证） | driver-canuse 测试 + 回调返回值断言 | [ ] |
| AC-08.3 | 用户 deny（带 message）→ 回调返回 `{behavior:'deny', message}`；SDK 拿到 message | driver-canuse 测试 | [ ] |
| AC-08.4 | **5min 未响应 deny（D-007 硬规则）** | backend `_on_timeout` 到点发 deny + publish reason=timeout；daemon 兜底定时器双保险；前端倒计时到 5min 禁用按钮 | `test_session_permissions.py` + `permission-resolver.test.ts` fake timer + PermissionApprovalCard 测试 | [ ] |
| AC-08.5 | AbortSignal abort（SDK interrupt）→ 回调立即 deny + listener 移除 | permission-resolver AbortSignal 测试 | [ ] |
| AC-08.6 | 并发多 tool 审批各自独立 resolve | resolver 多 entry 测试 + driver 串行三次 canUseTool 测试（spike D2 场景） | [ ] |
| AC-08.7 | session ended/interrupted/failed 时 abortAll → 所有未决 deny | session-manager end/fail/interrupt 测试 + resolver.abortAll 测试 | [ ] |
| AC-08.8 | turn result 完成时 resolver.abortAll → 本 turn 无悬空回调 | session-manager _onResult 测试 | [ ] |
| AC-08.9 | wire request_id 全局唯一（uuid）；跨 turn 旧 response 不命中新 turn | resolver 唯一性测试 + ws-client-permission-route 迟到 response 测试 | [ ] |
| AC-08.10 | 重复 PERMISSION_RESPONSE 只 settle 一次（resolver.resolve 第二次 unknown；backend REST 第二次 409） | resolver 重复测试 + backend respond_permission 已 resolved 测试 | [ ] |
| AC-08.11 | WS send 失败（daemon 上行）→ fail-closed deny（不本地 allow） | resolver send=false 测试 | [ ] |
| AC-08.12 | backend WS 离线（response 下行）→ REST 返回 DaemonRuntimeOffline；前端提示重试；daemon 兜底仍 deny | backend respond_permission runtime offline 测试 + resolver 兜底定时器 | [ ] |
| AC-08.13 | manual=false（默认）→ driver 不注入 canUseTool，无 PERMISSION_REQUEST，前端无卡 | session-manager manual=false 测试 + driver 选项断言 canUseTool===undefined | [ ] |
| AC-08.14 | backend 校验：manual=false / runtime 不一致 / run_id 不匹配 / session 非 active / 无 currentRun → 不 publish 不启定时器 | `test_session_permissions.py` 反例矩阵 | [ ] |
| AC-08.15 | frontend PermissionApprovalCard：渲染 tool_name + input 摘要 + 倒计时；allow/deny 点击触发 REST；permission_resolved SSE 后移除卡 | component 渲染测试 + SSE 事件解析测试 | [ ] |
| AC-08.16 | batch lease / TaskRunner 零改动（FR-09 守门） | daemon/backend 全量回归测试全绿 | [ ] |
| AC-08.17 | daemon typecheck + pnpm test；backend ruff + pytest；frontend typecheck + test 全绿 | 命令输出 | [ ] |
| AC-08.18 | diff 只在 allowed_paths 内；未改 task-runner.ts / protocol.ts/py / model / migration / SSE 路由 | git diff 审查 | [ ] |

## 10. 完成定义

- **D-007@v1 三段链路完整闭环**：canUseTool 回调（spike D2 可 await 任意延迟）→ WS PERMISSION_REQUEST → backend publish SSE + 5min 定时器 → 前端弹卡 → 用户 allow/deny → REST → backend WS PERMISSION_RESPONSE → daemon resolver resolve 回调，每段均有自动化测试证据（AC-08.1～AC-08.3）。
- **5min 超时 deny 双保险**：backend 主定时器 + daemon 兜底定时器，任一路径失效仍 fail-closed（AC-08.4）。
- **AbortSignal 透传**：SDK interrupt 时 abort signal → resolver 立即 deny，无悬空（AC-08.5）。
- **生命周期收敛**：end/fail/interrupt/result 四条路径均 abortAll，pending resolver 不跨 turn 不悬空（AC-08.7/AC-08.8）。
- **fail-closed 原则**：WS send 失败 / runtime 离线 / 重复 response / 未知 request 全部 deny 或明确错误，不本地 allow（AC-08.11/AC-08.12/AC-08.10）。
- **manual=false 零变化**：默认不进人审链路，SDK 内置策略行为不变，batch 路径零改动（AC-08.13/AC-08.16）。
- **AC-08.1～AC-08.18 全部通过**；所有异常路径有明确错误码，禁止裸 `try/catch` 吞错；未越过 allowed_paths。
