---
author: qinyi
created_at: 2026-06-02T16:21:37
id: task-03
title: "后端 `stream_run_logs` 增加 `after` 参数 + router 透传"
priority: P0
estimated_hours: 1
depends_on: [task-01, task-02]
blocks: [task-07, task-09]
allowed_paths:
  - backend/app/modules/agent/service.py
  - backend/app/modules/agent/router.py
---

# task-03: 后端 `stream_run_logs` 增加 `after` 参数 + router 透传

## 修改文件

- `backend/app/modules/agent/service.py` — `stream_run_logs()` 方法（约第 504 行）
- `backend/app/modules/agent/router.py` — `stream_agent_run_logs()` 端点（约第 159 行）

## 实现要求

1. `stream_run_logs` 增加 `after: str | None = None` 参数（UUID 字符串）
2. DB replay 阶段调用 `self.get_run_logs(run_id, after=after)` 替代原来无参数的调用
3. router 端点解析 `after` query parameter（可选，字符串）并透传

**重要**：`AgentRunLog.id` 是 UUID 而非自增整数。`after` 参数类型为 `str | None`，接收 UUID 字符串。

## 接口定义

### router.py

```python
from fastapi import Query

@router.get("/workspaces/{workspace_id}/agent/runs/{run_id}/stream")
async def stream_agent_run_logs(
    workspace_id: uuid.UUID,
    run_id: uuid.UUID,
    after: str | None = Query(None, description="Resume from log id (UUID)"),
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.TASK_READ))],
) -> StreamingResponse:
    svc = AgentService(session)
    run = await svc.get_run(run_id)
    if run is None:
        raise AgentRunNotFound(
            f"Agent run '{run_id}' not found.",
            details={"run_id": str(run_id)},
        )
    return StreamingResponse(
        svc.stream_run_logs(run_id, follow=run.status in ("pending", "running"), after=after),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
    )
```

### service.py — stream_run_logs

```python
async def stream_run_logs(
    self,
    run_id: uuid.UUID,
    *,
    follow: bool = True,
    after: str | None = None,
) -> AsyncGenerator[str, None]:
    # ... 原有逻辑 ...
    # 变更点：将 get_run_logs 调用改为传 after 参数
    for entry in await self.get_run_logs(run_id, after=after):
        yield f"data: {_serialize_log_event(entry)}\n\n"
    # ... 后续 Redis follow 逻辑不变 ...
```

## 边界处理

- `after=None`：不传时 `get_run_logs` 返回全部日志，行为与当前完全一致
- `after` 为非法 UUID 字符串：`get_run_logs` 内部校验并忽略（返回全部），不抛异常
- `after` 指向的 log_id 不存在：`get_run_logs` 忽略过滤返回全部
- Redis Pub/Sub 阶段不受 `after` 参数影响（只订阅新消息）
- 不修改 `_serialize_log_event`（task-01 已负责添加 `log_id`）

## 非目标

- 不修改 `/logs` HTTP 端点（只需 `/stream` 支持 after）
- 不修改 Redis Pub/Sub 逻辑
- 不添加分页到 SSE stream
- 不修改 AgentRunLog 模型

## 参考

- `stream_run_logs` 在 `service.py:504`
- `stream_agent_run_logs` 在 `router.py:159`
- `AgentRunLog.id` 类型为 UUID（`model.py:154`）

## TDD 步骤

1. 写测试：`GET /stream?after=<uuid>` 验证 DB replay 阶段只返回 timestamp 在该 log 之后的日志
2. 确认失败
3. 修改 router 增加 `after` 参数解析
4. 修改 `stream_run_logs` 透传 `after` 到 `get_run_logs`
5. 确认通过
6. 回归：不传 `after` 时行为不变

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | `GET /stream?after=<uuid>` | SSE replay 只包含该 log 之后的日志 |
| AC-02 | `GET /stream`（无 after） | 返回全部日志，行为不变 |
| AC-03 | `GET /stream?after=invalid` | 不崩溃，返回全部日志 |
| AC-04 | SSE 事件包含 `log_id` 字段 | 每个 data 事件 JSON 有 log_id（UUID 字符串） |
| AC-05 | Redis follow 阶段 | 不受 after 参数影响，正常订阅新消息 |
