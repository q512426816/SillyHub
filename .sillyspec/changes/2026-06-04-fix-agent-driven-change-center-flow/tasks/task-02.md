---
id: task-02
title: "新增 rerun_stage 同阶段重跑 + TRANSITIONS 加 verify→propose 回退边"
priority: P0
estimated_hours: 2
depends_on: []
blocks: [task-03, task-04, task-05]
allowed_paths:
  - backend/app/modules/change/model.py
  - backend/app/modules/change/service.py
  - backend/app/modules/change/tests/test_rerun_stage.py
author: WhaleFall
created_at: 2026-06-04 13:50:10
---

# Task-02: 新增 rerun_stage 同阶段重跑 + TRANSITIONS 加 verify→propose 回退边

## 修改文件

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `backend/app/modules/change/model.py` | 修改 | TRANSITIONS 字典 VERIFY 条目中加 `StageEnum.PROPOSE: ["reviewer"]` 回退边 |
| `backend/app/modules/change/service.py` | 新增 | 新增 `rerun_stage` 方法；新增 `RerunStageResult` dataclass |
| `backend/app/modules/change/tests/test_rerun_stage.py` | 新增 | rerun_stage 单元测试 + verify→propose TRANSITIONS 边测试 |

## 实现要求

### 1. TRANSITIONS 加 verify→propose 回退边

**当前行为** (model.py L109-113):

```python
StageEnum.VERIFY: {
    StageEnum.QUICK: ["agent"],
    StageEnum.ARCHIVE: ["reviewer", "agent"],
    StageEnum.BLOCKED: ["agent"],
},
```

**目标行为**:

```python
StageEnum.VERIFY: {
    StageEnum.QUICK: ["agent"],
    StageEnum.ARCHIVE: ["reviewer", "agent"],
    StageEnum.BLOCKED: ["agent"],
    StageEnum.PROPOSE: ["reviewer"],
},
```

**设计依据**: design.md "AD-03: TRANSITIONS 加 verify→propose 回退边"。`human_test("doc_mismatch")` 需要从 verify 回到 propose，这是合法的回退场景，只有 reviewer 角色可以执行。

### 2. 新增 `rerun_stage` 方法

**设计依据**: design.md "AD-02: rerun_stage 绕过 TRANSITIONS 自环限制"

在 `ChangeService` 类中新增 `rerun_stage` 方法。

**核心语义**: "带意见重跑当前阶段"，不是"阶段流转"。因此：
- **不走 `transition()` 校验** — 不检查 TRANSITIONS 自环边
- **不修改 `current_stage`** — 保持当前阶段不变
- **重置 `human_gate=none`** — 清除 gate 以允许 Agent 再次运行
- **记录 comment 到 review_history** — 保留审核意见
- **dispatch 当前阶段的 Agent** — 触发重跑

**使用场景**:
- `proposal_review("revise")` → 调用 `rerun_stage(stage="propose")`
- `plan_review("replan")` → 调用 `rerun_stage(stage="plan")`

**仅允许在 review gate 时调用**: `human_gate` 必须是 `need_proposal_review` 或 `need_plan_review` 之一。其他 gate 状态（`need_human_test`、`need_archive_confirm`、`blocked` 等）不允许调用 rerun_stage。

### 3. `rerun_stage` 不走 `transition()` 的原因

TRANSITIONS 字典没有自环边（如 `propose→propose`），也不应该有。自环边语义不明确（"允许 propose→propose" 不等于 "允许任意阶段自环"）。rerun 是业务层面的"重跑"操作，不是状态机的"流转"操作。通过独立方法绕过 TRANSITIONS 校验，保持状态机定义的清晰性。

## 接口定义

### TRANSITIONS 修改 (model.py)

**位置**: model.py L109, `StageEnum.VERIFY` 字典内

```python
StageEnum.VERIFY: {
    StageEnum.QUICK: ["agent"],
    StageEnum.ARCHIVE: ["reviewer", "agent"],
    StageEnum.BLOCKED: ["agent"],
    StageEnum.PROPOSE: ["reviewer"],  # AD-03: human_test doc_mismatch 回退
},
```

### `RerunStageResult` (新增 dataclass)

```python
@dataclass
class RerunStageResult:
    """rerun_stage 的返回值。"""
    change: Change
    dispatched: bool
    agent_dispatch: dict  # dispatch() 的返回结果
```

### `rerun_stage` (新增方法)

```python
async def rerun_stage(
    self,
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    stage: str,            # 要重跑的阶段名，必须与 current_stage 一致
    comment: str | None,   # 审核意见
    user_id: uuid.UUID,    # 操作用户
) -> RerunStageResult:
    """同阶段重跑：带审核意见重新 dispatch 当前阶段的 Agent。

    核心逻辑：
    1. 加载 Change 记录
    2. 校验 human_gate 必须是 review gate (need_proposal_review / need_plan_review)
    3. 校验 stage 与 current_stage 一致
    4. 将 comment 记录到 stages.review_history
    5. 设置 human_gate=none
    6. commit
    7. dispatch 当前阶段的 Agent

    注意：不走 transition() 校验，不修改 current_stage。

    Raises:
        ChangeNotFound: change_id 不存在
        InvalidTransition: human_gate 不是 review gate，或 stage 与 current_stage 不一致
    """
```

**伪代码**:

```python
async def rerun_stage(self, workspace_id, change_id, stage, comment, user_id):
    # 1. 加载 Change
    change = await self.get(workspace_id, change_id)

    # 2. 校验 current_stage 与传入 stage 一致
    current = change.current_stage or "draft"
    if current != stage:
        raise InvalidTransition(
            f"rerun_stage 阶段不匹配: current={current}, requested={stage}",
            details={"current_stage": current, "requested_stage": stage},
        )

    # 3. 校验 human_gate 是 review gate
    review_gates = {HumanGate.NEED_PROPOSAL_REVIEW, HumanGate.NEED_PLAN_REVIEW}
    if change.human_gate not in review_gates:
        raise InvalidTransition(
            f"当前 gate 不允许 rerun: {change.human_gate}",
            details={"human_gate": change.human_gate},
        )

    # 4. 记录 comment 到 review_history
    stages = change.stages or {}
    history = stages.get("review_history", [])
    history.append({
        "decision": "rerun",
        "stage": stage,
        "comment": comment,
        "by": str(user_id),
        "at": datetime.now(UTC).isoformat(),
    })
    stages["review_history"] = history
    stages["last_review"] = {
        "decision": "rerun",
        "stage": stage,
        "comment": comment,
    }
    change.stages = stages

    # 5. 重置 human_gate
    change.human_gate = HumanGate.NONE
    change.updated_at = datetime.now(UTC)

    # 6. 审计日志
    from app.modules.workflow.model import AuditLog
    audit = AuditLog(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        actor_id=user_id,
        action="change.rerun_stage",
        resource_type="change",
        resource_id=change.id,
        details_json=json.dumps({
            "stage": stage,
            "comment": comment[:200] if comment else None,
        }),
    )
    self._session.add(audit)
    self._session.add(change)
    await self._session.commit()

    # 7. dispatch 当前阶段 Agent
    dispatch_result: dict = {}
    try:
        from app.core.db import get_session_factory
        from app.modules.change.dispatch import dispatch

        factory = get_session_factory()
        async with factory() as dispatch_session:
            dispatch_result = await dispatch(
                session=dispatch_session,
                workspace_id=workspace_id,
                change_id=change_id,
                target_stage=stage,
                user_id=user_id,
            )
    except Exception as exc:
        log.warning(
            "rerun_stage_dispatch_failed",
            change_id=str(change_id),
            stage=stage,
            error=str(exc),
        )
        dispatch_result = {
            "dispatched": False,
            "reason": "dispatch_exception",
            "error": str(exc),
        }

    return RerunStageResult(
        change=change,
        dispatched=dispatch_result.get("dispatched", False),
        agent_dispatch=dispatch_result,
    )
```

## 边界处理

1. **`stage` 与 `current_stage` 不一致**: 抛 `InvalidTransition`，拒绝执行。例如 current_stage="plan" 但传入 stage="propose"，属于调用方传错参数
2. **`human_gate` 不是 review gate**: 抛 `InvalidTransition`。例如 `human_gate=need_human_test` 时调用 rerun_stage，不允许。仅允许 `need_proposal_review` 和 `need_plan_review`
3. **`human_gate=none` 时调用 rerun_stage**: 抛 `InvalidTransition`。如果 Agent 正在运行（gate=none），不允许再次 rerun
4. **`comment=None`**: 允许，review_history 中记录 `comment=None`。调用方（proposal_review/plan_review）可能不传 comment
5. **dispatch 失败**: `rerun_stage` 本身的 DB 更新（human_gate=none, review_history）已经 commit，不回滚。dispatch_result 中标记 `dispatched=False`，调用方根据返回值决定是否重试
6. **并发 rerun**: dispatch() 内部有 `has_active_run` 检查（dispatch.py L341），如果已有 Agent 在运行，dispatch 返回 `{"dispatched": False, "reason": "active_run_exists"}`。`rerun_stage` 不会重复触发 Agent

## 非目标

- 不修改 `resolve_human_gate` 或 `_GATE_MAP`（task-01 负责）
- 不新增 `complete_stage` 方法（task-01 负责）
- 不修改 `proposal_review` / `plan_review` / `human_test` 方法（task-03/04/05 负责，它们会调用 `rerun_stage`）
- 不修改前端代码（task-07 负责）
- 不新增数据表或列
- 不修改 `transition()` 方法本身
- 不在 TRANSITIONS 中添加自环边（这是 rerun_stage 绕过的原因）

## 参考

- design.md AD-02 "rerun_stage 绕过 TRANSITIONS 自环限制"
- design.md AD-03 "TRANSITIONS 加 verify→propose 回退边"
- model.py L84-127: TRANSITIONS 字典定义
- model.py L72-81: HumanGate 枚举值
- service.py L340-410: `transition()` 方法
- service.py L880-928: `proposal_review()` 方法（task-03 会改为调用 rerun_stage）
- service.py L929-985: `plan_review()` 方法（task-04 会改为调用 rerun_stage）
- dispatch.py L324-401: `dispatch()` 函数（rerun_stage 调用它）
- dispatch.py L314-321: `has_active_run()` 并发检查

## TDD 步骤

### Step 1: 写 TRANSITIONS verify→propose 测试

创建 `backend/app/modules/change/tests/test_rerun_stage.py`:

```python
from app.modules.change.model import TRANSITIONS, StageEnum

def test_verify_can_transition_to_propose():
    """AD-03: verify→propose 回退边存在且只有 reviewer 角色可执行。"""
    assert StageEnum.PROPOSE in TRANSITIONS[StageEnum.VERIFY]
    assert TRANSITIONS[StageEnum.VERIFY][StageEnum.PROPOSE] == ["reviewer"]

def test_can_transition_verify_to_propose():
    """can_transition 辅助函数确认 verify→propose 合法。"""
    from app.modules.change.model import can_transition
    assert can_transition(StageEnum.VERIFY, StageEnum.PROPOSE) is True
```

### Step 2: 写 rerun_stage 前置校验测试

```python
import pytest
from app.core.errors import InvalidTransition

# 测试 stage 与 current_stage 不一致时抛 InvalidTransition
async def test_rerun_stage_mismatch_stage_raises(client, db_change_with_gate):
    # change.current_stage = "plan", 传入 stage="propose"
    ...

# 测试 human_gate 不是 review gate 时抛 InvalidTransition
@pytest.mark.parametrize("gate", ["none", "need_human_test", "need_archive_confirm", "blocked"])
async def test_rerun_stage_invalid_gate_raises(client, db_change_with_gate, gate):
    # 设置 human_gate 为非 review gate
    ...

# 测试 human_gate=need_proposal_review 时允许 rerun
async def test_rerun_stage_proposal_review_allowed(client, db_change_with_gate):
    ...

# 测试 human_gate=need_plan_review 时允许 rerun
async def test_rerun_stage_plan_review_allowed(client, db_change_with_gate):
    ...
```

### Step 3: 写 rerun_stage 核心行为测试

```python
# 测试 rerun 后 human_gate 变为 none
async def test_rerun_stage_resets_human_gate(client, db_change_with_gate):
    ...

# 测试 rerun 后 current_stage 不变
async def test_rerun_stage_keeps_current_stage(client, db_change_with_gate):
    ...

# 测试 rerun 记录 review_history
async def test_rerun_stage_records_review_history(client, db_change_with_gate):
    ...

# 测试 rerun 记录审计日志 (action="change.rerun_stage")
async def test_rerun_stage_creates_audit_log(client, db_change_with_gate):
    ...

# 测试 comment=None 时正常执行
async def test_rerun_stage_without_comment(client, db_change_with_gate):
    ...
```

### Step 4: 实现 TRANSITIONS 修改

- 在 model.py `StageEnum.VERIFY` 条目中加 `StageEnum.PROPOSE: ["reviewer"]`
- 运行 Step 1 测试确认通过

### Step 5: 实现 `RerunStageResult` dataclass

- 在 service.py 顶部（ChangeService 类之前或之后）新增 dataclass
- 可放在 `resolve_human_gate` 函数附近或 `CompleteStageResult` 旁边（如果 task-01 已完成）

### Step 6: 实现 `rerun_stage` 方法

- 在 `ChangeService` 类中新增 `rerun_stage` 方法
- 按伪代码实现，包含完整的前置校验、review_history 记录、dispatch 逻辑
- 运行 Step 2 和 Step 3 测试确认通过

### Step 7: 运行全量测试

```bash
cd backend && python -m pytest app/modules/change/tests/ -v
```

## 验收标准

| # | 验收项 | 验证方式 |
|---|--------|----------|
| 1 | TRANSITIONS 中 `StageEnum.VERIFY` 包含 `StageEnum.PROPOSE: ["reviewer"]` | 测试 `test_verify_can_transition_to_propose` 通过 |
| 2 | `can_transition(VERIFY, PROPOSE)` 返回 `True` | 测试 `test_can_transition_verify_to_propose` 通过 |
| 3 | `rerun_stage` 在 `human_gate=need_proposal_review` 时正常执行 | 集成测试确认 human_gate 变为 none |
| 4 | `rerun_stage` 在 `human_gate=need_plan_review` 时正常执行 | 集成测试确认 human_gate 变为 none |
| 5 | `rerun_stage` 不修改 `current_stage` | 测试确认 rerun 前后 current_stage 一致 |
| 6 | `rerun_stage` 重置 `human_gate` 为 `none` | 测试确认 gate 从 review 变为 none |
| 7 | `rerun_stage` 将 comment 记录到 `stages.review_history` | 测试检查 review_history 包含新条目 |
| 8 | `rerun_stage` 在 stage 与 current_stage 不一致时抛 `InvalidTransition` | 测试确认异常抛出 |
| 9 | `rerun_stage` 在 human_gate 非 review gate 时抛 `InvalidTransition` | 参数化测试覆盖 none/human_test/archive_confirm/blocked |
| 10 | `rerun_stage` 记录审计日志 (action=`change.rerun_stage`) | 测试检查 AuditLog 记录 |
| 11 | `rerun_stage` dispatch 当前阶段 Agent | 测试确认 dispatch 被调用（可 mock） |
| 12 | TRANSITIONS 中无自环边（propose→propose 等） | grep 确认 TRANSITIONS 字典中无同 key-value 对 |
| 13 | 所有 `pytest` 通过 | `cd backend && python -m pytest` |
| 14 | `ruff check` 无新增错误 | `cd backend && ruff check app/modules/change/` |
