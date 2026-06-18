---
author: qinyi
created_at: 2026-06-18 15:31:03
change: 2026-06-18-daemon-interactive-session
id: task-05
title: "session SSE 聚合：跨 AgentRun 回放、续流与 turn 边界"
wave: W4
priority: P0
estimated_hours: 12
depends_on: [task-04]
blocks: [task-06, task-10]
requirement_ids: [FR-03]
decision_ids: [D-002@v2, D-005@v1]
allowed_paths:
  - backend/app/modules/agent/service.py
  - backend/app/modules/daemon/service.py
  - backend/app/modules/daemon/router.py
  - backend/app/modules/daemon/schema.py
  - backend/app/modules/daemon/tests/test_session_sse.py
  - backend/app/modules/agent/tests/test_session_log_replay.py
---

# task-05 — session SSE 聚合：跨 AgentRun 回放、续流与 turn 边界

> 以 `plan.md` 的显式 task-05 为准：本任务是 Wave 4 的 session SSE 聚合，不是 permission 任务。依据 `design.md` §7.2、§8.4、R-08，以及当前 `AgentRun` / `AgentRunLog` / Redis Pub/Sub / run SSE 真实实现。

## 1. 目标

为一个 `AgentSession` 提供一个稳定 SSE 地址：

```http
GET /api/daemon/sessions/{session_id}/stream
```

该连接必须：

1. 按 `AgentRun.agent_session_id` 聚合该 session 下多个 turn 的 `AgentRunLog`。
2. 首次连接先回放已有日志，再无缝进入 Redis 实时流；不能只订阅“当前 run”。
3. 断线重连时使用 SSE `Last-Event-ID`（并支持 `cursor` 查询参数）只补发断点后的持久化日志。
4. 每个业务事件都携带 `session_id`、`run_id` 和明确的 turn 边界，前端不依赖当前 run 的外部状态猜测归属。
5. session 结束时先完成历史回放，再发送 `event: done`；单个 run 完成只结束 turn，不关闭 session SSE。
6. 保留现有 `agent_run:{run_id}` 与 run SSE 行为，batch/quick-chat 旧链路不回归。

本任务覆盖 FR-03、D-002@v2、D-005@v1。每 turn 独立 spawn + resume 由 task-03 实现；session REST/AgentRun 创建由 task-04 实现；前端消费由 task-10 实现。

## 2. 当前事实与实现约束

| 当前事实 | 证据 | 本任务约束 |
|---|---|---|
| `AgentRunLog` 只有 `id/run_id/timestamp/channel/content_redacted` | `backend/app/modules/agent/model.py` | 不新增事件表；持久日志游标由 `(timestamp, id)` 构成 |
| `AgentService.stream_run_logs` 只订阅 `agent_run:{run_id}`，Redis Pub/Sub 无历史 | `backend/app/modules/agent/service.py` | session stream 必须“DB 回放 + Redis 续流”，不能复制一个纯 Pub/Sub 订阅器 |
| `DaemonService.submit_messages` 先提交 DB，再向 `agent_run:{run_id}` 发布扁平 log 和 summary | `backend/app/modules/daemon/service.py` | interactive run 追加向 `agent_session:{session_id}` 发布；run channel 原样保留 |
| 同一批 message 使用相同 timestamp，但 log id 不同 | `submit_messages` 当前实现 | 排序与 cursor 必须使用 `(timestamp, log_id)`，不能只用 timestamp |
| `AgentRun.session_id` 是 agent 内部 resume id | D-001 / task-01 | 聚合字段只能使用 `AgentRun.agent_session_id`，禁止混用 `session_id` |
| Redis 发布失败当前不会回滚已提交日志 | `submit_messages` 当前 try/except | DB 是回放真相；Redis 只负责低延迟通知，失败时下次重连仍可补齐 |

开始实现前硬门：task-01 的 `AgentSession` 与 `AgentRun.agent_session_id`、task-04 的 session service/REST 必须已经落地。若字段或方法不存在，停止 task-05，不得在本任务临时重做 task-01/task-04。

## 3. 任务边界

### 3.1 修改文件

| 文件 | 改动 |
|---|---|
| `backend/app/modules/agent/service.py` | 新增 session 日志查询、cursor 编解码/校验、DB 回放与 Redis 续流生成器 |
| `backend/app/modules/daemon/service.py` | `submit_messages` 对 interactive run 双 publish；session/run 终态发布 session 事件；复用小型 publish helper |
| `backend/app/modules/daemon/router.py` | 新增 session SSE 路由，校验权限与 session 所有权，读取 `Last-Event-ID`/`cursor` |
| `backend/app/modules/daemon/schema.py` | 定义 SSE envelope 与 cursor 的内部 DTO/类型（不作为普通 JSON response body） |
| `backend/app/modules/daemon/tests/test_session_sse.py` | service publish、SSE、鉴权、终态与竞态测试 |
| `backend/app/modules/agent/tests/test_session_log_replay.py` | 跨 run 查询、稳定排序、cursor 回放测试 |

### 3.2 非目标

- 不实现或修改 Claude `--resume`、Codex thread resume、daemon SessionStore（task-03）。
- 不创建 session、不处理 inject/interrupt 的业务编排（task-04）。
- 不实现 permission_request/response（task-07/task-08）。
- 不做前端 EventSource、日志 UI 或历史列表（task-10/task-11）。
- 不删除、不改名 `stream_run_logs` 和 `agent_run:{run_id}`。
- 不增加 Kafka/Redis Streams/新事件表；当前以 PostgreSQL 日志回放 + Redis Pub/Sub 续流完成目标。
- 不把 Redis summary 消息当可回放日志；summary 无 `log_id`，不进入 session SSE 的稳定日志序列。
- 不为非日志状态事件设计独立持久化 cursor；`turn_started` / `turn_completed` / `session_ended` 从 run/session 权威状态与日志序列重建，只有持久化 log 推进 `Last-Event-ID`。
- 不在 backend 内实现 Redis 断线后的无限自动重订阅；本任务在异常时释放 pubsub 并发出通用 error，客户端携 cursor 重连后由 DB 补齐。
- 不提供独立的 session 历史分页 REST API；task-11 负责历史列表/回看，本任务只提供 SSE 首次回放与断点续流所需查询。
- 不承诺多个并发 publisher 的 Redis 到达顺序代表全局业务顺序；对外稳定顺序以 PostgreSQL 中 `(AgentRunLog.timestamp, AgentRunLog.id)` 为准。

## 4. 事件与 cursor 契约

### 4.1 Redis channel

```text
agent_run:{run_id}         # 现有，保持不变
agent_session:{session_id} # 新增，session 实时通知
```

只有 `agent_run.agent_session_id IS NOT NULL` 才发布 session channel。batch run 为 NULL 时只走原 run channel。

### 4.2 SSE 事件 envelope

所有非 comment 事件的 `data` 使用同一 envelope：

```json
{
  "event": "turn_started|log|turn_completed|session_status|session_ended",
  "session_id": "uuid",
  "run_id": "uuid|null",
  "turn": 1,
  "log_id": "uuid|null",
  "timestamp": "2026-06-18T07:31:03.123456Z",
  "channel": "stdout|null",
  "content": "redacted content|null",
  "status": "running|completed|failed|killed|active|ended|null",
  "exit_code": 0,
  "reason": "manual|null"
}
```

约束：

- `log` 必须含 `run_id/log_id/timestamp/channel/content`；内容来自 `content_redacted`。
- `turn_started` 在一次连接的有序输出中首次遇到某个 `run_id` 时、且在该 run 第一条 `log` 前发送。`run_id` 本身是稳定 turn identity；`turn` 是本次聚合查询按首日志时间排序得到的展示序号，不作为数据库主键。
- `turn_completed` 表示单个 AgentRun 终态，不得转成 SSE `done`，连接继续等待后续 inject 产生的新 run。
- `session_ended` 对应 SSE `event: done`，`run_id=null`；只有 session 终态才关闭连接。
- `: connected` 与 `: keepalive` 是 SSE comment，无 data envelope。

### 4.3 SSE frame

持久化 log 使用：

```text
id: eyJ0cyI6IjIwMjYt...<base64url cursor>
event: log
data: {...envelope...}

```

边界事件使用 `event: turn` / `event: turn_done`；session 结束使用：

```text
event: done
data: {"event":"session_ended", ...}

```

### 4.4 cursor

cursor 是 base64url 编码的 UTF-8 JSON：

```json
{"v":1,"ts":"2026-06-18T07:31:03.123456Z","log_id":"uuid"}
```

- 服务端只接受 `v=1`、合法 timezone-aware timestamp 与 UUID。
- SQL 条件是 `timestamp > :ts OR (timestamp = :ts AND id > :log_id)`。
- 排序固定为 `ORDER BY AgentRunLog.timestamp ASC, AgentRunLog.id ASC`。
- Header `Last-Event-ID` 优先于 `?cursor=`；两者都没有表示从头回放。
- 非法/未知版本 cursor 返回 HTTP 400 `HTTP_400_INVALID_SESSION_CURSOR`，禁止静默从头回放造成重复刷屏。
- `turn` 边界不推进 cursor；只有持久化 `log` frame 写 `id:`。重连后边界可重新发送，前端以 `run_id` 幂等处理。

## 5. 服务接口

### 5.1 跨 run 日志查询

在 `AgentService` 增加：

```python
async def get_session_logs(
    self,
    agent_session_id: uuid.UUID,
    *,
    after: SessionLogCursor | None = None,
) -> list[tuple[AgentRunLog, uuid.UUID]]: ...
```

查询必须显式 join `AgentRun`：

```sql
SELECT l.*, r.id AS run_id
FROM agent_run_logs l
JOIN agent_runs r ON r.id = l.run_id
WHERE r.agent_session_id = :agent_session_id
  AND (:cursor IS NULL OR (l.timestamp, l.id) > (:ts, :log_id))
ORDER BY l.timestamp, l.id
```

实现使用 SQLAlchemy 表达式，兼容测试 SQLite，不直接拼用户输入 SQL。不能先查 run id 再逐个查日志（N+1），也不能按 run 分组后拼接（会破坏真实时间序）。

### 5.2 session stream

```python
async def stream_session_logs(
    self,
    agent_session_id: uuid.UUID,
    *,
    cursor: SessionLogCursor | None,
    session: AsyncSession,
) -> AsyncGenerator[str, None]: ...
```

固定算法：

1. yield `: connected`，创建并订阅 `agent_session:{id}`。
2. **先订阅、后查 DB**，避免“回放查询结束到 subscribe 完成”之间丢事件。
3. 调 `get_session_logs(after=cursor)` 回放，按 `(timestamp,id)` 排序；遇到新 run 先发 `turn_started`，再发带 cursor id 的 `log`。
4. 回放后重新读取 `AgentSession.status`。若已 `ended/failed`，发 `event: done` 后结束；不得因为 session 已终态而跳过历史回放。
5. 进入 Pub/Sub 循环。只接受 `session_id` 匹配的结构化 payload；log 以 `log_id` 去重。回放期间已缓冲在 Pub/Sub 的同一 log 必须丢弃。
6. 收到新 run 的首个事件先发 `turn_started`；收到 `turn_completed` 仅发 `event: turn_done` 并继续。
7. 收到 `session_ended`，再次检查 DB 终态后发 `event: done`；若 Redis 消息早于 DB commit，短暂重试读取，不得把 active session误关。
8. 25 秒无消息、30 秒 wait timeout 时发 `: keepalive`。
9. Redis 异常发 `event: error`（不含敏感异常文本）并关闭；`finally` 始终 unsubscribe + close。

去重集合只保留“本次回放的 log_id + 最近实时窗口”，采用有界结构（建议 4096）；不能让长 session 的 Python set 无界增长。cursor 比较仍是主要断点规则。

### 5.3 双 publish

在 `DaemonService.submit_messages` 中：

1. 保留当前 DB commit 和 `agent_run:{run_id}` 发布顺序/格式。
2. 从已查询的 `agent_run.agent_session_id` 取得 session id，禁止用 `AgentRun.session_id`。
3. 对每条已持久化 `published_logs` 向 session channel 发布 envelope，补齐：
   - `event="log"`
   - `session_id`
   - `run_id`
   - `log_id/timestamp/channel/content`
4. batch run 不发布 session channel。
5. run channel 与 session channel 分别 try/except；session publish 失败不能跳过/破坏现有 run publish。
6. 不把 `summary_payload` 作为 session log 发布，因为它没有可恢复 cursor。

提取 helper：

```python
async def _publish_session_event(
    self,
    session_id: uuid.UUID,
    payload: dict[str, object],
) -> None: ...
```

task-04 的 run/session 状态收口点调用同一 helper：

- 当前 AgentRun 进入 `completed/failed/killed` → `turn_completed`，含 run_id/status/exit_code。
- `end_session` DB commit 后 → `session_ended`，含 session_id/status/reason。

状态发布是实时提示；断线后的权威状态由 `AgentRun` / `AgentSession` DB 重建。禁止用 Redis 状态覆盖 DB。

### 5.4 Router

```python
@router.get("/sessions/{session_id}/stream")
async def stream_session_logs(
    session_id: uuid.UUID,
    request: Request,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.TASK_READ))],
    cursor: str | None = Query(default=None),
) -> StreamingResponse: ...
```

路由必须：

- 按 `AgentSession.id == session_id AND AgentSession.user_id == user.id` 查询；不存在或不属于当前用户统一返回 `DaemonSessionNotFound`，不泄漏对象存在性。
- 解析 `request.headers.get("last-event-id")`，优先于 query cursor。
- 即使 session 已终态，也调用生成器完成回放后再 done。
- 返回 `text/event-stream`，headers 与现有 run SSE 一致：`Cache-Control: no-cache, no-transform`、`Connection: keep-alive`、`X-Accel-Buffering: no`。
- 路由放在 daemon router 内；`main.py` 已 include，无需新增注册。

## 6. 边界与异常场景

| # | 场景 | 期望 |
|---|---|---|
| 1 | session 含 run A、B，日志时间交错 | 全局按 `(timestamp,id)` 输出；每条含正确 run_id，run 首次出现前有 turn boundary |
| 2 | 同一批多条日志 timestamp 完全相同 | 以 UUID id 次序稳定排序；cursor 不漏不重 |
| 3 | 首次连接发生在两个 turn 都完成后 | 回放 A+B 全部日志和边界；session active 时继续等待第三 turn |
| 4 | 连接在 DB 回放与 Redis subscribe 之间发生新日志 | 因先 subscribe 后回放，事件在 buffer 中；log_id 去重后恰好输出一次 |
| 5 | 携带 Last-Event-ID 重连 | 只回放 cursor 之后日志，再进入实时流；Header 覆盖 query 参数 |
| 6 | cursor 非法、版本未知或 timestamp 无时区 | HTTP 400，不建立 SSE，不回退为全量回放 |
| 7 | session 已 ended，仍有历史日志 | 先完整回放历史，再发 done；不能只返回 done |
| 8 | 一个 turn completed，session 仍 active | 发 turn_done，连接保持；后续 inject 的新 run 继续到达同一连接 |
| 9 | batch run 的 `agent_session_id=NULL` | 仅原 run channel 有事件；session channel 零发布 |
| 10 | Redis publish 失败 | AgentRunLog 已提交且接口成功；run channel不受 session channel 失败影响；重连从 DB 补齐 |
| 11 | Redis 连接在 stream 中断 | 发通用 error event，释放 pubsub；客户端可携 cursor 重连 |
| 12 | session 属于其他用户 | 与不存在一致返回 404，不回放、不订阅 Redis |
| 13 | session active 但暂时没有日志 | connected 后保持连接并周期 keepalive，不产生伪 log |
| 14 | Redis 重复投递相同 log_id | 单连接只输出一次；去重窗口有界 |
| 15 | session_ended Redis 先于 DB terminal commit | 重新读取/短暂重试；DB 未终态时继续流，不误发 done |

## 7. TDD 实施顺序

1. **Red — 查询与 cursor**
   - 写 `test_session_log_replay.py`：两个 session、每个多个 run、相同 timestamp、跨 run 时间交错。
   - 覆盖全量查询、after cursor、非法 cursor、稳定排序和不越权聚合。
2. **Green — DB 回放**
   - 实现 cursor DTO/codec 与 `get_session_logs`，定向测试通过。
3. **Red — publish**
   - 写 interactive 双 publish、batch 单 publish、session publish 失败不影响 run publish测试。
4. **Green — publish helper**
   - 在不改 run channel payload 的前提下追加 session envelope。
5. **Red — stream 竞态**
   - fake pubsub 覆盖先订阅后回放、回放/live 重复、跨 turn boundary、turn_done 不关流、ended 回放后 done、keepalive、Redis 异常清理。
6. **Green — generator/router**
   - 实现 `stream_session_logs` 与路由；补 owner/404、Last-Event-ID precedence、400 cursor 测试。
7. **Refactor/回归**
   - 抽取 SSE formatter，保持函数小且异步资源在 finally 释放。
   - 跑定向测试、ruff、backend 全量测试；grep/diff 确认 run SSE 未被替换。

测试优先使用现有 `AsyncMock` pubsub 范式（见 `backend/app/modules/agent/tests/test_router.py`），不引入只为本任务服务的新测试依赖。

## 8. 验收标准

| AC | 验收项 | 自动化证据 | 对齐 |
|---|---|---|---|
| AC-01 | 查询通过 `AgentRun.agent_session_id` 聚合多个 run 的 AgentRunLog，且不混入其他 session | 跨 session/run 查询测试 | FR-03 / D-005 |
| AC-02 | 回放顺序固定为 `(timestamp, log_id)`，同 timestamp 也稳定 | 同 timestamp 测试 | FR-03 |
| AC-03 | 首次连接先回放历史再续流，新日志在 subscribe/replay 竞态窗口恰好输出一次 | fake pubsub 竞态测试 | FR-03 / R-08 |
| AC-04 | Last-Event-ID/cursor 只补发断点后日志，Header 优先；非法 cursor 返回 400 | codec + router 测试 | FR-03 |
| AC-05 | 每个 log envelope 含 session_id/run_id/log_id；每个新 run 有 turn_started，run 终态有 turn_done | envelope 顺序断言 | D-002@v2 |
| AC-06 | turn_done 不关闭 SSE；session ended 才 done，且 ended session 仍先回放历史 | generator 测试 | D-002@v2 / D-005 |
| AC-07 | `submit_messages` 对 interactive run 同时发布 run/session channel；batch 仅发布 run channel | publish 调用断言 | FR-03 |
| AC-08 | session publish 失败不回滚日志、不影响原 run publish；重连可从 DB 补齐 | 故障注入测试 | FR-03 |
| AC-09 | SSE endpoint 要求 TASK_READ 且强制 `AgentSession.user_id == user.id`；越权与不存在均 404 | router auth 测试 | 安全边界 |
| AC-10 | Redis 异常、断连和取消均执行 unsubscribe/close；静默期有 keepalive | 资源清理测试 | 稳定性 |
| AC-11 | 现有 run SSE、quick-chat stream、batch lease 行为与 payload 不变 | 现有测试 + diff 审查 | brownfield |
| AC-12 | 改动严格限制在 allowed_paths；未实现 permission/前端/daemon runner | `git diff --name-only` | 任务边界 |
| AC-13 | backend 定向测试、ruff 与全量 pytest 通过 | 命令输出 | 质量门 |

## 9. 验证命令

```powershell
cd backend
uv run pytest app/modules/agent/tests/test_session_log_replay.py app/modules/daemon/tests/test_session_sse.py -q
uv run pytest app/modules/agent/tests/test_router.py -q
uv run ruff check app/modules/agent/service.py app/modules/daemon/service.py app/modules/daemon/router.py app/modules/daemon/schema.py app/modules/agent/tests/test_session_log_replay.py app/modules/daemon/tests/test_session_sse.py
uv run ruff format --check app/modules/agent/service.py app/modules/daemon/service.py app/modules/daemon/router.py app/modules/daemon/schema.py app/modules/agent/tests/test_session_log_replay.py app/modules/daemon/tests/test_session_sse.py
uv run pytest -q
```

若全量测试因外部 PostgreSQL/Redis 环境不可用，必须记录精确失败命令与错误；定向 fake Redis/SQLite 测试仍须通过，不得把环境阻塞写成已验证。

## 10. 完成定义

- 一个 session SSE 连接能够完整看到多个 AgentRun 的历史与实时日志。
- cursor 重连可证明无遗漏、无重复持久日志；run_id 与 turn 边界可供 task-10 直接消费。
- 单个 turn 结束不终止 session stream，session ended 才统一收口。
- run 级 SSE 与 batch 路径无回归。
- 所有 AC 满足，且改动未越过 allowed_paths。
