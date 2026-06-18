---
author: qinyi
created_at: 2026-06-18 15:31:03
change: 2026-06-18-daemon-interactive-session
id: task-04
title: "backend session REST/service/placement：逐 turn 创建 AgentRun、并发防重与统一结束"
wave: W3
priority: P0
estimated_hours: 16
depends_on: [task-01, task-02]
blocks: [task-05, task-06, task-10]
requirement_ids: [FR-01, FR-02, FR-04, FR-05]
decision_ids: [D-002@v2, D-005@v1]
allowed_paths:
  - backend/app/modules/daemon/schema.py
  - backend/app/modules/daemon/router.py
  - backend/app/modules/daemon/service.py
  - backend/app/modules/daemon/ws_hub.py
  - backend/app/modules/agent/placement.py
  - backend/app/modules/daemon/tests/test_session_service.py
  - backend/app/modules/daemon/tests/test_session_router.py
  - backend/app/modules/daemon/tests/test_ws_hub_session_control.py
  - backend/app/modules/agent/tests/test_interactive_session_placement.py
---

# task-04：backend session REST/service/placement

> 以 `plan.md` 显式 task-04 为边界：create 与 inject 都先创建独立 `AgentRun` 再 dispatch；同一 session 并发 inject 只能成功一个；interrupt 只终止 currentRun；只有 `end_session` 可以统一结束 session 与 interactive lease。

## 修改文件（必填）

| 操作 | 文件 | 责任 |
|---|---|---|
| 修改 | `backend/app/modules/daemon/schema.py` | create/inject/interrupt/end 的请求响应 DTO |
| 修改 | `backend/app/modules/daemon/router.py` | 新增 4 个 `/api/daemon/sessions` REST 端点及权限、所有权透传 |
| 修改 | `backend/app/modules/daemon/service.py` | session 编排、数据库行锁、currentRun 查询、inject 防重、interrupt/end 收口 |
| 修改 | `backend/app/modules/daemon/ws_hub.py` | 复用现有连接表发送 session 控制消息 |
| 修改 | `backend/app/modules/agent/placement.py` | 创建 `agent_run_id=NULL` 的 interactive lease，并派发首 turn |
| 新增 | `backend/app/modules/daemon/tests/test_session_service.py` | service 状态机、并发、回滚、幂等测试 |
| 新增 | `backend/app/modules/daemon/tests/test_session_router.py` | REST、鉴权、所有权、错误码测试 |
| 新增 | `backend/app/modules/daemon/tests/test_ws_hub_session_control.py` | 在线/离线控制消息发送测试 |
| 新增 | `backend/app/modules/agent/tests/test_interactive_session_placement.py` | 三元关系、首 turn dispatch 与 batch 回归测试 |

不得修改 `backend/app/modules/daemon/protocol.py`：task-02 已负责消息常量与 payload 契约。不得修改 model/migration：task-01 已负责数据结构。

## 覆盖来源

- Requirements：FR-01、FR-02、FR-04、FR-05。
- Decisions：D-002@v2、D-005@v1；禁止引用已 superseded 的 D-002@v1。
- Design：§7.1-7.2、§8.4-8.5、§9；尤其是 `interactive lease.agent_run_id=NULL`、session↔lease 1:1、session↔run 1:N、每 turn 独立 spawn。
- Plan：Wave 3 task-04；task-04 建立 `end_session` 与 currentRun 规则，task-05 只补 session SSE，task-06 做生命周期联调与空闲回收。
- 真实源码基线：
  - `RunPlacementService.dispatch_to_daemon()` 当前直接 INSERT batch lease、commit 后 `send_wakeup()`，并把 lease 绑定单个 `agent_run_id`。
  - `DaemonService.expire_leases()` 只扫描 `lease_expires_at < now`；interactive lease 以 NULL 自然跳过。
  - `DaemonLeaseService.cancel_lease(agent_run_id)` 只适用于 run↔lease 绑定的 batch 路径，不能拿来结束 `agent_run_id=NULL` 的 interactive lease。
  - `DaemonWsHub.send_to_runtime()` 已提供 runtime→WebSocket 查找、超时与断连清理能力。
  - `AgentRun` 当前没有 `created_at`，因此 currentRun 不能靠时间排序猜测；必须靠“同一 session 最多一个非终态 run”的不变量查询。

## 实现要求

### 1. 业务不变量与状态集合

在 `daemon/service.py` 集中定义，不在 router 重复判断：

```python
ACTIVE_SESSION_STATUSES = frozenset({"pending", "active", "reconnecting"})
ACTIVE_TURN_STATUSES = frozenset({"pending", "running", "pending_approval"})
TERMINAL_TURN_STATUSES = frozenset({"completed", "failed", "killed", "cancelled"})
```

必须维护以下不变量：

1. 一个 `AgentSession` 对应一个 `kind="interactive"`、`agent_run_id=NULL`、`lease_expires_at=NULL` 的 lease。
2. create 创建首个 `AgentRun`；每次成功 inject 再创建一个新的 `AgentRun`，均写 `agent_session_id=session.id`。
3. 同一 session 任一时刻最多一个 `ACTIVE_TURN_STATUSES` 中的 run；该唯一 run 就是 backend 视角的 currentRun。
4. interrupt 不改变 session/lease 终态，只请求 daemon 终止 currentRun。
5. 只有 `end_session()` 同时写 `AgentSession.status="ended"`、`ended_at` 与 interactive lease `status="completed"`。

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
```

- 查不到统一抛 `DaemonSessionNotFound`（404），不泄露他人 session 是否存在。
- `inject_session`、`interrupt_session`、`end_session` 必须先锁 `agent_sessions` 行，再查询 active run；PostgreSQL 下两个并发 inject 会串行进入临界区。
- `_get_current_run(session_id)` 查询 `agent_runs.agent_session_id=session_id AND status IN ACTIVE_TURN_STATUSES`，不按随机 UUID 或不存在的 `created_at` 排序。
- 结果为 0 条返回 `None`；1 条返回该 run；超过 1 条抛 `DaemonSessionInvariantViolation`（409/500 均可，但必须有明确 code/details），禁止任意挑一条终止。
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

控制流：

1. 复制配置为新 dict，禁止修改请求对象；创建 `AgentSession(status="pending", turn_count=0, ...)` 并 `flush()` 获得 id。
2. 创建首个 `AgentRun(status="pending", spec_strategy="quick-chat", agent_session_id=session.id, provider/model...)` 并 `flush()`。
3. 调 placement 的 `prepare_interactive_dispatch()`：选择在线 runtime，创建唯一 interactive lease，物理字段严格为 `agent_run_id=None`、`kind="interactive"`、`lease_expires_at=None`；首 turn 的 `run_id/prompt/session_id/provider/model` 只写 lease metadata/claim payload，不写 lease.agent_run_id。
4. 回填 `AgentSession.runtime_id`、`lease_id`、`status="active"`、`turn_count=1`、`last_active_at=now`，一次 commit 固化 session/run/lease 三元关系。
5. commit 后调用 placement/hub 唤醒目标 daemon；daemon claim payload 必须能从 interactive lease metadata 取得首 `run_id`，为首 turn 独立 spawn。
6. 唤醒返回 False 不删除已提交实体：把首 run 收敛为 `failed`、session 收敛为 `failed`、lease 收敛为 `completed`，commit 后抛 `DaemonRuntimeOffline`，不得遗留 active session。

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
) -> InteractiveDispatch: ...  # add + flush only，不 commit、不发送

async def notify_interactive_dispatch(self, dispatch: InteractiveDispatch) -> bool: ...
```

现有 `dispatch_to_daemon()` 及所有 batch 调用保持签名和行为不变。

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

在持有 session 行锁的事务内：

1. 校验 session.status 必须为 `active`，lease/runtime 必须非空。
2. 调 `_get_current_run()`；若存在 pending/running/pending_approval run，抛 409。
3. 创建新的 pending `AgentRun`，复制 session 的 provider 与 config.model，写 `agent_session_id`。
4. `turn_count += 1`、`last_active_at=now`，commit 后再发送 `DAEMON_MSG_SESSION_INJECT`，payload 严格使用 task-02 的 `{session_id, lease_id, run_id, prompt}`。
5. 发送成功返回新 run；发送失败则把该 run 标 `failed` 并写可读错误，session 仍为 active（允许下一次 inject），再抛 `DaemonRuntimeOffline`。失败 turn 仍保留审计记录，turn_count 不回退。

### 5. interrupt：仅 currentRun

```python
async def interrupt_session(
    self,
    session_id: uuid.UUID,
    user_id: uuid.UUID,
) -> SessionControlResult: ...
```

- 锁定并校验 active session；查唯一 currentRun。
- currentRun 不存在时返回 `DaemonSessionNoCurrentRun`（409），不发送空 interrupt。
- 发送 task-02 的 `DAEMON_MSG_SESSION_INTERRUPT` / `SessionControlPayload {session_id, lease_id}`；daemon 根据自己的 `currentRunId` 只终止当前 turn。
- backend 不调用 `DaemonLeaseService.cancel_lease()`，不把 interactive lease 置 cancelled/completed，不改 `AgentSession.status`。
- daemon 上报 turn 终态前，backend 不抢先伪造 completed；响应返回 `current_run_id` 便于调用方确认被打断目标。
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

1. 锁 session 行；若已 `ended`，幂等返回，不重复 WS、不重复写时间。
2. 查询 currentRun；若存在，先向 daemon 发送 `DAEMON_MSG_SESSION_END`（payload 仍为 `{session_id, lease_id}`），该消息语义是终止 currentRun 并删除 daemon sessionStore 元数据。
3. 无论 daemon 当前在线与否，backend 都在同一数据库事务内将 currentRun（如仍非终态）置 `killed`/`finished_at=now`，将 session 置 `ended`/`ended_at=now`/`last_active_at=now`，将对应 `kind="interactive"` lease 置 `completed`/`updated_at=now`。
4. lease 不存在、不是 interactive、或不属于该 session 时抛 `DaemonSessionInvariantViolation` 并回滚，禁止误完成 batch lease。
5. WS 失败只记录结构化 warning；end 的本地收口仍成功并返回 ended。这样 daemon 离线也不会永久占用 session/lease。

所有手工结束与后续 task-06 的空闲结束都必须调用此方法；禁止另写第二套 session/lease 终态更新。

### 7. REST 与 schema

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

- 四个端点均使用 `require_permission_any(Permission.TASK_RUN_AGENT)`。
- router 只做 DTO 映射，把 `user.id` 传入 service；不得在 router 直接写 SQL 或吞 `AppError`。
- `stream_url` 固定返回 `/api/daemon/sessions/{session_id}/stream`，实际 SSE 由 task-05 落地。

## 接口定义（代码类任务必填）

```python
@dataclass(frozen=True, slots=True)
class SessionDispatchResult:
    agent_session: AgentSession
    agent_run: AgentRun
    lease_id: uuid.UUID

@dataclass(frozen=True, slots=True)
class SessionControlResult:
    agent_session: AgentSession
    current_run_id: uuid.UUID | None

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

class DaemonWsHub:
    async def send_session_control(
        self,
        runtime_id: uuid.UUID,
        msg_type: str,
        payload: dict[str, Any],
    ) -> bool: ...  # 内部调用 send_to_runtime
```

伪代码：

```text
inject(session_id, user_id, prompt):
  BEGIN
    session = SELECT owned session FOR UPDATE
    assert session.status == active
    assert current_run(session) is None
    run = INSERT AgentRun(agent_session_id=session.id, status=pending)
    UPDATE session turn_count += 1, last_active_at = now
  COMMIT
  if !send SESSION_INJECT(run.id): mark run failed; raise runtime_offline
  return run

interrupt(session_id, user_id):
  BEGIN; lock owned session; run = unique current_run; COMMIT
  assert run exists
  send SESSION_INTERRUPT(session_id, lease_id)
  return run.id  # session/lease 不变

end(session_id, user_id):
  BEGIN; lock owned session
  if ended: COMMIT; return
  validate interactive lease; run = current_run
  best-effort send SESSION_END
  mark run killed if active; mark session ended; mark lease completed
  COMMIT; return ended
```

## 边界处理（至少 5 条）

| # | 场景 | 必须行为 |
|---|---|---|
| 1 | prompt 为空、全空白或超过 8000 | schema/service 拒绝 422/业务错误，不创建 session/run/lease |
| 2 | session 不存在或属于其他用户 | 统一 404，不泄露资源存在性 |
| 3 | session 已 ended/failed 时 inject 或 interrupt | 409 `DAEMON_SESSION_NOT_ACTIVE`，不建 run、不发 WS |
| 4 | 两个 inject 并发到同一 active session | session 行锁串行；一个 201、一个 409；DB 只新增一条 pending run，WS 只发一次 |
| 5 | active session 已有 pending/running/pending_approval run | inject 返回 409，禁止重入与重复 spawn |
| 6 | currentRun 查询得到多条 active run | 抛 invariant violation；interrupt/end 不任意选择 run |
| 7 | interrupt 时无 currentRun | 返回 409；session 仍 active，lease 不变 |
| 8 | interrupt 的 daemon 离线 | 返回明确错误；不得把 session/lease 终结，也不得调用 batch cancel_lease |
| 9 | end 重复调用 | 幂等 200；不重复发 WS，ended_at 保持首次值 |
| 10 | end 时 daemon 离线 | 本地 session/lease/currentRun 仍一次性收口成功，记录 warning，不返回悬挂 active 状态 |
| 11 | session.lease_id 缺失或指向 batch lease | 回滚并报 invariant violation，禁止误完成其他 lease |
| 12 | create 首次唤醒失败 | 首 run=failed、session=failed、interactive lease=completed，不遗留 pending/active 资源 |
| 13 | inject WS 发送失败 | 新 run=failed 并保留审计，session 保持 active，可再次 inject |
| 14 | batch 调用未配置新功能 | 现有 `dispatch_to_daemon()`、lease.agent_run_id、TTL、claim/expire/cancel 行为完全不变 |
| 15 | 输入 config/payload dict | 复制后再扩展，不修改调用方传入对象 |
| 16 | DB commit/flush 抛异常 | rollback 后向上抛，不发送 WS，不静默吞错 |

## 非目标（本任务不做的事）

- 不实现 daemon TypeScript 的 SessionStore、spawn/resume 或进程终止；task-03 负责。
- 不修改 task-02 的 WS 常量/payload，不新增同义消息。
- 不实现 session Redis channel、历史回放或 SSE；task-05 负责。
- 不实现 30 分钟 idle scanner；task-06 只复用本任务 `end_session(reason="idle")`。
- 不实现 permission request/response；task-07/08 负责。
- 不修改 quick-chat 旧端点或前端；本任务以 plan 明示的 session REST/service/placement 为准，前端切换由 task-10 负责。
- 不恢复 daemon 崩溃前的旧进程，不持久化 daemon SessionStore；task-09 负责。
- 不给 interactive lease 写首 run FK；D-005@v1 明确要求 `agent_run_id=NULL`。

## 参考

- `backend/app/modules/agent/placement.py::dispatch_to_daemon`：复用 runtime 解析、metadata 构造和 wakeup 模式，但不得复用其 batch FK 语义。
- `backend/app/modules/daemon/ws_hub.py::send_to_runtime` / `send_wakeup`：控制消息发送与离线返回模式。
- `backend/app/modules/daemon/service.py::expire_leases`：NULL `lease_expires_at` 的跳过事实。
- `backend/app/modules/daemon/lease_service.py::cancel_lease`：仅作为 batch 对照；interactive interrupt/end 禁止调用。
- `backend/app/modules/daemon/tests/test_ws_hub.py`、`test_lease_service.py`：AsyncMock、SQLite fixture 和错误断言风格。

## TDD 步骤

1. **Red：schema/router**
   - 写 4 端点 DTO、权限、所有权测试；确认因类型/路由不存在失败。
2. **Red：placement 三元关系**
   - 写 interactive lease 测试，断言 `agent_run_id is None`、kind、expires、metadata 首 run id；写 batch 守门测试。
3. **Green：placement 最小实现**
   - 增加 `InteractiveDispatch`、prepare/notify 两段式 API；定向测试通过。
4. **Red：service create/inject**
   - 写首 run dispatch、后续新 run、active run 冲突、发送失败收敛测试；PostgreSQL 写两协程并发 inject 测试。
5. **Green：service create/inject**
   - 实现事务、session 行锁、唯一 currentRun 查询与 commit 后发送。
6. **Red：interrupt/end**
   - 写“interrupt 不动 session/lease”“end 同时收口”“end 离线仍收口”“end 幂等”“错误 lease 回滚”测试。
7. **Green：interrupt/end + router/ws_hub**
   - 最小实现接口，不提前实现 SSE/idle/permission。
8. **Refactor**
   - 提取所有权锁、currentRun 查询、终态写入 helper；保持 service 为唯一业务入口。
9. **定向验证**
   - 先读取 `.sillyspec/local.yaml`，使用其中 backend 命令；未配置时运行：
   - `uv run pytest backend/app/modules/daemon/tests/test_session_service.py backend/app/modules/daemon/tests/test_session_router.py backend/app/modules/daemon/tests/test_ws_hub_session_control.py backend/app/modules/agent/tests/test_interactive_session_placement.py`
   - `uv run ruff check backend/app/modules/daemon backend/app/modules/agent/placement.py`
10. **回归**
    - 运行现有 daemon/agent 测试，重点覆盖 batch dispatch、claim、expire、cancel；在 PostgreSQL 执行并发 inject 集成测试。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | POST create，检查响应与三张表 | 201；返回 session/run/lease；首 run 绑定 session；lease.kind=interactive、agent_run_id=NULL、lease_expires_at=NULL |
| AC-02 | 检查首 turn claim/wakeup payload | payload 含 session_id、首 run_id、prompt；daemon 可据此启动独立首 turn |
| AC-03 | 首 turn 完成后 POST inject | 201；新增不同 run_id；agent_session_id 相同；turn_count+1；只发一次 SESSION_INJECT |
| AC-04 | PostgreSQL 中并发两次 inject | 恰好一个 201、一个 409；只新增一条 active run；只 dispatch 一次 |
| AC-05 | 有 currentRun 时再次 inject | 409 `DAEMON_SESSION_TURN_CONFLICT`；DB 与 WS 无副作用 |
| AC-06 | POST interrupt 并检查 DB/WS | 200 且返回 current_run_id；只发 SESSION_INTERRUPT；session 仍 active；lease 未 completed/cancelled |
| AC-07 | 无 currentRun 或多 currentRun 时 interrupt | 分别返回明确 409；不任意终止、不改 session/lease |
| AC-08 | POST end（有 currentRun） | currentRun=killed、session=ended、lease=completed；只发 SESSION_END；三者在同一收口路径完成 |
| AC-09 | daemon 离线时 POST end | 仍返回 ended；DB 无 active session/interactive lease 悬挂；日志包含结构化 warning |
| AC-10 | 重复 POST end | 幂等 200；不重复 WS；ended_at 不变化 |
| AC-11 | 越权访问 inject/interrupt/end | 返回 404；无 DB/WS 副作用 |
| AC-12 | create 首次唤醒失败 | 返回明确运行时错误；run=failed、session=failed、lease=completed |
| AC-13 | inject 发送失败 | 新 run=failed 且可审计；session 保持 active，之后可再次 inject |
| AC-14 | 运行 batch placement/lease 回归 | 现有调用不传新参数仍使用 agent_run_id、batch TTL、claim/expire/cancel；测试全绿 |
| AC-15 | 检查 diff 路径 | 只改 `allowed_paths`，未修改 protocol/model/migration/SSE/frontend/daemon TS |
| AC-16 | 定向 pytest、ruff 与 daemon/agent 回归 | 全部通过；PostgreSQL 并发测试有命令输出，不能用 SQLite 结果代替并发证明 |

## 完成定义

- D-002@v2、D-005@v1 的三元关系与每 turn 独立 AgentRun 在代码和测试中均有直接证据。
- create/inject/interrupt/end 四条路径的异常均有明确 AppError，禁止裸 `except Exception` 后伪造成功。
- 并发 inject 防重在真实 PostgreSQL 上验证；interrupt 与 end 的语义由测试明确区分。
- batch lease 回归通过，且没有越过本 task 的 allowed_paths。
