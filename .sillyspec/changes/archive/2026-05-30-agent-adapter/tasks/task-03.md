---
author: qinyi
created_at: 2026-05-30T19:00:00
id: task-03
title: Kill API 端点
priority: P0
estimated_hours: 1
depends_on: [task-02]
blocks: [task-05]
allowed_paths:
  - backend/app/modules/agent/router.py
  - backend/app/modules/agent/schema.py
  - backend/app/core/errors.py
---

# task-03: Kill API 端点

## 修改文件（必填）

| # | 文件路径 | 操作 | 说明 |
|---|---|---|---|
| 1 | `backend/app/modules/agent/router.py` | 修改 | 新增 `POST /workspaces/{workspace_id}/agent/runs/{run_id}/kill` 端点 |
| 2 | `backend/app/modules/agent/schema.py` | 无变更 | `AgentKillResponse` 已存在（第 44-47 行） |
| 3 | `backend/app/core/errors.py` | 修改 | 新增 `AgentRunNotRunning` 错误类（409） |

## 实现要求

### 1. 新增 `AgentRunNotRunning` 错误类

在 `backend/app/core/errors.py` 的 Agent errors 区块（紧跟 `AgentRunNotFound` 之后）添加：

```python
class AgentRunNotRunning(AppError):
    code = "HTTP_409_AGENT_RUN_NOT_RUNNING"
    http_status = status.HTTP_409_CONFLICT
```

### 2. 新增 Kill 端点

在 `backend/app/modules/agent/router.py` 中新增端点，放置在 `get_agent_run`（单条查询）之后、`get_agent_run_logs` 之前。

## 接口定义（代码类任务必填）

### 端点签名

```python
@router.post(
    "/workspaces/{workspace_id}/agent/runs/{run_id}/kill",
    response_model=AgentKillResponse,
)
async def kill_agent_run(
    workspace_id: uuid.UUID,
    run_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.TASK_RUN_AGENT))],
) -> AgentKillResponse:
```

### 权限检查

- 使用 `Permission.TASK_RUN_AGENT`（与 create_agent_run 一致）
- 通过 `require_permission(Permission.TASK_RUN_AGENT)` 依赖注入

### 控制流伪代码

```
1. svc = AgentService(session)
2. run = await svc.get_run(run_id)
3. if run is None:
       raise AgentRunNotFound(f"Agent run '{run_id}' not found.", details={"run_id": str(run_id)})
4. if run.status not in ("pending", "running"):
       raise AgentRunNotRunning(
           f"Agent run '{run_id}' is not running (current status: {run.status}).",
           details={"run_id": str(run_id), "status": run.status},
       )
5. await svc.kill_run(run_id)  # task-02 提供的方法
6. await session.refresh(run)  # 刷新拿到 killed 状态
7. return AgentKillResponse(id=run.id, status=run.status)
```

### AgentKillResponse schema（已存在于 schema.py 第 44-47 行）

```python
class AgentKillResponse(BaseModel):
    id: uuid.UUID
    status: str
    model_config = {"from_attributes": True}
```

无需修改，直接 import 使用。

### Router import 变更

```python
# 在 router.py 顶部 import 块中添加：
from app.core.errors import AgentRunNotFound, AgentRunNotRunning
from app.modules.agent.schema import (
    AgentRunCreate,
    AgentRunLogEntry,
    AgentKillResponse,    # 新增
    AgentRunResponse,
)
```

注意：`AgentRunNotFound` 已在 import 中，只需新增 `AgentRunNotRunning`。

## 边界处理（必填）

| # | 场景 | 处理策略 |
|---|---|---|
| 1 | run_id 不存在（404） | 抛出 `AgentRunNotFound`，HTTP 404，details 包含 `run_id` |
| 2 | run 已结束（completed/failed） | 抛出 `AgentRunNotRunning`，HTTP 409，details 包含 `run_id` 和当前 `status` |
| 3 | run 状态为 `pending`（尚未开始执行） | 允许 kill，`pending` 状态的 run 也应可取消，`svc.kill_run()` 负责将状态置为 `killed` |
| 4 | run 状态已经是 `killed` | 抛出 `AgentRunNotRunning`，HTTP 409，status 不在 `("pending", "running")` 白名单中 |
| 5 | kill_run() 内部异常（如进程已自行退出） | 由 `svc.kill_run()` 内部处理，router 层不捕获；如果 `kill_run` 抛异常，由全局异常处理器兜底 |
| 6 | workspace_id 不匹配 | 不做额外校验——现有端点均不做 workspace 归属校验，run_id 是全局唯一 UUID，保持一致 |
| 7 | 并发 kill 同一 run（竞态） | `svc.kill_run()` 应为幂等操作（task-02 负责）；router 层 refresh 后 status 已为 killed，不会重复 kill |
| 8 | AgentKillResponse 的 status 字段值 | 必须为 `"killed"`，由 `svc.kill_run()` 更新 DB 后 refresh 保证 |

## 非目标（本任务不做的事）

- 不实现 `kill_run()` 方法本身（由 task-02 负责）
- 不实现进程 SIGTERM/SIGKILL 逻辑（由 task-02 负责）
- 不实现 kill 相关审计日志（可由 `svc.kill_run()` 内部处理，非 router 职责）
- 不修改前端代码（Wave 3 任务）
- 不修改 `AgentKillResponse` schema（已存在且满足需求）
- 不添加 workspace 归属校验（与现有端点保持一致）

## 参考

- 现有路由模式参考：`get_agent_run`（同路径参数模式、同 404 处理）
- 权限模式参考：`create_agent_run`（同 `TASK_RUN_AGENT` 权限）
- 错误类定义参考：`AgentRunNotFound`（`backend/app/core/errors.py` 第 119 行）
- `AgentKillResponse` 已定义：`backend/app/modules/agent/schema.py` 第 44-47 行
- `AgentRun.status` 字段支持 `"killed"` 值：`backend/app/modules/agent/model.py` 第 44-47 行

## TDD 步骤

### 步骤 1：写测试（先写）

文件：`backend/app/modules/agent/tests/test_kill.py`（由 task-05 负责，本步骤在 task-03 中写端点级单元测试）

在 `backend/app/modules/agent/tests/` 目录下新建 `test_kill_endpoint.py`：

```python
"""Tests for POST /workspaces/{workspace_id}/agent/runs/{run_id}/kill endpoint."""
import uuid
import pytest
from unittest.mock import AsyncMock, patch
from httpx import AsyncClient

# 测试用例清单：
# 1. test_kill_running_run_returns_200 — 正常 kill 一个 running run，返回 {id, status: "killed"}
# 2. test_kill_pending_run_returns_200 — kill 一个 pending run，返回 {id, status: "killed"}
# 3. test_kill_nonexistent_run_returns_404 — run_id 不存在，返回 404
# 4. test_kill_completed_run_returns_409 — run 已完成，返回 409 AgentRunNotRunning
# 5. test_kill_failed_run_returns_409 — run 已失败，返回 409
# 6. test_kill_killed_run_returns_409 — run 已被 kill，返回 409
# 7. test_kill_without_permission_returns_403 — 无 TASK_RUN_AGENT 权限
```

### 步骤 2：确认失败

运行 `pytest backend/app/modules/agent/tests/test_kill_endpoint.py`，确认测试全部失败（端点尚未注册）。

### 步骤 3：写代码

1. 在 `errors.py` 中添加 `AgentRunNotRunning`
2. 在 `router.py` 中添加 `kill_agent_run` 端点
3. 更新 import 语句

### 步骤 4：确认通过

运行 `pytest backend/app/modules/agent/tests/test_kill_endpoint.py`，确认全部通过。

### 步骤 5：回归

运行 `pytest backend/app/modules/agent/tests/`，确认现有 63 个测试无回归。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | 向 `POST /workspaces/{ws_id}/agent/runs/{run_id}/kill` 发送请求，run 状态为 `running` | 返回 HTTP 200，body 为 `{"id": "<run_id>", "status": "killed"}` |
| AC-02 | 向 kill 端点发送请求，run 状态为 `pending` | 返回 HTTP 200，body 为 `{"id": "<run_id>", "status": "killed"}` |
| AC-03 | 向 kill 端点发送请求，run_id 不存在 | 返回 HTTP 404，error code 为 `HTTP_404_AGENT_RUN_NOT_FOUND` |
| AC-04 | 向 kill 端点发送请求，run 状态为 `completed` | 返回 HTTP 409，error code 为 `HTTP_409_AGENT_RUN_NOT_RUNNING`，details 包含当前 status |
| AC-05 | 向 kill 端点发送请求，run 状态为 `failed` | 返回 HTTP 409，error code 为 `HTTP_409_AGENT_RUN_NOT_RUNNING` |
| AC-06 | 向 kill 端点发送请求，run 状态已是 `killed` | 返回 HTTP 409，error code 为 `HTTP_409_AGENT_RUN_NOT_RUNNING` |
| AC-07 | 无 `TASK_RUN_AGENT` 权限的用户调用 kill 端点 | 返回 HTTP 403 |
| AC-08 | `AgentKillResponse` schema 无变更 | 现有 `AgentKillResponse`（schema.py 第 44-47 行）直接使用，无修改 |
| AC-09 | 现有 agent 测试全部通过 | `pytest backend/app/modules/agent/tests/` — 无回归 |
| AC-10 | `AgentRunNotRunning` 错误类注册在 Agent errors 区块 | 位于 `errors.py` 中 `AgentRunNotFound` 之后，http_status=409 |
