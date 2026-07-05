---
author: qinyi
created_at: 2026-06-01 19:30:00
---

# task-10: 实现 step 完成后自动调度下一个 AgentRun

- **priority**: P0
- **estimated_hours**: 3
- **depends_on**: [task-09]
- **blocks**: [task-13, task-20]
- **allowed_paths**:
  - backend/app/modules/change/dispatch.py
  - backend/app/modules/agent/service.py

## 修改文件

- `backend/app/modules/change/dispatch.py` — 新增 `auto_dispatch_next_step()` 函数 + `_DISPATCH_CHAIN_LIMIT` 常量 + `_dispatch_chain_counter` 追踪
- `backend/app/modules/agent/service.py` — 修改 `_execute_stage_run()` 完成回调，在 AgentRun 完成后调用 `sync_stage_status()` + 自动调度逻辑

## 实现要求

根据 design.md Phase 4 "sync_stage_status 逻辑" + "AgentRun 完成后自动调度下一 step"：

1. 在 `dispatch.py` 中新增 `auto_dispatch_next_step()` 函数，接收 `StageSyncResult`，根据其返回结果决定是否自动调度
2. 在 `sync_stage_status()` 返回后，检查 `StageSyncResult.has_pending_step`：
   - `has_pending_step=True` → 自动调用 `dispatch_next_step()` 创建下一个 AgentRun
   - `stage_completed=True` → 记录 info 日志，不自动流转（等待人工确认或配置自动流转）
3. 在 `_execute_stage_run()` 完成回调的末尾（审计日志写入后、commit 前），调用 `sync_stage_status()` + `auto_dispatch_next_step()`
4. 防止无限循环：通过 `Change.stages` JSON 中的 `_dispatch_chain_count` 字段追踪连续 auto-dispatch 次数，上限为 10 次

## 接口定义

### 数据结构

```python
# dispatch.py 中新增（task-09 定义 StageSyncResult，这里列出 task-10 依赖的字段）
# StageSyncResult 由 task-09 实现，task-10 仅消费
@dataclass
class StageSyncResult:
    synced: bool                    # 同步是否成功
    stage: str | None               # 当前 stage
    has_pending_step: bool          # 当前 stage 是否还有 pending step
    stage_completed: bool           # 当前 stage 是否已完成
    pending_step_name: str | None   # 下一个 pending step 名称
    steps_snapshot: dict            # 步骤状态快照
    change_stage_updated: bool      # Change.current_stage 是否被更新
    error: str | None = None        # 错误信息（synced=False 时）

# task-10 新增常量
_DISPATCH_CHAIN_LIMIT: int = 10
```

### auto_dispatch_next_step 函数

```python
async def auto_dispatch_next_step(
    session: AsyncSession,
    workspace_id: UUID,
    change_id: UUID,
    user_id: UUID,
    sync_result: StageSyncResult,
) -> dict[str, Any]:
    """根据 sync_stage_status 的结果决定是否自动调度下一个 AgentRun。

    在 sync_stage_status 返回后调用。核心调度链路的"决策点"。

    Args:
        session: 数据库会话
        workspace_id: 工作区 ID
        change_id: 变更 ID
        user_id: 触发用户 ID（通常为上一个 AgentRun 的触发者）
        sync_result: sync_stage_status() 的返回结果

    Returns:
        dispatch 结果字典，格式同 dispatch() 函数：
        - {"dispatched": True, "agent_run_id": ..., "stage": ..., "reason": "auto_dispatch"}
        - {"dispatched": False, "reason": "no_pending_step"}
        - {"dispatched": False, "reason": "stage_completed"}
        - {"dispatched": False, "reason": "sync_failed"}
        - {"dispatched": False, "reason": "chain_limit_reached"}
    """
    # 控制流伪代码：
    # 1. sync_result.synced == False → 返回 {"dispatched": False, "reason": "sync_failed"}
    # 2. sync_result.stage_completed == True → 记录 info 日志，返回 {"dispatched": False, "reason": "stage_completed"}
    # 3. sync_result.has_pending_step == False → 记录 info 日志，返回 {"dispatched": False, "reason": "no_pending_step"}
    # 4. 检查 dispatch chain 计数：
    #    - 从 Change.stages.get("_dispatch_chain_count", 0) 读取
    #    - 如果 >= _DISPATCH_CHAIN_LIMIT → 记录 warning，返回 {"dispatched": False, "reason": "chain_limit_reached"}
    # 5. chain_count += 1，写回 Change.stages["_dispatch_chain_count"]
    # 6. 调用 dispatch(session, workspace_id, change_id, sync_result.stage, user_id)
    # 7. 如果 dispatch 返回 dispatched=True，在返回结果中追加 "reason": "auto_dispatch"
    # 8. 如果 dispatch 返回 dispatched=False，重置 chain_count（dispatch 失败说明可能需要人工干预）
    # 9. 返回 dispatch 结果
```

### _execute_stage_run 完成回调修改

```python
# service.py _execute_stage_run() 方法末尾（当前第 762-780 行之后，await session.commit() 之前）
# 新增自动调度链路

# 位置：在 "Update change.stages.last_dispatch with final status" 代码块之后

# -- 8. Sync stage status + auto dispatch next step -------------------------
if run.status == "completed":
    try:
        from app.modules.change.dispatch import auto_dispatch_next_step
        from app.modules.change.dispatch import sync_stage_status  # task-09 实现

        sync_result = await sync_stage_status(
            session=session,
            change_id=change_id,
            run_id=run_id,
        )
        log.info(
            "stage_sync_completed",
            run_id=str(run_id),
            change_id=str(change_id),
            synced=sync_result.synced,
            has_pending_step=sync_result.has_pending_step,
            stage_completed=sync_result.stage_completed,
        )

        if sync_result.synced and sync_result.has_pending_step:
            auto_result = await auto_dispatch_next_step(
                session=session,
                workspace_id=workspace_id,
                change_id=change_id,
                user_id=user_id,
                sync_result=sync_result,
            )
            log.info(
                "auto_dispatch_result",
                run_id=str(run_id),
                change_id=str(change_id),
                dispatched=auto_result.get("dispatched"),
                reason=auto_result.get("reason"),
            )
    except Exception as exc:
        # 自动调度失败不应影响主流程（AgentRun 已完成）
        log.warning(
            "auto_dispatch_failed",
            run_id=str(run_id),
            change_id=str(change_id),
            error=str(exc),
        )
```

### Dispatch Chain Counter 管理

```python
# dispatch.py 辅助函数

def _get_chain_count(stages: dict) -> int:
    """从 Change.stages JSON 中读取连续 auto-dispatch 计数。"""
    return stages.get("_dispatch_chain_count", 0)


def _increment_chain_count(stages: dict) -> dict:
    """递增连续 auto-dispatch 计数，返回更新后的 stages dict。"""
    stages["_dispatch_chain_count"] = _get_chain_count(stages) + 1
    return stages


def _reset_chain_count(stages: dict) -> dict:
    """重置连续 auto-dispatch 计数为 0。"""
    stages["_dispatch_chain_count"] = 0
    return stages
```

### 控制流伪代码（完整链路）

```
AgentRun 执行完成（exit_code == 0）
    |
    v
_execute_stage_run:
    ├─ 更新 run.status = "completed"
    ├─ 收集 diff
    ├─ 写日志
    ├─ 写审计日志
    ├─ 更新 change.stages.last_dispatch
    │
    ├─ if run.status == "completed":
    │   ├─ sync_stage_status(session, change_id, run_id)
    │   │   ├─ 读取 sillyspec.db
    │   │   ├─ 更新 Change.current_stage
    │   │   ├─ 更新 Change.stages 步骤状态
    │   │   └─ 返回 StageSyncResult
    │   │
    │   └─ if sync_result.synced and sync_result.has_pending_step:
    │       └─ auto_dispatch_next_step(session, ws_id, change_id, user_id, sync_result)
    │           ├─ synced=False? → 停止，返回
    │           ├─ stage_completed=True? → 停止，记录日志
    │           ├─ has_pending_step=False? → 停止，记录日志
    │           ├─ chain_count >= 10? → 停止，记录 warning
    │           ├─ chain_count += 1
    │           └─ dispatch(session, ws_id, change_id, stage, user_id)
    │               ├─ dispatched=True → 返回 {"dispatched": True, "reason": "auto_dispatch"}
    │               └─ dispatched=False → 重置 chain_count，返回
    │
    └─ session.commit()

如果 run.status != "completed"（即 failed/killed）:
    └─ 不触发 auto_dispatch（跳过整个同步调度块）
```

## 边界处理

1. **连续 auto-dispatch 超过 10 次**：从 `Change.stages["_dispatch_chain_count"]` 读取计数，若 >= 10 则记录 `log.warning("dispatch_chain_limit_reached", ...)` 并返回 `{"dispatched": False, "reason": "chain_limit_reached"}`，不创建新 AgentRun
2. **dispatch() 返回 dispatched=False（如阶段未配置、active_run_exists）**：调用 `_reset_chain_count()` 重置计数，记录 info 日志，停止自动调度
3. **sync_stage_status 返回 synced=False**（sillyspec.db 不存在或读取失败）：不触发 auto_dispatch，记录 warning 日志，返回 `{"dispatched": False, "reason": "sync_failed"}`
4. **并发完成回调（多个 AgentRun 同时完成同一 change）**：依赖 `has_active_run()` 的幂等性检查（dispatch.py 第 104-111 行），第二个并发 dispatch 会因 "active_run_exists" 被拒绝，不会创建重复 AgentRun
5. **stage_completed 但 Change.status 未变更**：只记录 info 日志（`"stage_completed_no_transition", change_id=..., stage=...`），不修改 Change.status，不创建新 AgentRun
6. **auto_dispatch_next_step 内部异常**：在 `_execute_stage_run` 中用 try/except 包裹整个同步调度块，异常只记录 warning 不影响 AgentRun 的完成状态
7. **run.status != "completed"（failed/killed）**：不触发 auto_dispatch，跳过 sync_stage_status 调用

## 非目标

- 不实现 stage 完成后自动流转到下一 stage（需人工确认或配置自动流转）
- 不修改 SillySpec CLI 的步骤定义
- 不修改 `sync_stage_status()` 的实现（由 task-09 负责）
- 不修改 `dispatch()` 函数的核心逻辑（仅消费其返回值）
- 不实现跨 stage 的 dispatch chain 计数（chain_count 在 stage 切换时由 dispatch() 的 last_dispatch 更新隐式重置）

## 参考

- design.md Phase 4 "sync_stage_status 逻辑" + "AgentRun 完成后自动调度下一 step"
- requirements.md FR-06: 状态同步 — "如果当前 stage 还有 pending step，自动创建下一个 AgentRun；如果 stage completed，不重复 dispatch"
- dispatch.py 现有 `dispatch()` 函数（第 114-192 行）
- dispatch.py 现有 `has_active_run()` 函数（第 104-111 行）
- service.py 现有 `_execute_stage_run()` 方法（第 650-780 行）

## TDD 步骤

1. **写测试**：验证 auto_dispatch_next_step 在 has_pending_step=True 时调用 dispatch
2. **确认失败**：运行测试，确认当前代码无此逻辑
3. **实现 auto_dispatch_next_step**：在 dispatch.py 中新增函数
4. **实现完成回调**：修改 _execute_stage_run 末尾
5. **确认通过**：运行测试，全部通过
6. **验证上限**：连续 dispatch 10 次后第 11 次被拒绝
7. **验证停止条件**：stage_completed / sync_failed / dispatched=False 均停止

### 测试用例设计

```
test_auto_dispatch_creates_next_run:
  """has_pending_step=True 时自动创建下一个 AgentRun"""
  sync_result = StageSyncResult(synced=True, has_pending_step=True, stage_completed=False, stage="propose", ...)
  result = await auto_dispatch_next_step(session, ws_id, change_id, user_id, sync_result)
  assert result["dispatched"] == True
  assert result["reason"] == "auto_dispatch"

test_auto_dispatch_stops_on_stage_completed:
  """stage_completed=True 时不自动调度"""
  sync_result = StageSyncResult(synced=True, has_pending_step=False, stage_completed=True, stage="propose", ...)
  result = await auto_dispatch_next_step(session, ws_id, change_id, user_id, sync_result)
  assert result["dispatched"] == False
  assert result["reason"] == "stage_completed"

test_auto_dispatch_stops_on_sync_failed:
  """synced=False 时不触发自动调度"""
  sync_result = StageSyncResult(synced=False, has_pending_step=True, stage_completed=False, ...)
  result = await auto_dispatch_next_step(session, ws_id, change_id, user_id, sync_result)
  assert result["dispatched"] == False
  assert result["reason"] == "sync_failed"

test_auto_dispatch_stops_on_chain_limit:
  """连续 dispatch 超过 10 次后停止"""
  # 设置 change.stages["_dispatch_chain_count"] = 10
  sync_result = StageSyncResult(synced=True, has_pending_step=True, stage_completed=False, stage="propose", ...)
  result = await auto_dispatch_next_step(session, ws_id, change_id, user_id, sync_result)
  assert result["dispatched"] == False
  assert result["reason"] == "chain_limit_reached"

test_auto_dispatch_resets_chain_on_dispatch_failure:
  """dispatch() 返回 dispatched=False 时重置 chain_count"""
  # 设置 change.stages["_dispatch_chain_count"] = 5
  # mock dispatch() 返回 {"dispatched": False, "reason": "active_run_exists"}
  sync_result = StageSyncResult(synced=True, has_pending_step=True, stage_completed=False, stage="propose", ...)
  result = await auto_dispatch_next_step(session, ws_id, change_id, user_id, sync_result)
  assert result["dispatched"] == False
  # 验证 change.stages["_dispatch_chain_count"] == 0

test_execute_stage_run_calls_auto_dispatch_on_success:
  """_execute_stage_run 完成后触发 sync + auto dispatch"""
  # mock sync_stage_status 返回 synced=True, has_pending_step=True
  # mock auto_dispatch_next_step
  # 执行 _execute_stage_run（mock adapter 返回 exit_code=0）
  # 验证 auto_dispatch_next_step 被调用

test_execute_stage_run_skips_auto_dispatch_on_failure:
  """AgentRun 失败时不触发 auto dispatch"""
  # mock adapter 返回 exit_code=1
  # 执行 _execute_stage_run
  # 验证 sync_stage_status 和 auto_dispatch_next_step 均未被调用

test_auto_dispatch_idempotent_on_concurrent_completion:
  """并发回调幂等：第二个 dispatch 被拒绝"""
  # 设置 has_active_run 返回 True（模拟并发场景）
  sync_result = StageSyncResult(synced=True, has_pending_step=True, stage_completed=False, stage="propose", ...)
  result = await auto_dispatch_next_step(session, ws_id, change_id, user_id, sync_result)
  # dispatch() 内部 has_active_run 检查会拒绝，返回 {"dispatched": False, "reason": "active_run_exists"}
  # chain_count 被重置
```

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---------|---------|
| AC-01 | step pending 时自动调度 | auto_dispatch_next_step 调用 dispatch()，返回 `{"dispatched": True, "reason": "auto_dispatch"}` |
| AC-02 | stage completed 时不自动调度 | 返回 `{"dispatched": False, "reason": "stage_completed"}`，不创建新 AgentRun |
| AC-03 | 连续 dispatch 不超过 10 次 | chain_count 达到 10 后，第 11 次返回 `{"dispatched": False, "reason": "chain_limit_reached"}`，记录 warning 日志 |
| AC-04 | sync 失败时不触发自动调度 | synced=False 时返回 `{"dispatched": False, "reason": "sync_failed"}`，不创建新 AgentRun |
| AC-05 | 并发回调幂等 | has_active_run 检查拒绝第二次 dispatch，不创建重复 AgentRun，chain_count 被重置 |
| AC-06 | AgentRun 失败时不触发自动调度 | _execute_stage_run 中 run.status != "completed" 时跳过 sync + auto dispatch 块 |
| AC-07 | dispatch() 自身失败时重置计数 | chain_count 被重置为 0，记录日志 |
| AC-08 | auto_dispatch 异常不影响 AgentRun 完成状态 | try/except 包裹，AgentRun.status 仍为 "completed" |
