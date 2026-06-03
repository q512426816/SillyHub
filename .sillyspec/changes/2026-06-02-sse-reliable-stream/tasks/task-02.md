---
author: qinyi
created_at: 2026-06-02T16:21:37
id: task-02
title: 后端 `get_run_logs` 增加 `after` 参数过滤
priority: P0
estimated_hours: 0.5
depends_on: []
blocks: [task-03, task-07]
allowed_paths:
  - backend/app/modules/agent/service.py
---

# task-02: 后端 `get_run_logs` 增加 `after` 参数过滤

## 修改文件
- `backend/app/modules/agent/service.py` -- `get_run_logs()` 方法

## 实现要求
1. `get_run_logs` 增加 `after: str | None = None` 参数（UUID 字符串）
2. 当 `after` 不为 None 时，通过子查询找到该 log 的 timestamp，返回 timestamp 在该 log 之后的记录
3. 排序保持 `ORDER BY timestamp, id`

## 接口定义
```python
async def get_run_logs(
    self, run_id: uuid.UUID, *, after: str | None = None
) -> list[AgentRunLog]:
    stmt = (
        select(AgentRunLog)
        .where(col(AgentRunLog.run_id) == run_id)
        .order_by(col(AgentRunLog.timestamp), col(AgentRunLog.id))
    )
    if after is not None:
        try:
            after_uuid = uuid.UUID(after)
            # 找到 after log 的 timestamp，返回之后的记录
            after_log = await self._session.get(AgentRunLog, after_uuid)
            if after_log:
                stmt = stmt.where(col(AgentRunLog.timestamp) > after_log.timestamp)
        except (ValueError, AttributeError):
            pass  # 无效 UUID，忽略过滤
    return list((await self._session.execute(stmt)).scalars().all())
```

## 边界处理
- `after=None`：不添加 WHERE 条件，行为与当前完全一致
- `after` 为无效 UUID 字符串：忽略过滤，返回全部日志
- `after` 对应的 log 不存在：忽略过滤，返回全部日志
- `after` 指向最后一条 log：返回空列表
- 不修改 AgentRunLog 模型或数据库

## 非目标
- 不修改 `/logs` HTTP 端点（由 task-03 处理 router 层）
- 不修改 SSE stream 逻辑
- 不添加分页参数

## 参考
- 当前 `get_run_logs` 在 `service.py:390`
- AgentRunLog.id 是 UUID（非自增整数），`after` 参数为 UUID 字符串

## TDD 步骤
1. 写测试：传入 `after=<uuid>`，验证返回结果只包含该 log 之后的记录
2. 确认失败
3. 修改 `get_run_logs` 增加 after 过滤
4. 确认通过
5. 回归：`after=None` 时返回全部日志

## 验收标准
| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | `get_run_logs(run_id, after=uuid_str)` | 只返回该 log 之后的日志 |
| AC-02 | `get_run_logs(run_id, after=None)` | 返回全部日志，行为不变 |
| AC-03 | `get_run_logs(run_id, after="invalid")` | 忽略过滤，返回全部日志 |
| AC-04 | 结果排序 | 按 timestamp, id 排序 |
