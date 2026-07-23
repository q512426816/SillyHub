---
id: task-11
title: gate 任务完成（gate_status→decided/failed）时发 Redis gate_status_changed SSE，复用 agent_run:{id} channel
title_zh: gate 完成的 SSE 通知
author: qinyi
created_at: 2026-07-10 14:49:30
priority: P0
depends_on: [task-07]
blocks: [task-12]
requirement_ids: [FR-9]
decision_ids: []
allowed_paths:
  - backend/app/modules/daemon/run_sync/service.py
---

# task-11 — gate 完成的 SSE 通知

## 契约

```yaml
provides:
  - contract: gate_status_changed SSE event
    fields: [agent_run_id, gate_status, errors_summary]
expects_from:
  task-07:
    - contract: _run_gate_decision_task
      needs: [gate_result, gate_status]
```

## 背景

design §5.7：gate 任务后台跑 27s+，close 的 SSE 只发 `turn_completed`（agent 完成），gate 完成无 SSE → 前端 "客观核验中" 徽标卡住。gate 决策任务存完 gate_result 后需主动发一条 `gate_status_changed` 事件，复用现有 `agent_run:{id}` channel（前端 task-12 已订阅该 channel，无需新建）。

## 实现

在 task-07 的 `_run_gate_decision_task` 末尾——**gate_result 已落库、gate_status 已置 decided/failed 之后**（含异常分支置 failed 之后），插入 publish 块，逐字对齐 `close_interactive_run:879-900` 的 try/except 容错模式：

```python
# design §5.7：gate 完成通知前端更新 gate_status 徽标（decided/failed）。
# 复用 agent_run:{id} SSE channel，对齐 close 的 status_changed publish 模式。
try:
    redis = get_redis()
    errors = (gate_result or {}).get("errors") if isinstance(gate_result, dict) else None
    errors_summary = (str(errors)[:500]) if errors else None  # 截断防超大 payload
    await redis.publish(
        f"agent_run:{agent_run.id}",
        json.dumps(
            {
                "event": "gate_status_changed",
                "agent_run_id": str(agent_run.id),
                "gate_status": agent_run.gate_status,
                "errors_summary": errors_summary,
            },
            default=str,
        ),
    )
except Exception:
    log.warning(
        "gate_status_changed_redis_publish_failed",
        agent_run_id=str(agent_run.id),
        gate_status=agent_run.gate_status,
    )
```

关键点：
- **decided 和 failed 两条路径都发**（failed 在异常分支置完 gate_status 后同样 publish）。
- **复用 `agent_run:{agent_run.id}` channel**——不新建 channel（task-12 前端订阅同 channel，按 event 字段分流）。
- **errors_summary 截断**：取 `gate_result.errors`，`str()[:500]`，None 时为 None。
- **Redis 抖动不影响已落库的 gate_result**：整个 publish 包 try/except，失败只 warning（对齐 close :895-900，gate_result 已 commit，SSE 漏发不回滚）。
- `get_redis()` 用法、`json.dumps(default=str)`、`log.warning(动作串, **ctx)` 风格全对齐 close。

## 验收

- [ ] decided 时 publish `gate_status_changed`（gate_status=decided）
- [ ] failed 时同样 publish（gate_status=failed）
- [ ] errors_summary 截断（gate_result.errors 超 500 字符截断）
- [ ] Redis publish 失败不抛（try/except 兜底，只 warning，gate_result 已落库不受影响）
- [ ] 复用 `agent_run:{id}` channel（无新 channel）

## verify

```bash
cd backend && uv run pytest -k gate_status_changed && uv run ruff check && uv run mypy app
```

## constraints

- 复用 `agent_run:{id}` SSE channel（不新建；前端按 event 字段分流）
- try/except 容错（逐字对齐 `close_interactive_run:879-900`，Redis 抖动不影响已 commit 的 gate_result）
- errors 截断（防超大 payload，硬上限 500 字符）
