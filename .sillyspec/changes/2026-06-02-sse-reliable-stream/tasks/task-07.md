---
id: task-07
title: "后端单测 — `after` 过滤 + `log_id` 字段"
priority: P0
estimated_hours: 1
depends_on: [task-03]
blocks: []
allowed_paths:
  - backend/app/modules/agent/tests/test_router.py
---

# task-07: 后端单测 — `after` 过滤 + `log_id` 字段

## 修改文件
- `backend/app/modules/agent/tests/test_router.py` — 新增 SSE stream 测试用例

## 实现要求
1. 测试 `GET /stream?after=N` 只返回 seq > N 的日志（N 为整数）
2. 测试 `GET /stream`（无 after）返回全部日志
3. 测试 SSE 事件 JSON 包含 `log_id` 字段
4. 测试 `_serialize_log_event` 输出含 log_id
5. 测试 `GET /stream?after=abc` 返回 422

## 重要说明：AgentRunLog.id 是 UUID

当前 `AgentRunLog.id` 是 UUID 主键，不是自增整数。task-01/02/03 实现后：
- `AgentRunLog` 可能新增 `seq: int` 自增字段作为 `after` 参数的过滤依据
- 或者采用其他方案（如基于 timestamp 的过滤）
- `log_id` 字段在 SSE 事件中可能是 `entry.id`（UUID 字符串）或 `entry.seq`（整数）

**本测试文件必须等 task-01/02/03 实现后再执行。** 测试用例的编写基于 design.md
定义的接口契约，而非当前的数据库模型。测试可能需要根据最终实现微调字段名。

## 接口定义

### 测试用例清单

```python
# -- _serialize_log_event 单元测试（直接调用函数）--

def test_serialize_log_event_contains_log_id():
    """_serialize_log_event 输出包含 log_id 字段"""
    # 构造 mock AgentRunLog entry
    # 调用 _serialize_log_event(entry)
    # 解析 JSON，断言有 "log_id" key
    # 断言 log_id 等于 entry.id（UUID 或整数，取决于实现）


# -- HTTP 端点测试（通过 client 发请求）--

async def test_stream_with_after_param(client, db_session, tmp_path):
    """GET /stream?after=3 只返回 seq > 3 的日志"""
    # 前置：创建 completed 状态的 AgentRun（不需要 Redis pubsub）
    # 创建 5 条 AgentRunLog（seq=1..5，或用 timestamp 排序保证顺序）
    # GET /stream?after=3
    # 解析 SSE data 事件，断言只返回 seq > 3 的日志（2 条）


async def test_stream_without_after_param(client, db_session, tmp_path):
    """GET /stream 无 after 参数返回全部日志"""
    # 创建 completed AgentRun + 3 条 AgentRunLog
    # GET /stream（不传 after）
    # 断言返回全部 3 条日志


async def test_stream_event_contains_log_id(client, db_session, tmp_path):
    """SSE 事件 JSON 包含 log_id 字段"""
    # 创建 completed AgentRun + 1 条 AgentRunLog
    # GET /stream
    # 解析 SSE data: JSON，断言每条都包含 "log_id" key


async def test_stream_after_invalid_value(client, db_session, tmp_path):
    """GET /stream?after=abc 返回 422"""
    # GET /stream?after=abc
    # 断言 422


async def test_stream_after_zero_returns_all(client, db_session, tmp_path):
    """GET /stream?after=0 等价于返回全部日志"""
    # 创建 completed AgentRun + 3 条 AgentRunLog
    # GET /stream?after=0
    # 断言返回全部 3 条


async def test_stream_after_exceeds_max_returns_empty(client, db_session, tmp_path):
    """GET /stream?after=999999 返回 0 条 data 事件（只有 done）"""
    # 创建 completed AgentRun + 2 条 AgentRunLog
    # GET /stream?after=999999
    # 断言只有 event: done，无 data: 事件
```

## 辅助函数

为避免重复代码，提取辅助函数：

```python
def _parse_sse_data_events(text: str) -> list[dict]:
    """解析 SSE 文本中的 data: JSON 事件，返回 dict 列表。"""
    events = []
    for line in text.split("\n"):
        if line.startswith("data: ") and line != "data: {}":
            events.append(json.loads(line.removeprefix("data: ")))
    return events


async def _create_completed_run_with_logs(
    db_session, refs, log_count: int
) -> uuid.UUID:
    """创建 completed 状态的 AgentRun 和指定数量的 AgentRunLog。

    返回 run_id。每条 log 的 content_redacted 为 "line {i}"。
    """
    from app.modules.agent.model import AgentRun, AgentRunLog

    run_id = uuid.uuid4()
    run = AgentRun(
        id=run_id,
        task_id=refs["task_id"],
        lease_id=refs["lease_id"],
        agent_type="claude_code",
        status="completed",
        started_at=datetime.utcnow(),
        finished_at=datetime.utcnow(),
        exit_code=0,
        output_redacted="ok",
    )
    db_session.add(run)

    for i in range(log_count):
        log_entry = AgentRunLog(
            id=uuid.uuid4(),
            run_id=run_id,
            timestamp=datetime.utcnow() + timedelta(milliseconds=i),  # 保证顺序
            channel="stdout",
            content_redacted=f"line {i}",
        )
        db_session.add(log_entry)

    await db_session.commit()
    return run_id
```

## 边界处理
- `after=0` 等价于返回全部
- `after` 大于最大值返回空
- SSE 格式解析要处理 `data: ` 前缀和 `\n\n` 后缀
- `event: done` 事件中 `data: {}` 不应被当作日志事件解析
- completed 状态的 run 不走 Redis pubsub 路径，直接 replay DB 日志 + done

## 非目标
- 不测试 Redis Pub/Sub（集成测试范畴）
- 不测试前端逻辑
- 不修改被测代码
- 不创建 `test_service.py`（现有测试在 `test_router.py` 中同时覆盖 service 层）

## 参考
- 现有测试文件 `backend/app/modules/agent/tests/test_router.py`
- 现有测试风格使用 pytest + httpx async client
- 现有 `_setup` 辅助函数创建完整的 workspace/change/task/user/lease/token
- 现有 SSE 测试：`test_stream_completed_run_returns_done` 作为 completed run stream 的模板
- `_serialize_log_event` 在 `service.py:65`，可直接导入测试
- `AgentRunLog` 模型 id 为 UUID（`model.py:154`）

## TDD 步骤
1. 写全部测试用例
2. 确认失败（after 功能未实现，log_id 字段不存在）
3. 等待 task-01/02/03 实现
4. 确认通过
5. 回归：运行完整测试套件，确认无破坏

## 验收标准
| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | `test_serialize_log_event_contains_log_id` | JSON 输出包含 log_id |
| AC-02 | `test_stream_with_after_param` | 只返回 seq > after 的日志 |
| AC-03 | `test_stream_without_after_param` | 返回全部日志 |
| AC-04 | `test_stream_event_contains_log_id` | SSE JSON 含 log_id |
| AC-05 | `test_stream_after_invalid_value` | 返回 422 |
| AC-06 | `test_stream_after_zero_returns_all` | after=0 返回全部 |
| AC-07 | `test_stream_after_exceeds_max_returns_empty` | after 过大返回 0 条 data 事件 |
| AC-08 | `pytest backend/app/modules/agent/tests/test_router.py` | 全部通过，0 failures |
