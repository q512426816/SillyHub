---
id: task-11
title: 会话列表、跨 AgentRun 历史回看与 permission 审批弹窗
wave: W6
priority: P2
depends_on: [task-08, task-10]
blocks: []
covers: [FR-07, FR-10]
decision_ids: [D-005@v1]
created_at: 2026-06-18 15:31:03
author: qinyi
change: 2026-06-18-daemon-interactive-session
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

# Task-11：会话列表、跨 AgentRun 历史回看与 permission 审批弹窗

## 1. 目标与边界

在 task-10 的单会话 live 面板上增量补齐三个能力：

1. 展示当前用户的 `AgentSession` 列表，并可在 live 会话与只读历史会话间切换。
2. 按 `agent_runs.agent_session_id` 聚合一个会话下全部 `AgentRunLog`，按 turn/run 可辨识地回看。
3. 消费 task-07 已发布到 session SSE 的 `permission_request`，以队列式弹窗完成 allow/deny 审批。

本任务不重写 task-10 的 create/inject/interrupt/end/stream 主链路，不新增 permission WS 协议，不恢复 daemon 进程，不修改 `AgentRun.session_id`。permission 后端闭环必须复用 task-07 的既有 REST 路径与 service；开始实现前用 `rg` 确认最终落地签名，禁止并存第二套端点。

## 2. 依据与前置契约

| 来源 | 本任务采用的约束 |
|---|---|
| `plan.md` task-11 | W6、P2、依赖 task-08/task-10，交付会话列表、跨 AgentRun 历史、permission 弹窗 |
| `requirements.md` FR-07 | manual approval 需经 daemon → backend → frontend → backend → daemon 完成 allow/deny |
| `requirements.md` FR-10 | runtimes 页提供实时进度、追问、打断、结束和历史回看；本任务只补后三项 UI 中尚未由 task-10 覆盖的列表/历史/审批 |
| `decisions.md` D-005@v1 | session↔run 为 1:N；历史必须沿 `agent_runs.agent_session_id` 聚合；实时事件复用 `agent_session:{session_id}` |
| task-07 | `permission_request` 已发布到 session SSE；响应端点为 `POST /api/daemon/sessions/{session_id}/permissions/{request_id}/response` |
| task-10 | 已有 `streamSession`、会话 live 状态、create/inject/interrupt/end；本任务扩展而不复制 |

硬前置：task-01/04/05/07/08/10 已落地并通过各自测试。若实际接口与蓝图不同，以已经合并的实现为准，先更新本任务调用侧契约，不得猜测方法名。

## 3. 变更文件

| 文件 | 变更 |
|---|---|
| `backend/app/modules/daemon/schema.py` | 增加 session 列表、跨 run 日志响应 schema |
| `backend/app/modules/daemon/service.py` | 增加 owner-scoped 会话分页查询与跨 run 日志查询 |
| `backend/app/modules/daemon/router.py` | 增加 `GET /sessions`、`GET /sessions/{id}/logs`；固定路径必须置于参数化路由之前 |
| `backend/app/modules/daemon/tests/test_session_history.py` | service/router 的权限、分页、排序、聚合测试 |
| `frontend/src/lib/daemon.ts` | 增加列表/历史 API 类型与函数；扩展 `streamSession` 的 permission 事件分支 |
| `frontend/src/lib/daemon.test.ts` | API URL、query、响应及 SSE permission 解析测试 |
| `frontend/src/app/(dashboard)/runtimes/page.tsx` | 左侧会话列表、live/history 状态切换、历史视图、审批队列集成 |
| `frontend/src/app/(dashboard)/runtimes/page.test.tsx` | 列表选择、历史只读、live 不回归、审批队列测试 |
| `frontend/src/components/permission-approval-dialog.tsx` | 无新依赖的可访问审批弹窗 |
| `frontend/src/components/permission-approval-dialog.test.tsx` | allow/deny/cancel/submitting 与敏感内容渲染测试 |

## 4. 完整接口契约

### 4.1 Backend schema

```python
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

历史端点直接复用已存在的 `app.modules.agent.schema.AgentRunLogEntry`，其精确字段为 `id/run_id/timestamp/channel/content_redacted`；不得另建形似但字段漂移的 DTO。若 task-01 的 ORM 字段空值性与上面不同，session schema 必须对齐实际模型，不得为通过序列化而伪造空字符串。

### 4.2 Backend service

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

查询规则：

- 列表必须在 SQL 层用 `AgentSession.user_id == user_id` 隔离，筛选状态后再 count；排序为 `coalesce(last_active_at, created_at) DESC, id DESC`，保证稳定分页。
- 日志查询先以 `session_id + user_id` 校验 session 所有权；不存在或非 owner 均沿 task-04 的资源隐藏策略返回同一种 not-found。
- 日志沿 `AgentRun.agent_session_id == session_id` join `AgentRunLog.run_id == AgentRun.id`；排序为 `AgentRun.created_at ASC, AgentRunLog.timestamp ASC, AgentRunLog.id ASC`，必须稳定且跨 run。
- service 仅返回 ORM 对象，不依赖 FastAPI；全部使用 `AsyncSession`。

### 4.3 Backend REST

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

- `limit`: 1..100，默认 20。
- `offset`: >=0，默认 0。
- `status`: 可选，只接受 `pending|active|reconnecting|ended|failed`；非法值返回 422。
- 鉴权复用 task-04 session 控制端点的 permission dependency。

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

响应字段必须复用实际 `AgentRunLogEntry`，以上仅展示必要字段；非 owner 与不存在统一资源隐藏响应，不能泄露 session 是否存在。

permission 响应不得新建接口，直接消费 task-07：

```http
POST /api/daemon/sessions/{session_id}/permissions/{request_id}/response
Content-Type: application/json

{"decision":"allow"}  // 或 "deny"
```

### 4.4 Frontend API 与 SSE 类型

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

所有 path segment 使用 `encodeURIComponent`；普通 REST 通过 `apiFetch` 的 `json` 选项发送 body，SSE 继续沿 task-10 既有认证与关闭策略。`streamSession` 应增加独立 `onPermission` 回调或判别联合事件，不能把 permission 当日志内容渲染。

### 4.5 UI 状态契约

```ts
type SessionViewMode = "new" | "live" | "history";

interface PermissionQueueItem {
  sessionId: string;
  runId: string;
  requestId: string;
  toolName: string;
  input: unknown;
}
```

- `active|pending|reconnecting` 选择后进入 `live`；`ended|failed` 进入 `history`。
- 历史视图只读，隐藏发送、inject、interrupt、end；切回 live 时恢复 task-10 原状态机，不重建已存在的同 session SSE。
- permission 以 FIFO 队列处理；当前弹窗关闭但未审批时保持请求在队首，不能静默丢弃。允许明确“稍后处理”，但不得调用后端。
- 收到不属于当前选中 session 的 permission 仍入队并标识 session；审批必须使用事件自身 sessionId，不能误用当前 UI selection。

## 5. 实现步骤（强制 TDD）

### Step 1 — Backend Red

先创建 `test_session_history.py`，覆盖：owner 列表、状态过滤、稳定分页、跨用户隔离、跨两个 AgentRun 聚合日志、空日志、越权隐藏。运行测试，确认因接口不存在失败。

### Step 2 — Backend Green/Refactor

实现 schema → service → router 的最小代码使测试通过。router 只做参数解析/序列化；查询、所有权和排序全部在 service。完成后运行 daemon 模块测试，确保现有 runtime/lease/session 端点无回归。

### Step 3 — Frontend API Red/Green

先在 `daemon.test.ts` 写 list query、日志 URL、permission response body、permission SSE 解析测试，再实现类型与 API。使用实际 `apiFetch({json: ...})` 约定，不复制 token/错误处理。

### Step 4 — Dialog Red/Green

先写组件测试：展示工具名/结构化 input、allow、deny、稍后处理、submitting 禁用与防重复点击。再实现无新增依赖的遮罩弹窗，包含 `role="dialog"`、`aria-modal="true"`、可读标题；不得把 input 写入 console。

### Step 5 — Page Red/Green

先写页面测试再扩展 task-10：

1. 加载列表与空态/错误态。
2. 选择 ended/failed 拉历史并进入只读模式。
3. 选择 active/reconnecting 进入 live，复用对应 session SSE。
4. permission 事件入 FIFO，allow/deny 成功后弹下一条；失败保留当前项并显示错误。
5. 新建/追问/打断/结束行为保持 task-10 测试不变。

### Step 6 — Refactor 与全量验证

若 `QuickChatPanel` 继续膨胀，可在同文件内抽纯渲染子组件；除非先更新 allowed_paths，不新增目录。最后执行：

```powershell
cd backend
uv run pytest app/modules/daemon/tests/test_session_history.py -q
uv run pytest app/modules/daemon/tests -q

cd ..\frontend
pnpm vitest run src/lib/daemon.test.ts src/components/permission-approval-dialog.test.tsx "src/app/(dashboard)/runtimes/page.test.tsx"
pnpm build
```

## 6. 边界与异常场景

| 编号 | 场景 | 必须行为 |
|---|---|---|
| B-01 | 当前用户没有 session | 返回 200 空 items/total=0；UI 展示空态，不显示假会话 |
| B-02 | `limit=0/101`、负 offset、非法 status | FastAPI 返回 422；service 不执行宽松兜底 |
| B-03 | 用户 A 查询用户 B 的 session/logs | 列表永不出现；详情日志按资源隐藏策略返回 not-found，不泄露存在性 |
| B-04 | 一个 session 有 0 个 run 或 run 无日志 | 返回空数组；UI 显示“暂无历史日志”，不报错 |
| B-05 | 一个 session 有多个 run，日志时间相同 | 以 run 创建时间、log 时间、log id 稳定排序，run_id 完整保留 |
| B-06 | 切换历史请求时旧请求后返回 | 使用 abort/请求序号丢弃陈旧响应，不能覆盖新选中 session |
| B-07 | history 会话在加载中被状态刷新为 active/reconnecting | 保持用户当前只读选择，提示状态已变化；仅用户主动切 live，避免隐式启动重复 SSE |
| B-08 | 同一 permission SSE 重放/重复事件 | 以 `session_id + run_id + request_id` 去重，只入队一次 |
| B-09 | 两个 session 同时产生 permission | FIFO 保留各自 sessionId；响应发往事件所属 session，不依赖当前 selection |
| B-10 | permission 响应 409/404/网络失败 | 弹窗保持，显示可重试错误；不得 dequeue、不得自动 allow |
| B-11 | allow/deny 与用户双击/快速切换竞态 | submitting 时禁用全部决策按钮；每个 request 最多一次 POST |
| B-12 | session SSE done 时仍有 pending permission | 标记该项失效并移出队列/展示已结束提示；不得向 ended session 继续响应 |
| B-13 | `manual_approval=false` | 不出现弹窗；task-10 live 行为不变 |
| B-14 | permission input 含超长 JSON/不可序列化显示值 | 限高滚动并用安全 formatter；渲染失败显示类型摘要，不崩溃、不执行 HTML |

## 7. 验收表

| AC | 验收条件 | 自动证据 | 对齐 |
|---|---|---|---|
| AC-11.1 | 仅返回当前用户 session，支持合法状态筛选与稳定分页 | backend router/service tests | FR-10 |
| AC-11.2 | 历史端点跨至少两个 AgentRun 返回完整日志，保留 run_id 且稳定排序 | `test_session_history.py` | D-005@v1 |
| AC-11.3 | 越权 session 不出现在列表，日志查询不泄露资源存在性 | backend negative tests | 安全边界 |
| AC-11.4 | 空列表、空日志、加载失败均有明确 UI 状态 | page tests | FR-10 |
| AC-11.5 | 选择 ended/failed 进入只读 history，隐藏输入/interrupt/end | page tests | FR-10 |
| AC-11.6 | 选择 active/reconnecting 回到 live，且 task-10 create/inject/interrupt/end/SSE 用例全绿 | page regression tests | FR-10 |
| AC-11.7 | permission_request 从 session SSE 进入弹窗，展示 tool_name 与 input | SSE + dialog tests | FR-07 |
| AC-11.8 | allow/deny 调用 task-07 精确 `/response` 端点和 body，成功后推进队列 | lib/page tests | FR-07 |
| AC-11.9 | 重放事件去重、双击幂等、失败不丢请求、跨 session 不误审批 | page concurrency tests | FR-07 |
| AC-11.10 | manual=false 不弹窗，permission 内容不写 console/log | tests + code review | FR-07/安全 |
| AC-11.11 | backend daemon 模块测试、frontend 定向 vitest、`pnpm build` 全部通过 | 命令输出 | DoD |

## 8. 风险与收敛

| 风险 | 等级 | 收敛策略 |
|---|---|---|
| task-07/task-10 最终签名与蓝图偏差 | P1 | 开工先 `rg` 真实签名；只适配现有实现，不创建兼容双链路 |
| 页面组件继续膨胀 | P2 | 先保持状态所有权单一；仅抽无副作用子组件，不引入新状态库 |
| session 列表轮询与 SSE 状态冲突 | P1 | 列表刷新只更新摘要，不覆盖 live 面板的流状态；selection 以 id 保持 |
| permission 队列因 SSE 重连重复 | P1 | 复合 key 去重，成功/失效后保留已处理 key 的有界集合 |
| 历史日志量增长 | P2 | 本任务先完整返回并使用滚动容器；不得私自截断。后续若需分页，另立 API 变更 |

## 9. 完成检查

- [ ] 开工前重读 `.claude/CLAUDE.md` 与 backend/frontend `CONVENTIONS.md`、`ARCHITECTURE.md`。
- [ ] 用 `rg` 确认 task-07 的 response endpoint、task-10 的 `streamSession` 和 task-01 的 ORM 字段实际存在。
- [ ] 测试先红后绿；没有测试基础设施时先补测试基础，不以手工验收替代关键状态机测试。
- [ ] session 列表和日志查询均按 user_id 做数据库级隔离。
- [ ] 历史日志保留 run_id；UI 可识别不同 turn。
- [ ] permission 复用 task-07 SSE/REST，不新增第二连接或第二端点。
- [ ] task-10 live 会话回归测试全部通过。
- [ ] 仅修改 allowed_paths；不触碰 daemon spawn/resume 实现。
