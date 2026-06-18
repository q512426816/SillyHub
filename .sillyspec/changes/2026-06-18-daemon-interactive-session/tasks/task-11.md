---
id: task-11
title: 会话列表 + 历史回看 + 权限批准弹窗
wave: W4
priority: P2
depends_on: [task-08, task-10]
covers: [FR-10, FR-07]
created_at: 2026-06-18 14:11:24
author: qinyi
---

# 任务蓝图 — task-11 会话列表 + 历史回看 + 权限批准弹窗

> 设计依据：
> - `design.md` §5 Wave4（前端管控台）、§7.2 REST（`POST/GET /sessions` + `{id}/logs` + session 级 SSE）、§7.3 SessionStore、§8 数据模型（`agent_sessions` 表 / `AgentRun.agent_session_id` FK）、§10 R-08
> - `plan.md` task-11 行（W4, P2, depends_on task-08/task-10, covers FR-10/FR-07）
> - `requirements.md` FR-10（前端会话面板：会话列表 + 历史回看 + 权限弹窗）、FR-07（manual_approval 权限暂停往返前端侧）
> - `decisions.md` D-001（命名 `AgentSession`）、D-005（session 级 SSE 聚合，跨 turn 复用 channel `agent_session:{id}`）

## 1. 目标

在 task-10 升级后的会话面板基础上，补齐 FR-10 / FR-07 前端侧三块能力：

1. **会话列表**：runtimes 页左侧列出当前用户的 `agent_sessions`（active / idle / ended / failed 状态点 + provider + 最近活动时间），支持点击切换"当前活跃会话"。
2. **历史回看**：点选某个会话（含 ended）后，右侧面板拉 `getSessionLogs` 渲染该会话所有 turn 的 AgentRunLog（含每条 log 的 run_id，前端可按 turn 分组）。
3. **权限批准弹窗**：会话 `config.manual_approval=true` 时，订阅 task-07/08 打通的 `permission_request` 推送，弹窗展示 `tool_name` + `input`，用户批准/拒绝 → POST response 闭环。

## 2. 前置依赖

| 依赖 | 状态 | 提供能力 |
|---|---|---|
| **task-01**（已完成或本任务前完成） | 阻塞性 | `agent_sessions` 表 + `agent_runs.agent_session_id` FK + alembic 迁移。本任务所有列表/历史端点和前端类型都依赖该表存在 |
| **task-04** | 阻塞性（间接，task-10 已消费） | backend `POST /sessions`（创建）/ `{id}/inject` / `{id}/interrupt` / `{id}/end` REST 端点 + service 层 |
| **task-05** | 阻塞性（间接，task-10 已消费） | session 级 SSE 聚合（Redis channel `agent_session:{session_id}` + `stream_session_logs`） |
| **task-07** | 阻塞性 | `manual_approval` 开关 + `daemon:permission_request` / `daemon:permission_response` WS 消息两端接通（agent_sessions.config 持久化开关） |
| **task-08** | 阻塞性（核心依赖） | claude stream-json + codex json-rpc 的 `control_request` 升级为暂停往返；backend 暴露 permission 订阅通道给前端（本任务消费） |
| **task-10** | 阻塞性（直接） | runtimes/page.tsx 已升级为交互式会话面板（SSE 进度 + inject 输入框 + interrupt/end 按钮）；lib/daemon.ts 已有 `createSession`/`inject`/`interrupt`/`endSession`/`streamSession`。本任务在其之上加列表 + 历史 + 权限弹窗 |

**任务边界声明**：本任务**不**重新实现 inject/interrupt/end/createSession/streamSession（task-10 已做），**不**实现 backend permission WS 往返（task-07/08 已做），只消费其 API/通道。

## 3. 涉及文件

### 后端（补列表 + 历史端点 + permission 订阅暴露）

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | `backend/app/modules/daemon/router.py` | 新增 `GET /sessions`（当前用户会话列表，分页）+ `GET /sessions/{session_id}/logs`（历史 AgentRunLog 回看，复用现有 logs 端点模式参考 `main.py:358` get_quick_chat_logs） |
| 修改 | `backend/app/modules/daemon/service.py` | 新增 `list_sessions(user_id, *, limit, offset, status?)` + `get_session_logs(session_id, user_id)`（聚合该会话所有 AgentRun 的 AgentRunLog，按 run_id/时间排序） |
| 修改 | `backend/app/modules/daemon/schema.py` | 新增 `AgentSessionRead`（id/user_id/runtime_id/lease_id/provider/status/agent_session_id/config/turn_count/created_at/last_active_at/ended_at）+ `SessionListResponse`（items + total + pagination） |
| 新增/修改 | `backend/app/main.py` 或 daemon router | 暴露 permission 推送给前端：选型见 §6 风险 R-P1。两条候选：(a) 复用 session 级 SSE channel `agent_session:{id}` 额外 publish `permission_request` 事件，前端 task-10 已订阅 streamSession；(b) 新增 `GET /sessions/{id}/permissions/stream` 独立 SSE。**推荐 (a)**，零新增连接，与现有 streamSession 复用 |
| 修改 | `backend/app/modules/daemon/router.py` | 新增 `POST /sessions/{session_id}/permissions/{request_id}` body `{decision: allow\|deny}`（task-07 已建 backend WS 转发能力，本端点仅是 HTTP 入口供前端调用） |

### 前端

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | `frontend/src/lib/daemon.ts` | 新增 `listSessions({limit,offset,status?})` / `getSessionLogs(sessionId)` / `respondPermission(sessionId, requestId, decision)`；扩展 `streamSession` 的消息类型以识别 `permission_request` 事件（task-10 已建 streamSession，本任务加事件分支） |
| 修改 | `frontend/src/app/(dashboard)/runtimes/page.tsx` | 在 task-10 QuickChatPanel 升级基础上加：(1) 左侧 `SessionListPanel`（约 280px 宽，活动/空闲/已结束状态点 + provider 徽章 + 最近活动时间 + 切换会话）；(2) 历史回看模式：点选会话切到只读历史视图（复用 `AgentLogViewer`，logs = `getSessionLogs` 结果）；(3) `PermissionApprovalDialog`（manual_approval 会话内推送时弹出） |
| 新增 | `frontend/src/components/permission-approval-dialog.tsx` | 权限批准弹窗组件（参考 `api-key-create-dialog.tsx:61` 手写 `fixed inset-0 z-50` 遮罩模式，非 Radix Dialog——本仓库 shadcn 未装 Dialog；展示 tool_name + input 预览 + 批准/拒绝按钮） |

## 4. 实现步骤

> 顺序原则：先 backend 端点（可独立 pytest）→ lib/daemon.ts 类型与客户端 → runtimes/page.tsx 集成 → 权限弹窗组件。

### 步骤 1 — backend 数据访问层（service）

在 `DaemonService` 新增：

1. `list_sessions(user_id, *, limit=20, offset=0, status=None) -> tuple[list[AgentSession], int]`
   - 查询 `agent_sessions WHERE user_id=:uid [AND status=:status] ORDER BY last_active_at DESC LIMIT :limit OFFSET :offset`
   - 返回 (items, total)
   - 复用 `_get_owned_runtime` 同款所有权校验思路（user_id 过滤）

2. `get_session_logs(session_id, user_id) -> list[AgentRunLog]`
   - 先校验 session 属于 user_id（防越权），404 `DaemonSessionNotFound`（新增 AppError 子类，参考 `DaemonLeaseNotFound`）
   - 聚合查询：`SELECT l.* FROM agent_run_logs l JOIN agent_runs r ON l.run_id=r.id WHERE r.agent_session_id=:sid ORDER BY r.started_at, l.timestamp`
   - 返回 list，前端按 run_id 分组成 turn

3. `get_session(session_id, user_id) -> AgentSession`（步骤 2 前置，列表点选时拉详情用）

### 步骤 2 — backend schema

`schema.py` 新增（参考 `DaemonRuntimeRead` 结构）：

```python
class AgentSessionRead(BaseModel):
    id: UUID
    runtime_id: UUID
    lease_id: UUID
    provider: str | None
    status: str  # pending/active/reconnecting/ended/failed
    agent_session_id: str | None  # agent 内部 session/thread id
    config: dict | None  # { manual_approval, model, ... }
    turn_count: int
    created_at: datetime
    last_active_at: datetime | None
    ended_at: datetime | None

class SessionListResponse(BaseModel):
    items: list[AgentSessionRead]
    total: int
    limit: int
    offset: int
```

### 步骤 3 — backend router 端点

`router.py` 新增 4 个端点（所有都 `Depends(get_current_principal)` + 所有权校验，参考 `list_runtimes:175`）：

```python
@router.get("/sessions", response_model=SessionListResponse)
async def list_sessions(
    session: SessionDep,
    user: Annotated[User, Depends(get_current_principal)],
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    status: str | None = Query(None),  # active/ended/failed 过滤
) -> SessionListResponse: ...

@router.get("/sessions/{session_id}", response_model=AgentSessionRead)
async def get_session(...): ...

@router.get("/sessions/{session_id}/logs", response_model=list[AgentRunLogEntry])
async def get_session_logs(...):
    # 复用 AgentService.get_run_logs 的反序列化路径，但跨多 run 聚合
    ...

@router.post("/sessions/{session_id}/permissions/{request_id}")
async def respond_permission(
    session_id: uuid.UUID,
    request_id: str,
    data: PermissionResponseRequest,  # { decision: "allow"|"deny" }
    ...
) -> dict:
    # 调 task-07 已建的 service.respond_permission(session_id, request_id, decision)
    # 由 service 转 WS daemon:permission_response 推给 daemon
    return {"accepted": True}
```

> **路由前缀注意**：daemon router prefix=`/daemon`，所以实际路径是 `/api/daemon/sessions`。前端 fetch 时拼前缀。

### 步骤 4 — permission 推送通道（前端订阅源）

按 §6 R-P1 决策（推荐方案 a）：task-05 已建的 session 级 SSE channel `agent_session:{session_id}`，task-08 在 daemon→server 收到 permission_request 后，由 service 额外 publish 一条 `{"event":"permission_request", "request_id":..., "tool_name":..., "input":..., "run_id":...}` 到该 channel。这样前端 task-10 的 `streamSession` 单连接同时收 turn 进度 + permission 推送，零新增连接。

- 修改点：`backend/app/modules/daemon/service.py` 中 task-08 的 `handle_permission_request`（或同名方法），在落库 + 推 WS daemon 之外，额外 `redis.publish(f"agent_session:{sid}", json.dumps(permission_event))`。
- 前端 `streamSession` 的 onMessage 分支新增 `event === "permission_request"` 处理：回调上层 onPermission(req)。

### 步骤 5 — lib/daemon.ts 客户端扩展

在 task-10 已有的 session API 之上加：

```typescript
export interface AgentSessionRead {
  id: string;
  runtime_id: string;
  lease_id: string;
  provider: string | null;
  status: "pending" | "active" | "reconnecting" | "ended" | "failed";
  agent_session_id: string | null;
  config: { manual_approval?: boolean; model?: string | null } | null;
  turn_count: number;
  created_at: string;
  last_active_at: string | null;
  ended_at: string | null;
}

export async function listSessions(opts?: {
  limit?: number; offset?: number; status?: string;
}): Promise<{ items: AgentSessionRead[]; total: number; limit: number; offset: number }> {
  const params = new URLSearchParams();
  if (opts?.limit) params.set("limit", String(opts.limit));
  if (opts?.offset) params.set("offset", String(opts.offset));
  if (opts?.status) params.set("status", opts.status);
  const qs = params.toString() ? `?${params}` : "";
  return apiFetch(`/api/daemon/sessions${qs}`);
}

export async function getSessionLogs(sessionId: string): Promise<AgentRunLogEntry[]> {
  return apiFetch(`/api/daemon/sessions/${sessionId}/logs`);
}

export async function respondPermission(
  sessionId: string,
  requestId: string,
  decision: "allow" | "deny",
): Promise<void> {
  await apiFetch(`/api/daemon/sessions/${sessionId}/permissions/${requestId}`, {
    method: "POST",
    body: JSON.stringify({ decision }),
    headers: { "Content-Type": "application/json" },
  });
}

// streamSession 扩展：新增 onPermission 回调（task-10 已有 onMessage/onDone）
export interface PermissionRequest {
  request_id: string;
  tool_name: string;
  input: unknown;
  run_id?: string;
}
// 在现有 streamSession 签名加可选 onPermission(req) 参数
```

### 步骤 6 — runtimes/page.tsx 左侧 SessionListPanel

在 task-10 已升级的布局上加左侧列表面板：

- 布局：`<div className="grid xl:grid-cols-[280px_minmax(0,1fr)_430px]">`，左 = SessionListPanel，中 = 现有会话面板（task-10），右 = 保留（如有）或并入中。
- 状态：`active`（绿点 + "进行中"）、`reconnecting`（黄点 + "重连中"，Wave3）、`ended`（灰点 + "已结束"）、`failed`（红点 + "失败"）、`pending`（蓝点 + "等待"）。
- 每条卡片：provider 徽章（复用 `PROVIDER_META`）+ 状态点 + `turn_count` turn 数 + `last_active_at` 相对时间（复用 `formatRelativeTime`）+ shortId。
- 加载：mount 时 `listSessions({limit: 30})`；每 10s 轮询刷新 active 状态；切换会话调用 `onSelectSession(session)`。
- 顶部 "+ 新建会话" 按钮触发 task-10 的 createSession 流程。
- 选中态高亮（border-primary）。

### 步骤 7 — 历史回看模式

- 状态机：`mode: "live" | "history"`。点选列表中 ended/failed 会话 → `mode="history"` + `selectedSessionId`；点 active 会话或新建 → `mode="live"`。
- history 模式右侧面板：
  - 头部显示会话元信息（provider / 创建时间 / 结束时间 / turn 数）。
  - 主体复用 `AgentLogViewer`（compact 模式），logs = `getSessionLogs(selectedSessionId)` 返回，loading 态复用。
  - 按 run_id 分组：AgentLogViewer 已支持，每个 turn 一个折叠段（或平铺 + run_id 徽章，二选一，实现时取简单者）。
  - 只读：隐藏输入框 / interrupt / end 按钮（这些只在 live 模式显示）。
- live 模式保持 task-10 现有行为不变。

### 步骤 8 — 权限批准弹窗组件

新增 `frontend/src/components/permission-approval-dialog.tsx`：

- Props：`{ request: PermissionRequest | null; onRespond: (decision) => Promise<void>; onClose: () => void; submitting: boolean }`
- 渲染（参考 `api-key-create-dialog.tsx:61` 手写遮罩）：
  ```
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
    <div className="w-full max-w-lg rounded-lg border bg-background p-5 shadow-lg">
      <h2>工具调用批准</h2>
      <p>Agent 请求执行以下工具，需手动批准：</p>
      <dl>
        <dt>工具</dt><dd><code>{request.tool_name}</code></dd>
        <dt>输入</dt><dd><pre className="max-h-60 overflow-auto">{JSON.stringify(request.input, null, 2)}</pre></dd>
      </dl>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>取消（保持暂停）</Button>
        <Button variant="destructive" onClick={() => onRespond("deny")} disabled={submitting}>拒绝</Button>
        <Button onClick={() => onRespond("allow")} disabled={submitting}>批准</Button>
      </div>
    </div>
  </div>
  ```
- 仅当 `request !== null` 时渲染。
- runtimes/page.tsx 集成：streamSession 的 onPermission 回调把 req 存入 state `pendingPermission`，触发弹窗；onRespond 调 `respondPermission(sessionId, req.request_id, decision)`，成功后清空 state。submitting 期间禁用按钮。
- 仅 manual_approval=true 的会话会触发（task-08 在 daemon 端按 config 判断）。

## 5. 完成标准（Definition of Done）

1. **会话列表展示**：runtimes 页左侧展示当前用户的 agent_sessions（active/ended 混排），状态点 + provider + turn 数 + 相对时间正确渲染；空态友好提示。
2. **切换会话**：点 active 会话 → 中间面板切到该会话的 live SSE 流；点 ended 会话 → 切到 history 模式渲染历史日志。
3. **历史回看**：ended/failed 会话的历史 AgentRunLog 完整渲染（跨多 turn），按 run_id 可区分；只读（无输入/打断按钮）。
4. **权限弹窗闭环**：manual_approval=true 会话触发工具调用时，弹窗弹出显示 tool_name + input；点批准 → agent 继续执行；点拒绝 → agent 中止/跳过该工具；POST response 成功后弹窗关闭。
5. **默认行为不变**：manual_approval=false（默认）的会话不弹窗（task-08 在 daemon 端自动批准，前端收不到 permission_request 事件）。
6. **测试通过**：`cd frontend && pnpm build` + vitest 关键用例；`cd backend && uv run pytest` 新端点用例。
7. **无回归**：task-10 的 live 会话面板（SSE 进度 + inject + interrupt + end）行为零变化。

## 6. 测试要点

### vitest（frontend）

- `lib/daemon.test.ts`（或同名）：
  - `listSessions` 拼 query 正确（limit/offset/status）。
  - `getSessionLogs` URL 正确。
  - `respondPermission` POST body 含 decision。
- runtimes/page 组件测试（如有现成测试基础设施，否则手动验收清单）：
  - SessionListPanel 渲染 N 条 + 状态点映射正确。
  - 点 ended 会话 → mode 切 history + AgentLogViewer 渲染 logs。
  - 点 active 会话 → mode 切 live + streamSession 订阅。
  - 权限弹窗：onPermission 触发 → 弹窗可见；批准 → 调 respondPermission("allow") + 关闭；拒绝 → ("deny")。
  - manual_approval=false 会话：不渲染弹窗（onPermission 不触发）。

### pytest（backend）

新增 `backend/tests/modules/daemon/test_sessions_router.py`（参考现有 `test_daemon_router.py` 结构）：
- `GET /sessions` 空列表 / 有数据 / 分页 / status 过滤 / 跨用户隔离（user A 看不到 user B 的会话）。
- `GET /sessions/{id}/logs` 正常返回聚合 logs / 越权 404 / 不存在的 session 404。
- `GET /sessions/{id}` 正常 / 越权 404。
- `POST /sessions/{id}/permissions/{request_id}` 正常批准 / 拒绝 / session 不存在 / request_id 不属于该 session。
- service 层单测：`list_sessions` 排序、`get_session_logs` 跨 run 聚合正确性。

## 7. 风险与注意事项

| 编号 | 风险 | 等级 | 应对 |
|---|---|---|---|
| R-P1 | permission 推送通道选型：SSE 复用 vs 独立连接 | 中 | **推荐复用 session 级 SSE channel**（task-05 已建 `agent_session:{id}`）：零新增连接、与 streamSession 自然合一、前端 onMessage 加分支即可。若 task-05 未覆盖 permission 事件 publish，需在 task-08 service 层补一条 publish。备选独立 SSE 仅在复用方案遇阻时启用 |
| R-P2 | 列表分页：单用户会话数膨胀 | 低 | 默认 `limit=20`，前端首屏拉 30 条 + 滚动加载更多（本任务可只做首屏 + 简单"加载更多"按钮，不做无限滚动） |
| R-P3 | 与 task-10 面板集成冲突 | 中 | task-10 已定义 mode/selectedSession/streamSession 状态骨架；本任务**扩展非重写**。若 task-10 未预留 mode 字段，本任务补加并保持 live 模式行为不变（兼容） |
| R-P4 | shadcn 未装 Dialog 组件 | 低 | 参考仓库现有手写遮罩模式（`api-key-create-dialog.tsx:61` `fixed inset-0 z-50 bg-black/50`），不引入 Radix 依赖，保持技术栈一致 |
| R-P5 | 历史回看跨 turn 日志量大（单会话数百条 AgentRunLog） | 低 | 后端 `get_session_logs` 不分页（单会话量级可控，参考 quick-chat logs 端点也无分页）；前端 AgentLogViewer 已有 maxHeight 滚动容器。若实测超 1000 条再加 limit |
| R-P6 | permission 弹窗多请求并发（agent 连续触发多个 control_request） | 中 | 前端用队列：`pendingPermission: PermissionRequest \| null` 单弹窗，处理完一个再弹下一个；或同时展示多个弹窗（不推荐，UI 混乱）。取单弹窗 + 队列模式 |
| R-P7 | task-01 / task-04 / task-07 / task-08 / task-10 任一未完成 | 阻塞性 | 见 §2 前置依赖，全部完成后方可启动本任务。若并行开发，先 mock 类型 + 端点契约，联调阶段补齐 |
| R-P8 | agent_sessions.status 枚举跨前后端一致性 | 低 | 后端 schema 用字面量联合类型；前端 TS interface 用同款联合，避免 string 散落 |

## 8. 与 design / decisions 对齐

- **FR-10 覆盖**：会话列表（§5 Wave4 "会话历史回看"）+ 历史回看（§5 Wave4 "拉 agent_sessions + 关联 AgentRunLog"）+ 权限弹窗（§5 Wave4 "权限批准弹窗 Wave2 permission_request 订阅"）。
- **FR-07 前端覆盖**：弹窗 + POST response 闭环（§5 Wave2 后半）。
- **D-001 对齐**：所有类型/端点用 `AgentSession` / `agent_session_id` 命名，不碰现有 `AgentRun.session_id`。
- **D-005 对齐**：历史回看复用 session 级聚合（`agent_runs.agent_session_id` FK 跨 turn 聚合 logs）；permission 推送复用 session 级 SSE channel。
- **§7.2 REST 对齐**：`GET /sessions` + `{id}/logs` + `{id}/permissions/{request_id}` 均在 design §7.2 约定的 `/api/daemon/sessions` 命名空间下。

## 9. 非目标（本任务不做）

- ❌ 不实现 inject/interrupt/end/createSession/streamSession（task-10 已做）。
- ❌ 不实现 backend permission WS 往返（task-07/08 已做）。
- ❌ 不做权限批准历史审计页（仅做实时弹窗闭环）。
- ❌ 不做会话搜索/过滤 UI（仅 status 下拉过滤，不做全文搜索）。
- ❌ 不做 Wave3 resume 相关 UI（reconnecting 态仅展示标签，重连逻辑在 task-09）。
