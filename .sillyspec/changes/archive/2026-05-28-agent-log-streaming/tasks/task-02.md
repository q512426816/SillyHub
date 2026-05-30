---
id: task-02
title: SSE 端点 + Redis subscribe 服务方法
priority: P0
estimated_hours: 2
depends_on: []
blocks: [task-04, task-05]
allowed_paths:
  - backend/app/modules/agent/router.py
  - backend/app/modules/agent/service.py
---

# task-02: SSE 端点 + Redis subscribe 服务方法

## 修改文件
- `backend/app/modules/agent/service.py`
- `backend/app/modules/agent/router.py`

## 实现要求
1. service.py 新增 `stream_run_logs(run_id)` 异步生成器方法
2. router.py 新增 `GET /workspaces/{workspace_id}/agent/runs/{run_id}/stream` SSE 端点
3. SSE 端点使用 FastAPI StreamingResponse(media_type="text/event-stream")

## 接口定义

### service.py 新增方法
```python
async def stream_run_logs(self, run_id: uuid.UUID) -> AsyncGenerator[str, None]:
    """Yield SSE formatted events from Redis Pub/Sub for a given run."""
    redis = get_redis()
    pubsub = redis.pubsub()
    channel = f"agent_run:{run_id}"
    await pubsub.subscribe(channel)
    try:
        # 30-second keepalive
        while True:
            message = await asyncio.wait_for(pubsub.get_message(timeout=25), timeout=30)
            if message and message["type"] == "message":
                data = message["data"]
                payload = json.loads(data)
                if payload.get("event") == "done":
                    yield "event: done\ndata: {}\n\n"
                    break
                yield f"data: {data}\n\n"
            else:
                yield ": keepalive\n\n"
    finally:
        await pubsub.unsubscribe(channel)
        await pubsub.close()
```

### router.py 新增端点
```python
@router.get("/workspaces/{workspace_id}/agent/runs/{run_id}/stream")
async def stream_agent_run_logs(
    workspace_id: uuid.UUID,
    run_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.TASK_READ))],
):
    svc = AgentService(session)
    run = await svc.get_run(run_id)
    if run is None:
        raise AgentRunNotFound(...)
    # If not running, immediately send done
    if run.status not in ("pending", "running"):
        return StreamingResponse(iter(["event: done\ndata: {}\n\n"]), media_type="text/event-stream")
    return StreamingResponse(svc.stream_run_logs(run_id), media_type="text/event-stream")
```

## 边界处理
1. Agent 不在 running 状态：立即返回 done event，不订阅 Redis
2. Agent 不存在：抛出 AgentRunNotFound（与现有端点一致）
3. Redis 连接失败：SSE 流发送 error event 后关闭
4. 客户端断连：pubsub.close() 清理资源
5. pubsub.get_message 超时：发送 keepalive 注释防止连接超时
6. 权限校验：与现有 /logs 端点一致，使用 Permission.TASK_READ

## 非目标
- 不做历史消息回放
- 不做 Redis Streams 消费者组
- 不改现有 /logs 端点
- 不做 WebSocket

## 参考
- 现有 get_agent_run_logs 端点（router.py:70-88）
- FastAPI StreamingResponse 文档
- Redis async PubSub API

## TDD 步骤
1. 写测试：mock Redis pubsub，验证 SSE 输出格式
2. 确认失败
3. 实现 stream_run_logs + 路由
4. 确认通过
5. 回归：现有 /logs 端点测试不受影响

## 验收标准
| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | 连接 running 状态的 run | SSE 流输出 data event，格式为 `data: {...}\n\n` |
| AC-02 | 收到 done 消息 | SSE 流发送 `event: done\ndata: {}\n\n` 后关闭 |
| AC-03 | 连接 completed 状态的 run | 立即返回 `event: done` |
| AC-04 | 30 秒无消息 | 发送 `: keepalive\n\n` |
| AC-05 | run 不存在 | 返回 404 AgentRunNotFound |
| AC-06 | 无 TASK_READ 权限 | 返回 403 |
