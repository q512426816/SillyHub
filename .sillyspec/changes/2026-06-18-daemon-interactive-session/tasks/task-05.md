---
id: task-05
title: session 级 SSE 聚合（Redis channel agent_session:{id} + stream_session_logs + submit_messages 双 publish）
wave: W1
priority: P0
depends_on: [task-04]
blocks: [task-06]
covers: [FR-03, D-005, R-08]
created_at: 2026-06-18 14:11:24
author: qinyi
change: 2026-06-18-daemon-interactive-session
decision_ids: [D-005@v1]
allowed_paths:
  - backend/app/modules/agent/service.py
  - backend/app/modules/daemon/service.py
  - backend/app/modules/daemon/router.py
  - backend/app/modules/daemon/schema.py
  - backend/app/core/redis.py
---

# Task-05｜session 级 SSE 聚合：Redis channel `agent_session:{id}` + stream_session_logs + 双 publish

## 1. 目标

落地 design §7.2「session 级 SSE 聚合」与 R-08 应对策略，让**一个 SSE 连接贯穿整个交互式会话的多 turn**，无需在 turn 切换时前端重订阅：

1. **新增 session 级 Redis channel** `agent_session:{session_id}`，与现有 run 级 channel `agent_run:{run_id}` 并存（不替换）。
2. **`submit_messages` 双 publish**：在现有 publish 到 `agent_run:{run_id}`（保留 run 级 SSE 链路零变化）的同时，publish 一条**带 `run_id` 标记**的事件到 `agent_session:{session_id}`。
3. **新增 `AgentService.stream_session_logs(session_id)`**：subscribe `agent_session:{session_id}`，单连接接收所有 turn 的事件流；事件 payload 含 `run_id` 供前端区分 turn 边界；会话 `ended` 时发 `event: done`。
4. **新增 GET SSE 端点** `GET /api/daemon/sessions/{id}/stream` 调用 `stream_session_logs`。
5. **`end_session`（task-04 落地的方法）补 session 级 publish**：会话结束（手动 end / 空闲回收 task-06）时 publish 一条 `{"event":"session_ended", ...}` 到 `agent_session:{session_id}`，触发 stream_session_logs 发 done。

覆盖：**FR-03**（多 turn 输出经 SSE 实时回显，单连接贯穿会话）、**D-005@v1**（session 级 SSE 聚合）、**R-08**（跨 turn 切换 run_id 不失序）。

## 2. 前置依赖

- **task-04（backend session 侧）必须已合并**：
  - `AgentSession` 模型已存在（task-01 落库 + task-04 使用），含 `id` / `status` / `lease_id` / `runtime_id` 字段。
  - `DaemonService.create_session` / `inject_session` / `interrupt_session` / `end_session` 已实现，且 `end_session` 内已有「统一结束入口」骨架（task-04 §5.6 步骤 7 留了 "task-05 负责 channel 建立" 的 TODO）。
  - `submit_messages` 的现状 publish 代码（service.py:845-863）保持不变，本 task 在该 publish 区块**追加** session 级 publish（不重构、不移动）。
- **task-01 数据模型**：`agent_runs.agent_session_id` FK 已迁移（submit_messages 双 publish 时需要通过 `agent_run.agent_session_id` 反查 session_id）。
- daemon 侧（task-03）与前端（task-10）**不在本 task 依赖硬门**——session 级 channel 是 backend 内部 Redis pub/sub + 一个新 SSE 端点，可独立单测（fake redis / pubsub mock），端到端联调在 task-06。

> 代码现状确认：截至本 task 编写，`submit_messages`（service.py:733-872）仅 publish 到 `agent_run:{agent_run_id}`，无 session 级概念；`AgentService.stream_run_logs`（agent/service.py:542-620）是 run 级订阅范式，本 task 照此扩展为 session 级。task-04 的 `end_session` 尚未 publish 到 session channel（其步骤 7 留空待本 task 填）。

## 3. 涉及文件

| 文件 | 改动概述 |
|---|---|
| `backend/app/modules/daemon/service.py` | `submit_messages` 在现有 publish 区块（L845-863）**追加** session 级双 publish：通过 `AgentRun.agent_session_id` 反查 session_id，对每个 `published_logs` 和 `summary_payload` 各 publish 一份带 `run_id` 标记的事件到 `agent_session:{session_id}`；`end_session`（task-04 落地）补 session 级 `session_ended` publish |
| `backend/app/modules/agent/service.py` | 新增 `stream_session_logs(session_id, *, session=None)`：subscribe `agent_session:{session_id}`，事件 payload 透传（含 run_id），`session_ended` 事件 → `event: done`；30s keepalive；DB 状态兜底（已 ended 的 session 直接发 done）；与 `stream_run_logs` 同风格（参考 agent/service.py:542-620） |
| `backend/app/modules/daemon/router.py` | 新增 `GET /sessions/{session_id}/stream` SSE 端点（沿用 `router = APIRouter(prefix="/daemon")`，自动落到 `/api/daemon/sessions/{id}/stream`），权限 `Permission.TASK_READ`，复用 `_SSE_HEADERS` 风格（agent/router.py:398-402） |
| `backend/app/modules/daemon/schema.py` | （可选）`SessionStreamEvent` Pydantic 模型用于文档化事件结构；多数情况直接透传 dict 不强制模型，本 task 可不加（前端 task-10 自行约定字段） |
| `backend/app/core/redis.py` | **不改**：复用 `get_redis()` 单例（core/redis.py:16-27），无新客户端 |

> **不改 `main.py`**：task-04 已说明 main.py:426 `app.include_router(daemon_router, prefix="/api")` 自动让 daemon_router 内的新端点落到 `/api/daemon/sessions*`；本 task 的 SSE 端点加到 daemon_router 即可。`main.py` 的 `stream_quick_chat`（main.py:235-301）继续按 run_id 订阅（向后兼容），前端 task-10 切到 session 级订阅时改调 `/api/daemon/sessions/{id}/stream`。

## 4. 覆盖来源（文档 → 代码）

- design **§7.2 REST** 末段「session 级 SSE 聚合（Grill 修正 P1）」：channel 命名 `agent_session:{session_id}`、双 publish、事件带 run_id、单连接贯穿多 turn。
- design **§10 R-08**：跨 turn 切换 run_id 时前端事件流失序/断流 → 新增 session 级 channel + 双 publish + 事件带 run_id 供前端区分 turn 边界。
- design **§8.4 三元关系**：session↔runs 1:N（每 turn 一个 run），session channel 聚合 N 个 run 的事件。
- design **§9 兼容**：现有 run 级 `stream_run_logs` 不变（本 task 双 publish 是「追加」非「替换」）；批处理 lease 走 run 级 SSE 不受影响。
- decisions.md **D-005@v1**：三元关系 + session 级 SSE 聚合（Grill 修正）。
- plan.md task-05 行：Redis channel + stream_session_logs + 双 publish。
- requirements.md **FR-03**（一个 SSE 连接贯穿整个会话，多 turn 输出实时回显 + 历史可在 AgentRunLog 回看）。
- 现状代码（必须对照）：
  - `agent/service.py:542-620`（`stream_run_logs`：subscribe `agent_run:{run_id}`、yield `data`、`event: done`、30s keepalive、DB 状态兜底 race-condition guard——session 级照此扩展）
  - `daemon/service.py:733-872`（`submit_messages`：现状 publish 扁平 `StreamLogEvent` + 聚合 `messages` summary 到 `agent_run:{agent_run_id}`——本 task 在 L845-863 区块**追加** session 级 publish）
  - `daemon/service.py:990-1018+`（`handle_lease_expiry` / `complete_lease` publish `event: done` 到 run channel——session 级 done 由 `end_session` 显式 publish，不复用）
  - `agent/router.py:398-433`（`stream_agent_run_logs` SSE 端点 + `_SSE_HEADERS` 风格——session 端点照抄 headers）
  - `main.py:235-301`（`stream_quick_chat` run 级 SSE，本 task 不改，仅作风格参考）
  - `core/redis.py:16-27`（`get_redis()` 单例 + `pubsub()` 用法）

## 5. 实现步骤

### 5.1 事件结构约定（session channel 上的 payload）

session channel `agent_session:{session_id}` 上 publish 三类事件，全部 JSON 字符串：

```jsonc
// (a) 单条 log 透传（对应 submit_messages 的 published_logs 每条）
{
  "event": "log",
  "session_id": "<uuid>",
  "run_id": "<uuid>",            // 新增字段：标记属于哪个 turn
  "channel": "stdout|tool_call|stderr",
  "content": "...",
  "timestamp": "2026-06-18T14:11:24Z",
  "log_id": "<uuid>"
}

// (b) 批次 summary（对应 submit_messages 的 summary_payload）
{
  "event": "messages",
  "session_id": "<uuid>",
  "run_id": "<uuid>",
  "lease_id": "<uuid>",
  "count": 3,
  "agent_run_status": "running"
}

// (c) 会话结束（end_session publish，触发 stream_session_logs 发 done）
{
  "event": "session_ended",
  "session_id": "<uuid>",
  "reason": "manual|idle|failed",
  "status": "ended|failed"
}
```

> **run_id 标记**是 R-08 的核心：前端 task-10 收到事件后按 `run_id` 分组，知道哪些事件属于当前 turn、哪些是上一个/下一个 turn，避免跨 turn 输出交错显示。run 级 channel 上的事件**不带** session_id（保持 run 级 SSE 链路零变化）；session 级 channel 上的事件**必带** run_id。

> **不引入 turn 序号**：design §7.2 仅要求 `run_id`，`AgentSession.turn_count`（task-04 维护）作为审计字段，前端可用 `run_id` 的先后顺序（按 AgentRun.created_at）推断 turn 序，无需在事件里冗余。若联调发现 run_id 不足以表达 turn 边界（极端乱序），再考虑加 `turn_index`——本 task 不预先加（YAGNI）。

### 5.2 `submit_messages` 双 publish（daemon/service.py L845-863 区块）

现状代码（service.py:841-863）：

```python
try:
    redis = get_redis()
    channel_name = f"agent_run:{agent_run_id}"
    for log_payload in published_logs:
        await redis.publish(channel_name, json.dumps(log_payload))
    summary_payload: dict = {
        "event": "messages",
        "lease_id": str(lease_id),
        "count": count,
    }
    if agent_run_status is not None:
        summary_payload["agent_run_status"] = agent_run_status
    await redis.publish(channel_name, json.dumps(summary_payload))
except Exception:
    log.warning(
        "daemon_messages_redis_publish_failed",
        lease_id=str(lease_id),
        agent_run_id=str(agent_run_id),
    )
```

改造（追加 session 级 publish，**保留** run 级 publish 不动）：

```python
# ---- 反查 agent_session_id（task-05：session 级双 publish） ----
# submit_messages 入参只有 agent_run_id，session_id 需通过 AgentRun.agent_session_id
# 反查（task-01 已加该 FK）。批处理 run 的 agent_session_id=NULL → 跳过 session publish。
session_id_str: str | None = None
if agent_run is not None and agent_run.agent_session_id is not None:
    session_id_str = str(agent_run.agent_session_id)

try:
    redis = get_redis()
    run_channel = f"agent_run:{agent_run_id}"
    session_channel = (
        f"agent_session:{session_id_str}" if session_id_str else None
    )

    # (1) run 级 publish（现状，零变化）
    for log_payload in published_logs:
        await redis.publish(run_channel, json.dumps(log_payload))
    summary_payload: dict = {
        "event": "messages",
        "lease_id": str(lease_id),
        "count": count,
    }
    if agent_run_status is not None:
        summary_payload["agent_run_status"] = agent_run_status
    await redis.publish(run_channel, json.dumps(summary_payload))

    # (2) session 级双 publish（task-05 新增，仅 interactive session 走）
    if session_channel is not None:
        for log_payload in published_logs:
            session_log = {
                "event": "log",
                "session_id": session_id_str,
                "run_id": str(agent_run_id),
                **log_payload,  # channel / content / timestamp / log_id
            }
            await redis.publish(session_channel, json.dumps(session_log))
        session_summary = {
            "event": "messages",
            "session_id": session_id_str,
            "run_id": str(agent_run_id),
            "lease_id": str(lease_id),
            "count": count,
        }
        if agent_run_status is not None:
            session_summary["agent_run_status"] = agent_run_status
        await redis.publish(session_channel, json.dumps(session_summary))
except Exception:
    log.warning(
        "daemon_messages_redis_publish_failed",
        lease_id=str(lease_id),
        agent_run_id=str(agent_run_id),
    )
```

要点：
- **批处理 run（agent_session_id=NULL）天然跳过 session publish**：`session_channel is None` → 不进入 (2) 分支，行为与现状完全一致（§9 兼容）。
- **双 publish 各自独立 try**：当前外层 try 包住两段，任一失败都 log warning 但不抛（与现状一致，publish 失败不影响 DB 已 commit 的日志）。若担心 session publish 失败拖累 run publish（unlikely，同 Redis 连接），可拆成两个 try——本 task 先合并一个 try，联调时观察。
- **`agent_run` 变量**：submit_messages 在 L808 已 `agent_run = await self._session.get(AgentRun, agent_run_id)`，直接复用，无需再查一次。
- **`agent_run.agent_session_id` 字段**：依赖 task-01 已加该列；若 execute 时发现 task-01 未合并，本 task 阻塞（前置依赖硬门）。

### 5.3 `end_session` 补 session 级 publish（task-04 §5.6 步骤 7 收尾）

task-04 的 `end_session`（service.py 新增方法）步骤 7 原文：「（可选）publish Redis 事件到 `agent_session:{session_id}`（task-05 负责 channel 建立；本 task 可先 publish 到现有 `agent_run:{run_id}` 通知前端各 turn 收尾，或留空等 task-05）」。

本 task 在 `end_session` 的 commit 之后（task-04 §5.6 步骤 6 之后）补：

```python
# ---- task-05：publish session_ended 到 session channel ----
# 触发 stream_session_logs 发 event: done，前端单 SSE 连接收尾。
try:
    redis = get_redis()
    await redis.publish(
        f"agent_session:{session_id}",
        json.dumps({
            "event": "session_ended",
            "session_id": str(session_id),
            "reason": reason,           # manual / idle / failed
            "status": session.status,   # ended / failed
        }),
    )
except Exception:
    log.warning(
        "daemon_session_end_redis_publish_failed",
        session_id=str(session_id),
    )
```

要点：
- **publish 失败不阻塞 DB 收尾**（task-04 §5.6 步骤 3 同款语义）：DB 已 commit，publish 仅通知在线 SSE 连接收尾；失败时已订阅的 SSE 靠 30s keepalive + DB 状态兜底（§5.4）最终也能发 done，不会永久悬挂。
- **reason 来源**：`end_session(*, reason="manual")` 入参；task-06 空闲回收调 `end_session(reason="idle")`；崩溃路径（R-03）走 `reason="failed"`。
- **不 publish 到 run channel**：session 结束时各 turn 的 run 终态由 daemon 侧 task-runner 通过 `syncStatus` + `complete_lease` 走 run 级 channel（现状不变）；session channel 只发一条聚合 `session_ended`。

### 5.4 `AgentService.stream_session_logs`（agent/service.py 新增，紧邻 stream_run_logs L542）

照 `stream_run_logs`（L542-620）范式扩展，关键差异：订阅 channel 是 `agent_session:{session_id}`、done 触发条件是 `session_ended` 事件、DB 兜底查 `AgentSession.status`。

```python
async def stream_session_logs(
    self,
    session_id: uuid.UUID,
    *,
    db_session: AsyncSession | None = None,
) -> AsyncGenerator[str, None]:
    """Yield SSE formatted events from Redis Pub/Sub for an interactive
    agent session (aggregates multiple turns / AgentRuns).

    Subscribes to ``agent_session:{session_id}``. Emits ``data`` events
    for each message (payload carries ``run_id`` so the frontend can
    distinguish turn boundaries), a ``done`` event when the session is
    ended (``session_ended`` Redis event or DB status not active/pending),
    and ``: keepalive`` comments every ~30s of silence.

    Single SSE connection spans the whole session's multiple turns —
    frontend does NOT need to re-subscribe on turn switch (R-08).
    """
    redis = get_redis()
    pubsub = redis.pubsub()
    channel = f"agent_session:{session_id}"
    try:
        yield ": connected\n\n"
        await pubsub.subscribe(channel)

        # Race-condition guard: session already ended before subscribe.
        if db_session is not None:
            from app.modules.daemon.model import AgentSession  # 局部 import 避免循环
            sess = await db_session.get(AgentSession, session_id)
            if sess is not None and sess.status not in ("pending", "active", "reconnecting"):
                done_data = json.dumps({"status": sess.status, "reason": "already_ended"})
                yield f"event: done\ndata: {done_data}\n\n"
                return

        while True:
            try:
                message = await asyncio.wait_for(
                    pubsub.get_message(timeout=25),
                    timeout=30,
                )
            except TimeoutError:
                yield ": keepalive\n\n"
                continue
            if message and message["type"] == "message":
                data = message["data"]
                try:
                    payload = json.loads(data)
                except (json.JSONDecodeError, TypeError):
                    payload = {}
                if payload.get("event") == "session_ended":
                    done_data = json.dumps({
                        "status": payload.get("status", "ended"),
                        "reason": payload.get("reason", "manual"),
                    })
                    yield f"event: done\ndata: {done_data}\n\n"
                    break
                yield f"data: {data}\n\n"
            else:
                yield ": keepalive\n\n"
    except Exception:
        yield 'event: error\ndata: {"error": "redis connection failed"}\n\n'
    finally:
        await pubsub.unsubscribe(channel)
        await pubsub.close()
```

要点：
- **done 触发**：`session_ended` 事件（来自 §5.3 end_session publish）。**不**在 stream 内监听单 turn 的 run done——session 级 SSE 的生命周期 = 整个会话，单 turn 完成不是会话结束。
- **DB 兜底**：订阅后立即查 `AgentSession.status`，若已 ended（subscribe 前会话刚结束，`session_ended` 事件已发过被错过）直接发 done。复用 stream_run_logs 的 race-condition guard 思路（agent/service.py:572-577）。
- **`AgentSession` 局部 import**：避免 `agent/service.py` 顶层 import `daemon.model` 形成循环依赖（daemon.service 已 import agent.model）。仅 DB 兜底分支需要，放函数内。
- **事件透传**：session channel 上的 `log` / `messages` 事件原样 `yield f"data: {data}\n\n"`，前端 task-10 按 `payload.event` 分发（log → 追加到对应 run_id 的输出区；messages → 更新计数）。
- **keepalive / 错误格式**：与 stream_run_logs 完全一致，前端复用同一套 SSE 解析逻辑。
- **db_session 入参**：router 传入（FastAPI 的 SessionDep），用于 DB 兜底；可选（None 时跳过兜底，仅靠 Redis 事件）。

### 5.5 `GET /api/daemon/sessions/{id}/stream` 端点（daemon/router.py 新增）

加到 daemon_router（`prefix="/daemon"`，自动落 `/api/daemon/sessions/{id}/stream`），紧邻 task-04 的 4 个 session REST 端点之前或之后（REST 与 SSE 同区，websocket `/ws` 仍单列）。权限 `Permission.TASK_READ`（只读订阅，与 `stream_agent_run_logs` 的 TASK_READ 对齐）。

```python
_SSE_HEADERS = {
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}


@router.get("/sessions/{session_id}/stream")
async def stream_session_logs(
    session_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.TASK_READ))],
) -> StreamingResponse:
    """SSE endpoint — stream real-time logs for an interactive agent session.

    Single connection spans the whole session (multiple turns / AgentRuns).
    Events carry run_id for turn boundary detection (R-08).
    """
    from fastapi.responses import StreamingResponse

    from app.modules.agent.service import AgentService
    from app.modules.daemon.service import DaemonService, DaemonSessionNotFound

    # 校验 session 存在（404 语义对齐 task-04）
    dsvc = DaemonService(session)
    agent_session = await dsvc.get_session(session_id)  # task-04 应已有 get_session
    if agent_session is None:
        raise DaemonSessionNotFound(
            f"Agent session '{session_id}' not found.",
            details={"session_id": str(session_id)},
        )

    # 已终态：直接发 done（与 stream_agent_run_logs / stream_quick_chat 同款）
    if agent_session.status not in ("pending", "active", "reconnecting"):
        done_data = json.dumps({"status": agent_session.status, "reason": "already_ended"})
        return StreamingResponse(
            iter([f"event: done\ndata: {done_data}\n\n"]),
            media_type="text/event-stream",
            headers=_SSE_HEADERS,
        )

    svc = AgentService(session)
    return StreamingResponse(
        svc.stream_session_logs(session_id, db_session=session),
        media_type="text/event-stream",
        headers=_SSE_HEADERS,
    )
```

要点：
- **`_SSE_HEADERS` 复制自 agent/router.py:398-402**：不跨模块 import 常量（daemon/router 不应依赖 agent/router），本 task 在 daemon/router 内重新声明同款 dict（3 个 header，字面量）。
- **`get_session`**：task-04 的 DaemonService 应已有（或加一个简单的 `await self._session.get(AgentSession, session_id)`）；若 task-04 未提供，本 task 在 DaemonService 补一个 `get_session(session_id) -> AgentSession | None`（5 行，不破坏 task-04 边界）。
- **权限 `TASK_READ`**：与 stream_agent_run_logs 一致（只读 SSE）。task-04 的 create/inject/interrupt/end 是 `TASK_RUN_AGENT`（写），本 SSE 端点是只读订阅。
- **`StreamingResponse` 局部 import**：daemon/router.py 现状未 import StreamingResponse（router.py:1-51 无），本 task 在端点函数内局部 import 或加到模块顶部 import（二选一，建议顶部加 `from fastapi.responses import StreamingResponse` 与 agent/router.py:10 对齐）。

## 6. 接口定义（最终签名汇总）

```python
# agent/service.py（AgentService 新增方法）
class AgentService:
    async def stream_session_logs(
        self,
        session_id: uuid.UUID,
        *,
        db_session: AsyncSession | None = None,
    ) -> AsyncGenerator[str, None]: ...


# daemon/service.py（DaemonService 新增辅助方法 + 改造现有方法）
class DaemonService:
    async def get_session(self, session_id: uuid.UUID) -> AgentSession | None: ...

    # submit_messages：签名不变，内部 L845-863 区块追加 session 级双 publish
    async def submit_messages(
        self, lease_id, claim_token, agent_run_id, messages,
    ) -> int: ...

    # end_session（task-04 落地）：步骤 7 补 session_ended publish
    async def end_session(
        self, session_id: uuid.UUID, *, reason: str = "manual",
    ) -> AgentSession: ...


# daemon/router.py（新增 SSE 端点）
@router.get("/sessions/{session_id}/stream")
async def stream_session_logs(
    session_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.TASK_READ))],
) -> StreamingResponse: ...
```

## 7. Redis channel 总览（本 task 后的状态）

| Channel | 订阅者 | publish 者 | 事件 | 用途 |
|---|---|---|---|---|
| `agent_run:{run_id}` | `stream_run_logs`（run 级 SSE，**不变**） | submit_messages / sync_agent_run_status / complete_lease / handle_lease_expiry | `log` 扁平 / `messages` summary / `done` / `status_changed` | 单个 AgentRun 的实时输出（批处理 + quick-chat 现状） |
| `agent_session:{session_id}` **（本 task 新增）** | `stream_session_logs`（session 级 SSE） | submit_messages（双 publish，仅 interactive run）/ end_session | `log`（带 run_id）/ `messages`（带 run_id）/ `session_ended` | 整个交互式会话跨 turn 聚合输出（R-08） |

## 8. 完成标准（AC）

- [ ] **AC-5.1 双 publish**：`submit_messages` 对 interactive run（`agent_run.agent_session_id IS NOT NULL`）同时 publish 到 `agent_run:{run_id}` 和 `agent_session:{session_id}`，session channel 上的事件**必带 run_id**。
- [ ] **AC-5.2 批处理兼容**：批处理 run（`agent_session_id IS NULL`）的 submit_messages **不** publish 到任何 session channel，run 级 SSE 行为零变化（§9 兼容）。
- [ ] **AC-5.3 单连接贯穿**：`stream_session_logs(session_id)` 一个 SSE 连接贯穿会话的全部 turn，turn 切换（inject 新 prompt → 新 run_id）时**前端无需重订阅**，事件流连续不断。
- [ ] **AC-5.4 run_id 标记**：session channel 上每个事件 payload 含 `run_id` 字段，前端可据其区分 turn 边界（R-08 应对）。
- [ ] **AC-5.5 ended 发 done**：`end_session` publish `session_ended` → `stream_session_logs` 收到后发 `event: done` 并关闭生成器；已 ended 的 session 新建 SSE 连接时 DB 兜底立即发 done。
- [ ] **AC-5.6 run 级 SSE 不变**：现有 `stream_run_logs` / `stream_agent_run_logs` / `stream_quick_chat` 行为零变化（grep 确认未改动这三处的订阅逻辑）。
- [ ] **AC-5.7 keepalive + 错误格式**：session 级 SSE 30s 无消息发 `: keepalive`，Redis 异常发 `event: error`，格式与 run 级 SSE 一致（前端复用解析器）。

## 9. 测试要点（pytest，backend）

新增测试文件 `backend/app/modules/daemon/tests/test_session_sse.py`（或扩展现有 test_session.py，按 task-04 的测试落点决定）：

- **T1 双 publish（interactive）**：mock `get_redis()` 返回 fake redis（或用 `fakeredis`），调 `submit_messages` 传入 `agent_run.agent_session_id=<非空>`，断言：
  - `agent_run:{run_id}` channel 收到 N+1 条（N 条 log + 1 条 messages summary）；
  - `agent_session:{session_id}` channel 收到同样 N+1 条，且**每条 payload 含 `run_id == agent_run_id`**。
- **T2 单 publish（批处理兼容）**：`agent_run.agent_session_id=None`，调 `submit_messages`，断言：
  - `agent_run:{run_id}` channel 收到事件（现状不变）；
  - `agent_session:*` channel **零事件**（AC-5.2）。
- **T3 stream_session_logs 多 turn 连续性**：fake redis 预灌两组事件（run_id=A 的 3 条 log + run_id=B 的 2 条 log，模拟两个 turn），subscribe `stream_session_logs`，断言：
  - 收到 5 条 `data` 事件，顺序与 publish 一致；
  - 每条 payload 的 run_id 正确（A×3 + B×2）；
  - 未发 `event: done`（会话未结束）。
- **T4 ended 发 done**：subscribe `stream_session_logs`，fake redis publish 一条 `{"event":"session_ended","status":"ended","reason":"manual"}`，断言生成器 yield `event: done` + `{"status":"ended","reason":"manual"}` 后停止。
- **T5 DB 兜底（已 ended）**：DB 中 `AgentSession.status="ended"`，新建 SSE 连接调 `stream_session_logs`，断言立即 yield `event: done`（不进 while 循环等 Redis）。
- **T6 end_session publish**：调 `service.end_session(session_id, reason="manual")`，断言 `agent_session:{session_id}` channel 收到一条 `{"event":"session_ended","reason":"manual","status":"ended"}`。
- **T7 keepalive**：fake redis `get_message` 持续返回 None（模拟 30s 静默），断言生成器 yield `: keepalive`（不卡死）。
- **T8 端点 404/已终态**：`GET /api/daemon/sessions/{不存在的id}/stream` → 404；`status=ended` 的 session → 端点直接返回 `event: done` 的 StreamingResponse（不进 stream_session_logs）。

测试用 `fakeredis.aioredis` 或自建 mock（参考 `agent/tests/test_router.py:196` 的 stream_run_logs 测试范式）。

## 10. 风险与注意

| 编号 | 风险 | 等级 | 应对 |
|---|---|---|---|
| R-08（design） | 跨 turn 切换 run_id 时前端事件流失序/断流 | P1 | 本 task 核心：session channel + 双 publish + 事件带 run_id；前端 task-10 按 run_id 分组渲染（不依赖事件到达顺序绝对一致，Redis pubsub 单订阅者保序） |
| R-08-sub1 | session publish 失败拖累 run publish（同 Redis 连接） | P2 | 当前合并一个 try；联调观察，若发现 session publish 异常导致 run publish 也跳过，拆成两个独立 try（run publish 优先级更高） |
| R-08-sub2 | `AgentRun.agent_session_id` 反查在 submit_messages 时为 NULL（task-01 未合并 / 数据异常） | P1 | `session_id_str is None` 时跳过 session publish（AC-5.2 同款分支），退化为纯 run 级 SSE，不报错；execute 时确认 task-01 已合并 |
| 循环依赖 | `agent/service.py` import `daemon.model.AgentSession` 形成循环（daemon.service 已 import agent.model） | P2 | `stream_session_logs` 内 DB 兜底分支局部 import（`from app.modules.daemon.model import AgentSession`），不放模块顶部 |
| Redis pubsub 断连 | 长连接 SSE 期间 Redis 重启 / 网络断，pubsub 失效 | P2 | 现状 stream_run_logs 未做自动重订阅（异常 → `event: error` 关闭）；本 task 保持同款行为，前端 task-10 监听到 error 事件后重连（前端职责）。Wave3 task-09 崩溃恢复时可补重订阅，本 task 不做 |
| 与 run 级 SSE 共存 | 两套 SSE 端点（run 级 + session 级）同时存在，前端用哪个？ | P2 | 批处理 lease 用 run 级（`/api/workspaces/.../agent/runs/{run_id}/stream`）；interactive session 用 session 级（`/api/daemon/sessions/{id}/stream`）。前端 task-10 按 lease.kind / session 存在性分流；本 task 不删除 run 级端点（§9 兼容） |
| 双 publish 性能 | 每个 log 多一次 Redis publish（interactive session） | P3 | Redis pubsub 单连接 publish 极快（μs 级），且 interactive session 数量受限（R-07 并发池）；联调时监控 Redis ops/s，必要时可合并 log 批次为单条数组 publish（前端解包），本 task 先逐条 |

## 11. 与其他 task 的边界

- **task-04**（依赖）：提供 `AgentSession` 模型、`end_session` 方法骨架、`get_session`（若无则本 task 补）。本 task 在 task-04 的 `end_session` 步骤 7 填空（session_ended publish）。
- **task-06**（被 blocks）：Wave1 联调会验证「一个 SSE 连接贯穿多 turn」（AC-3），依赖本 task 的 stream_session_logs；空闲回收（task-06）调 `end_session(reason="idle")` 触发本 task 的 session_ended publish → SSE 收尾。
- **task-10**（前端，Wave4）：消费 `/api/daemon/sessions/{id}/stream`，按 payload.run_id 分组渲染 turn 输出；监听 `event: done` 收尾会话面板。本 task 定义事件结构（§5.1），task-10 遵循。
- **task-03**（daemon）：不直接交互——daemon 通过 `submit_messages`（REST）上报日志，backend 内部双 publish，daemon 无感知。daemon 侧 task-runner session 模式的 result 事件经 submit_messages 自动进入 session channel。

## 12. 实现顺序建议

1. 先确认 task-01（`agent_runs.agent_session_id` 列）+ task-04（`AgentSession` 模型 / `end_session` / `get_session`）已合并到工作分支。
2. 改 `submit_messages` 双 publish（§5.2）——最小改动，先让 session channel 有数据。
3. 加 `stream_session_logs`（§5.4）——消费端。
4. 加 `end_session` 的 session_ended publish（§5.3）——收尾端。
5. 加 router SSE 端点（§5.5）——HTTP 入口。
6. 写测试（§9）——T1/T2 验证双 publish，T3/T4 验证 stream，T5/T6 验证兜底/收尾，T7/T8 验证边界。
7. 跑 `cd backend && uv run pytest`，确认全绿 + 现有 stream_run_logs 测试不回归。
