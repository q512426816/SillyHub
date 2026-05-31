---
author: hermes
created_at: "2026-05-31T16:25:00Z"
---

# Task 02: 创建 AgentDispatchService

## 目标

创建 `AgentDispatchService`，负责 change transition 后的 agent 派发逻辑。

## 实现细节

1. 在 `backend/app/modules/change/dispatch.py` 中创建 `AgentDispatchService` 类

### 2.1 `get_config_for_stage(stage: str) -> StageAgentConfig | None`
- 查找 `STAGE_AGENT_CONFIG[stage]`
- 返回 None 表示该阶段不派发 agent

### 2.2 `has_active_run(session, change_id) -> bool`
- 查询 `AgentRun` 表
- 条件：`task_id` 关联的 Task 的 `change_id` == change_id（或通过新的 change_id 字段）
- `status IN ("pending", "running")`
- 返回 True 表示已有运行中的 agent

**注意**: 当前 AgentRun 没有直接的 `change_id` 字段，需要通过 `task_id → Task.change_id` 关联。如果 task_id 为 None（change-level dispatch），需要在 AgentRun 上新增 `change_id` 字段（见 task-04）。

**临时方案**: 在 change 的 stages JSON 中记录 `agent_run_id`，查 AgentRun 表确认状态。

### 2.3 `async dispatch(session, workspace_id, change_id, target_stage, user_id) -> dict`
核心派发方法:
1. 查找 `STAGE_AGENT_CONFIG[target_stage]`，没有则返回 `{"dispatched": False}`
2. 检查 change 的 `stages["agent_run_id"]`，如果有则查 AgentRun 状态
   - 如果 agent 正在运行：返回 `{"dispatched": False, "reason": "agent_already_running"}`
   - 如果 agent 失败/完成：允许重新派发
3. 记录 dispatch 信息到 change 的 stages JSON:
   ```python
   stages["last_dispatch"] = {
       "stage": target_stage,
       "dispatched_at": now_iso(),
       "status": "dispatched",
       "trigger": "auto",
   }
   ```
4. 返回 `{"dispatched": True, "stage": target_stage}`

### 2.4 集成到 ChangeService.transition()
```python
# In transition() 方法末尾，after commit:
from app.modules.change.dispatch import AgentDispatchService

dispatch_svc = AgentDispatchService()
dispatch_result = await dispatch_svc.dispatch(self._session, workspace_id, change_id, target_stage, user_id)
# dispatch_result 存到返回值中或 change 的 stages JSON
```

## 验证

- AgentDispatchService 可以正确查找配置
- 并发检查逻辑正确（同一 change 不重复派发）
- transition 后 stages JSON 包含 last_dispatch
- transition 方法修改后无回归
