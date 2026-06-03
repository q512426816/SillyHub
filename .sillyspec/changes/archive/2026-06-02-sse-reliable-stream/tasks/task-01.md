---
author: qinyi
created_at: 2026-06-02T16:21:37
id: task-01
title: 后端 `_serialize_log_event` 增加 `log_id` 字段
priority: P0
estimated_hours: 0.5
depends_on: []
blocks: [task-04, task-07]
allowed_paths:
  - backend/app/modules/agent/service.py
---

# task-01: 后端 `_serialize_log_event` 增加 `log_id` 字段

## 修改文件
- `backend/app/modules/agent/service.py` — `_serialize_log_event()` 函数（约第 65 行）

## 实现要求
1. 在 `_serialize_log_event` 的 payload dict 中增加 `"log_id": entry.id` 字段

## 接口定义
```python
def _serialize_log_event(entry: AgentRunLog) -> str:
    payload = {
        "channel": entry.channel,
        "content": entry.content_redacted or "",
        "timestamp": entry.timestamp.isoformat(),
        "log_id": entry.id,  # 新增
    }
    return json.dumps(payload, ensure_ascii=False)
```

## 边界处理
- `entry.id` 为 None（新创建尚未 flush）：log_id 为 None，前端忽略即可
- AgentRunLog.id 是 UUID，序列化为字符串
- 不改变 Redis Pub/Sub 的消息格式（它直接传 JSON 字符串，也包含 log_id）
- 旧前端不识别 log_id 字段会忽略，向后兼容
- 不修改 entry 对象本身

## 非目标
- 不修改 Redis Pub/Sub channel 名或订阅逻辑
- 不修改 `_publish_log_event` 函数
- 不修改 `AgentRunLog` 模型

## 参考
- 当前 `_serialize_log_event` 在 `service.py:65`

## TDD 步骤
1. 写测试：调用 `_serialize_log_event` 并检查 JSON 输出包含 `log_id`
2. 确认失败
3. 修改 `_serialize_log_event` 增加 `log_id`
4. 确认通过
5. 回归：确认现有 SSE 流正常

## 验收标准
| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | 调用 `_serialize_log_event(mock_entry)` | 返回 JSON 包含 `"log_id": <entry.id>` |
| AC-02 | `log_id` 为 None 时 | JSON 中 `"log_id": null`，不崩溃 |
| AC-03 | 现有 SSE stream 行为 | 不传 `after` 时日志流格式向后兼容 |
