---
id: task-04
title: backend session 侧（REST + service + ws_hub 控制推送 + placement + quick-chat 升级）
wave: W1
priority: P0
depends_on: [task-01, task-02]
blocks: [task-05, task-06]
covers: [FR-01, FR-02, FR-04, FR-05]
created_at: 2026-06-18 14:11:24
author: qinyi
change: 2026-06-18-daemon-interactive-session
decision_ids: [D-002@v1, D-005@v1]
allowed_paths:
  - backend/app/modules/daemon/router.py
  - backend/app/modules/daemon/service.py
  - backend/app/modules/daemon/ws_hub.py
  - backend/app/modules/daemon/schema.py
  - backend/app/modules/daemon/protocol.py
  - backend/app/modules/agent/placement.py
  - backend/app/main.py
  - backend/app/core/config.py
---

# Task-04｜backend session 侧：REST + service + ws_hub 控制推送 + placement + quick-chat 升级

## 1. 目标

在 backend 落地交互式会话的「服务端侧」闭环（不含 SSE 聚合，那属 task-05；不含空闲回收，那属 task-06）：

1. **4 个 REST 端点**（design §7.2）：`POST /sessions`（创建会话+首 prompt）、`POST /sessions/{id}/inject`（注入新 prompt = 新 turn）、`POST /sessions/{id}/interrupt`（打断本轮）、`POST /sessions/{id}/end`（结束会话）。
2. **service 层**：`create_session` / `inject_session` / `interrupt_session` / `end_session`，其中 `end_session` 作为 session 与 lease 的**统一结束入口**（D-005 / §8.5）。
3. **ws_hub 主动推送**：`send_session_control(runtime_id, msg)`，复用现有 `runtime_id → WebSocket` 映射把 `daemon:session_inject` / `daemon:session_interrupt` / `daemon:session_end` 推给目标 daemon。
4. **placement interactive lease**：复用 `dispatch_to_daemon`，传 `kind="interactive"` 且**不设** `lease_expires_at`，让该 lease 天然跳过 `handle_lease_expiry`（R-04 / §8.5）。
5. **main.py quick-chat 升级**：首次 prompt 创建 `AgentSession` + interactive lease（取代现状「每轮新 run + resume」的伪多轮）；后续 prompt 走 `inject`。

覆盖：**FR-01**（创建/注入）、**FR-02**（中途追问）、**FR-04**（打断本轮保留会话）、**FR-05**（结束会话与打断分离）。

## 2. 前置依赖

- **task-01（数据模型迁移）**：`agent_sessions` 表、`daemon_task_leases.kind`（batch/interactive，默认 batch）、`agent_runs.agent_session_id`（FK→agent_sessions）必须已迁移并落到 `model.py`。本 task 的 service / router 直接依赖这些字段，否则 INSERT/SELECT 报错。**验收前需确认 task-01 alembic 已 apply。**
- **task-02（协议契约）**：`backend/app/modules/daemon/protocol.py` 必须已新增以下常量与 payload 模型，本 task 的 `ws_hub.send_session_control` 与 router 分派直接引用：
  - `DAEMON_MSG_SESSION_INJECT = "daemon:session_inject"`
  - `DAEMON_MSG_SESSION_INTERRUPT = "daemon:session_interrupt"`
  - `DAEMON_MSG_SESSION_END = "daemon:session_end"`
  - `SessionInjectPayload { session_id, lease_id, run_id, prompt }`
  - `SessionControlPayload { session_id, lease_id }`
- daemon 侧（task-03）的 sessionStore / ws-client 控制消息路由**不在本 task 依赖硬门**——backend 端可独立编译/单测（send_session_control 只发 WS 消息，不依赖 daemon 是否能处理）；端到端联调在 task-06。

> 代码现状确认：截至本 task 编写，`agent/model.py`、`daemon/model.py`、`daemon/protocol.py` 中上述字段/常量**尚未落地**（task-01/02 未合并到 main）。本 task 的实现步骤均假设 task-01/02 已合并；若 execute 时发现前置未就绪，应先阻塞推进 task-01/02。

## 3. 涉及文件

| 文件 | 改动概述 |
|---|---|
| `backend/app/modules/daemon/router.py` | 新增 4 个 session REST 端点（沿用现有 `router = APIRouter(prefix="/daemon", ...)`，无需新增 `include_router`，main.py 已 `include_router(daemon_router, prefix="/api")` → 自动落到 `/api/daemon/sessions`） |
| `backend/app/modules/daemon/service.py` | 新增 `create_session` / `inject_session` / `interrupt_session` / `end_session` 四个 service 方法；新增 domain error `DaemonSessionNotFound` / `DaemonSessionNotActive`；`end_session` 内统一更新 `agent_sessions.status=ended` + `daemon_task_leases.status=completed`（D-005 / §8.5） |
| `backend/app/modules/daemon/ws_hub.py` | 新增 `send_session_control(runtime_id, msg_type, payload)` 方法，复用 `send_to_runtime` 推送；不引入新锁/新连接池 |
| `backend/app/modules/daemon/schema.py` | 新增 4 个端点的 Pydantic 请求/响应模型（`SessionCreateRequest` / `SessionCreateResponse` / `SessionInjectRequest` / `SessionInjectResponse` / `SessionControlResponse`） |
| `backend/app/modules/daemon/protocol.py` | 仅在 task-02 未覆盖到 backend 端常量时补全（默认 task-02 已加，本 task 仅 import） |
| `backend/app/modules/agent/placement.py` | `dispatch_to_daemon` 新增关键字参数 `kind: str = "batch"` + `lease_expires_at: datetime | None = None`；interactive 路径 `kind="interactive"` + `lease_expires_at=None`；batch 路径维持现状（不破坏现有 4 处调用：quick_chat / start_run / start_stage_dispatch / start_scan_dispatch） |
| `backend/app/main.py` | `_register_quick_chat` 内 `quick_chat` 端点升级：`prev_run_id` 缺失（首次）→ 建 AgentSession + interactive lease；`prev_run_id` 存在（后续）→ 走 `service.inject_session` |
| `backend/app/core/config.py` | 新增 session 相关 Settings：`session_idle_timeout_sec: int = 1800`（默认 30min，D-004；本 task 仅声明，实际回收在 task-06 用） |

## 4. 覆盖来源（文档 → 代码）

- design **§5 Wave 1**（核心交互层：1 AgentSession = 1 长生命周期 lease；WS 控制通道 server→daemon；复用 submitMessages + SSE）
- design **§7.2 REST**（4 个端点签名 + session_id/run_id/stream_url 返回）
- design **§8.4 三元关系**（interactive lease.agent_run_id=NULL；session↔lease 1:1；session↔runs 1:N，每 turn 一个 AgentRun）
- design **§8.5 lease 过期语义**（interactive lease_expires_at=NULL；不进 handle_lease_expiry；结束集中在 service.end_session）
- design **§9 兼容**（lease.kind 默认 batch；批处理 lease 行为零变化；WS 控制消息 daemon 不识别时静默丢弃）
- design **§10 R-04**（kind 隔离：interactive 走新路径，不进现有 expire 回收）
- decisions.md **D-002@v1**（1 AgentSession = 1 长生命周期 lease，多 turn 复用 spawn）
- decisions.md **D-005@v1**（三元关系 + session/lease 统一结束入口）
- plan.md task-04 行（REST/service/ws_hub/placement/main.py；新端点 main.py include_router）
- requirements.md **FR-01 / FR-02 / FR-04 / FR-05**
- 现状代码：
  - `router.py:55`（`router = APIRouter(prefix="/daemon", tags=["daemon"])`）、`router.py:425`（`@router.websocket("/ws")` daemon_websocket，hub.connect/disconnect）
  - `service.py:348-379`（`create_lease` 现状建 pending lease）、`service.py:590-731`（`complete_lease` 终态优先级护栏 + Redis publish）、`service.py:887-905`（`expire_leases`：`status IN ('claimed','pending')` AND `lease_expires_at < now`，interactive lease 因 expires_at=NULL 天然跳过）
  - `ws_hub.py:104-139`（`send_to_runtime`：runtime_id→ws 映射 + 发送超时/失败 eviction）、`ws_hub.py:203-226`（`send_wakeup` 作为 send_to_runtime 的现成封装范例）
  - `placement.py:165-302`（`dispatch_to_daemon` raw SQL `INSERT INTO daemon_task_leases (id, agent_run_id, runtime_id, status, metadata, ...)`，未含 kind 列）
  - `main.py:126-212`（`quick_chat` 端点：现状伪多轮，每次 INSERT agent_runs + `dispatch_to_daemon(resume_session_id=...)`）

## 5. 实现步骤

### 5.1 `placement.dispatch_to_daemon` 加 `kind` / `lease_expires_at` 参数

签名扩展（向后兼容，新参数均有默认值）：

```python
async def dispatch_to_daemon(
    self,
    agent_run_id: uuid.UUID,
    user_id: uuid.UUID,
    *,
    workspace_id: uuid.UUID | None = None,
    kind: str = "batch",                       # 新增：batch | interactive
    lease_expires_at: datetime | None = None,  # 新增：None 表示不设过期（interactive 用）
    provider: str | None = None,
    # ...其余现有参数不变
) -> uuid.UUID | None:
```

raw SQL INSERT 补 `kind` 列（task-01 已加列）：

```sql
INSERT INTO daemon_task_leases
    (id, agent_run_id, runtime_id, status, kind, lease_expires_at, metadata, created_at, updated_at)
VALUES
    (:id, :agent_run_id, :runtime_id, 'pending', :kind, :lease_expires_at, :metadata, :now, :now)
```

batch 路径调用方（start_run / start_stage_dispatch / start_scan_dispatch / 现有 quick_chat 兜底分支）**不传** `kind` / `lease_expires_at`，走默认值 → 行为与现状一致（§9 兼容）。

> **R-04 兜底**：即便有调用方误传 `kind="interactive"`，`handle_lease_expiry`（service.py:887-905）按 `lease_expires_at < now` 扫描，interactive lease 因 `lease_expires_at IS NULL` 不会被 `col(...) < now` 命中（SQL 中 `NULL < x` 求值为 unknown，被 WHERE 过滤），天然跳过回收。本 task 不改 `handle_lease_expiry`，依赖 NULL 语义实现隔离（最小侵入，§8.5）。

### 5.2 `ws_hub.send_session_control`（server→daemon 主动推送）

在 `DaemonWsHub` 内新增方法，紧邻 `send_wakeup`（ws_hub.py:203）：

```python
async def send_session_control(
    self,
    runtime_id: uuid.UUID,
    msg_type: str,            # DAEMON_MSG_SESSION_INJECT / _INTERRUPT / _END
    payload: dict[str, Any],
) -> bool:
    """Push a session control message (inject/interrupt/end) to a daemon.

    Reuses send_to_runtime (ws_hub.py:104) — same runtime_id→ws lookup,
    send timeout, and slow-connection eviction. Returns False (logged) if
    the runtime is offline; callers (service) decide whether to surface
    a 504 to the REST caller or retry.
    """
    message = {"type": msg_type, "payload": payload}
    return await self.send_to_runtime(runtime_id, message)
```

- **不引入**新锁、新连接池、新 RPC correlation（控制消息是 fire-and-forget，daemon 不回 result；与 `send_rpc` 的 future 机制不同）。
- daemon 离线时返回 False（service 层决定映射成 `DaemonRuntimeOffline` → HTTP 504，复用现有错误类）。

### 5.3 `service.create_session`（建 AgentSession + interactive lease + dispatch）

```python
async def create_session(
    self,
    user_id: uuid.UUID,
    *,
    provider: str,
    prompt: str,
    model: str | None = None,
    manual_approval: bool = False,
) -> tuple[AgentSession, AgentRun, uuid.UUID]:
    """Create an interactive session: AgentSession + first AgentRun +
    interactive lease + dispatch to daemon.

    Returns (session, first_run, lease_id). The first AgentRun carries
    agent_session_id FK; the lease is kind=interactive with
    lease_expires_at=NULL (R-04 / §8.5).
    """
```

控制流：
1. 选 runtime：复用 `RunPlacementService._get_online_runtime(user_id, provider=provider)`（通过新构造 `placement = RunPlacementService(self._session)`，与现有 `handle_lease_expiry:1108-1111` 同样的 lazy import 模式）。无 online runtime → 抛 `NoOnlineDaemonError`（不在此处吞掉，让 router 层映射 504/503）。
2. 建 `AgentSession` 行：`status="pending"`、`provider=provider`、`runtime_id=runtime.id`、`config={"manual_approval": manual_approval, "model": model}`、`turn_count=0`。
3. 建首 `AgentRun`：`agent_type="claude_code"`、`provider=provider`、`model=model`、`status="pending"`、`spec_strategy="quick-chat"`（沿用 quick-chat 语义，便于复用现有 SSE / kill 链路）、`agent_session_id=session.id`。
4. 建 interactive lease：调 `placement.dispatch_to_daemon(run.id, user.id, kind="interactive", lease_expires_at=None, provider=provider, model=model, prompt=prompt)`。
5. 回填 `session.lease_id = lease_id`、`session.status = "active"`、`session.last_active_at = now`；commit。
6. 返回 `(session, run, lease_id)`。

> 注意：interactive lease 的 `agent_run_id` 在 dispatch_to_daemon 内会被设为首 run 的 id（raw SQL `:agent_run_id` 绑定）。§8.4 说「interactive lease.agent_run_id = NULL」是从「每 turn 一个 run」语义上讲 lease 不绑单个 run；但物理列上仍指向**首** run（便于 daemon claim 时拿到首 prompt 的 AgentRun 上下文）。后续 turn 的 run 通过 `agent_runs.agent_session_id` 关联到 session，而 session 再关联到 lease。后续 `inject_session` 创建的 run **不**更新 lease.agent_run_id（保持指向首 run），避免 lease 与 run 1:1 约束被破坏。

### 5.4 `service.inject_session`（新 turn = 新 AgentRun + WS inject 推送）

```python
async def inject_session(
    self,
    session_id: uuid.UUID,
    *,
    prompt: str,
) -> AgentRun:
    """Inject a new prompt into an active session → new AgentRun turn +
    push daemon:session_inject via WS."""
```

控制流：
1. 查 `AgentSession` by id；不存在 → `DaemonSessionNotFound`（HTTP 404）。
2. 校验 `session.status == "active"`；否则 `DaemonSessionNotActive`（HTTP 409，details 含当前 status）。
3. 建 `AgentRun`：`agent_session_id=session.id`、`provider=session.provider`、`model=session.config.get("model")`、`status="pending"`、`spec_strategy="quick-chat"`。
4. `session.turn_count += 1`；`session.last_active_at = now`；commit。
5. 构造 payload（task-02 的 `SessionInjectPayload`）：
   ```python
   {
       "session_id": str(session.id),
       "lease_id": str(session.lease_id),
       "run_id": str(new_run.id),
       "prompt": prompt,
   }
   ```
6. 调 `ws_hub.send_session_control(session.runtime_id, DAEMON_MSG_SESSION_INJECT, payload)`。
7. 推送失败（返回 False）→ 抛 `DaemonRuntimeOffline`（HTTP 504），但**已建的 AgentRun 保留**（状态 pending），便于 daemon 重连后由前端 retry（R-02 兜底）。
8. 返回 `new_run`。

> daemon 侧收到 `session_inject` 后写 stdin（task-03 负责）；本 task 不关心 stdin 内容，仅保证 WS 消息发出去。

### 5.5 `service.interrupt_session`（打断本轮，保留会话）

```python
async def interrupt_session(self, session_id: uuid.UUID) -> AgentSession:
    """Interrupt the current turn (SIGINT / turn interrupt) without
    ending the session. Session stays active for further inject."""
```

控制流：
1. 查 `AgentSession`；不存在 → 404。
2. 校验 status IN `("active", "pending")`；`ended`/`failed` → `DaemonSessionNotActive`（409）。
3. 构造 payload（`SessionControlPayload`）：`{"session_id": str(session.id), "lease_id": str(session.lease_id)}`。
4. 调 `send_session_control(session.runtime_id, DAEMON_MSG_SESSION_INTERRUPT, payload)`。
5. 推送失败 → `DaemonRuntimeOffline`（504）。
6. **不改** `session.status`（仍是 active）—— interrupt 是「停当前 turn」不是「结束会话」（FR-04 与 FR-05 分离的核心）。
7. 返回 `session`。

> 当前 turn 的 AgentRun 终态由 daemon 侧 task-runner 处理（标 cancelled/failed via syncStatus），本 task 不主动改 run 状态。

### 5.6 `service.end_session`（结束会话 = 统一结束入口，D-005 / §8.5）

```python
async def end_session(
    self,
    session_id: uuid.UUID,
    *,
    reason: str = "manual",
) -> AgentSession:
    """End a session: push daemon:session_end + update agent_sessions.status
    = ended + daemon_task_leases.status = completed.

    Unified end entry (D-005 / §8.5) — both manual end and idle-timeout
    (task-06) go through here, avoiding lease_expiry vs sessionStore
    double-reclaim (R-04).
    """
```

控制流：
1. 查 `AgentSession`；不存在 → 404。
2. 幂等：若 `session.status == "ended"` → 直接返回（多次点 end 不报错）。
3. 推 `send_session_control(session.runtime_id, DAEMON_MSG_SESSION_END, payload)`。**推送失败不阻塞 DB 收尾**（daemon 可能已掉线，但仍要把 session/lease 标终态，避免悬挂；log warning）。
4. 更新：
   - `session.status = "ended"`、`session.ended_at = now`、`session.updated_at = now`。
   - 关联 `DaemonTaskLease`（by `session.lease_id`）：`status = "completed"`、`updated_at = now`。
5. 把 session 下所有非终态 `AgentRun`（`status IN ('pending','running')`）置 `failed`（reason 进 `output_redacted`），防止悬挂 run。
6. commit。
7. （可选）publish Redis 事件到 `agent_session:{session_id}`（task-05 负责 channel 建立；本 task 可先 publish 到现有 `agent_run:{run_id}` 通知前端各 turn 收尾，或留空等 task-05）。
8. 返回 `session`。

### 5.7 `router.py` 4 个 REST 端点

全部加到现有 `router`（`APIRouter(prefix="/daemon")`），自动落到 `/api/daemon/sessions*`。权限沿用 `require_permission_any(Permission.TASK_RUN_AGENT)`（create/inject/interrupt/end 写操作）/ `Permission.TASK_READ`（如有 GET，本 task 不加 GET，列表/回看属 task-11）。

```python
# router.py 末尾（websocket 端点之前，保持 REST 与 WS 分区清晰）

@router.post("/sessions", response_model=SessionCreateResponse, status_code=201)
async def create_session(
    data: SessionCreateRequest,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.TASK_RUN_AGENT))],
) -> SessionCreateResponse:
    """Create an interactive agent session with the first prompt."""
    svc = DaemonService(session)
    try:
        agent_session, run, lease_id = await svc.create_session(
            user.id,
            provider=data.provider,
            prompt=data.prompt,
            model=data.model,
            manual_approval=data.manual_approval,
        )
    except NoOnlineDaemonError as exc:
        # 复用现有错误映射（placement 抛 → 504/503）；若 NoOnlineDaemonError 非 AppError，
        # 在此转 DaemonRuntimeOffline 或直接 HTTPException(503)。
        raise HTTPException(status_code=503, detail=exc.message) from exc
    return SessionCreateResponse(
        session_id=str(agent_session.id),
        run_id=str(run.id),
        lease_id=str(lease_id),
        stream_url=f"/api/daemon/sessions/{agent_session.id}/stream",  # task-05 落地
    )


@router.post("/sessions/{session_id}/inject", response_model=SessionInjectResponse)
async def inject_session(
    session_id: uuid.UUID,
    data: SessionInjectRequest,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.TASK_RUN_AGENT))],
) -> SessionInjectResponse:
    svc = DaemonService(session)
    run = await svc.inject_session(session_id, prompt=data.prompt)
    return SessionInjectResponse(run_id=str(run.id))


@router.post("/sessions/{session_id}/interrupt", response_model=SessionControlResponse)
async def interrupt_session(
    session_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.TASK_RUN_AGENT))],
) -> SessionControlResponse:
    svc = DaemonService(session)
    agent_session = await svc.interrupt_session(session_id)
    return SessionControlResponse(
        session_id=str(agent_session.id),
        status=agent_session.status or "active",
    )


@router.post("/sessions/{session_id}/end", response_model=SessionControlResponse)
async def end_session(
    session_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.TASK_RUN_AGENT))],
) -> SessionControlResponse:
    svc = DaemonService(session)
    agent_session = await svc.end_session(session_id)
    return SessionControlResponse(
        session_id=str(agent_session.id),
        status=agent_session.status or "ended",
    )
```

> **端点注册不需要新 `include_router`**：main.py:426 已有 `app.include_router(daemon_router, prefix="/api")`，session 端点加到 `daemon_router` 内即自动落到 `/api/daemon/sessions*`。CONVENTIONS「固定路径优先于参数化路径」对本 task 无影响（`/api/daemon/sessions` 与 `/api/workspaces/{workspace_id}` 不冲突，且 daemon_router 注册在 workspace_router 之后也无序问题，因路径前缀不同）。这点与任务描述中「main.py include_router 注册新 session 端点（CONVENTIONS 约定）」需澄清：**实际无需改 main.py 的 include_router 区块**，仅改 `_register_quick_chat` 的 quick-chat 升级部分（§5.8）。

### 5.8 `main.py` quick-chat 升级

`_register_quick_chat` 内 `quick_chat` 端点（main.py:126-212）改造：

```python
@qc_router.post("/daemon-chat", status_code=201)
async def quick_chat(
    prompt: str = Query(min_length=1, max_length=8000),
    provider: str = Query(default="claude", max_length=30),
    model: str | None = Query(default=None, max_length=128),
    prev_session_id: str | None = Query(default=None, max_length=64),  # 改：原 prev_run_id → prev_session_id
    session: AsyncSession = Depends(get_session),
    user: User = Depends(require_permission_any(Permission.TASK_RUN_AGENT)),
) -> dict:
    from app.modules.daemon.service import DaemonService

    svc = DaemonService(session)

    if not prev_session_id:
        # 首次 prompt：建 session + interactive lease
        agent_session, run, lease_id = await svc.create_session(
            user.id, provider=provider, prompt=prompt, model=model,
        )
        return {
            "session_id": str(agent_session.id),
            "id": str(run.id),         # 兼容旧前端字段（首轮 run id）
            "provider": provider,
            "model": model,
            "status": run.status,
        }

    # 后续 prompt：走 inject（新 turn）
    try:
        run = await svc.inject_session(uuid.UUID(prev_session_id), prompt=prompt)
    except DaemonSessionNotFound:
        # 旧 session 已结束/不存在 → 降级建新 session（R 兜底，§9 回退路径）
        agent_session, run, lease_id = await svc.create_session(
            user.id, provider=provider, prompt=prompt, model=model,
        )
        return {
            "session_id": str(agent_session.id),
            "id": str(run.id),
            "provider": provider, "model": model, "status": run.status,
        }
    return {
        "session_id": prev_session_id,
        "id": str(run.id),
        "provider": provider, "model": model, "status": run.status,
    }
```

变更点：
- 入参 `prev_run_id` → `prev_session_id`（语义对齐：现在续的是会话不是单 run）。
- 首次建 session（替代旧的「每轮新 run + resume_session_id」）。
- 后续 inject（替代旧的「INSERT agent_runs + dispatch_to_daemon(resume_session_id=...)」）。
- 保留 `id` 字段返回当前 turn 的 run_id，前端 `streamQuickChat(run_id)` 仍按 run 订阅（task-05 上线 session 级 SSE 后切到 session 订阅）。
- 旧 `prev_run_id` 入参**不保留**（本项目未上线，数据可清空，CLAUDE.md 规则 7），前端 task-10 同步改。

`get_quick_chat_result` / `stream_quick_chat` / `kill_quick_chat` / `get_quick_chat_logs`（main.py:214-401）**本 task 不改**：
- `stream_quick_chat` 按 run_id 订阅继续可用（每个 turn 一个 run_id）；session 级聚合 SSE 是 task-05。
- `kill_quick_chat` 现状走 `AgentService.kill_run(run_id)`（cancel lease）；本 task 升级后，前端「结束会话」按钮应调新 `/api/daemon/sessions/{id}/end`，「打断本轮」调 `/interrupt`，`kill_quick_chat` 端点保留作单 run 兜底（向后兼容，前端 task-10 切换）。

### 5.9 `config.py` 新增 session 配置

```python
class Settings(BaseSettings):
    # ...现有字段不变...

    # ── Interactive session (daemon-interactive-session / D-004) ────────
    session_idle_timeout_sec: int = Field(
        default=1800, ge=60, le=24 * 3600,
        description="Idle timeout (seconds) before an interactive session is "
        "auto-ended. Default 30min (D-004). Actual reclaim loop lands in task-06; "
        "this task only declares the setting.",
    )
```

本 task 仅声明，`service.end_session` 内不消费（task-06 的空闲扫描 loop 读取此值调 end_session）。

## 6. 接口定义（最终签名汇总）

```python
# ws_hub.py
class DaemonWsHub:
    async def send_session_control(
        self,
        runtime_id: uuid.UUID,
        msg_type: str,
        payload: dict[str, Any],
    ) -> bool: ...


# service.py
class DaemonSessionNotFound(AppError):
    code = "HTTP_404_DAEMON_SESSION_NOT_FOUND"
    http_status = 404


class DaemonSessionNotActive(AppError):
    code = "HTTP_409_DAEMON_SESSION_NOT_ACTIVE"
    http_status = 409


class DaemonService:
    async def create_session(
        self,
        user_id: uuid.UUID,
        *,
        provider: str,
        prompt: str,
        model: str | None = None,
        manual_approval: bool = False,
    ) -> tuple[AgentSession, AgentRun, uuid.UUID]: ...

    async def inject_session(
        self,
        session_id: uuid.UUID,
        *,
        prompt: str,
    ) -> AgentRun: ...

    async def interrupt_session(self, session_id: uuid.UUID) -> AgentSession: ...

    async def end_session(
        self,
        session_id: uuid.UUID,
        *,
        reason: str = "manual",
    ) -> AgentSession: ...


# placement.py
class RunPlacementService:
    async def dispatch_to_daemon(
        self,
        agent_run_id: uuid.UUID,
        user_id: uuid.UUID,
        *,
        workspace_id: uuid.UUID | None = None,
        kind: str = "batch",                        # 新增
        lease_expires_at: datetime | None = None,   # 新增
        # ...其余现有参数不变
    ) -> uuid.UUID | None: ...
```

```python
# schema.py
class SessionCreateRequest(BaseModel):
    provider: str
    prompt: str
    model: str | None = None
    manual_approval: bool = False


class SessionCreateResponse(BaseModel):
    session_id: str
    run_id: str
    lease_id: str
    stream_url: str


class SessionInjectRequest(BaseModel):
    prompt: str


class SessionInjectResponse(BaseModel):
    run_id: str


class SessionControlResponse(BaseModel):
    session_id: str
    status: str
```

## 7. 完成标准

| AC# | 验收项 | 验证方式 | 关联 |
|---|---|---|---|
| AC-01 | `POST /api/daemon/sessions` 返回 `{session_id, run_id, lease_id, stream_url}`；DB 中 agent_sessions.status=pending→active、daemon_task_leases.kind=interactive 且 lease_expires_at IS NULL | service 单测 + router 端点测试 | FR-01 / D-002 |
| AC-02 | `POST /api/daemon/sessions/{id}/inject` 建 AgentRun（agent_session_id 指向 session，turn_count+1）并推送 `daemon:session_inject` 到 runtime_id 对应 WS | service 单测（mock send_session_control）+ ws_hub 单测 | FR-02 |
| AC-03 | `POST /api/daemon/sessions/{id}/interrupt` 推送 `daemon:session_interrupt`，session.status 仍为 active（不改终态） | service 单测 | FR-04 |
| AC-04 | `POST /api/daemon/sessions/{id}/end` 推送 `daemon:session_end`，agent_sessions.status=ended，daemon_task_leases.status=completed，session 下非终态 AgentRun 标 failed | service 单测 | FR-05 / D-005 |
| AC-05 | interactive lease（kind=interactive, lease_expires_at=NULL）**不**被 `expire_leases` 命中（构造一条 interactive lease + 一条过期 batch lease，跑 expire_leases 后 interactive 状态不变，batch 变 expired） | service 单测 | R-04 / §8.5 |
| AC-06 | `placement.dispatch_to_daemon(kind="interactive")` 写入的 lease 行 kind=interactive、lease_expires_at=NULL；不传 kind 时 kind=batch、行为与现状一致（现有 test_dispatch_metadata 全绿） | placement 单测 | §9 兼容 |
| AC-07 | `ws_hub.send_session_control` 离线 runtime 返回 False（不抛异常）；在线 runtime 发出 `{type, payload}` JSON | ws_hub 单测（mock WebSocket） | FR-02 / FR-04 / FR-05 |
| AC-08 | `main.py` quick-chat：首次（无 prev_session_id）调 create_session，返回含 session_id；再次（带 prev_session_id）调 inject_session，返回同 session_id + 新 run_id；旧 session 不存在时降级建新 session（不抛 500） | main.py quick-chat 集成测试 | FR-01 / FR-02 / §9 回退 |
| AC-09 | 批处理 lease（workspace agent run 走 start_run/start_stage_dispatch/start_scan_dispatch）行为零变化：现有 agent/service.py 测试全绿，kind 默认 batch | 全量 `pytest backend/app/modules/agent/` | §9 兼容 |
| AC-10 | 4 个端点权限正确：create/inject/interrupt/end 需 `TASK_RUN_AGENT`；无权限返回 403 | router 权限测试 | 安全 |
| AC-11 | `uv run ruff check backend/app/modules/{daemon,agent}/ backend/app/main.py backend/app/core/config.py` 无新增告警 | lint | 工程约束 |
| AC-12 | `uv run pytest backend/app/modules/daemon/tests/ backend/app/modules/agent/tests/` 全绿（含现有 + 新增 session 测试） | 测试 | 工程约束 |

## 8. 测试要点

新增测试文件：
- `backend/app/modules/daemon/tests/test_session_service.py`（service 单测）
- `backend/app/modules/daemon/tests/test_session_router.py`（4 个端点 + 权限）
- `backend/app/modules/daemon/tests/test_ws_hub_session_control.py`（send_session_control）
- `backend/app/modules/agent/tests/test_dispatch_interactive_lease.py`（placement kind 参数）
- `backend/tests/test_quick_chat_session_upgrade.py`（main.py quick-chat 升级，参照现有 quick-chat 测试 fixture）

测试用例（service 层，mock `send_session_control` 避免真连 WS）：

| # | 用例 | 给定 | 当 | 则 |
|---|---|---|---|---|
| TS1 | create_session 正常 | user 有 online runtime | create_session(provider=claude, prompt="hi") | 返回 (session, run, lease_id)；DB agent_sessions.status=active、lease.kind=interactive、lease.lease_expires_at IS NULL、run.agent_session_id=session.id |
| TS2 | create_session 无 online runtime | user 无 online runtime | create_session(...) | 抛 NoOnlineDaemonError |
| TS3 | inject_session 正常 | active session | inject_session(sid, prompt="more") | 新 AgentRun.agent_session_id=sid；turn_count+1；send_session_control 被调用一次，msg_type=SESSION_INJECT，payload.run_id=新 run id |
| TS4 | inject 到非 active session | session.status=ended | inject_session(sid, ...) | 抛 DaemonSessionNotActive（409） |
| TS5 | inject session 不存在 | 无该 session | inject_session(不存在的id, ...) | 抛 DaemonSessionNotFound（404） |
| TS6 | inject 推送失败（daemon 离线） | active session + send_session_control 返回 False | inject_session(sid, ...) | 抛 DaemonRuntimeOffline（504）；新 AgentRun 已建（status=pending）保留 |
| TS7 | interrupt 正常 | active session | interrupt_session(sid) | send_session_control 被调用，msg_type=SESSION_INTERRUPT；session.status 仍 active |
| TS8 | interrupt 已 ended session | session.status=ended | interrupt_session(sid) | 抛 DaemonSessionNotActive |
| TS9 | end_session 正常 | active session + 2 个 pending run | end_session(sid) | send_session_control 调 SESSION_END；session.status=ended；lease.status=completed；2 个 pending run 标 failed |
| TS10 | end_session 幂等 | session.status=ended | end_session(sid) | 不抛错；不重复推 WS；返回当前 session |
| TS11 | end_session daemon 离线 | active session + send_session_control 返回 False | end_session(sid) | 不阻塞：session/lease 仍标终态（log warning） |
| TP1 | dispatch interactive lease | online runtime | dispatch_to_daemon(run.id, user.id, kind="interactive", lease_expires_at=None, prompt=...) | lease.kind=interactive；lease.lease_expires_at IS NULL；lease.agent_run_id=run.id |
| TP2 | dispatch batch 默认 | online runtime | dispatch_to_daemon(run.id, user.id, prompt=...)（不传 kind） | lease.kind=batch（或 NULL→默认 batch）；行为与现状一致 |
| TP3 | interactive lease 不进 expire | 1 条 interactive lease（expires_at=NULL）+ 1 条过期 batch lease（status=claimed, expires_at=过去） | service.expire_leases() | 返回列表只含 batch lease；interactive lease 状态不变 |
| TW1 | send_session_control 在线 | mock ws connected | send_session_control(rid, SESSION_INJECT, {...}) | 返回 True；ws.send_json 被调用，参数 {type, payload} |
| TW2 | send_session_control 离线 | 无 ws 连接 | send_session_control(rid, ...) | 返回 False；不抛异常 |
| TQ1 | quick-chat 首次建 session | 无 prev_session_id | POST /api/daemon-chat?prompt=hi | 返回 {session_id, id, status=pending}；DB agent_sessions.status=active |
| TQ2 | quick-chat 后续 inject | 带 prev_session_id（active session） | POST /api/daemon-chat?prompt=more&prev_session_id=sid | 返回 {session_id=sid, id=新run, status=pending}；DB turn_count+1 |
| TQ3 | quick-chat 降级 | 带 prev_session_id 但 session 已 ended | POST /api/daemon-chat?prompt=x&prev_session_id=ended_sid | 不抛 500；建新 session 返回新 session_id |

测试约束：
- 沿用现有 daemon tests 的 `db_session` fixture（in-memory SQLite）。因 task-01 已建表，直接 INSERT agent_sessions / daemon_task_leases / agent_runs 行。
- `send_session_control` 在 service 测试中用 `unittest.mock.AsyncMock` 替换 `get_daemon_ws_hub().send_session_control`，断言调用参数。
- ws_hub 测试用 `fastapi.testclient.TestClient` 或直接构造 mock WebSocket 对象（参照现有 ws_hub 测试如有）。

## 9. 依赖与影响

- **depends_on: task-01**（model 字段：agent_sessions 表、lease.kind、agent_runs.agent_session_id）——硬门，未合并则本 task 编译失败。
- **depends_on: task-02**（protocol 常量：DAEMON_MSG_SESSION_INJECT/INTERRUPT/END + payload 模型）——硬门，本 task import 这些常量。
- **blocks: task-05**（session 级 SSE 聚合）——task-05 的 `stream_session_logs` + submit_messages 双 publish 依赖本 task 的 session 实体存在；本 task 的 `stream_url` 字段指向 task-05 端点。
- **blocks: task-06**（空闲回收 + Wave1 联调）——task-06 的空闲 loop 调本 task 的 `end_session(reason="idle")`，依赖本 task 已落地。
- **不阻塞** task-03（daemon 侧）：backend 与 daemon 通过 WS 消息解耦，本 task 可独立单测；端到端联调在 task-06。
- **不阻塞** task-07/08/09/10/11（Wave 2/3/4）。
- 影响面：`main.py` quick-chat 端点入参字段变更（prev_run_id → prev_session_id），前端 task-10 需同步改（本 task 不动前端）。

## 10. 风险与注意

- **R-04（kind 隔离）核心保证**：interactive lease 通过 `lease_expires_at IS NULL` + `expire_leases` 的 `col(...) < now` 语义天然跳过，**不**改 `handle_lease_expiry` / `expire_leases` 代码（最小侵入）。测试 TP3 必须显式覆盖此隔离，防止未来有人改 expire_leases 把 NULL 算进去。
- **lease.agent_run_id 语义**：§8.4 说 interactive lease 不绑单个 run，但物理列 task-01 设计上 `agent_run_id` 仍是 FK→agent_runs（NOT NULL 约束未变，仅 nullable）。本 task 让 interactive lease.agent_run_id 指向**首 run**（dispatch_to_daemon 现有 raw SQL 已绑 `:agent_run_id`），后续 turn 的 run 通过 `agent_runs.agent_session_id` 关联。若 task-01 把 lease.agent_run_id 改为允许 NULL 且 interactive 强制 NULL，本 task 的 dispatch 需对应调整（传 agent_run_id=None）——**execute 时需与 task-01 对齐此点**。
- **新端点 main.py include_router**：澄清——**不需要**改 main.py 的 `include_router` 区块（daemon_router 已 include，session 端点加到 daemon_router 内即自动路由）。任务描述第 7 步「main.py include_router 注册新 session 端点」实指「session 端点通过 daemon_router 注册」，非新增 include_router 调用。
- **NoOnlineDaemonError 错误映射**：`NoOnlineDaemonError` 现状是 `Exception` 子类（placement.py:42），非 `AppError`，全局异常处理器不会自动序列化。router 层需 `try/except` 转 `HTTPException(503)` 或 `DaemonRuntimeOffline`（AppError, 504）。本 task create_session 端点已含此转换（§5.7）。
- **配置走 Settings**：`session_idle_timeout_sec` 必须经 `get_settings()`，禁止 feature 代码读 `os.environ`（CONVENTIONS）。
- **quick-chat 旧入参不保留**：`prev_run_id` 移除（数据可清空，CLAUDE.md 规则 7），前端 task-10 同步改 `prev_session_id`。若 execute 时希望保留过渡期兼容，可同时接受两参（prev_session_id 优先），但非必须。
- **send_session_control 是 fire-and-forget**：不等待 daemon 确认。inject 推送后 daemon 是否真写 stdin 由 task-03 保证；本 task 仅保证消息发出。R-02（inject 到已结束 session）由 daemon 侧 sessionStore 校验 status 拒绝，backend 层 inject_session 已先校验 session.status=active（双保险）。
- **manual_approval 仅声明不消费**：本 task 的 create_session 接受 `manual_approval` 参数并存入 `agent_sessions.config`，但 Wave 1 不实现权限暂停往返逻辑（Wave 2 task-07/08 才消费）。默认 False（§9 兼容）。
