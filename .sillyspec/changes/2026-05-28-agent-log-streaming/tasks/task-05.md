---
id: task-05
title: 后端流式日志单元测试
priority: P0
estimated_hours: 1
depends_on: [task-01, task-02]
blocks: [task-06]
allowed_paths:
  - backend/app/modules/agent/tests/test_streaming.py
---

# task-05: 后端流式日志单元测试

## 修改文件
- `backend/app/modules/agent/tests/test_streaming.py`（新增）

## 实现要求
1. 测试 _exec_stream 的 Redis publish 行为（mock Redis）
2. 测试 SSE 端点的响应格式（使用 httpx AsyncClient）
3. 测试非 running 状态立即返回 done

## 测试用例

### TestAdapterPublishesToRedis
- mock subprocess 输出 stream-json 格式的 stdout
- mock Redis client
- 验证每行 stdout 触发一次 redis.publish
- 验证消息格式包含 channel、content、timestamp
- 验证进程结束后发布 done event

### TestSSEEndpointRunning
- 创建 AgentRun 记录，status=running
- mock Redis pubsub 返回 2 条消息 + 1 条 done
- 验证 SSE 流输出 2 条 data event + 1 条 done event
- 验证 content-type 为 text/event-stream

### TestSSEEndpointCompleted
- 创建 AgentRun 记录，status=completed
- 请求 SSE 端点
- 验证立即返回 event: done

### TestSSEEndpointNotFound
- 不存在的 run_id
- 验证返回 404

## 边界处理
1. Redis 不可用：adapter 测试中 mock redis.publish 抛异常，验证不崩溃
2. SSE 端点无 Redis 消息：验证 keepalive 注释发送
3. 空输出：验证仍发送 done event
4. 使用 conftest.py 的 db_session fixture
5. SSE 测试使用 TestClient（同步 httpx）或 httpx.AsyncClient

## 非目标
- 不测前端 EventSource 行为
- 不做端到端集成测试（task-06 负责）
- 不改已有测试

## 参考
- conftest.py 中的 db_session / client fixture
- 现有 agent 测试：backend/app/modules/agent/tests/test_router.py（_setup 辅助函数创建 workspace + change + task + lease + user + token）
- design.md 中 Redis channel 命名：`agent_run:{run_id}`
- design.md 中 SSE 事件格式：`data: {"channel":"stdout","content":"...","timestamp":"..."}` / `event: done\ndata: {}` / `: keepalive`
- plan.md 中 stream_run_logs 方法签名和 SSE 端点路径：`GET /api/workspaces/{workspace_id}/agent/runs/{run_id}/stream`

## TDD 步骤
1. 先写所有测试用例（4 个测试类，含边界用例）
2. 确认失败（task-01/02 实现前）
3. task-01/02 实现后重跑
4. 确认通过
5. 回归：全量 pytest 通过

## 验收标准
| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | pytest test_streaming.py | 4 个测试类全部通过 |
| AC-02 | pytest 全量运行 | 无回归 |
| AC-03 | 测试覆盖 Redis publish | 验证 publish 调用次数、channel 名、消息格式 |
| AC-04 | 测试覆盖 SSE 格式 | 验证 data/done/keepalive 格式 |
