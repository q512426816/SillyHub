---
author: qinyi
created_at: 2026-06-18T22:41:08
change: 2026-06-18-daemon-interactive-session
id: task-06
title: "session 级 SSE 聚合：submit_messages 双 publish + stream_session_logs（D-002@v3）"
wave: W3
priority: P0
estimated_hours: 12
depends_on: [task-02, task-05]
blocks: [task-11]
requirement_ids: [FR-03]
decision_ids: [D-005@v1]
allowed_paths:
  - backend/app/modules/agent/service.py
  - backend/app/modules/daemon/service.py
  - backend/app/modules/daemon/router.py
---

# task-06 — session 级 SSE 聚合：submit_messages 双 publish + stream_session_logs

> 以 `plan.md` v3 显式 task-06 为准（"session 级 SSE 聚合——submit_messages 双 publish + stream_session_logs，覆盖 FR-03 / D-005@v1, R-08"）。本任务保留 v2 蓝图的 SSE 聚合职责与接口设计，并按 v3 更新引用：v2 plan 中"session SSE 聚合"归 task-05；v3 plan 把 SSE 聚合独立成 task-06（W3，depends_on=[task-02, task-05]），task-05 降为 backend session REST/service/placement（create/inject/interrupt/end_session）。依据 `design.md` §7.5（session 级 SSE 聚合）、§8.4（三元关系）、`requirements.md` FR-03、`decisions.md` D-005@v1、风险登记 R-08，以及当前 `stream_run_logs`（`backend/app/modules/agent/service.py:542`）、`submit_messages`（`backend/app/modules/daemon/service.py:733`）与 Redis Pub/Sub 的真实实现。

## 1. 目标

为一个 `AgentSession` 提供一个稳定 SSE 地址，单连接贯穿整个会话生命周期，跨多个 turn（AgentRun）不中断：

```http
GET /api/daemon/sessions/{session_id}/stream
```

该连接必须满足 FR-03 与 R-08：

1. backend 订阅 session 级 Redis channel `agent_session:{session_id}`，跨多个 turn 持续推送；前端不再随 run_id 切换而断流。
2. 每个业务事件携带 `session_id` + `run_id`，前端用 `run_id` 区分 turn 边界（D-005@v1）。
3. session 结束（status=ended/failed）时关闭连接；单 turn 完成只结束 turn，不关 session SSE。
4. `submit_messages` 对 interactive run 双 publish：`agent_run:{run_id}`（保留原行为）+ `agent_session:{session_id}`（带 run_id 标记）；batch run 不发 session channel。
5. 不删除、不改名现有 `stream_run_logs` 与 `agent_run:{run_id}`；batch / quick-chat / workspace AgentRun 路径零回归。

本任务覆盖 FR-03、D-005@v1、R-08。数据模型（agent_sessions 表、agent_runs.agent_session_id FK）由 task-02 落地；backend session REST/service（create/inject/interrupt/end_session、`_publish_session_event` helper）由 task-05 落地；前端消费由 task-11 实现。

## 2. 覆盖来源

| 来源 | 本任务依赖 / 覆盖点 |
|---|---|
| `design.md` §7.5 | session 级 Redis channel `agent_session:{session_id}`；submit_messages 双 publish（run 级保留 + session 级带 run_id 标记）；新增 `stream_session_logs(session_id)` 订阅 session channel |
| `design.md` §8.4（D-005@v1） | session↔runs 1:N（`agent_runs.agent_session_id`），每 turn（SDK result）一个 run；聚合字段只能用 `AgentRun.agent_session_id`，禁止混用 `AgentRun.session_id`（claude resume 语义） |
| `requirements.md` FR-03 | 单 SSE 连接贯穿会话直到 ended，事件含 run_id 区分 turn 边界 |
| `decisions.md` D-005@v1 | (b) 新增 session 级 Redis channel + submit_messages 双 publish + stream_session_logs |
| `design.md` R-08 | session SSE 跨 turn 聚合（D-005 session 级 channel + 双 publish） |
| `plan.md` v3 task-06 | W3，depends_on=[task-02, task-05]，blocks=[task-11]；保留 v2 内容更新引用到 D-002@v3 |
| `backend/app/modules/agent/service.py:542` | 现有 `stream_run_logs`（run 级，订阅 `agent_run:{run_id}`），作为本任务 SSE 生成器与 keepalive/error/finally 资源清理范式参考 |
| `backend/app/modules/daemon/service.py:733` | 现有 `submit_messages`（已 publish 扁平 log + summary 到 `agent_run:{run_id}`），双 publish 追加点 |

## 3. 修改文件

| 文件 | 改动 |
|---|---|
| `backend/app/modules/agent/service.py` | 新增 `stream_session_logs(agent_session_id, *, session)` 异步生成器：DB 历史回放 + Redis session channel 续流；复用现有 SSE frame/keepalive/error/finally 范式 |
| `backend/app/modules/daemon/service.py` | `submit_messages` 对 interactive run 追加 session channel publish（双 publish）；batch run（`agent_session_id IS NULL`）零变化 |
| `backend/app/modules/daemon/router.py` | 新增 `GET /sessions/{session_id}/stream` 路由，校验 session 所有权，返回 `StreamingResponse`（`text/event-stream`） |

测试文件不在本任务 `allowed_paths` 内，按项目惯例挂到 `backend/app/modules/agent/tests/` 与 `backend/app/modules/daemon/tests/`（由 execute 阶段在测试目录创建，不违反 allowed_paths 对实现文件的限制）。

## 4. 接口定义（搬砖级）

### 4.1 Redis channel

```text
agent_run:{run_id}         # 现有，保持不变（run 级实时流）
agent_session:{session_id} # 新增，session 级聚合实时流
```

约束：

- 只有 `AgentRun.agent_session_id IS NOT NULL`（interactive run）才发布 session channel。
- batch run（`agent_session_id=NULL`）只走原 `agent_run:{run_id}`，session channel 零发布。

### 4.2 session channel 事件 payload（含 run_id 标记）

session channel 的每条 message 是 JSON，统一携带 `run_id` 区分 turn 边界：

```json
{
  "event": "log",
  "session_id": "uuid",
  "run_id": "uuid",
  "log_id": "uuid",
  "channel": "stdout",
  "content": "redacted content",
  "timestamp": "2026-06-18T22:41:08.123456Z"
}
```

session/turn 终态事件（由 task-05 的 `_publish_session_event` helper 在 `end_session` / run 收敛点发布，本任务只消费不重复定义）：

```json
{ "event": "turn_completed", "session_id": "uuid", "run_id": "uuid", "status": "completed", "exit_code": 0 }
{ "event": "session_ended",   "session_id": "uuid", "run_id": null,  "status": "ended", "reason": "manual" }
```

约束：

- `log` 事件必须含 `session_id/run_id/log_id/timestamp/channel/content`；`content` 来自 `content_redacted`（已脱敏）。
- 不把 summary（`submit_messages` 现有 `event:"messages"` 聚合事件）作为 session log 发布——summary 无 `log_id`，不进入 session SSE 的稳定日志序列，session channel 只发布带 `log_id` 的扁平 log。
- `session_ended` 对应 SSE `event: done`，`run_id=null`；只有 session 终态关闭连接。

### 4.3 `stream_session_logs` 签名（agent/service.py）

```python
async def stream_session_logs(
    self,
    agent_session_id: uuid.UUID,
    *,
    session: AsyncSession | None = None,
) -> AsyncGenerator[str, None]:
    """Yield SSE formatted events aggregating all AgentRuns of an AgentSession.

    Subscribes to the ``agent_session:{session_id}`` Redis Pub/Sub channel so
    that a single client connection survives across multiple turns (run_id
    changes). Emits ``data`` events for each structured log message, a ``done``
    event when the session reaches a terminal status, and ``: keepalive``
    comments every ~30 seconds of silence.

    Unlike ``stream_run_logs`` (run-scoped), this generator aggregates every
    AgentRun whose ``agent_session_id`` matches and surfaces ``run_id`` on each
    event so the frontend can delineate turn boundaries (D-005@v1).
    """
```

固定算法（参考现有 `stream_run_logs:542` 的 SSE/keepalive/error/finally 范式）：

1. `redis = get_redis(); pubsub = redis.pubsub()`；`yield ": connected\n\n"`。
2. `await pubsub.subscribe(f"agent_session:{agent_session_id}")`。
3. **竞态守卫**：subscribe 完成后，若 `session` 提供，查询 `AgentSession.status`：
   - 若已 `ended/failed`：先发 `event: done`（status/reason），再 return；不得因 session 已终态跳过任何尚未发出的历史（本任务最小实现不强制 DB 历史回放，见 §6 边界 6，但 ended 必须立即 done）。
   - 若 `active/reconnecting`：进入 Pub/Sub 循环。
4. Pub/Sub 循环：`asyncio.wait_for(pubsub.get_message(timeout=25), timeout=30)`：
   - `TimeoutError` → `yield ": keepalive\n\n"`，continue。
   - 收到 `type=="message"`：`json.loads` 解析 payload：
     - `payload["event"] == "session_ended"` → 发 `event: done\ndata: {status, reason}\n\n`，break。
     - 其他结构化事件（`log` / `turn_completed`）→ `yield f"data: {raw_json}\n\n"`（保持原 payload 含 run_id 透传给前端）。
   - 非 message（None）→ `yield ": keepalive\n\n"`。
5. `except Exception` → `yield 'event: error\ndata: {"error": "redis connection failed"}\n\n'`（不泄漏敏感异常文本）。
6. `finally` → `await pubsub.unsubscribe(channel); await pubsub.close()`（资源清理必须执行）。

每个透传的 `data` 事件天然含 `run_id`，前端按 `run_id` 分 turn；本任务不在 backend 内做 turn_started 边界注入（保持最小实现，与现有 `stream_run_logs` 的扁平 `data` 透传风格一致）。

### 4.4 submit_messages 双 publish（daemon/service.py:733）

在现有 `submit_messages` 的 Redis publish 段（`service.py:845-863`）追加 session channel 发布，**不改动** run channel 的 payload、顺序和 try/except：

```python
# 现有（保持不变）：
try:
    redis = get_redis()
    run_channel = f"agent_run:{agent_run_id}"
    for log_payload in published_logs:
        await redis.publish(run_channel, json.dumps(log_payload))
    summary_payload = {"event": "messages", "lease_id": ..., "count": count, ...}
    await redis.publish(run_channel, json.dumps(summary_payload))
except Exception:
    log.warning("daemon_messages_redis_publish_failed", ...)

# 新增（interactive run 双 publish）：
# agent_run 在循环前已 self._session.get；此处取其 agent_session_id。
# batch run agent_session_id IS NULL → 跳过 session channel。
if agent_run is not None and agent_run.agent_session_id is not None:
    session_channel = f"agent_session:{agent_run.agent_session_id}"
    try:
        for log_payload in published_logs:
            session_payload = {
                "event": "log",
                "session_id": str(agent_run.agent_session_id),
                "run_id": str(agent_run_id),
                "log_id": log_payload["log_id"],
                "channel": log_payload["channel"],
                "content": log_payload["content"],
                "timestamp": log_payload["timestamp"],
            }
            await redis.publish(session_channel, json.dumps(session_payload))
    except Exception:
        log.warning(
            "daemon_messages_session_redis_publish_failed",
            lease_id=str(lease_id),
            agent_run_id=str(agent_run_id),
            agent_session_id=str(agent_run.agent_session_id),
        )
```

约束：

1. 保留现有 DB commit（`service.py:839`）和 `agent_run:{run_id}` 发布顺序/格式/payload 不变。
2. 从已查询的 `agent_run.agent_session_id` 取 session id；**禁止**用 `AgentRun.session_id`（claude resume 语义，D-001）。
3. session channel 只发布带 `log_id` 的扁平 log；**不**发布 `summary_payload`（无 log_id，不可作稳定日志序列）。
4. batch run（`agent_session_id IS NULL`）零 session channel 发布。
5. run channel 与 session channel **分别 try/except**：session publish 失败不得跳过/破坏现有 run publish，不得回滚已提交的 AgentRunLog。重连后前端从新的 session SSE 连接补齐（Redis Pub/Sub 无历史，丢失的实时事件不影响 DB 真相）。

### 4.5 Router（daemon/router.py）

```python
@router.get("/sessions/{session_id}/stream")
async def stream_session_logs(
    session_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(get_current_principal)],
) -> StreamingResponse:
    """Stream session-level SSE aggregating all AgentRuns of the session."""
    ...
```

路由必须：

- 按 `AgentSession.id == session_id AND AgentSession.user_id == user.id` 查询；不存在或不属于当前用户统一返回 404（`DaemonSessionNotFound` 或等价），不泄漏对象存在性。
- 查到 session 后调用 `AgentService(session).stream_session_logs(session_id, session=session)`，返回 `StreamingResponse(generator, media_type="text/event-stream")`。
- Response headers 与现有 run SSE 一致：`Cache-Control: no-cache, no-transform`、`Connection: keep-alive`、`X-Accel-Buffering: no`。
- 即使 session 已 `ended/failed`，也进入生成器（生成器内部发 done 后 return），不提前在 router 层短路。
- 路由放在 daemon router 内（`main.py` 已 include，无需新增注册）。
- 鉴权依赖沿用现有 `get_current_principal`（与 `/leases/{lease_id}/messages` 一致），不新增无认证入口；权限粒度遵循 task-05 的 session 所有权校验，本任务不重写权限模型。

> `AgentSession` ORM、`DaemonSessionNotFound` 等错误类由 task-02 / task-05 提供；本任务消费，不重定义。执行前用 `rg` 确认这些符号真实存在，签名不符先更新本文再写代码。

## 5. 实现要求（最小可验证集）

1. 在 `agent/service.py` 的 `AgentService` 增加 `stream_session_logs`（§4.3），复用现有 `get_redis()` / pubsub 范式。
2. 在 `daemon/service.py` 的 `submit_messages` Redis publish 段追加 interactive run 的 session channel 双 publish（§4.4），run channel 段一字不改。
3. 在 `daemon/router.py` 增加 `GET /sessions/{session_id}/stream` 路由（§4.5）。
4. 不新增事件表、不引入 Kafka/Redis Streams、不修改 `AgentRunLog` schema（task-02 已完成数据层）。
5. 不实现前端 EventSource / 日志 UI / 历史列表（task-11）。
6. 不重新实现 task-05 的 session REST（create/inject/interrupt/end）或 `_publish_session_event`；本任务只消费 task-05 发布的 `session_ended` / `turn_completed` 事件。

## 6. 边界与异常场景（≥5）

| # | 场景 | 期望 |
|---|---|---|
| 1 | session 无 active run（active 但当前没有正在跑的 turn） | `connected` 后保持连接，周期 `: keepalive`，不产生伪 log；前端 EventSource 不超时断开 |
| 2 | SSE 断线重连 | 客户端重新 GET `/sessions/{id}/stream` 建立新连接；Redis Pub/Sub 无历史，断线期间的实时事件不可补（本任务最小实现不做 cursor 回放），但重连后后续 turn 正常到达。done 仅在 session 真终态时发，不在每次重连重复发 |
| 3 | turn 切换 run_id（同一 session 多 turn） | 单连接不断流；每个 `data` 事件含新 `run_id`，前端按 run_id 区分 turn 边界；旧 turn 的 done 不关闭 session SSE |
| 4 | session ended/failed（手动 end / 空闲回收 / failed） | `submit_messages` 或 task-05 `end_session` 发布 `session_ended` → 生成器发 `event: done` 并 return；router 不提前短路已终态 session |
| 5 | 并发 publish 顺序 | 同一批多条 log 在 run channel 与 session channel 各自按 `published_logs` 列表顺序串行 publish；不保证跨 publisher 全局顺序，但单批次内顺序稳定（run channel 现有行为不变） |
| 6 | batch run（`agent_session_id IS NULL`） | session channel 零发布；`stream_session_logs` 不会被 batch run 触发（router 按 session_id 路由）；现有 batch lease / workspace AgentRun / quick-chat SSE 零回归 |
| 7 | interactive run session publish 失败 | run channel publish 不受影响；AgentRunLog 已 DB commit；`log.warning("daemon_messages_session_redis_publish_failed")`；不抛、不回滚 |
| 8 | session 属于其他用户 / 不存在 | router 统一 404，不回放、不订阅 Redis、不泄漏存在性 |
| 9 | Redis 连接在 stream 中断 | 生成器 `except` 发 `event: error`，`finally` 执行 unsubscribe + close；客户端可重连 |
| 10 | submit_messages 对同一 interactive run 多次调用（多 batch 消息） | 每次都按 published_logs 双 publish；session SSE 连接持续收到该 run_id 的 log，不重复、不丢（依赖 log_id 唯一） |

## 7. 非目标

- 不实现或修改 SDK driver / SessionManager / TaskRunner（task-04 / task-07）。
- 不实现 session REST（create/inject/interrupt/end_session）、`_publish_session_event`（task-05）。
- 不实现 permission_request/response（task-08 / task-09）。
- 不做前端 EventSource、日志 UI、历史列表（task-11 / task-12）。
- 不删除、不改名 `stream_run_logs` 和 `agent_run:{run_id}`；run 级 SSE 行为零变化。
- 不实现 DB 历史回放 + cursor（`Last-Event-ID`）的完整断点续流——v2 蓝图的 cursor/envelope 设计不纳入本最小实现；本任务只做 Redis session channel 实时聚合 + ended done，断线期间事件丢失是已知 trade-off（R-08 应对：session 级 channel + 双 publish 已解决跨 turn 断流主问题）。
- 不引入 Kafka/Redis Streams/新事件表；不修改 `AgentRunLog` schema。
- 不为非日志状态事件（`turn_completed`）设计独立持久化 cursor；该事件由 task-05 发布，本任务透传。
- 不把 `summary_payload`（`event:"messages"`）作为 session log 发布（无 log_id）。
- 不在 backend 内做 turn_started 边界注入；前端用 `data` 中的 `run_id` 自行分 turn。

## 8. 参考

- `backend/app/modules/agent/service.py:542` — `stream_run_logs`（SSE 生成器 / keepalive / error / finally pubsub 清理范式，直接对照实现 `stream_session_logs`）。
- `backend/app/modules/daemon/service.py:733` — `submit_messages`（双 publish 追加点：Redis publish 段 `service.py:845-863`）。
- `backend/app/modules/daemon/router.py:256` — `submit_lease_messages`（router 鉴权依赖 `get_current_principal` + `SessionDep` 范式）。
- `backend/app/core/redis.py:16` — `get_redis()`（同步返回 `Redis`，`publish` / `pubsub()` 用法）。
- `.sillyspec/changes/2026-06-18-daemon-interactive-session/design.md` §7.5 / §8.4 / R-08。
- `.sillyspec/changes/2026-06-18-daemon-interactive-session/decisions.md` D-005@v1 / D-001@v1（agent_session_id vs session_id）。
- `.sillyspec/changes/2026-06-18-daemon-interactive-session/tasks/task-05.md`（v2 蓝图，本任务 SSE 聚合职责的来源；v3 plan 将其 REST 部分留在 task-05，SSE 部分拆到 task-06）。

## 9. TDD 实施顺序

必须先红后绿，记录至少一次目标测试按预期失败。

### Step 1：Red — submit_messages 双 publish

- 写 `backend/app/modules/daemon/tests/test_session_sse.py`：构造 interactive run（`agent_session_id` 非空），调 `submit_messages`，用 fake Redis（`AsyncMock`，参考 `agent/tests/test_router.py` 的 pubsub 范式）断言：
  - `agent_run:{run_id}` 收到扁平 log + summary（现有行为不变）。
  - `agent_session:{agent_session_id}` 收到带 `run_id` 标记的 log 事件，数量 = published_logs 数量。
  - summary **不**出现在 session channel。
- 写 batch run（`agent_session_id=None`）测试：session channel 零发布。
- 写 session publish 失败测试：注入 `redis.publish` 对 session channel 抛异常，断言 run channel publish 仍完成、AgentRunLog 已 commit、不抛出。

### Step 2：Green — 双 publish

- 在 `submit_messages` Redis 段追加 §4.4 的 interactive 双 publish；run channel 段不动。定向测试通过。

### Step 3：Red — stream_session_logs

- 用 fake pubsub（参考 `stream_run_logs` 测试范式）覆盖：
  - connected → subscribe `agent_session:{id}`。
  - 收到 `log` 事件 → 透传 `data:`，含 run_id。
  - 收到 `session_ended` → 发 `event: done` 并 return。
  - 超时 → `: keepalive`。
  - subscribe 后 session 已 ended（session 参数提供）→ 立即 done。
  - Redis 异常 → `event: error`，finally 执行 unsubscribe + close。
  - 同一连接收到两个不同 run_id 的事件 → 都透传，不断流。

### Step 4：Green — 生成器

- 实现 `stream_session_logs`（§4.3），定向测试通过。

### Step 5：Red — router

- 写 router 测试：session 存在且属于当前用户 → 200 `text/event-stream` + 正确 headers。
- session 不存在 / 属于他人 → 404，不进入生成器。
- session 已 ended → 仍 200，生成器内部 done。

### Step 6：Green — router + 回归

- 实现 `GET /sessions/{session_id}/stream`。
- 跑现有 `agent/tests/test_router.py`（run SSE 不回归）、daemon 现有测试、ruff、backend 全量 pytest。
- `git diff` 确认 `stream_run_logs` / `agent_run:{run_id}` / batch 路径零改动。

## 10. 验收表

| AC | 验收项 | 自动化证据 | 对齐 |
|---|---|---|---|
| AC-01 | `submit_messages` 对 interactive run（`agent_session_id` 非空）同时发布 `agent_run:{run_id}` 与 `agent_session:{session_id}`；session channel 事件含 `run_id` 标记 | fake Redis publish 调用断言（双 channel、payload 含 run_id） | FR-03 / D-005@v1 |
| AC-02 | session channel 只发布带 `log_id` 的扁平 log；`summary_payload`（`event:"messages"`）不出现在 session channel | publish payload 断言（summary 仅在 run channel） | FR-03 |
| AC-03 | batch run（`agent_session_id IS NULL`）session channel 零发布；run channel 行为不变 | batch run publish 断言 + 现有 run SSE 测试通过 | brownfield |
| AC-04 | `stream_session_logs` 单连接跨多个 turn（不同 run_id）持续透传 `data` 事件，不断流；每个事件含 run_id | fake pubsub 多 run_id 透传测试 | FR-03 / R-08 |
| AC-05 | session ended/failed → 生成器发 `event: done` 并 return；单 turn 完成不关 session SSE | session_ended → done 测试 + turn_completed 不关流测试 | FR-03 / D-005@v1 |
| AC-06 | session publish 失败不影响 run channel publish、不回滚 AgentRunLog、不抛出 | 故障注入测试（session publish raise → run publish 仍完成） | FR-03 |
| AC-07 | Redis 异常 / 取消时生成器 `finally` 执行 unsubscribe + close，并发 `event: error` | 资源清理测试（fake pubsub.unsubscribe/close 被调用） | 稳定性 |
| AC-08 | `GET /sessions/{id}/stream` 校验 `AgentSession.user_id == user.id`；越权与不存在均 404，不订阅 Redis | router auth/ownership 测试 | 安全边界 |
| AC-09 | Response headers 含 `text/event-stream` + `Cache-Control: no-cache, no-transform` + `X-Accel-Buffering: no` | router response headers 断言 | 一致性 |
| AC-10 | session 无 active run 时保持连接 + 周期 keepalive，不产生伪 log、不超时断开 | fake pubsub timeout → keepalive 测试 | FR-03 |
| AC-11 | 现有 `stream_run_logs`、`agent_run:{run_id}`、batch lease、quick-chat、workspace AgentRun 路径零回归 | 现有 `agent/tests/test_router.py` + daemon 全量测试 + diff 审查 | brownfield |
| AC-12 | 改动严格限制在 `allowed_paths`（agent/service.py、daemon/service.py、daemon/router.py） | `git diff --name-only` | 任务边界 |
| AC-13 | backend 定向测试、ruff check/format、全量 pytest 通过 | 命令输出 | 质量门 |

## 11. 验证命令

```powershell
cd backend
uv run pytest app/modules/daemon/tests/test_session_sse.py -q
uv run pytest app/modules/agent/tests/test_router.py -q
uv run ruff check app/modules/agent/service.py app/modules/daemon/service.py app/modules/daemon/router.py
uv run ruff format --check app/modules/agent/service.py app/modules/daemon/service.py app/modules/daemon/router.py
uv run pytest -q
```

若全量测试因外部 PostgreSQL/Redis 环境不可用，必须记录精确失败命令与错误；定向 fake Redis/SQLite 测试仍须通过，不得把环境阻塞写成已验证。

## 12. 完成定义

- 一个 session SSE 连接能够跨多个 turn（不同 run_id）持续看到实时日志，事件含 run_id 区分 turn 边界（FR-03 / R-08）。
- `submit_messages` 对 interactive run 双 publish，session channel 事件带 run_id 标记；batch run 零变化（D-005@v1）。
- session ended/failed 时连接发 done 并关闭；单 turn 完成不关 session SSE。
- run 级 SSE、batch lease、quick-chat、workspace AgentRun 路径零回归。
- 所有 AC-01~AC-13 满足，且改动未越过 allowed_paths。
