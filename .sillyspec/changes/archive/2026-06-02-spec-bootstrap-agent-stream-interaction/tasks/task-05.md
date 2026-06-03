---
author: qinyi
created_at: 2026-06-02T10:00:08+08:00
id: task-05
title: 增加 AgentRun 用户输入 HTTP 端点和测试
priority: P0
estimated_hours: 3
depends_on: [task-04]
blocks: [task-06]
allowed_paths:
  - backend/app/modules/agent/router.py
  - backend/app/modules/agent/schema.py
  - backend/app/modules/agent/tests/test_router.py
---

# task-05: 增加 AgentRun 用户输入 HTTP 端点和测试

## 修改文件
- `backend/app/modules/agent/schema.py`
  - 新增用户输入请求 DTO 和响应 DTO。
- `backend/app/modules/agent/router.py`
  - 新增 `POST /workspaces/{workspace_id}/agent/runs/{run_id}/input`。
- `backend/app/modules/agent/tests/test_router.py`
  - 增加 HTTP 层测试，覆盖成功、鉴权、权限、归属、校验和 missing run。

## 实现要求
1. 在 `schema.py` 新增 `AgentRunInputRequest`，字段为 `content: str`，用于承载用户指导文本。
2. 在 `schema.py` 新增 `AgentRunInputResponse`，响应字段固定为 `run_id: uuid.UUID` 和 `accepted: bool`。
3. 在 `router.py` 的现有 AgentRun routes 区域新增 input endpoint，路径必须是：
   `POST /workspaces/{workspace_id}/agent/runs/{run_id}/input`。
4. 新 endpoint 必须使用 `require_permission(Permission.WORKSPACE_WRITE)`，不要沿用 create/kill/resume 的 `TASK_RUN_AGENT` 权限。
5. endpoint 只做 HTTP 层职责：解析请求、执行权限依赖、调用 task-04 提供的 `AgentService.submit_run_input(...)`、返回 DTO。
6. endpoint 必须把 `workspace_id`、`run_id`、当前 `user.id` 和已校验的 `content` 都传给 service，归属校验由 service 通过 `AgentRunWorkspace` 完成。
7. endpoint 不直接写 `AgentRunLog`，不直接 publish Redis；这些属于 task-04 的 service 层职责。
8. 测试应写在现有 `backend/app/modules/agent/tests/test_router.py` 中，复用 `_setup(...)` 创建 workspace、user、task、lease、token。
9. 成功测试要使用真实 service 行为，断言响应体，并验证 DB 中新增 `AgentRunLog(channel="user_input")`；如 task-04 的 service 会 publish Redis，测试中 patch `app.modules.agent.service.get_redis`，避免依赖真实 Redis。
10. 所有新增测试命名使用 `test_submit_agent_run_input_*` 前缀，便于目标运行。

## 接口定义

### Pydantic DTO

在 `backend/app/modules/agent/schema.py` 中新增：

```python
class AgentRunInputRequest(BaseModel):
    content: str = Field(min_length=1, max_length=4000)


class AgentRunInputResponse(BaseModel):
    run_id: uuid.UUID
    accepted: bool
```

实现时需要剔除纯空白输入。推荐在 `AgentRunInputRequest` 增加 Pydantic v2 `field_validator("content")`：

```python
@field_validator("content")
@classmethod
def _content_not_blank(cls, value: str) -> str:
    content = value.strip()
    if not content:
        raise ValueError("content must not be blank")
    return content
```

如果项目当前 Pydantic 版本或 lint 规则已经使用其它验证模式，保持本地风格，但必须满足：

- `"hello"` 保存为 `"hello"`。
- `"  hello  "` 保存为 `"hello"`。
- `""`、`"   "`、缺失 `content` 返回 422。
- 超过 4000 字符返回 422。

### HTTP endpoint

在 `backend/app/modules/agent/router.py` 中引入新 DTO：

```python
from app.modules.agent.schema import (
    AgentKillResponse,
    AgentRunCreate,
    AgentRunInputRequest,
    AgentRunInputResponse,
    AgentRunLogEntry,
    AgentRunResponse,
)
```

新增 route，建议放在 `kill_agent_run` 之后、`get_agent_run_logs` 之前：

```python
@router.post(
    "/workspaces/{workspace_id}/agent/runs/{run_id}/input",
    response_model=AgentRunInputResponse,
)
async def submit_agent_run_input(
    workspace_id: uuid.UUID,
    run_id: uuid.UUID,
    data: AgentRunInputRequest,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_WRITE))],
) -> AgentRunInputResponse:
    svc = AgentService(session)
    await svc.submit_run_input(
        workspace_id=workspace_id,
        run_id=run_id,
        user_id=user.id,
        content=data.content,
    )
    return AgentRunInputResponse(run_id=run_id, accepted=True)
```

### 依赖的 service 合同

task-05 不实现 service，但依赖 task-04 已在 `AgentService` 提供如下等价合同：

```python
async def submit_run_input(
    self,
    *,
    workspace_id: uuid.UUID,
    run_id: uuid.UUID,
    user_id: uuid.UUID,
    content: str,
) -> AgentRunLog:
    ...
```

service 必须负责：

- run 不存在时抛 `AgentRunNotFound`，HTTP 映射为 404。
- run 未关联 `workspace_id` 时抛 `AgentRunNotFound`，HTTP 映射为 404，避免泄露其它 workspace 的 run。
- 写入 `AgentRunLog(channel="user_input", content_redacted=content)`。
- 通过现有 `agent_run:{run_id}` Redis channel 推送 SSE payload。

### 请求和响应

请求：

```http
POST /api/workspaces/{workspace_id}/agent/runs/{run_id}/input
Content-Type: application/json
Authorization: Bearer <token>

{
  "content": "Use sensible defaults and continue scan."
}
```

成功响应：

```json
{
  "run_id": "00000000-0000-0000-0000-000000000000",
  "accepted": true
}
```

状态码约定：

- `200 OK`：输入已被接受并交给 service 持久化/推送。
- `401`：未登录。
- `403`：已登录但缺少 `workspace:write`。
- `404`：run 不存在，或 run 不属于当前 `workspace_id`。
- `422`：请求体缺失、`content` 为空白或超过长度限制。

## 边界处理
- `content` 缺失、类型不是字符串、空字符串、纯空白字符串都必须由请求 DTO 拒绝，返回 422，不进入 service。
- `content` 前后空白必须在 DTO 层 trim 后再传给 service，避免日志中保存无意义空白。
- `content` 最大长度为 4000 字符，和现有 `AgentRunLog.content_redacted` 的写入截断策略保持一致；超长请求直接 422，不依赖 service 静默截断。
- run id 格式非法由 FastAPI 路径参数校验返回 422，不需要手写解析。
- run 不存在时返回现有 `HTTP_404_AGENT_RUN_NOT_FOUND`，不要新增错误模型。
- run 存在但未通过 `AgentRunWorkspace` 关联到路径中的 `workspace_id` 时也返回 404，不返回 403，避免跨 workspace 枚举 run。
- 用户未登录返回 401；已登录但没有 `WORKSPACE_WRITE` 返回 403，测试要区分这两个路径。
- endpoint 必须接受 `pending`、`running`、`completed`、`failed`、`killed` 等任意 run 状态的用户指导日志；本轮只是记录指导事件，不实现进程 stdin 或暂停恢复。
- service 抛出的 `AgentRunNotFound`、`PermissionDenied`、Redis 相关 AppError 不在 router 中吞掉；交给全局 exception handler 保持统一错误格式。
- endpoint 不应修改 `AgentRun.status`、`started_at`、`finished_at`、`exit_code`、`output_redacted` 或 checkpoint 字段。
- endpoint 不应改变现有 `/stream`、`/logs`、`/kill`、`/resume`、`/approve` 路由行为和权限。

## 非目标
- 不实现 `AgentService.submit_run_input(...)` 的持久化和 SSE publish 逻辑；这属于 task-04。
- 不新增数据库表、Alembic migration 或新的 `AgentRunLog.channel` enum。
- 不实现真实进程 stdin 注入、Claude CLI 暂停/恢复、approval token 或 resumable interactive session。
- 不修改 spec bootstrap router/service 或 frontend API。
- 不改造现有 AgentRun 查询、日志、stream、kill、resume、approve endpoint 的 workspace 归属校验。
- 不更新 `.sillyspec/docs/backend/modules/agent.md`；文档同步由 task-09 统一处理。

## 参考
- `backend/app/modules/agent/router.py`
  - `kill_agent_run(...)`：写操作 route、service 调用和现有 AgentRun 错误抛出模式。
  - `get_agent_run_logs(...)`：run not found 检查和 log response 模式。
  - `stream_agent_run_logs(...)`：workspace path 下的 SSE endpoint 命名和权限风格。
- `backend/app/modules/agent/schema.py`
  - `AgentKillResponse` 和 `AgentRunLogEntry`：小型 response DTO 的本地风格。
- `backend/app/modules/agent/tests/test_router.py`
  - `_setup(...)`：创建 workspace/change/task/user/lease/token 的基础 fixture。
  - `test_stream_*`：手工创建 `AgentRun` 并验证 HTTP route 的模式。
- `.sillyspec/changes/2026-06-02-spec-bootstrap-agent-stream-interaction/design.md`
  - API 设计中明确该接口需要校验 run 属于 workspace，并要求 `WORKSPACE_WRITE`。
- `.sillyspec/docs/backend/modules/agent.md`
  - 现有 Agent 模块 route、日志、SSE 和错误处理说明。

## TDD 步骤
1. 在 `backend/app/modules/agent/tests/test_router.py` 先新增 `test_submit_agent_run_input_success`：
   - 用 `_setup(...)` 创建 refs。
   - 手工创建 `AgentRun(status="running", task_id=refs["task_id"], lease_id=refs["lease_id"], agent_type="claude_code")`。
   - 创建 `AgentRunWorkspace(agent_run_id=run.id, workspace_id=refs["ws_id"])`。
   - patch Redis 客户端，提交 `{"content": "  continue with defaults  "}`。
   - 期望 200，响应 `accepted is True`，DB 中存在 `channel == "user_input"` 且 `content_redacted == "continue with defaults"`。
2. 运行目标测试，确认因 endpoint/DTO 未实现而失败：
   `pytest backend/app/modules/agent/tests/test_router.py -k submit_agent_run_input`
3. 在 `schema.py` 增加 `AgentRunInputRequest` 和 `AgentRunInputResponse`，补齐导入所需的 Pydantic validator。
4. 在 `router.py` 增加 endpoint，调用 `AgentService.submit_run_input(...)`，使用 `Permission.WORKSPACE_WRITE`。
5. 新增并运行以下失败路径测试：
   - `test_submit_agent_run_input_no_auth_returns_401`
   - `test_submit_agent_run_input_requires_workspace_write_returns_403`
   - `test_submit_agent_run_input_missing_run_returns_404`
   - `test_submit_agent_run_input_wrong_workspace_returns_404`
   - `test_submit_agent_run_input_blank_content_returns_422`
   - `test_submit_agent_run_input_too_long_content_returns_422`
6. 重跑目标测试：
   `pytest backend/app/modules/agent/tests/test_router.py -k submit_agent_run_input`
7. 跑 agent router 回归测试：
   `pytest backend/app/modules/agent/tests/test_router.py`
8. 若本地配置要求 lint，执行项目已有后端 lint 命令；如果未配置，至少运行：
   `ruff check backend/app/modules/agent/router.py backend/app/modules/agent/schema.py backend/app/modules/agent/tests/test_router.py`

## 验收标准
| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | 打开 `backend/app/modules/agent/schema.py` | 存在 `AgentRunInputRequest` 和 `AgentRunInputResponse`，字段与接口定义一致 |
| AC-02 | POST `/api/workspaces/{ws}/agent/runs/{run}/input`，body 为 `{"content":"continue"}`，用户具备 `workspace:write`，run 关联该 workspace | 返回 200，响应为 `{"run_id": "<run>", "accepted": true}` |
| AC-03 | 查询 `agent_run_logs` | 新增一条 `run_id=<run>`、`channel="user_input"`、`content_redacted="continue"` 的记录 |
| AC-04 | 订阅/模拟 Redis publish | service 被调用后向 `agent_run:{run_id}` 发布 `user_input` SSE payload；router 不直接 publish |
| AC-05 | 不带 Authorization 调用 endpoint | 返回 401，且没有新增 `AgentRunLog` |
| AC-06 | 使用无 `workspace:write` 的非平台管理员调用 endpoint | 返回 403，且没有新增 `AgentRunLog` |
| AC-07 | 使用不存在的 `run_id` 调用 endpoint | 返回 404，错误 code 为 `HTTP_404_AGENT_RUN_NOT_FOUND` |
| AC-08 | 使用存在但未关联当前 `workspace_id` 的 `run_id` 调用 endpoint | 返回 404，避免泄露其它 workspace 的 run |
| AC-09 | body 缺少 `content`、`content=""` 或 `content="   "` | 返回 422，service 不被调用 |
| AC-10 | body 中 `content` 长度为 4001 字符 | 返回 422，service 不被调用 |
| AC-11 | body 中 `content="  use defaults  "` | 返回 200，持久化内容为 `use defaults` |
| AC-12 | 运行 `pytest backend/app/modules/agent/tests/test_router.py -k submit_agent_run_input` | 新增 input endpoint 测试全部通过 |
| AC-13 | 运行 `pytest backend/app/modules/agent/tests/test_router.py` | 现有 agent router 测试无回归 |
