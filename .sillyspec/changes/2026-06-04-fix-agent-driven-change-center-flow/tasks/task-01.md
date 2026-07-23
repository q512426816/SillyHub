---
id: task-01
title: "resolve_human_gate 全返回 none + 新增 complete_stage 统一入口"
priority: P0
estimated_hours: 3
depends_on: []
blocks: [task-03, task-04, task-05]
allowed_paths:
  - backend/app/modules/change/service.py
  - backend/app/modules/change/dispatch.py
  - backend/app/modules/change/tests/test_complete_stage.py
author: WhaleFall
created_at: 2026-06-04 13:50:10
---

# Task-01: resolve_human_gate 全返回 none + 新增 complete_stage 统一入口

## 修改文件

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `backend/app/modules/change/service.py` | 修改 + 新增 | 删除 `_GATE_MAP`；`resolve_human_gate` 硬返回 `HumanGate.NONE`；新增 `complete_stage` 方法 |
| `backend/app/modules/change/dispatch.py` | 修改 | `auto_dispatch_next_step` 在 `stage_completed=True` 时调用 `complete_stage` |
| `backend/app/modules/change/tests/test_complete_stage.py` | 新增 | `complete_stage` 各映射路径的单元测试 |

## 实现要求

### 1. `resolve_human_gate` 全返回 none

**当前行为** (service.py L37-48):

```python
_GATE_MAP: dict[str, str] = {
    "brainstorm": HumanGate.NEED_REQUIREMENT_INPUT,
    "propose": HumanGate.NEED_PROPOSAL_REVIEW,
    "plan": HumanGate.NEED_PLAN_REVIEW,
    "verify": HumanGate.NEED_HUMAN_TEST,
    "archive": HumanGate.NEED_ARCHIVE_CONFIRM,
}

def resolve_human_gate(target_stage: str) -> str:
    return _GATE_MAP.get(target_stage, HumanGate.NONE)
```

**目标行为**:

- 删除 `_GATE_MAP` 字典（整个变量）
- `resolve_human_gate` 改为一行: `return HumanGate.NONE`
- 这样 `transition()` 在 L391 调用 `resolve_human_gate(target_stage)` 时，无论目标阶段是什么，都会设 `human_gate="none"`
- 人工 gate 的设置推迟到 `complete_stage` 中处理

### 2. 新增 `complete_stage` 方法

在 `ChangeService` 类中新增 `complete_stage` 方法。

**设计依据**: design.md "AD-01: Gate 时机 — transition 时一律 none，complete_stage 后设 gate"

**完整映射表** (来自 design.md):

| stage (刚完成的阶段) | result | current_stage (设置为) | human_gate (设置为) | dispatch (后续动作) |
|---------------------|--------|----------------------|--------------------|--------------------|
| brainstorm | clear | propose | none | propose Agent |
| brainstorm | ambiguous | brainstorm | need_requirement_input | -- (不 dispatch) |
| propose | -- (忽略 result) | propose (不变) | need_proposal_review | -- (不 dispatch) |
| plan | -- (忽略 result) | plan (不变) | need_plan_review | -- (不 dispatch) |
| execute | -- (忽略 result) | verify | none | verify Agent |
| verify | passed | verify (不变) | need_human_test | -- (不 dispatch) |
| verify | failed | quick | none | quick Agent (auto_fix_count < 3) |
| verify | failed (>=3次) | verify (不变) | blocked | -- (不 dispatch) |
| quick | -- (忽略 result) | verify | none | verify Agent |
| archive | -- (忽略 result) | archived | none | -- (不 dispatch) |

**注意**: verify failed 的 auto_fix_count 逻辑已在 `auto_dispatch_next_step` 中实现。`complete_stage` 中 verify failed 只需设 `current_stage=quick, human_gate=none`，dispatch 由 `auto_dispatch_next_step` 继续处理。auto_fix_count >= 3 的 "blocked" 情况也由 `auto_dispatch_next_step` 处理。因此 `complete_stage` 中 verify 行为简化为:

- verify + passed: 设 `human_gate=need_human_test`，不 dispatch
- verify + failed: 设 `current_stage=quick, human_gate=none`，返回需 dispatch quick 的信号

### 3. `auto_dispatch_next_step` 调用 `complete_stage`

**当前行为** (dispatch.py L188-251): 当 `sync_result.stage_completed=True` 时，先检查 human_gate 是否活跃，然后处理 verify auto-fix 逻辑，最后返回 `{"dispatched": False, "reason": "stage_completed"}`。

**目标行为**: 当 `sync_result.stage_completed=True` 时:
1. 先调用 `complete_stage` 设置 current_stage 和 human_gate
2. 根据 `complete_stage` 返回的 dispatch 信息决定是否继续 dispatch
3. 保留原有的 chain limit 检查和 verify auto-fix 逻辑（需适配新流程）

**关键**: `auto_dispatch_next_step` 中的 verify auto-fix 计数逻辑 (_auto_fix_count) 需要保留。`complete_stage` 本身不做 auto_fix_count 判断，它只映射 stage+result。`auto_dispatch_next_step` 在调用 `complete_stage` 之后，如果 complete_stage 返回 dispatch_target，则执行 dispatch。

## 接口定义

### `resolve_human_gate` (修改)

```python
def resolve_human_gate(target_stage: str) -> str:
    """Return the default human_gate for a given target stage.

    AD-01: transition 时一律返回 none。
    gate 时机推迟到 complete_stage 中处理。
    """
    return HumanGate.NONE
```

### `complete_stage` (新增)

```python
@dataclass
class CompleteStageResult:
    """complete_stage 的返回值。"""
    change: Change
    dispatch_target: str | None  # 需要 dispatch 的目标阶段，None 表示不需要
    gate: str  # 设置的 human_gate 值

async def complete_stage(
    self,
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    stage: str,           # 刚完成的阶段名
    result: str | None,   # 阶段结果 ("clear" / "ambiguous" / "passed" / "failed" / None)
    summary: str | None,  # 可选的阶段完成摘要
) -> CompleteStageResult:
    """Agent 完成某一阶段后，统一设置 current_stage 和 human_gate。

    核心逻辑：
    1. 加载 Change 记录
    2. 根据 stage + result 查映射表，确定 new_stage、new_gate、dispatch_target
    3. 更新 Change 的 current_stage、human_gate、stages JSON
    4. 记录审计日志
    5. commit 并返回 CompleteStageResult

    注意：此方法只更新 DB 状态，不执行 agent dispatch。
    dispatch 由调用方 (auto_dispatch_next_step) 根据 dispatch_target 执行。

    Raises:
        ChangeNotFound: change_id 不存在
        ValueError: stage 不是合法的 SillySpec 阶段
    """
```

**伪代码**:

```python
async def complete_stage(self, workspace_id, change_id, stage, result, summary):
    # 1. 加载 Change
    change = await self.get(workspace_id, change_id)

    # 2. 映射 stage+result -> (new_stage, new_gate, dispatch_target)
    new_stage, new_gate, dispatch_target = self._resolve_stage_completion(stage, result)

    # 3. 更新 Change
    change.current_stage = new_stage
    change.human_gate = new_gate
    change.updated_at = datetime.now(UTC)

    # 4. 记录到 stages JSON
    stages = change.stages or {}
    stages["last_stage_completion"] = {
        "stage": stage,
        "result": result,
        "summary": summary,
        "new_stage": new_stage,
        "new_gate": new_gate,
        "completed_at": datetime.now(UTC).isoformat(),
    }
    change.stages = stages

    # 5. 审计日志
    audit = AuditLog(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        actor_id=None,
        action="change.complete_stage",
        resource_type="change",
        resource_id=change.id,
        details_json=json.dumps({
            "stage": stage, "result": result,
            "new_stage": new_stage, "new_gate": new_gate,
        }),
    )
    self._session.add(audit)
    self._session.add(change)
    await self._session.commit()

    return CompleteStageResult(
        change=change,
        dispatch_target=dispatch_target,
        gate=new_gate,
    )
```

### `_resolve_stage_completion` (私有辅助方法)

```python
@staticmethod
def _resolve_stage_completion(stage: str, result: str | None) -> tuple[str, str, str | None]:
    """根据 stage + result 返回 (new_current_stage, new_human_gate, dispatch_target)。

    映射表见 design.md complete_stage mapping。
    """
    if stage == "brainstorm":
        if result == "clear":
            return ("propose", HumanGate.NONE, "propose")
        else:  # ambiguous 或 None
            return ("brainstorm", HumanGate.NEED_REQUIREMENT_INPUT, None)

    if stage == "propose":
        return ("propose", HumanGate.NEED_PROPOSAL_REVIEW, None)

    if stage == "plan":
        return ("plan", HumanGate.NEED_PLAN_REVIEW, None)

    if stage == "execute":
        return ("verify", HumanGate.NONE, "verify")

    if stage == "verify":
        if result == "passed":
            return ("verify", HumanGate.NEED_HUMAN_TEST, None)
        else:  # failed
            return ("quick", HumanGate.NONE, "quick")

    if stage == "quick":
        return ("verify", HumanGate.NONE, "verify")

    if stage == "archive":
        return ("archived", HumanGate.NONE, None)

    # 未知阶段：不改变
    return (stage, HumanGate.NONE, None)
```

### `auto_dispatch_next_step` 修改点 (dispatch.py)

**修改位置**: L188-251 的 `if sync_result.stage_completed:` 分支

**伪代码**:

```python
if sync_result.stage_completed:
    change = await session.get(Change, change_id)
    if change is None:
        return {"dispatched": False, "reason": "change_not_found"}

    # 调用 complete_stage 设置状态
    from app.modules.change.service import ChangeService
    cs = ChangeService(session)
    complete_result = await cs.complete_stage(
        workspace_id=workspace_id,
        change_id=change_id,
        stage=sync_result.current_stage,
        result=None,  # result 由 sillyspec.db steps 状态推断，此处先传 None
        summary=None,
    )

    # 如果 complete_stage 指定了 dispatch_target，执行 dispatch
    if complete_result.dispatch_target:
        target = complete_result.dispatch_target

        # verify failed auto-fix: check auto_fix_count
        if sync_result.current_stage == "verify" and target == "quick":
            stages = change.stages or {}
            fix_count = stages.get("_auto_fix_count", 0)
            if fix_count >= 3:
                change.human_gate = "blocked"
                change.stages = stages
                session.add(change)
                await session.commit()
                return {"dispatched": False, "reason": "verify_auto_fix_limit", ...}
            stages["_auto_fix_count"] = fix_count + 1
            change.stages = stages
            session.add(change)
            await session.commit()

        # Chain limit check
        stages = change.stages or {}
        chain_count = _get_chain_count(stages)
        if chain_count >= _DISPATCH_CHAIN_LIMIT:
            return {"dispatched": False, "reason": "chain_limit_reached"}

        stages = _increment_chain_count(stages)
        change.stages = stages
        session.add(change)
        await session.commit()

        dispatch_result = await dispatch(
            session=session,
            workspace_id=workspace_id,
            change_id=change_id,
            target_stage=target,
            user_id=user_id,
        )
        dispatch_result["reason"] = "auto_dispatch_after_complete"
        return dispatch_result

    # 没有需要 dispatch 的目标
    log.info("auto_dispatch_stage_completed_with_gate",
             change_id=str(change_id), gate=complete_result.gate)
    return {"dispatched": False, "reason": "stage_completed", "human_gate": complete_result.gate}
```

**重要**: 旧的 `stage_completed` 分支中检查 `change.human_gate` 的逻辑 (`if change and change.human_gate and change.human_gate != "none"`) 不再需要，因为 gate 的设置现在由 `complete_stage` 统一管理。删除这个条件判断。

## 边界处理

1. **`complete_stage` 传入未知 stage**: `_resolve_stage_completion` 返回 `(stage, HumanGate.NONE, None)`，不改变状态，不 dispatch，记录 warning log
2. **`complete_stage` 中 change_id 不存在**: 抛 `ChangeNotFound`，与现有 `self.get()` 行为一致
3. **`complete_stage` 中 result=None**: 对于 brainstorm 默认当 ambiguous 处理；对于 verify 默认当 failed 处理
4. **`auto_dispatch_next_step` 中 sync_result.current_stage 为 None**: 不调用 `complete_stage`，直接返回 `{"dispatched": False, "reason": "stage_completed"}`
5. **`auto_dispatch_next_step` 中 complete_stage 与 chain_limit 的交互**: 先调 complete_stage 更新状态，再检查 chain_limit。chain_limit 达到时不 dispatch，但 complete_stage 的状态更新已经 commit（不回滚）
6. **`complete_stage` 与现有 transition() 的关系**: `transition()` 仍然调用 `resolve_human_gate` 设 gate=none。`complete_stage` 是后续的状态修正。两者不冲突

## 非目标

- 不修改 TRANSITIONS 字典（task-02 负责 verify -> propose 回退边）
- 不新增 rerun_stage 方法（task-02 负责）
- 不修改 proposal_review / plan_review / human_test（task-03/04/05 负责）
- 不新增 archive-confirm API（task-06 负责）
- 不修改前端代码（task-07 负责）
- 不新增数据表或列（human_gate 字段已存在）

## 参考

- design.md AD-01 "Gate 时机 — transition 时一律 none，complete_stage 后设 gate"
- design.md "complete_stage 阶段映射" 表格
- service.py L37-48: `_GATE_MAP` 和 `resolve_human_gate` 现有实现
- service.py L340-410: `transition()` 方法（L391 调用 resolve_human_gate）
- dispatch.py L152-301: `auto_dispatch_next_step` 现有实现
- model.py L72-81: `HumanGate` 枚举值
- model.py L84-127: `TRANSITIONS` 字典

## TDD 步骤

### Step 1: 写 complete_stage 映射测试

创建 `backend/app/modules/change/tests/test_complete_stage.py`:

```python
import pytest
from app.modules.change.model import HumanGate

# 测试 _resolve_stage_completion 静态方法
@pytest.mark.parametrize("stage,result,expected_stage,expected_gate,expected_dispatch", [
    ("brainstorm", "clear", "propose", HumanGate.NONE, "propose"),
    ("brainstorm", "ambiguous", "brainstorm", HumanGate.NEED_REQUIREMENT_INPUT, None),
    ("brainstorm", None, "brainstorm", HumanGate.NEED_REQUIREMENT_INPUT, None),
    ("propose", None, "propose", HumanGate.NEED_PROPOSAL_REVIEW, None),
    ("plan", None, "plan", HumanGate.NEED_PLAN_REVIEW, None),
    ("execute", None, "verify", HumanGate.NONE, "verify"),
    ("verify", "passed", "verify", HumanGate.NEED_HUMAN_TEST, None),
    ("verify", "failed", "quick", HumanGate.NONE, "quick"),
    ("verify", None, "quick", HumanGate.NONE, "quick"),
    ("quick", None, "verify", HumanGate.NONE, "verify"),
    ("archive", None, "archived", HumanGate.NONE, None),
    ("scan", None, "scan", HumanGate.NONE, None),  # unknown -> no change
])
def test_resolve_stage_completion(stage, result, expected_stage, expected_gate, expected_dispatch):
    from app.modules.change.service import ChangeService
    new_stage, new_gate, dispatch_target = ChangeService._resolve_stage_completion(stage, result)
    assert new_stage == expected_stage
    assert new_gate == expected_gate
    assert dispatch_target == expected_dispatch
```

### Step 2: 写 resolve_human_gate 测试

```python
from app.modules.change.service import resolve_human_gate
from app.modules.change.model import HumanGate

@pytest.mark.parametrize("stage", [
    "brainstorm", "propose", "plan", "verify", "archive", "execute", "quick", "scan", "draft"
])
def test_resolve_human_gate_always_none(stage):
    assert resolve_human_gate(stage) == HumanGate.NONE
```

### Step 3: 写 complete_stage 集成测试（需 async + DB session）

```python
# 测试 brainstorm clear -> propose dispatch
# 测试 propose -> need_proposal_review gate
# 测试 execute -> verify dispatch
# 测试 verify passed -> need_human_test gate
# 测试 verify failed -> quick dispatch
# 测试 archive -> archived
```

### Step 4: 实现 resolve_human_gate 修改

- 删除 `_GATE_MAP`
- 修改 `resolve_human_gate` 返回 `HumanGate.NONE`

### Step 5: 实现 _resolve_stage_completion 静态方法

- 在 `ChangeService` 中新增 `_resolve_stage_completion`
- 运行 Step 1 的参数化测试确认通过

### Step 6: 实现 complete_stage 方法

- 在 `ChangeService` 中新增 `complete_stage`
- 运行 Step 3 的集成测试确认通过

### Step 7: 修改 auto_dispatch_next_step

- 重写 `stage_completed` 分支，调用 `complete_stage`
- 保留 verify auto-fix 计数逻辑和 chain limit 逻辑
- 删除旧的 human_gate 活跃检查

### Step 8: 运行全量测试

```bash
cd backend && python -m pytest app/modules/change/tests/ -v
```

## 验收标准

| # | 验收项 | 验证方式 |
|---|--------|----------|
| 1 | `resolve_human_gate` 对所有 stage 返回 `HumanGate.NONE` | 参数化测试覆盖 brainstorm/propose/plan/verify/archive/execute/quick/scan/draft |
| 2 | `_GATE_MAP` 字典已删除 | grep 确认 `service.py` 中无 `_GATE_MAP` |
| 3 | `_resolve_stage_completion` 映射与 design.md 表格一致 | 参数化测试 12 条 case 全通过 |
| 4 | `complete_stage` 正确更新 Change 的 current_stage 和 human_gate | 集成测试: brainstorm->propose, propose->need_review, execute->verify 等 |
| 5 | `complete_stage` 记录审计日志 (action="change.complete_stage") | 测试中检查 AuditLog 记录 |
| 6 | `complete_stage` 更新 stages JSON 的 last_stage_completion | 测试中检查 stages["last_stage_completion"] |
| 7 | `auto_dispatch_next_step` 在 stage_completed 时调用 complete_stage | 测试 mock + 验证调用 |
| 8 | verify failed auto-fix 计数逻辑仍在 auto_dispatch_next_step 中生效 | 测试 _auto_fix_count < 3 dispatch quick, >= 3 设 blocked |
| 9 | chain limit 逻辑在新的 dispatch 流程中仍然生效 | 测试 chain_count >= LIMIT 不 dispatch |
| 10 | 现有 `transition()` 方法行为不变（只是 gate 总为 none） | 现有 transition 测试仍通过 |
| 11 | 所有 `pytest` 通过 | `cd backend && python -m pytest` |
| 12 | `ruff check` 无新增错误 | `cd backend && ruff check app/modules/change/` |
