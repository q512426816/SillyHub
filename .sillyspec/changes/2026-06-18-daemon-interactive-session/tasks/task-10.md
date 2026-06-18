---
author: qinyi
created_at: 2026-06-18 15:31:03
change: 2026-06-18-daemon-interactive-session
id: task-10
title: "前端会话基础面板：session SSE、下一 turn、打断 currentRun 与结束 session"
wave: W5
priority: P1
estimated_hours: 12
depends_on: [task-04, task-05]
blocks: [task-11]
requirement_ids: [FR-10]
decision_ids: [D-002@v2, D-005@v1]
allowed_paths:
  - frontend/src/lib/daemon.ts
  - frontend/src/lib/__tests__/daemon-session.test.ts
  - frontend/src/components/daemon/interactive-session-panel.tsx
  - frontend/src/components/daemon/__tests__/interactive-session-panel.test.tsx
  - frontend/src/app/(dashboard)/runtimes/page.tsx
  - frontend/src/app/api/daemon/sessions/[sessionId]/stream/route.ts
  - frontend/src/app/api/daemon/sessions/[sessionId]/stream/__tests__/route.test.ts
---

# task-10：前端会话基础面板

> 以 `plan.md` 显式 task-10 为准，不采用 CLI 重编号。本任务把 `/runtimes` 现有 quick-chat 演进为单个交互式会话面板：首条消息创建 session；追问创建同一 session 的下一 turn；一个 session SSE 连接跨多个 AgentRun；interrupt 只打断 currentRun；end 才结束 session。权限审批和历史会话列表留给 task-11。

## 1. 目标与硬约束

1. 首条 prompt 调 task-04 的 `POST /api/daemon/sessions`，保存 `session_id` 与首个 `run_id`。
2. 后续 prompt 调 `POST /api/daemon/sessions/{id}/inject`。inject 的业务含义是创建下一 turn/AgentRun，不是写入长驻进程 stdin。
3. 每个 session 只建立一个 `GET /api/daemon/sessions/{id}/stream` EventSource；`turn_done` 不关闭连接，只有 `done` 关闭。
4. SSE 事件按 `run_id` 路由到对应 turn；不得把第二 turn 输出追加到第一 turn。
5. interrupt 调 `/interrupt`，只进入“正在打断当前 turn”状态；session 保持 active，收到该 run 的 `turn_done` 后可继续追问。
6. end 调 `/end`，收到 `done` 或成功响应后进入 ended，关闭 SSE；不得把 interrupt 当作 end。
7. 保留现有 `quickChat`、`streamQuickChat`、run 日志 API，避免破坏旧调用；新面板不得继续用 `prev_run_id` 伪多轮。
8. 本任务不实现 permission 弹窗、会话列表、跨会话历史切换、daemon 重启恢复 UI；这些属于 task-11/task-09。

## 2. 当前源码事实

实现前必须用 `rg` 重新确认符号存在；若依赖 task 尚未落地，以本任务接口为编译契约，不编造别名。

| 依据 | 当前事实 | 本任务用法 |
|---|---|---|
| `frontend/src/lib/daemon.ts` | 已有 `apiFetch`、`getApiBaseUrl`、`useSession`、quick-chat REST/SSE 封装 | 新增 session API；旧 API 保留 |
| `frontend/src/app/(dashboard)/runtimes/page.tsx` | `QuickChatPanel` 用 `lastRunId + quickChat + streamQuickChat`，每轮重建 run SSE | 用独立组件替换其会话核心，页面保留 provider/model/runtime 布局 |
| `frontend/src/app/api/daemon-chat/[runId]/stream/route.ts` | Next route handler 代理 SSE，避免 rewrite 缓冲 | 新建 session stream 同型代理，并转发 cursor/Last-Event-ID |
| task-04 | create/inject/interrupt/end REST DTO 已固定 | 客户端类型必须逐字段对齐 |
| task-05 | SSE 使用命名事件 `turn`、`log`、`turn_done`、`done`；仅 log frame 带 cursor `id:` | 必须 `addEventListener`，不能只写 `onmessage` |
| `frontend/vitest.config.ts` | jsdom + Testing Library 可用 | API、组件和 route handler 测试先行 |

扫描文档把 daemon 写成旧 Python 实现，与本任务无关；前端以当前 TypeScript 源码及 task-04/task-05 契约为准。

## 3. 文件边界

| 操作 | 文件 | 责任 |
|---|---|---|
| 修改 | `frontend/src/lib/daemon.ts` | session REST 类型/函数、SSE envelope/parser/client |
| 新增 | `frontend/src/lib/__tests__/daemon-session.test.ts` | REST path/body、命名 SSE 事件、cursor 与 close 行为 |
| 新增 | `frontend/src/components/daemon/interactive-session-panel.tsx` | 可独立测试的 session 状态机与基础 UI |
| 新增 | `frontend/src/components/daemon/__tests__/interactive-session-panel.test.tsx` | 首 turn、inject、多 run 路由、interrupt、end、错误分支 |
| 修改 | `frontend/src/app/(dashboard)/runtimes/page.tsx` | 用新面板替换旧伪多轮核心，传入在线 provider/model；保留 runtime 卡片与日志区 |
| 新增 | `frontend/src/app/api/daemon/sessions/[sessionId]/stream/route.ts` | 无缓冲代理 backend session SSE，转发鉴权、cursor、Last-Event-ID |
| 新增 | `frontend/src/app/api/daemon/sessions/[sessionId]/stream/__tests__/route.test.ts` | URL/headers/body/status/abort 代理测试 |

不得修改 backend/daemon、task-05 SSE 格式或 task-04 状态机。若 `QuickChatPanel` 内日志渲染逻辑需要复用，应抽到新组件或小纯函数，不复制两份状态机。

## 4. REST 接口定义

对齐 task-04，不得删字段或把 body 改为 query：

```typescript
export type InteractiveProvider = 'claude' | 'codex';

export interface SessionCreateRequest {
  provider: InteractiveProvider;
  prompt: string;
  model?: string | null;
  manual_approval?: boolean;
}

export interface SessionCreateResponse {
  session_id: string;
  run_id: string;
  lease_id: string;
  status: string;
  stream_url: string;
}

export interface SessionInjectResponse {
  session_id: string;
  run_id: string;
  status: string;
}

export interface SessionControlResponse {
  session_id: string;
  status: string;
  current_run_id: string | null;
}

export function createSession(
  input: SessionCreateRequest,
): Promise<SessionCreateResponse>;

export function injectSession(
  sessionId: string,
  prompt: string,
): Promise<SessionInjectResponse>;

export function interruptSession(
  sessionId: string,
): Promise<SessionControlResponse>;

export function endSession(
  sessionId: string,
): Promise<SessionControlResponse>;
```

固定请求：

```text
POST /api/daemon/sessions                         JSON create request
POST /api/daemon/sessions/{sessionId}/inject     JSON {"prompt":"..."}
POST /api/daemon/sessions/{sessionId}/interrupt  no body
POST /api/daemon/sessions/{sessionId}/end        no body
```

- session id 必须 `encodeURIComponent`。
- REST 统一使用 `apiFetch(..., {method:'POST', json: ...})` 的真实现有签名；实现前用 `rg` 确认 `json` 选项，禁止自行改成不存在的 helper。
- UI 展示 `ApiError.message`；根据 `code/status` 决定状态，不解析英文 message 猜测。
- `409 DAEMON_SESSION_TURN_CONFLICT` 保持 session active，移除未被 backend 接受的本地 turn 占位。
- `409 DAEMON_SESSION_NO_CURRENT_RUN` 只表示当前无可打断 run，session 仍 active。

## 5. session SSE 接口定义

### 5.1 事件 envelope

严格对齐 task-05；所有 data 都用同一形状，字段按事件可空：

```typescript
export type SessionEventKind =
  | 'turn_started'
  | 'log'
  | 'turn_completed'
  | 'session_status'
  | 'session_ended';

export interface SessionStreamEnvelope {
  event: SessionEventKind;
  session_id: string;
  run_id: string | null;
  turn: number | null;
  log_id: string | null;
  timestamp: string | null;
  channel: string | null;
  content: string | null;
  status: string | null;
  exit_code: number | null;
  reason: string | null;
}

export interface SessionStreamHandlers {
  onTurnStarted(event: SessionStreamEnvelope): void;
  onLog(event: SessionStreamEnvelope, cursor: string | null): void;
  onTurnCompleted(event: SessionStreamEnvelope): void;
  onDone(event: SessionStreamEnvelope): void;
  onError(error: Error): void;
}

export interface SessionStreamConnection {
  close(): void;
  getLastEventId(): string | null;
}

export function streamSession(
  sessionId: string,
  handlers: SessionStreamHandlers,
  options?: { cursor?: string },
): SessionStreamConnection;
```

### 5.2 EventSource 行为

- URL 使用 `/api/daemon/sessions/{id}/stream`，access token 延续现有 SSE query 方案；可选 cursor 仅在首次显式恢复时添加。
- 分别注册 `turn`、`log`、`turn_done`、`done` 命名事件；不得依赖 `es.onmessage` 接收命名事件。
- 每个 listener 先 JSON parse，再校验 `session_id` 与 URL session 一致；`turn/log/turn_done` 还必须有非空 `run_id`。
- `log` listener 保存 `MessageEvent.lastEventId`，供浏览器自动重连及测试验证；不得把 turn boundary 当 cursor。
- `turn_done` 只调用 `onTurnCompleted`，不 close。
- `done` 调 `onDone` 后 close，且回调最多一次。
- parse/schema 错误调用通用 `onError`，不把原始含敏感内容的 data 拼进错误消息。
- `onerror` 不立即 close，允许浏览器携 Last-Event-ID 自动重连；组件卸载、切换/新建 session、end 后必须显式 close。

### 5.3 Next route handler

新增 `/api/daemon/sessions/[sessionId]/stream` 代理，避免 Next rewrite 缓冲：

1. backend URL 固定为 `/api/daemon/sessions/{encodedId}/stream`。
2. 转发 query `token`、`cursor`；转发请求头 `Last-Event-ID` 与 `Accept: text/event-stream`。
3. 传递 `request.signal` 给 backend fetch，浏览器断开时取消上游。
4. backend 非 2xx 或无 body 时保留状态码与安全响应体；成功时原样流式返回 body。
5. response headers 至少包含 `Content-Type: text/event-stream`、`Cache-Control: no-cache, no-transform`、`Connection: keep-alive`、`X-Accel-Buffering: no`。

## 6. 前端状态模型

组件不得用一个 `sending` 布尔值混合“REST 正在提交”和“turn 正在运行”。建议显式状态：

```typescript
type SessionUiStatus = 'idle' | 'creating' | 'active' | 'ending' | 'ended' | 'failed';
type TurnUiStatus = 'pending' | 'running' | 'interrupting' | 'completed' | 'failed' | 'killed';

interface SessionTurnView {
  runId: string;
  turn: number | null;
  prompt: string;
  output: string;
  status: TurnUiStatus;
}

interface InteractiveSessionView {
  sessionId: string | null;
  status: SessionUiStatus;
  currentRunId: string | null;
  turns: SessionTurnView[];
}
```

状态不变量：

- `currentRunId` 只指向 pending/running/interrupting turn；收到相同 run 的 `turn_done` 后清空。
- `turn` 以 `run_id` 为 identity，SSE 重连重复 `turn` boundary 时更新已有项，不新增重复 turn。
- create/inject REST 返回 run id 后立即建立本地 turn；若 SSE 的 `turn` 先到，也按 run id upsert，解决 REST/SSE 时序竞态。
- log 只追加到相同 run id；未知 run id 先创建无 prompt 的 turn，再追加，不能丢日志。
- ended/failed session 禁止 inject；active 且有 currentRun 时禁止再次发送，backend 的 409 仍作为最终防线。
- interrupt 成功不修改 session status；end 成功进入 ended 并关闭连接。

## 7. UI 与交互

### 7.1 首条消息与追问

- idle：provider/model 可编辑，输入框文案“输入首条消息”。
- 首次发送：先把用户 prompt 放入待创建 turn；create 成功后绑定返回 run id、启动唯一 SSE、状态 active。
- active 且无 currentRun：输入框文案“继续追问”，发送走 inject。
- active 且 currentRun 运行中：发送按钮禁用。本设计不支持把 prompt 排队到运行中 turn 之后；“追问创建下一 turn”必须等 currentRun 终态。
- inject 成功：新增 turn，更新 currentRunId，但不重建 EventSource。

### 7.2 输出渲染

- `stdout` 正常追加；`stderr` 用错误样式；`tool_call` 可复用现有简短工具展示。
- 保留现有对 `[SYSTEM:*]`/`[RESULT:*]` 技术日志过滤，但原始日志仍由 `AgentLogViewer` 查看。
- 每个 turn 独立显示用户 prompt、agent output、status；React key 使用 run id，不使用数组 index。
- `turn_done` 未带最终 log 时仍更新该 turn 状态，不生成伪造输出。

### 7.3 打断 currentRun

- 仅当 session active 且 currentRunId 非空启用“打断本轮”。
- 点击后状态 `interrupting`，禁用重复 interrupt；调用 `/interrupt`。
- REST 返回的 `current_run_id` 必须等于本地 currentRunId；不一致时显示“运行状态已变化”，等待 SSE/刷新，不得把错误 turn 标 killed。
- interrupt REST 成功后 session 仍 active；最终 turn 状态由 `turn_done` 的 status 决定。
- 无 currentRun 的 409 不结束 session，清理本地过期 currentRun 并允许追问。

### 7.4 结束 session

- active session 始终可点“结束会话”，有无 currentRun 都可。
- 点击后进入 ending，禁用发送/interrupt/end；调用 `/end`。
- REST 成功可立即标 ended 并 close；稍后重复 `done` 必须幂等。若 SSE `done` 先到，同样收口。
- end 请求失败时：只有后端明确返回 ended 状态才收口；网络错误不得假定数据库已结束，应恢复 active 并显示错误，允许重试。
- “新建会话”遇 active session 时先要求/执行 end 成功，再清空本地状态；禁止 fire-and-forget end 后立即遗忘 session，避免悬挂 lease。

### 7.5 页面集成

- `/runtimes` 的在线 provider 过滤、model override、runtime summary 保留。
- provider/model 在 active/ending session 中锁定；新建会话后才可修改。
- 当前 turn 的 `activeRunId` 继续驱动 `AgentLogViewer`；历史 turn 日志回看不在本任务。
- 将状态机放进 `InteractiveSessionPanel`，页面只传 providers/default provider/model；不要继续膨胀单文件 `page.tsx`。

## 8. 边界与异常场景

| # | 场景 | 必须行为 |
|---|---|---|
| 1 | prompt 为空、全空白或超过 8000 | 前端拒绝发送并保留输入；不调用 REST |
| 2 | create 成功但 SSE 尚未连接，首批日志已产生 | task-05 DB replay 补齐；前端按 run id upsert，不丢首日志 |
| 3 | SSE `turn` 先于 create/inject Promise resolve | 创建临时 turn；REST resolve 后合并 prompt/status，不生成重复项 |
| 4 | 同一 `turn`/`log` 因重连重复到达 | boundary 幂等；log 以 `log_id` 去重，输出不重复 |
| 5 | 第二 turn 日志到达 | 只写第二 run 的 output；第一 turn 内容不变 |
| 6 | `turn_done` 到达但 session 仍 active | 清 currentRun，输入重新启用；EventSource 保持 open |
| 7 | interrupt 时本地无 currentRun | 按钮禁用，不发请求 |
| 8 | interrupt 返回不同 `current_run_id` | 不篡改任一 turn；提示状态变化并等待 SSE |
| 9 | interrupt 返回 no-current-run 409 | session 保持 active；清过期 currentRun，可继续 inject |
| 10 | inject 返回 turn conflict 409 | 移除未接受占位，保留 prompt 供重试；不重连 SSE |
| 11 | end 时 daemon/网络不可达 | 不凭网络错误假定 ended；恢复 active、显示错误、允许重试 |
| 12 | `done` 与 end REST response 竞态 | ended 收口、close、状态更新均幂等，只执行一次 |
| 13 | 非法 JSON、错误 session_id、缺 run_id 的 log | 不写 UI；调用通用 onError；不泄露原始 payload |
| 14 | EventSource 网络断开后自动重连 | 连接保持由浏览器恢复，Last-Event-ID 续流；已见 log_id 不重复 |
| 15 | 组件卸载或切换新 session | 显式 close 旧 EventSource，旧 listener 不再修改 state |
| 16 | session ended/failed 后用户按 Enter | 不调用 inject，输入/发送禁用；可新建会话 |
| 17 | provider 无在线 runtime | 首发禁用，现有 model 输入可见；不创建 session |
| 18 | 旧 quick-chat/batch 页面 | `quickChat`/`streamQuickChat` 与 run SSE 行为不变 |

## 9. TDD 实施顺序

严格执行 Red → Green → Refactor，每组测试必须先观察到因接口/行为缺失而失败。

### Step 1：REST 客户端（Red）

- 写 `daemon-session.test.ts`，断言四个 endpoint、method、JSON body、编码 session id、完整响应类型与 ApiError 透传。
- 最小实现 `createSession/injectSession/interruptSession/endSession`。

### Step 2：SSE parser/client（Red）

- fake EventSource 覆盖命名 `turn/log/turn_done/done`、lastEventId、parse error、session mismatch、turn_done 不 close、done 幂等 close。
- 实现 `streamSession`；旧 `streamQuickChat` 测试/代码不改。

### Step 3：SSE route proxy（Red）

- 测试 token/cursor/Last-Event-ID/Accept/signal 转发、错误状态透传、成功流 headers。
- 参照现有 daemon-chat route 最小实现 session route。

### Step 4：组件 create + 跨 turn（Red）

- 提取并渲染 `InteractiveSessionPanel`；mock API 与 stream。
- 首发 create；SSE log 写首 turn；turn_done 后追问 inject；断言 streamSession 只调用一次；第二 run 输出不污染第一 run。

### Step 5：interrupt/end（Red）

- 覆盖 interrupt 仅收敛当前 turn且 session active、run id mismatch、no-current-run、end/done 竞态、end 网络失败可重试、新建前先 end。
- 最小实现显式状态机，避免散落 boolean。

### Step 6：重连/去重/清理（Red）

- 重复 boundary/log 不重复；unknown run log upsert；unmount close；旧 connection callback 不更新新 session。
- 抽纯 reducer/helper 后重构，保证 run id 是唯一 identity。

### Step 7：页面集成与回归

- `/runtimes` 接入新组件，保留 provider/model/日志区；grep 确认新面板不调用 `quickChat(...prevRunId)`。
- 运行定向测试、typecheck、全量 frontend test/build。

## 10. 验收标准

| ID | 验证步骤 | 通过标准 | 覆盖 |
|---|---|---|---|
| AC-10-01 | 首次输入 prompt | 仅调用 create；保存 session/run；建立一个 session SSE | FR-10 |
| AC-10-02 | 首 run 产生 turn/log/turn_done | 独立 turn 实时渲染；turn_done 后连接仍 open、输入可追问 | FR-10 / FR-03 |
| AC-10-03 | 发送第二条 prompt | 调 inject 创建新 run；`streamSession` 累计仍只调用一次 | FR-10 / D-002@v2 |
| AC-10-04 | 第二 run 输出 | 只追加到第二 turn，第一 turn 内容不变；重复 log 不重复 | D-005@v1 |
| AC-10-05 | 运行中点击打断 | `/interrupt` 一次；session 仍 active；最终只由对应 turn_done 收敛 currentRun | FR-10 / FR-04 |
| AC-10-06 | 打断后继续追问 | currentRun 清空后 inject 成功创建下一 run，不新开 SSE | FR-10 |
| AC-10-07 | 点击结束会话 | `/end` 一次；done/REST 竞态幂等；session ended、SSE closed、发送禁用 | FR-10 / FR-05 |
| AC-10-08 | SSE 断线重连 | Last-Event-ID/cursor 正确续流；turn_done 不 close；done 才 close | D-005@v1 |
| AC-10-09 | create/inject/interrupt/end 错误 | 409/404/网络错误按边界表处理，不伪造 session/run 终态 | 健壮性 |
| AC-10-10 | 页面切换/新建 | 旧 EventSource close；active session 必须 end 成功后才清空 | 资源收口 |
| AC-10-11 | 运行旧 quick-chat/API 测试 | 旧函数、run SSE 和 batch 使用者无回归 | brownfield |
| AC-10-12 | 运行定向与全量命令 | session 客户端/组件/route 测试、typecheck、test、build 全通过 | 工程约束 |

## 11. 验证命令

先读取 `.sillyspec/local.yaml`。当前 frontend 命令为：

```powershell
Set-Location frontend
pnpm test -- src/lib/__tests__/daemon-session.test.ts src/components/daemon/__tests__/interactive-session-panel.test.tsx
pnpm typecheck
pnpm test
pnpm build
```

route handler 测试若 Vitest 的 glob 不能随上面定向路径发现，显式追加：

```powershell
pnpm test -- "src/app/api/daemon/sessions/[sessionId]/stream/__tests__/route.test.ts"
```

联调由 task-06 覆盖真实 create → 首 turn → inject → interrupt → 再 inject → end。task-04/task-05 未合并时只能报告依赖未满足，不得用旧 quick-chat 假装完成 session 链路。

## 12. 非目标与完成定义

非目标：permission request/response UI、manual approval 开关、session 列表、跨 AgentRun 历史查询、daemon restart reconnecting UI、持久化当前 session 到 localStorage、运行中 prompt 排队。

完成条件：一个 `/runtimes` 会话面板可用单一 SSE 连接完成多个顺序 turn；用户可以明确打断 currentRun 后继续追问，也可以结束整个 session；所有事件按 run id 隔离，终态和错误分支可由自动化测试证明，且旧 quick-chat/run SSE 无回归。
