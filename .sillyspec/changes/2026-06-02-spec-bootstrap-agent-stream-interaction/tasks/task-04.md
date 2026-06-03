---
id: task-04
title: 增加 AgentRun 用户输入记录与 SSE 推送服务
priority: P0
estimated_hours: 3
author: qinyi
created_at: 2026-06-02T10:00:00
depends_on:
  - task-01
blocks:
  - task-05
allowed_paths:
  - backend/app/modules/agent/service.py
  - backend/app/modules/agent/tests/test_run_input_service.py
---

# task-04: 增加 AgentRun 用户输入记录与 SSE 推送服务

目标是在 `AgentService` 中提供一个可复用的用户指导输入服务方法：校验 run 属于 workspace，写入 `AgentRunLog(channel="user_input")`，并把同一事件发布到现有 `agent_run:{run_id}` Redis Pub/Sub 通道，使已连接的 `/stream` SSE 客户端立即收到用户输入记录。

## 修改文件

| 文件 | 操作 | 说明 |
|---|---|---|
| `backend/app/modules/agent/service.py` | 修改 | 增加 `submit_run_input()` 服务方法，复用现有 `AgentRunLog`、`AgentRunWorkspace`、`get_redis()`、`_serialize_log_event()`。 |
| `backend/app/modules/agent/tests/test_run_input_service.py` | 新增 | 覆盖用户输入持久化、Redis publish、workspace 归属校验、状态校验、内容校验、Redis 失败降级。 |

## 实现要求

- 在 `AgentService` 增加 `submit_run_input()`，不要把逻辑写到 router；task-05 会基于该服务方法增加 HTTP 端点。
- 通过 `AgentRunWorkspace` 校验 `run_id` 与 `workspace_id` 的关联；run 不存在或不属于 workspace 时统一抛 `AgentRunNotFound`，避免跨 workspace 信息泄露。
- 仅允许 `AgentRun.status in ("pending", "running")` 的 run 接受输入；终态 `completed/failed/killed` 抛 `AgentRunNotRunning`。
- 输入内容先 `strip()`；空字符串抛 `AgentRunError`；超过 4000 字符抛 `AgentRunError`，不要静默截断用户指导。
- 写入 `AgentRunLog` 时使用 `channel="user_input"`，`content_redacted=redact_agent_output(content)`，并保持 `timestamp` 由模型默认值或服务显式 UTC 时间生成。
- DB `commit` 成功后再 Redis publish；publish payload 必须与现有 SSE replay 格式一致：`{"channel":"user_input","content":"...","timestamp":"..."}`。
- Redis publish 失败只记录 warning，不回滚已持久化日志；晚连接客户端仍可通过 `stream_run_logs()` 的 DB replay 看到该输入。
- 不新增表、不改 `AgentRunLog` schema、不改 SSE endpoint 语义、不向 agent 子进程 stdin 写入内容。

## 接口定义

### 服务方法

```python
async def submit_run_input(
    self,
    *,
    workspace_id: uuid.UUID,
    run_id: uuid.UUID,
    content: str,
) -> AgentRunLog:
    ...
```

行为：

- 返回新建并已持久化的 `AgentRunLog`。
- 使用 Redis channel：`agent_run:{run_id}`。
- 推荐复用 `_serialize_log_event(entry)` 构造 publish 字符串，避免 DB replay 与实时事件格式漂移。
- 推荐在 `service.py` 中定义局部常量：

```python
USER_INPUT_CHANNEL = "user_input"
MAX_USER_INPUT_CHARS = 4000
```

### Redis/SSE 事件

实时 publish 内容必须与 `stream_run_logs()` 回放的 `data:` 内容保持一致：

```json
{
  "channel": "user_input",
  "content": "Use sensible defaults and continue scan.",
  "timestamp": "2026-06-02T10:12:30.123456"
}
```

task-04 不新增 HTTP API。task-05 将对外暴露：

```http
POST /api/workspaces/{workspace_id}/agent/runs/{run_id}/input
```

并调用本任务新增的 `submit_run_input()`。

## 边界处理

- run 不存在：抛 `AgentRunNotFound`，`details` 至少包含 `run_id`。
- run 存在但未关联当前 `workspace_id`：同样抛 `AgentRunNotFound`，不要返回 “forbidden” 或暴露真实存在性。
- run 已完成、失败或 killed：抛 `AgentRunNotRunning`，`details` 包含 `run_id` 和当前 `status`。
- 输入为 `""`、全空格、换行空白：抛 `AgentRunError`，不要写 DB，也不要 publish。
- 输入超过 4000 字符：抛 `AgentRunError`，不要截断后写入，避免用户以为完整指导已提交。
- 输入包含潜在 token、PAT、密钥等敏感内容：写入前调用 `redact_agent_output()`，只保存和推送脱敏后的 `content_redacted`。
- Redis 不可用或 publish 抛异常：捕获异常并 `log.warning("agent_run_input_publish_failed", ...)`；方法仍返回已写入的 `AgentRunLog`。
- DB commit 失败：让异常向上抛出，不 publish，避免客户端看到未落库事件。
- 多次提交相同内容：每次都写一条独立 `AgentRunLog`；本任务不做幂等或去重。
- 当前实现不是交互式 stdin：该输入只是结构化日志/指导事件，不应尝试恢复、暂停或控制 Claude CLI 进程。

## 非目标

- 不新增 `POST /input` router、Pydantic request/response schema 或权限依赖；这些属于 task-05。
- 不新增数据库表、枚举迁移或 `AgentRunLog` 字段。
- 不实现真实进程级交互、stdin 注入、暂停/恢复或 resumable session 协议。
- 不修改 `ClaudeCodeAdapter`、`SpecBootstrapService`、前端 API 或 UI。
- 不更新 `.sillyspec/docs/**`；文档同步属于 task-09。

## 参考

- `.sillyspec/changes/2026-06-02-spec-bootstrap-agent-stream-interaction/design.md`
  - 决策 4：本轮最小交互落在 `AgentRunLog/SSE`。
  - 数据模型：复用 `AgentRun`、`AgentRunLog`、`AgentRunWorkspace`，新增通道约定 `user_input`。
  - API 设计：后续 `/input` 接口会提交用户指导文本。
- `.sillyspec/changes/2026-06-02-spec-bootstrap-agent-stream-interaction/plan.md`
  - Wave 2：task-04 在 `AgentService` 增加 `submit_run_input()`，task-05 增加 HTTP 端点。
- `backend/app/modules/agent/service.py`
  - `_serialize_log_event()` 定义 SSE payload 格式。
  - `get_run_logs()` 和 `stream_run_logs()` 已支持 DB 历史回放 + Redis 实时追踪。
  - `list_runs()` / `enrich_with_workspace_ids()` 展示 `AgentRunWorkspace` 关联查询方式。
- `backend/app/modules/agent/model.py`
  - `AgentRunLog.channel` 是字符串字段，无需 schema enum 迁移。
- `backend/app/core/redis.py`
  - `get_redis()` 返回全局 async Redis client。
- `.sillyspec/docs/backend/modules/agent.md`
  - 当前 Agent 模块约定：`/stream` 先回放 DB 日志，再订阅 Redis Pub/Sub。

## TDD 步骤

1. 新建 `backend/app/modules/agent/tests/test_run_input_service.py`，先写 `test_submit_run_input_persists_user_input_log`：构造 `AgentRun(status="running")` + `AgentRunWorkspace`，调用服务后断言 DB 中有 `channel="user_input"` 的日志。
2. 写 `test_submit_run_input_publishes_sse_payload`：patch `app.modules.agent.service.get_redis`，断言 `publish("agent_run:{run_id}", payload)` 被调用，payload JSON 的 `channel/content/timestamp` 与 SSE replay 格式一致。
3. 写 `test_submit_run_input_rejects_missing_run` 和 `test_submit_run_input_rejects_cross_workspace_run`：均期望 `AgentRunNotFound`。
4. 写 `test_submit_run_input_rejects_terminal_status`：对 `completed/failed/killed` 至少覆盖一个终态，期望 `AgentRunNotRunning` 且不写日志。
5. 写 `test_submit_run_input_rejects_blank_content` 和 `test_submit_run_input_rejects_too_long_content`：期望 `AgentRunError`，断言未调用 Redis。
6. 写 `test_submit_run_input_redacts_content_before_persist_and_publish`：patch 或使用真实 `redact_agent_output()` 可识别的 token 样例，断言 DB 与 publish payload 都不含原始敏感值。
7. 写 `test_submit_run_input_keeps_log_when_redis_publish_fails`：让 `publish` 抛异常，断言方法仍返回 log，DB 中日志存在。
8. 实现 `submit_run_input()`，保持改动只在 `service.py` 和新测试文件内。
9. 运行目标测试与 lint：

```bash
pytest backend/app/modules/agent/tests/test_run_input_service.py
ruff check backend/app/modules/agent/service.py backend/app/modules/agent/tests/test_run_input_service.py
```

## 验收标准

| 编号 | 标准 | 验证方式 |
|---|---|---|
| AC-01 | `AgentService.submit_run_input()` 存在，签名包含 `workspace_id`、`run_id`、`content`，返回 `AgentRunLog`。 | 单元测试 + 代码检查 |
| AC-02 | pending/running run 的有效输入会写入一条 `AgentRunLog(channel="user_input")`。 | `test_submit_run_input_persists_user_input_log` |
| AC-03 | 写入成功后发布到 `agent_run:{run_id}`，payload 与 SSE replay 的 `channel/content/timestamp` 格式一致。 | `test_submit_run_input_publishes_sse_payload` |
| AC-04 | run 不存在或不属于 workspace 时抛 `AgentRunNotFound`，且不写日志、不 publish。 | missing/cross-workspace tests |
| AC-05 | terminal run 拒绝输入并抛 `AgentRunNotRunning`。 | terminal status test |
| AC-06 | 空白或超长输入抛 `AgentRunError`，且无副作用。 | content validation tests |
| AC-07 | 内容在持久化和 publish 前经过 `redact_agent_output()` 脱敏。 | redaction test |
| AC-08 | Redis publish 失败不影响已提交 DB 日志，方法仍返回 `AgentRunLog`。 | redis failure test |
| AC-09 | 不修改 router/schema/model/adapter/docs/frontend 文件。 | `git diff --name-only` |
| AC-10 | 目标 pytest 与 ruff 通过。 | 命令输出 |
