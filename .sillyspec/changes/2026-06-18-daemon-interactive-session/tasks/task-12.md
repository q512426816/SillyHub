---
author: qinyi
created_at: 2026-06-18T22:41:08
change: 2026-06-18-daemon-interactive-session
id: task-12
title: "会话列表 + 历史回看 + permission 审批弹窗"
wave: W6
priority: P1
estimated_hours: 16
depends_on: [task-11, task-08]
blocks: []
requirement_ids: [FR-07, FR-10]
decision_ids: [D-005@v1]
allowed_paths:
  - backend/app/modules/daemon/router.py
  - backend/app/modules/daemon/schema.py
  - backend/app/modules/daemon/service.py
  - backend/app/modules/daemon/tests/test_session_history.py
  - frontend/src/lib/daemon.ts
  - frontend/src/lib/daemon.test.ts
  - frontend/src/app/(dashboard)/runtimes/page.tsx
  - frontend/src/app/(dashboard)/runtimes/page.test.tsx
  - frontend/src/components/permission-approval-dialog.tsx
  - frontend/src/components/permission-approval-dialog.test.tsx
---

# Task-12：会话列表 + 历史回看 + permission 审批弹窗

> v3 蓝图（D-002@v3）。v2 内容（task-11.md，W8 旧编号）作为本任务参考蓝本保留：其接口契约、边界矩阵、验收思路结构性地搬入本任务，引用更新到 v3（permission 通道由 task-08 v3 canUseTool 落地；session SSE 由 task-06 落地；session REST 由 task-05 落地）。

## 1. 目标与边界

在 task-11 的单会话 live 面板之上，补齐三个前端能力 + 对应的后端只读列表/历史端点：

1. **会话列表**：runtimes 页左侧列出当前用户的所有 `AgentSession`（active / 历史），可在 live 会话与只读历史会话间切换。后端新增 `GET /api/daemon/sessions`（task-05 未交付，本任务新增）。
2. **历史回看**：拉取指定 `AgentSession` + 关联的全部 `AgentRunLog`，跨 turn（AgentRun）可辨识地回看（D-005@v1：聚合键只能用 `agent_runs.agent_session_id`）。后端新增 `GET /api/daemon/sessions/{session_id}/logs`（task-05 未交付，本任务新增）。
3. **permission 审批弹窗**：订阅 task-08 发布的 `PERMISSION_REQUEST`（经 backend 推前端：当前设计为 WS 控制消息路径见 design §7.3；若 task-08 v3 最终落地为 session SSE 事件路径，以 task-08 实际签名为准，本任务只消费不新增第二通道），弹卡 allow/deny 后回传 task-08 的 `PERMISSION_RESPONSE` 端点。

本任务**不重写** task-11 的 create/inject/interrupt/end/stream 主链路，**不新增** permission WS/SSE 协议，**不恢复** daemon 进程，**不修改** `AgentRun.session_id`。permission 后端闭环必须复用 task-08 的既有响应路径与 service；session live SSE 必须复用 task-06 的 `GET /sessions/{id}/stream`；开工前用 `rg` 确认 task-05/06/08 的最终落地签名，禁止并存第二套端点。

## 2. 覆盖来源与前置契约

| 来源 | 本任务采用的约束 |
|---|---|
| `plan.md` v3 task-12 | W6、P1、depends_on=[task-11, task-08]、blocks=[]；交付会话列表 + 跨 AgentRun 历史回看 + permission 弹窗 |
| `requirements.md` FR-07 | canUseTool 远程人审：daemon→backend→frontend 弹窗→backend→daemon 完成 allow/deny；5min 超时→deny（D-007@v1） |
| `requirements.md` FR-10 | runtimes 页提供实时进度、追问、打断、结束 + 历史回看；本任务只补列表/历史/审批，不重写 task-11 已交付的 live 主链路 |
| `decisions.md` D-005@v1 | session↔lease 1:1（`agent_sessions.lease_id`）、session↔runs 1:N（`agent_runs.agent_session_id`，**不得**用 `AgentRun.session_id` 聚合）；session 级 SSE channel `agent_session:{session_id}` |
| `design.md` §7.3 | permission WS 控制消息 `PERMISSION_REQUEST`/`PERMISSION_RESPONSE`，payload `{session_id, run_id, request_id, tool_name, input}` / `{session_id, request_id, decision, message?}` |
| `design.md` §7.4 | session REST 契约（create/inject/interrupt/end/stream，由 task-05 落地） |
| `design.md` §7.5 / §8.4 | session 级 SSE 聚合（task-06）+ 三元关系（task-02 数据层） |
| task-11 | 已有 `streamSession`、会话 live 状态、create/inject/interrupt/end；本任务扩展而不复制 |
| task-08 | `PERMISSION_REQUEST` 发布通道 + `PERMISSION_RESPONSE` 回传端点（canUseTool 回调驱动）；本任务只消费 |

硬前置：task-02/05/06/08/11 已落地并通过各自测试。若 task-05/06/08 实际接口与蓝图不同，以已合并的实现为准，先用 `rg` 确认真实签名再适配调用侧契约，不得猜测方法名，不得并存第二套 permission/session 端点。

## 3. 变更文件

| 文件 | 变更 |
|---|---|
| `backend/app/modules/daemon/schema.py` | 新增 `AgentSessionRead`、`AgentSessionListResponse`；历史直接复用 `app.modules.agent.schema.AgentRunLogEntry`（不另建字段漂移 DTO） |
| `backend/app/modules/daemon/service.py` | 新增 `list_agent_sessions(user_id, *, limit, offset, status_filter)` 与 `get_agent_session_logs(session_id, user_id)`；owner-scoped SQL 隔离 + 稳定排序 |
| `backend/app/modules/daemon/router.py` | 新增 `GET /sessions`、`GET /sessions/{session_id}/logs`；固定路径 `GET /sessions` 必须置于参数化路由 `GET /sessions/{session_id}/...`（task-05/06 已落地的 stream 等）之前，避免 `/sessions` 被当 path param 匹配 |
| `backend/app/modules/daemon/tests/test_session_history.py` | service/router 的权限、分页、排序、跨 run 聚合、资源隐藏测试 |
| `frontend/src/lib/daemon.ts` | 新增 `listAgentSessions` / `getAgentSessionLogs` / `respondToSessionPermission` 类型与函数；扩展 task-11 的 `streamSession`（或 task-08 推送路径）增加 permission 事件分支 |
| `frontend/src/lib/daemon.test.ts` | list query、logs URL、permission response body、permission 事件解析测试 |
| `frontend/src/app/(dashboard)/runtimes/page.tsx` | 左侧会话列表、live/history 状态切换、历史只读视图、审批队列集成；复用 task-11 面板与 SSE 状态机 |
| `frontend/src/app/(dashboard)/runtimes/page.test.tsx` | 列表选择、历史只读、live 不回归、审批队列测试 |
| `frontend/src/components/permission-approval-dialog.tsx` | 无新依赖的可访问审批弹窗（`role="dialog"` / `aria-modal="true"`） |
| `frontend/src/components/permission-approval-dialog.test.tsx` | allow/deny/cancel/submitting 与敏感 input 渲染测试 |

> 测试文件按项目惯例挂到 `backend/app/modules/daemon/tests/` 与 frontend 同级 `*.test.*`；若该目录/约定在 execute 前由其他任务新增，以实际目录为准，不违反 allowed_paths 对实现文件的限制。

## 4. 完整接口契约

### 4.1 Backend schema（`daemon/schema.py`）

```python
from typing import Literal
from datetime import datetime
from pydantic import BaseModel
import uuid


class AgentSessionRead(BaseModel):
    id: uuid.UUID
    runtime_id: uuid.UUID
    lease_id: uuid.UUID
    provider: str
    status: Literal["pending", "active", "reconnecting", "ended", "failed"]
    agent_session_id: str | None
    config: dict | None
    turn_count: int
    created_at: datetime
    last_active_at: datetime | None
    ended_at: datetime | None

    model_config = {"from_attributes": True}


class AgentSessionListResponse(BaseModel):
    items: list[AgentSessionRead]
    total: int
    limit: int
    offset: int
```

历史端点直接复用 `app.modules.agent.schema.AgentRunLogEntry`（实际字段 `id/run_id/timestamp/channel/content_redacted`，见 `backend/app/modules/agent/schema.py:123`）；**不得**另建形似但字段漂移的 DTO。若 task-02 的 ORM 字段空值性与上面不同，session schema 必须对齐实际模型，不得为通过序列化而伪造空字符串。

### 4.2 Backend service（`daemon/service.py`）

```python
class DaemonService:
    async def list_agent_sessions(
        self,
        user_id: uuid.UUID,
        *,
        limit: int,
        offset: int,
        status_filter: str | None = None,
    ) -> tuple[list[AgentSession], int]: ...

    async def get_agent_session_logs(
        self,
        session_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> list[AgentRunLog]: ...
```

查询规则（严格）：

- **列表**：SQL 层用 `AgentSession.user_id == user_id` 隔离；可选 `status_filter` 过滤；count 与 items 用同一 user_id + status 条件。排序为 `coalesce(last_active_at, created_at) DESC, id DESC`，保证稳定分页。
- **日志所有权校验**：先以 `session_id + user_id` 校验 session 所有权；不存在或非 owner 均沿 task-05 的资源隐藏策略返回同一种 not-found（不泄露 session 是否存在）。
- **跨 run 聚合**：沿 `AgentRun.agent_session_id == session_id` join `AgentRunLog.run_id == AgentRun.id`；排序为 `AgentRun.created_at ASC, AgentRunLog.timestamp ASC, AgentRunLog.id ASC`，必须稳定且跨 run；**禁止**用 `AgentRun.session_id`（claude resume 语义）聚合。
- service 仅返回 ORM 对象，不依赖 FastAPI；全部使用 `AsyncSession`；不依赖 Redis。

### 4.3 Backend REST（`daemon/router.py`）

```http
GET /api/daemon/sessions?limit=20&offset=0&status=active
Authorization: Bearer <token>

200
{
  "items": [AgentSessionRead],
  "total": 42,
  "limit": 20,
  "offset": 0
}
```

- `limit`：1..100，默认 20；越界 → FastAPI 422。
- `offset`：>=0，默认 0；负值 → 422。
- `status`：可选，只接受 `pending|active|reconnecting|ended|failed`；非法值 → 422。
- 鉴权复用 task-05 session 控制端点的 permission dependency（与 create/inject 一致），不新增无认证入口。

```http
GET /api/daemon/sessions/{session_id}/logs
Authorization: Bearer <token>

200
[
  {
    "id": "...",
    "run_id": "...",
    "timestamp": "...",
    "channel": "stdout",
    "content_redacted": "..."
  }
]
```

- 响应字段必须复用实际 `AgentRunLogEntry`；非 owner 与不存在统一资源隐藏响应（404，不区分）。
- 路由顺序：`GET /sessions`（固定）必须注册在 `GET /sessions/{session_id}/stream`（task-06）、`/sessions/{session_id}/logs`（本任务）等参数化路由之前；FastAPI 按注册顺序匹配，固定路径后置会被 `{session_id}` 误吞。

permission 响应**不得新建接口**，直接消费 task-08 的回传端点。task-08 v3 实际路径以 `rg` 确认为准（候选形态：`POST /api/daemon/sessions/{session_id}/permissions/{request_id}/response` body `{"decision":"allow"|"deny"}`，或 WS `PERMISSION_RESPONSE` 控制消息）。本任务前端只调一个固定函数 `respondToSessionPermission`，内部路由由 task-08 落地签名决定。

### 4.4 Frontend API 与事件类型（`lib/daemon.ts`）

```ts
export type AgentSessionStatus =
  | "pending"
  | "active"
  | "reconnecting"
  | "ended"
  | "failed";

export interface AgentSessionRead {
  id: string;
  runtime_id: string;
  lease_id: string;
  provider: string;
  status: AgentSessionStatus;
  agent_session_id: string | null;
  config: { manual_approval?: boolean; model?: string | null } | null;
  turn_count: number;
  created_at: string;
  last_active_at: string | null;
  ended_at: string | null;
}

export interface AgentSessionListResponse {
  items: AgentSessionRead[];
  total: number;
  limit: number;
  offset: number;
}

export interface PermissionRequestEvent {
  event: "permission_request";
  session_id: string;
  run_id: string;
  request_id: string;
  tool_name: string;
  input: unknown;
}

export async function listAgentSessions(options?: {
  limit?: number;
  offset?: number;
  status?: AgentSessionStatus;
}): Promise<AgentSessionListResponse>;

export async function getAgentSessionLogs(
  sessionId: string,
): Promise<AgentRunLogEntry[]>;

export async function respondToSessionPermission(
  sessionId: string,
  requestId: string,
  decision: "allow" | "deny",
): Promise<void>;
```

- 所有 path segment 使用 `encodeURIComponent`。
- `listAgentSessions` / `getAgentSessionLogs` 走 `apiFetch`（GET，query 经 `URLSearchParams`）。
- `respondToSessionPermission` 按 task-08 实际落地签名（REST POST 或 WS send）实现；通过 `apiFetch({json})` 或 task-08 暴露的 ws send helper，不复制 token/错误处理。
- `PermissionRequestEvent` 订阅来源：复用 task-11 的 `streamSession` 扩展独立 `onPermission` 回调（若 task-08 v3 把 permission_request 发布到 session SSE），或消费 task-08 单独建立的 permission 推送通道（WS）。**只接入一条** task-08 实际提供的通道，不并存。permission 事件**不得**当普通日志内容渲染。

### 4.5 UI 状态契约（`runtimes/page.tsx`）

```ts
type SessionViewMode = "new" | "live" | "history";

interface PermissionQueueItem {
  sessionId: string;
  runId: string;
  requestId: string;
  toolName: string;
  input: unknown;
}

interface SessionListPanelProps {
  sessions: AgentSessionRead[];
  selectedSessionId: string | null;
  loading: boolean;
  error: string | null;
  onSelect: (session: AgentSessionRead) => void;
  onCreateNew: () => void;
  onRetry: () => void;
}

interface PermissionApprovalDialogProps {
  request: PermissionQueueItem | null;
  submitting: boolean;
  error: string | null;
  onRespond: (decision: "allow" | "deny") => Promise<void>;
  onDefer: () => void;
}
```

- `active|pending|reconnecting` 选择后进入 `live`；`ended|failed` 进入 `history`。
- 历史视图只读：隐藏发送、inject、interrupt、end 控件；切回 live 时恢复 task-11 原状态机，**不重建**已存在的同 session SSE 连接。
- permission 以 **FIFO 队列**处理；当前弹窗关闭但未审批时保持请求在队首，不能静默丢弃。允许明确“稍后处理”（`onDefer`），但不得调用后端。
- 收到不属于当前选中 session 的 permission 仍入队并标识其所属 session；审批必须使用事件自身的 `sessionId`，**不能误用当前 UI selection**。
- `PermissionApprovalDialog` 仅在 `request !== null` 时渲染，必须提供 `role="dialog"`、`aria-modal="true"` 与标题关联；`submitting=true` 时 allow/deny/defer 全部禁用。
- `SessionListPanel` 是受控组件，不自行持有 selected session，不创建第二套 SSE；错误重试通过 `onRetry` 交还父组件。

## 5. 实现步骤（强制 TDD，先红后绿）

### Step 1 — Backend Red

先创建 `test_session_history.py`，覆盖：owner 列表、status 过滤、稳定分页、跨用户隔离、跨两个 AgentRun 聚合日志、空日志、越权资源隐藏、`limit/offset/status` 非法值 422。运行测试，确认因接口不存在失败（Red 证据保留）。

### Step 2 — Backend Green / Refactor

按 schema → service → router 的最小代码使测试通过。router 只做参数解析 / 序列化 / 所有权委托；查询、所有权、排序全部在 service。注意路由注册顺序（§4.3）。完成后跑 daemon 模块测试，确保 task-05/06 的 runtime/lease/session/stream 端点无回归。

### Step 3 — Frontend API Red / Green

先在 `daemon.test.ts` 写 list query 构造、logs URL、permission response body、permission 事件解析测试，再实现类型与 API。使用实际 `apiFetch` 约定，不复制 token / 错误处理。

### Step 4 — Dialog Red / Green

先写组件测试：展示工具名 / 结构化 input、allow、deny、稍后处理、submitting 禁用与防重复点击。再实现无新增依赖的遮罩弹窗，含 `role="dialog"`、`aria-modal="true"`、可读标题；**不得**把 input 写入 `console` 或日志。

### Step 5 — Page Red / Green

先写页面测试再扩展 task-11 面板：

1. 加载列表与空态 / 错误态。
2. 选择 `ended/failed` 拉历史并进入只读模式。
3. 选择 `active/reconnecting` 进入 live，复用对应 session SSE（task-06）。
4. permission 事件入 FIFO，allow/deny 成功后弹下一条；失败保留当前项并显示错误。
5. 新建 / 追问 / 打断 / 结束行为保持 task-11 测试不变（回归）。

### Step 6 — Refactor 与全量验证

若 `QuickChatPanel` / 会话面板继续膨胀，可在同文件内抽纯渲染子组件；除非先更新 allowed_paths，不新增目录。最后执行（Windows PowerShell）：

```powershell
cd backend
uv run pytest app/modules/daemon/tests/test_session_history.py -q
uv run pytest app/modules/daemon/tests -q

cd ..\frontend
pnpm vitest run src/lib/daemon.test.ts src/components/permission-approval-dialog.test.tsx "src/app/(dashboard)/runtimes/page.test.tsx"
pnpm build
```

## 6. 边界与异常场景（必须覆盖，≥5，实际 14 项）

| 编号 | 场景 | 必须行为 |
|---|---|---|
| B-01 | 当前用户没有 session | 返回 200 空 items / total=0；UI 展示空态，不显示假会话 |
| B-02 | `limit=0/101`、负 offset、非法 status | FastAPI 返回 422；service 不执行宽松兜底 |
| B-03 | 用户 A 查询用户 B 的 session / logs | 列表永不出现；详情日志按资源隐藏策略返回 not-found，不泄露 session 是否存在 |
| B-04 | 一个 session 有 0 个 run 或 run 无日志 | 返回空数组；UI 显示“暂无历史日志”，不报错 |
| B-05 | 一个 session 有多个 run，日志时间相同 | 以 run 创建时间、log 时间、log id 稳定排序；`run_id` 完整保留，前端可辨识 turn 边界 |
| B-06 | 切换历史请求时旧请求后返回 | 使用请求序号 / AbortController 丢弃陈旧响应，不能覆盖新选中 session 的历史 |
| B-07 | history 会话在加载中被状态刷新为 active/reconnecting | 保持用户当前只读选择，提示状态已变化；仅用户主动切 live，避免隐式启动重复 SSE |
| B-08 | 同一 permission 事件重放 / 重复推送 | 以 `session_id + run_id + request_id` 复合 key 去重，只入队一次 |
| B-09 | 两个 session 同时产生 permission | FIFO 保留各自 sessionId；响应发往事件所属 session，不依赖当前 selection |
| B-10 | permission 响应 409/404/网络失败 | 弹窗保持，显示可重试错误；**不得** dequeue、不得自动 allow |
| B-11 | allow/deny 与用户双击 / 快速切换竞态 | submitting 时禁用全部决策按钮；每个 request 最多一次成功 POST |
| B-12 | session SSE done（或 permission 推送通道关闭）时仍有 pending permission | 标记该项失效并移出队列 / 展示已结束提示；不得向 ended session 继续响应 |
| B-13 | `manual_approval=false` | 不出现弹窗；task-11 live 行为不变 |
| B-14 | permission input 含超长 JSON / 不可序列化显示值 | 限高滚动并用安全 formatter；渲染失败显示类型摘要，不崩溃、不执行 HTML、不写入 console |

## 7. 非目标

- 不实现或修改 daemon spawn / SDK driver / resume / SessionStore 持久化及崩溃恢复（task-04/07/10）。
- 不重复实现 task-11 的 create/inject/interrupt/end/stream 主链路，也不保留新旧两套会话 UI 状态机。
- 不新增 permission SSE/WS/REST 协议；只消费 task-08 已发布的推送通道与精确回传端点。
- 不修改 `AgentRun.session_id` 语义，不以该字段聚合历史（D-001/D-005）。
- 不做全文搜索、权限审批历史审计、无限滚动、历史日志分页或批量审批。
- 不在本任务中调整非 runtimes 页的 AgentLogViewer 消费方。
- 不重新实现 task-05 的 session REST（create/inject/interrupt/end）或 task-06 的 session SSE stream。

## 8. 参考

- **task-11 v2 蓝本**（`tasks/task-11.md`）：本任务列表 / 历史 / 审批三段式结构与接口契约的参考来源；引用更新到 v3。
- **task-08**：`PERMISSION_REQUEST` 发布 + `PERMISSION_RESPONSE` 回传（canUseTool 回调驱动）。
- **task-05**：session REST（create/inject/interrupt/end）+ 所有权校验 + `_publish_session_event`。
- **task-06**：`GET /sessions/{session_id}/stream`（session 级 SSE 聚合，`agent_session:{session_id}` channel）。
- **task-02**：`agent_sessions` 表 + `agent_runs.agent_session_id` FK（D-005 数据层）。
- 代码锚点：`backend/app/modules/agent/schema.py:123`（`AgentRunLogEntry`）、`backend/app/modules/daemon/router.py`（task-05/06 session 路由注册点）、`frontend/src/lib/daemon.ts`（task-11 `streamSession` 扩展点）。

## 9. TDD 实施检查

- [ ] 开工前重读 `.claude/CLAUDE.md` 与 backend/frontend `CONVENTIONS.md`、`ARCHITECTURE.md`。
- [ ] 用 `rg` 确认 task-05 的 session REST 端点、task-06 的 `GET /sessions/{id}/stream`、task-08 的 permission 回传端点 / 推送通道、task-02 的 `AgentSession` / `AgentRun.agent_session_id` ORM 字段实际存在。
- [ ] 测试先红后绿；保留至少一次预期 Red 证据。
- [ ] 没有测试基础设施时先补测试基础，不以手工验收替代关键状态机测试。
- [ ] session 列表和日志查询均按 user_id 做数据库级隔离；历史聚合只用 `agent_runs.agent_session_id`。
- [ ] 历史日志保留 run_id；UI 可识别不同 turn。
- [ ] permission 复用 task-08 通道，不新增第二连接或第二端点。
- [ ] task-11 live 会话回归测试全部通过。

## 10. 验收表

| AC | 验收条件 | 自动证据 | 对齐 |
|---|---|---|---|
| AC-12.1 | 仅返回当前用户 session，支持合法状态筛选与稳定分页 | `test_session_history.py` list 用例 | FR-10 |
| AC-12.2 | 历史端点跨至少两个 AgentRun 返回完整日志，保留 run_id 且稳定排序 | `test_session_history.py` 聚合用例 | D-005@v1 |
| AC-12.3 | 越权 session 不出现在列表，日志查询不泄露资源存在性 | backend negative tests | 安全边界 |
| AC-12.4 | 空列表、空日志、加载失败均有明确 UI 状态 | page tests | FR-10 |
| AC-12.5 | 选择 ended/failed 进入只读 history，隐藏输入 / interrupt / end | page tests | FR-10 |
| AC-12.6 | 选择 active/reconnecting 回到 live，且 task-11 create/inject/interrupt/end/SSE 用例全绿 | page regression tests | FR-10 |
| AC-12.7 | `permission_request` 从 task-08 通道进入弹窗，展示 tool_name 与 input | 事件解析 + dialog tests | FR-07 / D-007@v1 |
| AC-12.8 | allow/deny 调用 task-08 精确回传端点和 body，成功后推进队列 | lib + page tests | FR-07 |
| AC-12.9 | 重放事件去重、双击幂等、失败不丢请求、跨 session 不误审批 | page concurrency tests | FR-07 |
| AC-12.10 | `manual=false` 不弹窗，permission 内容不写 console / log | tests + code review | FR-07 / 安全 |
| AC-12.11 | backend daemon 模块测试、frontend 定向 vitest、`pnpm build` 全部通过 | 命令输出 | DoD |
| AC-12.12 | 改动严格限制在 allowed_paths，不触碰 daemon driver / SDK / resume 实现 | `git diff --name-only` | 任务边界 |

## 11. 风险与收敛

| 风险 | 等级 | 收敛策略 |
|---|---|---|
| task-05/06/08 最终签名与蓝图偏差（尤其 permission 通道是 WS 还是 SSE） | P1 | 开工先 `rg` 真实签名；只适配现有实现，不创建兼容双链路 |
| 页面组件继续膨胀 | P2 | 先保持状态所有权单一；仅抽无副作用子组件，不引入新状态库 |
| session 列表轮询与 SSE 状态冲突 | P1 | 列表刷新只更新摘要，不覆盖 live 面板的流状态；selection 以 id 保持 |
| permission 队列因推送通道重连 / 重放重复 | P1 | 复合 key 去重，成功 / 失效后保留已处理 key 的有界集合 |
| 历史日志量增长 | P2 | 本任务先完整返回并使用滚动容器；不得私自截断。后续若需分页，另立 API 变更 |
| 路由顺序导致 `GET /sessions` 被 path param 误吞 | P1 | 固定路径注册在参数化路由之前；router 测试覆盖 `/sessions` 与 `/sessions/{id}/logs` 都能命中 |

## 12. 完成检查

- [ ] 对照 §10 验收表 AC-12.1 ~ AC-12.12 逐项验收。
- [ ] session 列表 / 历史 / 审批三段功能各自有定向测试通过。
- [ ] task-11 live 主链路回归零失败。
- [ ] 仅修改 allowed_paths 内文件；不触碰 daemon spawn / SDK driver / resume / SessionStore。
