---
author: qinyi
created_at: 2026-06-18T22:41:08
change: 2026-06-18-daemon-interactive-session
id: task-05
title: "backend session REST/service/placement：逐 turn 创建 AgentRun、并发防重与统一结束"
wave: W2
priority: P0
estimated_hours: 16
depends_on: [task-02, task-03]
blocks: [task-06, task-08, task-10]
requirement_ids: [FR-01, FR-02, FR-04, FR-05]
decision_ids: [D-005@v1]
allowed_paths:
  - backend/app/modules/daemon/router.py
  - backend/app/modules/daemon/service.py
  - backend/app/modules/daemon/ws_hub.py
  - backend/app/modules/agent/placement.py
  - backend/app/modules/daemon/tests/test_session_service.py
  - backend/app/modules/daemon/tests/test_session_router.py
  - backend/app/modules/daemon/tests/test_ws_hub_session_control.py
  - backend/app/modules/agent/tests/test_interactive_session_placement.py
---

# task-05：backend session REST/service/placement

> 以 `plan.md` 显式 task-05 为边界（Wave2，依赖 task-02 数据模型 + task-03 协议契约）：create 与 inject 都先创建独立 `AgentRun` 再 dispatch；同一 session 并发 inject 只能成功一个；interrupt 只终止 currentRun；只有 `end_session` 可以统一结束 session 与 interactive lease。本任务为 backend 侧 session 编排的唯一业务入口，task-06（SSE 聚合）只复用本任务暴露的 router 入口与 `_publish_session_event`，task-08（canUseTool）复用 router + WS hub。

## v2 → v3 迁移说明（保留 v2 引用）

本文件在 D-002@v2 时期承担的是 "session SSE 聚合" 职责（Wave5, FR-03, depends_on=[task-04,task-07]）。spike-02 通过后 D-002@v3 立项，`plan.md` 重排任务编号：

- **原 v2 task-05 的 SSE 聚合内容（session 级 Redis channel、`stream_session_logs`、cursor/Last-Event-ID、双 publish、turn 边界）整体迁移到 task-06**（plan Wave3 "session 级 SSE 聚合"，depends_on=[task-02,task-05]，覆盖 FR-03/D-005@v1/R-08）。task-06 复用本任务建立的 `_publish_session_event` 入口与 `agent_session:{session_id}` channel 命名。
- **v3 task-05 接替原 v2 task-04 的 "backend session REST/service/placement" 职责**（Wave2, FR-01/02/04/05, depends_on=[task-02,task-03], blocks=[task-06,task-08,task-10]）。
- v2 task-04 的 backend REST/service 内容（create/inject/interrupt/end_session、interactive lease、并发防重、end 统一收口）即本 v3 task-05 的直接来源；v2 → v3 唯一语义变化是 daemon 侧执行模型从 "per-turn spawn+resume" 变为 "SDK 同进程 driver"（D-002@v3），但 **backend 侧契约不变**——backend 仍逐 turn 创建 AgentRun + WS 控制消息，对 daemon 内部是 spawn 还是 SDK 同进程无感。
- 本任务的 `decision_ids` 只列 **D-005@v1**（三元关系 + lease.agent_run_id=NULL + 不进 handle_lease_expiry + end_session 收口）。D-002@v3（driver 与 TaskRunner 并存）由 task-04 落地 daemon 侧，本任务只产出 backend ↔ daemon 的 `lease.kind=interactive` + `agent_session_id` 契约，不依赖 SDK 内部语义。

## 修改文件（必填）

| 操作 | 文件 | 责任 |
|---|---|---|
| 修改 | `backend/app/modules/daemon/router.py` | 新增 4 个 `/api/daemon/sessions` REST 端点及权限、所有权透传；router 只做 DTO 映射 |
| 修改 | `backend/app/modules/daemon/service.py` | session 编排（create/inject/interrupt/end_session）、数据库行锁、currentRun 查询、并发防重、`_publish_session_event`、终态统一收口 |
| 修改 | `backend/app/modules/daemon/ws_hub.py` | 复用现有连接表新增 `send_session_control()`，封装 task-03 定义的控制消息发送 |
| 修改 | `backend/app/modules/agent/placement.py` | 新增 `prepare_interactive_dispatch()`/`notify_interactive_dispatch()` 两段式入口，创建 `agent_run_id=NULL` 的 interactive lease 并派发首 turn；现有 batch `dispatch_to_daemon()` 签名/行为不变 |
| 新增 | `backend/app/modules/daemon/tests/test_session_service.py` | service 状态机、并发防重、回滚、幂等测试 |
| 新增 | `backend/app/modules/daemon/tests/test_session_router.py` | REST、鉴权、所有权、错误码测试 |
| 新增 | `backend/app/modules/daemon/tests/test_ws_hub_session_control.py` | 在线/离线控制消息发送测试 |
| 新增 | `backend/app/modules/agent/tests/test_interactive_session_placement.py` | 三元关系、首 turn dispatch 与 batch 回归测试 |

不得修改 `backend/app/modules/daemon/protocol.py`（task-03 负责消息常量与 payload 契约）、`backend/app/modules/daemon/model.py`（task-02 负责数据结构/迁移）、`backend/app/modules/agent/model.py`（task-02 负责 `AgentSession`/`agent_session_id` FK）、`backend/app/modules/agent/service.py`（SSE 聚合归 task-06）。schema DTO 需要时可与 task-03 协商后并入 `router.py` 内联定义，避免越界修改 `daemon/schema.py`（batch DTO 居所）。

## 覆盖来源

- Requirements：FR-01（创建交互式会话）、FR-02（多轮追问新 turn）、FR-04（打断本轮）、FR-05（结束会话）。
- Decisions：**D-005@v1**（session/lease/run 三元关系 + lease.agent_run_id=NULL + lease_expires_at=NULL 不进 `handle_lease_expiry` + 结集中在 `service.end_session`）。
- Design：§7.4（REST 端点签名）、§7.6（turn/AgentRun 生命周期时序——AgentRun 创建由 backend 驱动，关闭由 daemon result 触发）、§8.4（三元关系）、§8.5（interactive lease 过期语义）、§9（兼容策略：batch 零改动）。
- Plan：Wave 2 task-05；本任务建立 `end_session` 与 currentRun 规则，task-06 只补 session SSE 聚合，task-08 复用本任务的 router 与 ws_hub。
- 真实源码基线（必读，不可与现状脱节）：
  - `backend/app/modules/agent/placement.py::dispatch_to_daemon`（第 161-298 行）当前以 raw SQL `INSERT INTO daemon_task_leases (id, agent_run_id, runtime_id, status, metadata, ...)` 直接绑定 `agent_run_id`、commit 后 `_send_ws_wakeup()`；interactive lease 必须以新入口 `prepare_interactive_dispatch()` 写 `agent_run_id=NULL`，**不得**复用 batch SQL 把首 run FK 绑进 lease。
  - `backend/app/modules/daemon/service.py::expire_leases()`（第 887-905 行）只扫 `status IN ('claimed','pending') AND lease_expires_at < now`；interactive lease `lease_expires_at=NULL` 自然跳过，**无需改动**该方法。
  - `backend/app/modules/daemon/service.py::handle_lease_expiry(agent_run_id)`（第 992 行）以 `agent_run_id` 为入参，不能处理 `agent_run_id=NULL` 的 interactive lease——interrupt/end 必须独立收口，禁止调用。
  - `backend/app/modules/daemon/service.py::_get_owned_runtime()`（第 326 行）是现有所有权装载参考；本任务 `_get_owned_session_for_update()` 复用其 404 不泄露模式 + 加 `with_for_update()`。
  - `backend/app/modules/daemon/service.py::_publish_run_event()`（第 1155 行）是现有 run 级 Redis publish（`agent_run:{run_id}`）参考；本任务 `_publish_session_event()` 复用其"失败只 warning 不抛"的容错模式，channel 换 `agent_session:{session_id}`。
  - `backend/app/modules/daemon/ws_hub.py::send_to_runtime()`（第 104 行）已提供 runtime→WebSocket 查找、`_SEND_TIMEOUT`、断连清理；`send_session_control()` 内部调用它，不新建连接表。
  - `backend/app/modules/daemon/protocol.py`（task-03）会新增 `DAEMON_MSG_SESSION_INJECT`/`SESSION_INTERRUPT`/`SESSION_END` 常量与 `SessionInjectPayload`/`SessionControlPayload`；本任务 import 这些常量，不重定义。
  - `AgentRun` 当前没有 `created_at` 字段（`backend/app/modules/agent/model.py`），currentRun 查询**不能**按时间排序猜测，必须靠"同一 session 最多一个非终态 run"的不变量查询。

## 实现要求

### 1. 业务不变量与状态集合

在 `daemon/service.py` 模块级集中定义，不在 router 重复判断：

```python
ACTIVE_SESSION_STATUSES = frozenset({"pending", "active", "reconnecting"})
ACTIVE_TURN_STATUSES = frozenset({"pending", "running", "pending_approval"})
TERMINAL_TURN_STATUSES = frozenset({"completed", "failed", "killed", "cancelled"})
```

必须维护以下不变量（直接对应 D-005@v1）：

1. 一个 `AgentSession` 对应一个 `kind="interactive"`、`agent_run_id=NULL`、`lease_expires_at=NULL` 的 lease（§8.4/§8.5）。
2. create 创建首个 `AgentRun`；每次成功 inject 再创建一个新的 `AgentRun`，均写 `agent_session_id=session.id`（design §7.6，AgentRun 创建由 backend 驱动）。
3. 同一 session 任一时刻最多一个 `ACTIVE_TURN_STATUSES` 中的 run；该唯一 run 即 backend 视角的 currentRun。
4. interrupt 不改变 session/lease 终态，只通过 WS 请求 daemon 终止 currentRun（FR-04）。
5. 只有 `end_session()` 同时写 `AgentSession.status="ended"` + `ended_at` 与 interactive lease `status="completed"`（§8.5，单一收口）。
6. interactive lease 因 `lease_expires_at=NULL` 永不进 `expire_leases()`/`handle_lease_expiry()`——本任务不改动这两个方法，靠 NULL 自然跳过证明 D-005@v1。

### 2. 所有权、锁与并发 inject 防重

新增私有装载方法，所有 mutate API 必须传 `user_id`：

```python
async def _get_owned_session_for_update(
    self,
    session_id: uuid.UUID,
    user_id: uuid.UUID,
) -> AgentSession:
    stmt = (
        select(AgentSession)
        .where(AgentSession.id == session_id, AgentSession.user_id == user_id)
        .with_for_update()
    )
    session = (await self._session.execute(stmt)).scalar_one_or_none()
    if session is None:
        raise DaemonSessionNotFound(
            f"AgentSession '{session_id}' not found.",
            details={"session_id": str(session_id)},
        )
    return session
```

- 查不到统一抛 `DaemonSessionNotFound`（404），不泄露他人 session 是否存在（参照现有 `_get_owned_runtime` 模式）。
- `inject_session`、`interrupt_session`、`end_session` 必须先锁 `agent_sessions` 行，再查询 active run；PostgreSQL 下两个并发 inject 会串行进入临界区。
- `_get_current_run(session_id)` 查询 `agent_runs.agent_session_id=session_id AND status IN ACTIVE_TURN_STATUSES`，**不**按随机 UUID 或不存在的 `created_at` 排序。
  - 结果为 0 条返回 `None`；1 条返回该 run；超过 1 条抛 `DaemonSessionInvariantViolation`（409），禁止任意挑一条终止。
- 第二个 inject 在获得锁后会看到第一个已提交的 pending run，抛 `DaemonSessionTurnConflict`（409），不得创建第二条 run、不得重复发 WS。
- SQLite 单测不能证明 `FOR UPDATE` 语义；并发验收必须在 PostgreSQL fixture/集成环境中执行，SQLite 只验证查询与错误分支。

### 3. create：首 turn + interactive lease + dispatch

```python
async def create_session(
    self,
    user_id: uuid.UUID,
    *,
    provider: str,
    prompt: str,
    model: str | None = None,
    manual_approval: bool = False,
) -> SessionDispatchResult: ...
```

控制流（design §7.6 步骤 1 + FR-01）：

1. 复制配置为新 dict（禁止修改请求对象）；创建 `AgentSession(status="pending", turn_count=0, provider=provider, config={...})` 并 `flush()` 获得 id。
2. 创建首个 `AgentRun(status="pending", spec_strategy="interactive", agent_session_id=session.id, provider=provider, model=model)` 并 `flush()`。
3. 调 placement 的 `prepare_interactive_dispatch()`：选择在线 runtime，创建唯一 interactive lease，物理字段严格为 `agent_run_id=None`、`kind="interactive"`、`lease_expires_at=None`、`status="pending"`；首 turn 的 `run_id`/`prompt`/`session_id`/`provider`/`model` **只**写 lease metadata，**不**写 lease.agent_run_id（D-005@v1）。
4. 回填 `AgentSession.runtime_id`、`lease_id`、`status="active"`、`turn_count=1`、`last_active_at=now`，一次 commit 固化 session/run/lease 三元关系。
5. commit 后调用 `notify_interactive_dispatch()` 唤醒目标 daemon（`send_wakeup` + `send_session_control(SESSION_INJECT, {session_id, lease_id, run_id, prompt})`）；daemon claim payload 从 interactive lease metadata 取得首 `run_id`，为首 turn 独立启动。
6. 唤醒返回 False：把首 run 收敛为 `failed`、session 收敛为 `failed`、lease 收敛为 `completed`，commit 后抛 `DaemonRuntimeOffline`，不得遗留 active session（与 FR-01 一致——首 turn 启动失败即会话失败）。

`prepare_interactive_dispatch()` 必须是新入口，不得把 interactive 强塞进现有 batch SQL 后继续绑定首 run：

```python
@dataclass(frozen=True, slots=True)
class InteractiveDispatch:
    lease_id: uuid.UUID
    runtime_id: uuid.UUID
    run_id: uuid.UUID

async def prepare_interactive_dispatch(
    self,
    *,
    agent_session_id: uuid.UUID,
    agent_run_id: uuid.UUID,
    user_id: uuid.UUID,
    provider: str,
    prompt: str,
    model: str | None,
    manual_approval: bool = False,
) -> InteractiveDispatch: ...  # add + flush only，不 commit、不发送

async def notify_interactive_dispatch(self, dispatch: InteractiveDispatch) -> bool: ...
```

- `prepare_interactive_dispatch()` 内部用 raw SQL `INSERT INTO daemon_task_leases (id, agent_run_id=NULL, runtime_id, status='pending', kind='interactive', lease_expires_at=NULL, metadata={...}, ...)`（字段以 task-02 迁移为准）；metadata 含 `session_id`/`run_id`/`prompt`/`provider`/`model`/`manual_approval`，daemon claim 时从 metadata 取首 turn 参数。
- 现有 `dispatch_to_daemon()` 及所有 batch 调用保持签名和行为不变（FR-09 兼容性，brownfield 守门测试必过）。

### 4. inject：新 turn + control dispatch

```python
async def inject_session(
    self,
    session_id: uuid.UUID,
    user_id: uuid.UUID,
    *,
    prompt: str,
) -> SessionDispatchResult: ...
```

在持有 session 行锁的事务内（design §7.6 步骤 1 + FR-02）：

1. 校验 `session.status` 必须为 `active`（不在 active 子集则抛 `DaemonSessionNotActive` 409），lease/runtime 必须非空。
2. 调 `_get_current_run()`；若存在 pending/running/pending_approval run，抛 `DaemonSessionTurnConflict`（409）。
3. 创建新的 pending `AgentRun`，复制 session 的 provider 与 config.model，写 `agent_session_id`、`spec_strategy="interactive"`。
4. `turn_count += 1`、`last_active_at=now`，commit 后再发送 task-03 的 `DAEMON_MSG_SESSION_INJECT`，payload 严格使用 `{session_id, lease_id, run_id, prompt}`（design §7.3）。
5. 发送成功返回新 run；发送失败则把该 run 标 `failed` 并写可读 error（`output_redacted`），session 仍为 active（允许下一次 inject），再抛 `DaemonRuntimeOffline`。失败 turn 仍保留审计记录，turn_count 不回退。
- 注意：interactive lease 在 inject 时**不**重新创建、**不**重新 claim，daemon 端通过 WS 控制消息直接 push 到既有 SessionManager（lease.kind 分流已在 task-04 落地）。

### 5. interrupt：仅 currentRun

```python
async def interrupt_session(
    self,
    session_id: uuid.UUID,
    user_id: uuid.UUID,
) -> SessionControlResult: ...
```

（FR-04 + design §7.6 步骤 3：daemon result 触发 AgentRun=failed，backend 不抢先伪造）

- 锁定并校验 active session；查唯一 currentRun。
- currentRun 不存在时返回 `DaemonSessionNoCurrentRun`（409），不发送空 interrupt。
- 发送 task-03 的 `DAEMON_MSG_SESSION_INTERRUPT` / `SessionControlPayload {session_id, lease_id}`；daemon 根据自己的 currentRunId 只终止当前 turn。
- backend **不**调用 `DaemonLeaseService.cancel_lease()`/`handle_lease_expiry()`，**不**把 interactive lease 置 cancelled/completed，**不**改 `AgentSession.status`。
- daemon 上报 turn 终态（result is_error → AgentRun=failed）前，backend 不抢先伪造 completed；响应返回 `current_run_id` 便于调用方确认被打断目标。
- 发送失败抛 `DaemonRuntimeOffline`，DB 状态保持原样。

### 6. end：session/lease 单一收口

```python
async def end_session(
    self,
    session_id: uuid.UUID,
    user_id: uuid.UUID,
    *,
    reason: str = "manual",
) -> SessionControlResult: ...
```

（FR-05 + §8.5：结集中在 `service.end_session`）

1. 锁 session 行；若已 `ended`，幂等返回，不重复 WS、不重复写时间。
2. 查询 currentRun；若存在，先向 daemon 发送 `DAEMON_MSG_SESSION_END`（payload 仍为 `{session_id, lease_id}`），该消息语义是终止 currentRun 并清理 daemon SessionStore。
3. **无论 daemon 当前在线与否**，backend 都在同一数据库事务内：
   - 将 currentRun（如仍非终态）置 `killed`/`finished_at=now`；
   - 将 session 置 `ended`/`ended_at=now`/`last_active_at=now`；
   - 将对应 `kind="interactive"` lease 置 `completed`/`updated_at=now`。
4. lease 不存在、不是 interactive、或不属于该 session（`session.lease_id != lease.id`）时抛 `DaemonSessionInvariantViolation` 并回滚，禁止误完成 batch lease。
5. WS 失败只记录结构化 warning（参照 `_publish_run_event` 容错模式）；end 的本地收口仍成功并返回 ended。这样 daemon 离线也不会永久占用 session/lease。

所有手工结束（FR-05）与后续 task-06 的空闲结束（FR-06/D-004）都必须调用此方法（`reason="idle"`）；禁止另写第二套 session/lease 终态更新。

### 7. REST 与 router

```python
class SessionCreateRequest(BaseModel):
    provider: Literal["claude", "codex"]
    prompt: str = Field(min_length=1, max_length=8000)
    model: str | None = Field(default=None, max_length=128)
    manual_approval: bool = False

class SessionCreateResponse(BaseModel):
    session_id: uuid.UUID
    run_id: uuid.UUID
    lease_id: uuid.UUID
    status: str
    stream_url: str

class SessionInjectRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=8000)

class SessionInjectResponse(BaseModel):
    session_id: uuid.UUID
    run_id: uuid.UUID
    status: str

class SessionControlResponse(BaseModel):
    session_id: uuid.UUID
    status: str
    current_run_id: uuid.UUID | None = None
```

路由（现有 daemon router 已由 `main.py` 以 `/api` 注册，无需改 main）：

```text
POST /api/daemon/sessions                         -> 201 SessionCreateResponse
POST /api/daemon/sessions/{session_id}/inject     -> 201 SessionInjectResponse
POST /api/daemon/sessions/{session_id}/interrupt  -> 200 SessionControlResponse
POST /api/daemon/sessions/{session_id}/end        -> 200 SessionControlResponse
```

- 四个端点均使用 `require_permission_any(Permission.TASK_RUN_AGENT)`（参照现有 router 的 `RuntimeAdminUser` 模式定义 `TaskRunAgentUser`）。
- router 只做 DTO 映射，把 `user.id` 传入 service；不得在 router 直接写 SQL 或吞 `AppError`（参照 `claim_lease`/`complete_lease` 路由风格）。
- `stream_url` 固定返回 `/api/daemon/sessions/{session_id}/stream`，实际 SSE 由 task-06 落地，本任务不实现该路由。

## 接口定义（代码类任务必填）

```python
# service.py 返回类型
@dataclass(frozen=True, slots=True)
class SessionDispatchResult:
    agent_session: AgentSession
    agent_run: AgentRun
    lease_id: uuid.UUID

@dataclass(frozen=True, slots=True)
class SessionControlResult:
    agent_session: AgentSession
    current_run_id: uuid.UUID | None

# service.py 新增 AppError 子类（参照现有 DaemonRuntimeNotFound 等模式）
class DaemonSessionNotFound(AppError):
    code = "HTTP_404_DAEMON_SESSION_NOT_FOUND"
    http_status = 404

class DaemonSessionNotActive(AppError):
    code = "HTTP_409_DAEMON_SESSION_NOT_ACTIVE"
    http_status = 409

class DaemonSessionTurnConflict(AppError):
    code = "HTTP_409_DAEMON_SESSION_TURN_CONFLICT"
    http_status = 409

class DaemonSessionNoCurrentRun(AppError):
    code = "HTTP_409_DAEMON_SESSION_NO_CURRENT_RUN"
    http_status = 409

class DaemonSessionInvariantViolation(AppError):
    code = "HTTP_409_DAEMON_SESSION_INVARIANT_VIOLATION"
    http_status = 409

# ws_hub.py 新增
class DaemonWsHub:
    async def send_session_control(
        self,
        runtime_id: uuid.UUID,
        msg_type: str,           # DAEMON_MSG_SESSION_INJECT / INTERRUPT / END
        payload: dict[str, Any],
    ) -> bool:
        """内部调用 send_to_runtime；封装 task-03 控制消息信封。
        离线/超时返回 False，由 service 决定收敛策略（create/inject 抛 runtime_offline，
        end 只 warning）。"""

# service.py 新增（task-06/08 共享前置，本任务只建 channel/envelope 入口）
class DaemonService:
    async def _publish_session_event(
        self,
        session_id: uuid.UUID,
        payload: dict[str, object],
    ) -> None:
        """只封装 agent_session:{session_id} Redis publish；
        失败只 warning 不抛（参照 _publish_run_event）；
        不实现 SSE 路由、历史回放、cursor。"""
```

`_publish_session_event` 是 task-06（SSE 聚合）与 task-08（permission 事件）的共享前置：本任务只建立稳定 channel/envelope 入口，task-06 用它发布持久日志和 turn/session 状态，task-08 用它发布当前 turn 的 permission 事件。

伪代码（搬砖级控制流）：

```text
create_session(user_id, provider, prompt, model, manual_approval):
  BEGIN
    session = INSERT AgentSession(status=pending, turn_count=0, provider, config)
    flush()
    run = INSERT AgentRun(status=pending, spec_strategy=interactive,
                          agent_session_id=session.id, provider, model)
    flush()
    dispatch = placement.prepare_interactive_dispatch(
        agent_session_id=session.id, agent_run_id=run.id, user_id,
        provider, prompt, model, manual_approval)  # INSERT lease kind=interactive, run_id=NULL
    UPDATE session SET runtime_id, lease_id=dispatch.lease_id,
                       status=active, turn_count=1, last_active_at=now
  COMMIT
  if !placement.notify_interactive_dispatch(dispatch):
      BEGIN; run.status=failed; session.status=failed; lease.status=completed; COMMIT
      raise DaemonRuntimeOffline
  return SessionDispatchResult(session, run, dispatch.lease_id)

inject_session(session_id, user_id, prompt):
  BEGIN
    session = SELECT owned session FOR UPDATE
    assert session.status == active          else DaemonSessionNotActive
    assert _get_current_run(session.id) is None  else DaemonSessionTurnConflict
    run = INSERT AgentRun(status=pending, agent_session_id=session.id,
                          provider=session.provider, model=session.config.model)
    UPDATE session turn_count += 1, last_active_at = now
  COMMIT
  if !hub.send_session_control(runtime_id, SESSION_INJECT, {session_id, lease_id, run_id, prompt}):
      BEGIN; run.status=failed, output_redacted=...; COMMIT
      raise DaemonRuntimeOffline
  return SessionDispatchResult(session, run, session.lease_id)

interrupt_session(session_id, user_id):
  BEGIN; session = lock owned; run = unique current_run; COMMIT
  if run is None: raise DaemonSessionNoCurrentRun
  if !hub.send_session_control(runtime_id, SESSION_INTERRUPT, {session_id, lease_id}):
      raise DaemonRuntimeOffline
  return SessionControlResult(session, current_run_id=run.id)  # session/lease 不变

end_session(session_id, user_id, reason="manual"):
  BEGIN; session = lock owned
  if session.status == ended: COMMIT; return  # 幂等
  lease = get interactive lease by session.lease_id
  validate lease.kind==interactive AND lease 属于该 session  else DaemonSessionInvariantViolation (rollback)
  run = current_run
  best-effort hub.send_session_control(runtime_id, SESSION_END, {session_id, lease_id})  # 失败只 warning
  if run and run.status not terminal: run.status=killed, finished_at=now
  session.status=ended, ended_at=now, last_active_at=now
  lease.status=completed, updated_at=now
  COMMIT
  _publish_session_event(session_id, {event:session_ended, reason})
  return SessionControlResult(session, current_run_id=run.id if run else None)
```

## 边界处理（至少 5 条）

| # | 场景 | 必须行为 |
|---|---|---|
| 1 | prompt 为空、全空白或超过 8000 | schema/service 拒绝 422/业务错误，不创建 session/run/lease |
| 2 | session 不存在或属于其他用户 | 统一 404，不泄露资源存在性（`_get_owned_session_for_update` 模式） |
| 3 | session 已 ended/failed 时 inject 或 interrupt | 409 `DAEMON_SESSION_NOT_ACTIVE`，不建 run、不发 WS |
| 4 | 两个 inject 并发到同一 active session | session 行锁串行；一个 201、一个 409；DB 只新增一条 pending run，WS 只发一次 |
| 5 | active session 已有 pending/running/pending_approval run | inject 返回 409 `DAEMON_SESSION_TURN_CONFLICT`，禁止重入与重复 spawn |
| 6 | currentRun 查询得到多条 active run | 抛 `DaemonSessionInvariantViolation`（409）；interrupt/end 不任意选择 run |
| 7 | interrupt 时无 currentRun | 返回 409 `DAEMON_SESSION_NO_CURRENT_RUN`；session 仍 active，lease 不变 |
| 8 | interrupt 的 daemon 离线（WS 发送失败） | 返回明确 `DaemonRuntimeOffline`；不得把 session/lease 终结，也不得调用 batch cancel_lease/handle_lease_expiry |
| 9 | end 重复调用 | 幂等 200；不重复发 WS，ended_at 保持首次值 |
| 10 | end 时 daemon 离线 | 本地 session/lease/currentRun 仍一次性收口成功，记录结构化 warning，不返回悬挂 active 状态 |
| 11 | session.lease_id 缺失或指向 batch lease（kind != interactive） | 回滚并报 `DaemonSessionInvariantViolation`，禁止误完成其他 lease |
| 12 | create 首次唤醒失败 | 首 run=failed、session=failed、interactive lease=completed，不遗留 pending/active 资源 |
| 13 | inject WS 发送失败 | 新 run=failed 并保留审计（output_redacted），session 保持 active，可再次 inject；turn_count 不回退 |
| 14 | batch 调用未配置新功能（brownfield） | 现有 `dispatch_to_daemon()`、lease.agent_run_id、TTL、claim/expire/cancel 行为完全不变；FR-09 守门测试全绿 |
| 15 | interactive lease 被 expire_leases 扫描 | 因 `lease_expires_at=NULL` + `kind=interactive` 自然跳过（证明 D-005@v1）；无需改 expire_leases |
| 16 | 输入 config/payload dict | 复制后再扩展，不修改调用方传入对象 |
| 17 | DB commit/flush 抛异常 | rollback 后向上抛，不发送 WS，不静默吞错 |
| 18 | Redis publish（`_publish_session_event`）失败 | 只 warning 不抛（参照 `_publish_run_event`），不阻断 end/interrupt 主流程 |

## 非目标（本任务不做的事）

- 不实现 daemon TypeScript 的 SessionStore、ClaudeSdkDriver、spawn/interrupt/resume；task-04 负责（D-002@v3）。
- 不修改 task-03 的 WS 常量/payload，不新增同义消息（FR-02/04/05 走 task-03 定义）。
- 不实现 session Redis channel 历史回放或 SSE 路由（`GET .../stream`）；task-06 负责。本任务只建 `_publish_session_event` 入口。
- 不实现 30 分钟 idle scanner；task-06 复用本任务 `end_session(reason="idle")`（FR-06/D-004）。
- 不实现 permission request/response；task-08 负责（FR-07/D-007）。
- 不修改 quick-chat 旧端点或前端；本任务以 plan 明示的 session REST/service/placement 为准，前端切换由 task-11 负责。
- 不恢复 daemon 崩溃前的旧进程，不持久化 daemon SessionStore；task-10 负责（FR-08/D-003）。
- 不给 interactive lease 写首 run FK；D-005@v1 明确要求 `agent_run_id=NULL`。
- 不改动 `expire_leases()`/`handle_lease_expiry()`/`cancel_lease()`；interactive lease 靠 NULL 自然跳过。
- 不实现 `codex` provider 的实际调度（Literal 允许但 Wave 内只验 claude，codex 留待后续）。

## 参考

- `backend/app/modules/agent/placement.py::dispatch_to_daemon`（第 161-298 行）：复用 runtime 解析（`_resolve_dispatch_runtime`）、metadata 构造和 wakeup 模式，但**不得**复用其 batch FK 语义——interactive lease 必须 `agent_run_id=NULL`。
- `backend/app/modules/agent/placement.py::_send_ws_wakeup`（第 613 行起）：wakeup 发送模式参考。
- `backend/app/modules/daemon/ws_hub.py::send_to_runtime`（第 104 行）/`send_wakeup`（第 203 行）：控制消息发送与离线返回模式；`send_session_control` 内部调用它。
- `backend/app/modules/daemon/service.py::expire_leases`（第 887 行）：NULL `lease_expires_at` 的跳过事实（证明 D-005@v1）。
- `backend/app/modules/daemon/service.py::handle_lease_expiry`（第 992 行）：以 `agent_run_id` 为入参，**仅作为 batch 对照**；interactive interrupt/end 禁止调用。
- `backend/app/modules/daemon/service.py::_get_owned_runtime`（第 326 行）/`_publish_run_event`（第 1155 行）：所有权装载 + Redis publish 容错模式参考。
- `backend/app/modules/daemon/router.py::claim_lease`/`complete_lease`：router 只做 DTO 映射、不写 SQL 的风格参考。
- `backend/app/modules/daemon/lease_service.py::cancel_lease`：仅作为 batch 对照；interactive 路径禁止调用。
- `backend/app/modules/daemon/tests/`（test_ws_hub.py、test_lease_service.py 等）：AsyncMock、SQLite fixture 和错误断言风格。

## TDD 步骤

1. **Red：router/schema**
   - 写 4 端点 DTO、权限、所有权、404/409 错误码测试；确认因路由/类型不存在失败。
2. **Red：placement 三元关系**
   - 写 interactive lease 测试，断言 `agent_run_id is None`、`kind=="interactive"`、`lease_expires_at is None`、metadata 含首 `run_id`/`session_id`/`prompt`；写 batch 守门测试（`dispatch_to_daemon()` 行为不变）。
3. **Green：placement 最小实现**
   - 增加 `InteractiveDispatch`、`prepare_interactive_dispatch()`/`notify_interactive_dispatch()` 两段式 API；定向测试通过。
4. **Red：service create/inject**
   - 写首 run dispatch、后续新 run、active run 冲突（409）、发送失败收敛（run=failed/session 保持 active）测试；PostgreSQL 写两协程并发 inject 测试。
5. **Green：service create/inject**
   - 实现事务、session 行锁（`with_for_update`）、唯一 currentRun 查询与 commit 后发送。
6. **Red：interrupt/end**
   - 写"interrupt 不动 session/lease""end 同时收口三实体""end 离线仍收口""end 幂等""错误 lease 回滚""currentRun 多条 invariant"测试。
7. **Green：interrupt/end + ws_hub + `_publish_session_event`**
   - 最小实现接口；以单测建立 `_publish_session_event` 的稳定 channel/envelope 入口（断言只向 `agent_session:{session_id}` 发布一次原 payload，Redis 异常可观察）；不提前实现 SSE/idle/permission 业务。
8. **Refactor**
   - 提取 `_get_owned_session_for_update`、`_get_current_run`、终态写入 helper；保持 service 为唯一业务入口。
9. **定向验证**
   - 先读取 `.sillyspec/local.yaml`，使用其中 backend 命令；未配置时运行：
   - `uv run pytest backend/app/modules/daemon/tests/test_session_service.py backend/app/modules/daemon/tests/test_session_router.py backend/app/modules/daemon/tests/test_ws_hub_session_control.py backend/app/modules/agent/tests/test_interactive_session_placement.py`
   - `uv run ruff check backend/app/modules/daemon backend/app/modules/agent/placement.py`
10. **回归**
    - 运行现有 daemon/agent 测试，重点覆盖 batch dispatch、claim、expire、cancel（FR-09 守门）；在 PostgreSQL 执行并发 inject 集成测试（不能用 SQLite 结果代替并发证明）。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | POST `/api/daemon/sessions` create，检查响应与三张表 | 201；返回 session/run/lease；首 run 绑定 session（`agent_session_id`）；lease.kind=interactive、agent_run_id=NULL、lease_expires_at=NULL |
| AC-02 | 检查首 turn claim/wakeup payload | payload（lease metadata + control message）含 session_id、首 run_id、prompt；daemon 可据此启动独立首 turn |
| AC-03 | 首 turn 完成后（或无需等 result）POST inject | 201；新增不同 run_id；agent_session_id 相同；turn_count+1；只发一次 SESSION_INJECT |
| AC-04 | PostgreSQL 中并发两次 inject 到同一 active session | 恰好一个 201、一个 409；只新增一条 active run；只 dispatch 一次 |
| AC-05 | 有 currentRun（pending/running/pending_approval）时再次 inject | 409 `DAEMON_SESSION_TURN_CONFLICT`；DB 与 WS 无副作用 |
| AC-06 | POST interrupt 并检查 DB/WS | 200 且返回 current_run_id；只发 SESSION_INTERRUPT；session 仍 active；lease 未 completed/cancelled；currentRun 终态由 daemon result 驱动（backend 不抢先伪造） |
| AC-07 | 无 currentRun 或多 currentRun 时 interrupt | 分别返回 `DAEMON_SESSION_NO_CURRENT_RUN` / `DAEMON_SESSION_INVARIANT_VIOLATION`（409）；不任意终止、不改 session/lease |
| AC-08 | POST end（有 currentRun） | currentRun=killed、session=ended、lease=completed；只发 SESSION_END；三者在同一收口路径（同一事务）完成 |
| AC-09 | daemon 离线时 POST end | 仍返回 ended；DB 无 active session/interactive lease 悬挂；日志包含结构化 warning；不抛 runtime_offline |
| AC-10 | 重复 POST end | 幂等 200；不重复 WS；ended_at 不变化 |
| AC-11 | 越权访问 inject/interrupt/end（他人 session） | 返回 404；无 DB/WS 副作用 |
| AC-12 | create 首次唤醒失败 | 返回明确 `DaemonRuntimeOffline`；run=failed、session=failed、lease=completed，无 active 残留 |
| AC-13 | inject 发送失败 | 新 run=failed 且 output_redacted 可审计；session 保持 active，之后可再次 inject |
| AC-14 | 运行 batch placement/lease 回归（FR-09） | 现有调用不传新参数仍使用 agent_run_id、batch TTL、claim/expire/cancel；测试全绿 |
| AC-15 | 检查 `expire_leases()` 对 interactive lease 的行为 | 因 `lease_expires_at=NULL` + `kind=interactive` 自然跳过，不被标 expired、不进 handle_lease_expiry（证明 D-005@v1） |
| AC-16 | 检查 diff 路径 | 只改 `allowed_paths`，未修改 protocol/model/migration/SSE 路由/frontend/daemon TS |
| AC-17 | 定向 pytest、ruff 与 daemon/agent 回归 | 全部通过；PostgreSQL 并发测试有命令输出，不能用 SQLite 结果代替并发证明 |
| AC-18 | 调用 `_publish_session_event(session_id, payload)` | 只向 `agent_session:{session_id}` 发布一次原 payload；Redis 异常由调用方可观察（warning）；不创建 SSE 连接 |
| AC-19 | session.lease_id 指向 batch lease 或缺失时 end | 回滚并抛 `DAEMON_SESSION_INVARIANT_VIOLATION`，不误完成 batch lease |

## 完成定义

- D-005@v1 的三元关系（lease.agent_run_id=NULL / session↔lease 1:1 / session↔runs 1:N）与每 turn 独立 AgentRun 在代码和测试中均有直接证据（AC-01/AC-02/AC-03/AC-15）。
- create/inject/interrupt/end 四条路径的异常均有明确 AppError（搬砖级接口定义），禁止裸 `except Exception` 后伪造成功。
- 并发 inject 防重在真实 PostgreSQL 上验证（AC-04）；interrupt 与 end 的语义由测试明确区分（AC-06 vs AC-08）。
- end_session 是 session/lease/currentRun 终态的唯一收口（AC-08/AC-09/AC-10/AC-19），task-06 的 idle 回收只复用此入口。
- batch lease 回归通过（AC-14），且没有越过本 task 的 allowed_paths（AC-16）。
