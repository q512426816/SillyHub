---
id: task-03
title: "修正 proposal-review（approve→plan, revise→rerun, unclear→brainstorm）+ 记录 review_history"
priority: P0
estimated_hours: 2
depends_on: [task-01, task-02]
blocks: [task-07]
allowed_paths:
  - backend/app/modules/change/service.py
  - backend/app/modules/change/tests/test_review_apis.py
author: WhaleFall
created_at: 2026-06-04 13:50:10
---

# Task-03: 修正 proposal-review + 记录 review_history

## 修改文件

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `backend/app/modules/change/service.py` | 修改 | 重写 `proposal_review` 方法：approve 走 transition+dispatch, revise 走 rerun_stage, unclear 走 transition+dispatch；所有决策记录到 `stages["review_history"]` |
| `backend/app/modules/change/tests/test_review_apis.py` | 修改 + 新增 | 新增 proposal_review 行为测试：三种 decision 的状态流转 + review_history 记录 |

## 实现要求

### 1. proposal_review guard 条件不变

**当前行为** (service.py L880-893):

```python
async def proposal_review(self, workspace_id, change_id, decision, comment, user_id):
    change = await self.get(workspace_id, change_id)
    if change.current_stage != "propose" or change.human_gate != "need_proposal_review":
        raise InvalidTransition(...)
```

**目标行为**: guard 条件保持不变。必须是 `current_stage=="propose" AND human_gate=="need_proposal_review"` 才能调用。这是 proposal review 的入口门控。

### 2. "approve" 决策：propose→plan

**当前行为** (service.py L895-903):

```python
if decision == "approve":
    return await self.transition_with_dispatch(
        workspace_id=workspace_id,
        change_id=change_id,
        target_stage="plan",
        user_role="reviewer",
        reason=comment or "proposal approved",
        user_id=user_id,
    )
```

**目标行为**: 基本不变，走 `transition_with_dispatch` 做 propose→plan 流转，角色为 "reviewer"。由于 task-01 已让 `resolve_human_gate` 返回 none，transition 后 gate 为 none。后续 plan Agent 完成后由 `complete_stage` 设 `need_plan_review`。

**无需改动**: 这条路径逻辑正确，只需补充 review_history 记录。

### 3. "revise" 决策：调用 rerun_stage("propose")

**当前行为** (service.py L904-918):

```python
elif decision == "revise":
    change.human_gate = "none"
    stages = change.stages or {}
    stages["last_review"] = {"decision": decision, "comment": comment}
    change.stages = stages
    self._session.add(change)
    await self._session.commit()
    return await self.transition_with_dispatch(
        workspace_id=workspace_id,
        change_id=change_id,
        target_stage="propose",
        user_role="admin",
        reason=comment or "proposal needs revision",
        user_id=user_id,
    )
```

**问题**: 走 `transition_with_dispatch` 尝试 propose→propose，但 TRANSITIONS 没有 propose→propose 的自环边，会抛 `InvalidTransition`。

**目标行为**: 调用 `rerun_stage("propose", comment, user_id)`（由 task-02 新增）。`rerun_stage` 直接重置 `human_gate=none` 并 dispatch propose Agent，不走 `transition()` 校验。

**设计依据**: design.md "AD-02: rerun_stage 绕过 TRANSITIONS 自环限制"

### 4. "unclear" 决策：propose→brainstorm

**当前行为** (service.py L919-927):

```python
else:  # unclear
    return await self.transition_with_dispatch(
        workspace_id=workspace_id,
        change_id=change_id,
        target_stage="brainstorm",
        user_role="admin",
        reason=comment or "proposal unclear, back to brainstorm",
        user_id=user_id,
    )
```

**目标行为**: 基本不变。走 `transition_with_dispatch` 做 propose→brainstorm 流转，角色为 "admin"。TRANSITIONS 中 `PROPOSE -> BRAINSTORM: ["reviewer"]`，admin 可 bypass 所有角色限制，所以用 admin 角色没问题。dispatch brainstorm Agent。

**无需改动**: 这条路径逻辑正确，只需补充 review_history 记录。

### 5. 所有决策记录到 review_history

**当前行为**: revise 分支记录了 `stages["last_review"]`，approve 和 unclear 分支不记录。

**目标行为**: 所有三种决策都追加记录到 `stages["review_history"]`（list）。每条记录格式：

```json
{
  "decision": "approve" | "revise" | "unclear",
  "comment": "用户输入的 comment，可为 null",
  "user_id": "UUID string",
  "submitted_at": "ISO 8601 datetime",
  "from_stage": "propose",
  "target_action": "transition:plan" | "rerun:propose" | "transition:brainstorm"
}
```

**实现要点**:
- `review_history` 是 `change.stages` JSON 字段中的一个 list
- 如果 `stages` 中不存在 `"review_history"` 键，初始化为空 list
- 每次 proposal_review 调用都 append 一条记录
- 在执行实际流转/rerun 之前先写入 review_history，确保即使后续操作失败，记录仍然保存（在同一次 session commit 中）

## 接口定义

### `proposal_review` (重写)

```python
async def proposal_review(
    self,
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    decision: str,         # "approve" | "revise" | "unclear"
    comment: str | None,   # 用户备注
    user_id: uuid.UUID,    # 操作用户 ID
) -> dict:
    """处理 proposal review 的三种决策。

    Guard: current_stage=="propose" AND human_gate=="need_proposal_review"

    决策路径:
    - approve:  transition propose→plan (reviewer), dispatch plan Agent
    - revise:   rerun_stage("propose") — 重跑 propose Agent
    - unclear:  transition propose→brainstorm (admin), dispatch brainstorm Agent

    所有决策都记录到 change.stages["review_history"] list。

    Returns:
        dict 包含 change 和 agent_dispatch 信息。
        revise 路径返回 rerun_stage 的结果格式。

    Raises:
        InvalidTransition: guard 条件不满足
    """
```

**伪代码**:

```python
async def proposal_review(self, workspace_id, change_id, decision, comment, user_id):
    # 1. Guard: 加载 Change 并校验状态
    change = await self.get(workspace_id, change_id)
    if change.current_stage != "propose" or change.human_gate != "need_proposal_review":
        raise InvalidTransition(
            "当前状态不允许 proposal review",
            details={"current_stage": change.current_stage, "human_gate": change.human_gate},
        )

    # 2. 记录 review_history（在执行流转前写入）
    stages = change.stages or {}
    review_history = stages.get("review_history", [])

    target_action_map = {
        "approve": "transition:plan",
        "revise": "rerun:propose",
        "unclear": "transition:brainstorm",
    }
    review_entry = {
        "decision": decision,
        "comment": comment,
        "user_id": str(user_id),
        "submitted_at": datetime.now(UTC).isoformat(),
        "from_stage": "propose",
        "target_action": target_action_map[decision],
    }
    review_history.append(review_entry)
    stages["review_history"] = review_history
    change.stages = stages
    self._session.add(change)
    await self._session.commit()

    # 3. 根据 decision 执行对应操作
    if decision == "approve":
        return await self.transition_with_dispatch(
            workspace_id=workspace_id,
            change_id=change_id,
            target_stage="plan",
            user_role="reviewer",
            reason=comment or "proposal approved",
            user_id=user_id,
        )
    elif decision == "revise":
        return await self.rerun_stage(
            workspace_id=workspace_id,
            change_id=change_id,
            stage="propose",
            comment=comment,
            user_id=user_id,
        )
    else:  # unclear
        return await self.transition_with_dispatch(
            workspace_id=workspace_id,
            change_id=change_id,
            target_stage="brainstorm",
            user_role="admin",
            reason=comment or "proposal unclear, back to brainstorm",
            user_id=user_id,
        )
```

### `rerun_stage` 调用约定（task-02 提供）

task-02 新增 `rerun_stage` 方法，签名：

```python
async def rerun_stage(
    self,
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    stage: str,           # 要重跑的阶段
    comment: str | None,  # 重跑意见
    user_id: uuid.UUID,   # 操作用户
) -> dict:
    """重跑指定阶段：重置 human_gate=none 并 dispatch 对应 Agent。

    不走 transition() 校验，直接重置状态并 dispatch。
    """
```

返回格式与 `transition_with_dispatch` 类似：`{"change": ..., "agent_dispatch": ...}`

## 边界处理

1. **decision 不是 approve/revise/unclear**: ProposalReviewRequest schema 层已有 regex 校验 `^(approve|revise|unclear)$`，service 层不重复校验。如果绕过 schema 直接调 service，decision 不匹配三个分支时走 else (unclear) 分支
2. **comment 为 None**: review_entry 中 `"comment": None` 是合法的 JSON null。`transition_with_dispatch` 的 reason 参数用 `comment or "proposal ..."` 处理了 None
3. **review_history 不存在**: `stages.get("review_history", [])` 初始化为空 list，首次写入时创建
4. **review_history 写入后流转失败**: review_history 先 commit（步骤 2），流转操作在独立事务中。如果流转失败（如 dispatch 异常），review_history 已记录。这是预期行为——审阅决策本身已发生，即使后续 dispatch 失败，决策记录不应丢失
5. **revise 路径的 rerun_stage 不存在**: task-02 必须先完成。如果 rerun_stage 未实现，import 会失败。在 task-03 实现时确保 task-02 已合并
6. **change.stages 为 None**: 已通过 `stages = change.stages or {}` 处理

## 非目标

- 不修改 ProposalReviewRequest schema（decision 字段值不变）
- 不修改 router.py 的 proposal-review 路由（endpoint 签名不变）
- 不修改 TRANSITIONS 字典（task-02 负责）
- 不修改 complete_stage（task-01 负责）
- 不修改 plan_review / human_test（task-04/05 负责）
- 不新增数据表或列
- 不修改前端代码（task-07 负责）
- 不实现 review_history 的 API 查询端点（前端直接从 ChangeRead.stages 读取）

## 参考

- design.md AD-02 "rerun_stage 绕过 TRANSITIONS 自环限制" — revise 走 rerun_stage 的理由
- design.md "文件变更清单 > 后端 > service.py" — proposal_review 修正
- plan.md Wave 2 task-03 描述
- service.py L880-927: `proposal_review` 当前实现
- service.py L340-467: `transition` 和 `transition_with_dispatch` 方法
- model.py L84-127: `TRANSITIONS` 字典（propose→plan, propose→brainstorm 边存在）
- model.py L72-81: `HumanGate` 枚举
- schema.py L248-251: `ProposalReviewRequest` DTO
- router.py L348-363: proposal-review 路由端点

## TDD 步骤

### Step 1: 写 review_history 记录测试

在 `test_review_apis.py` 中新增测试类（或新建 test 文件）：

```python
class TestProposalReviewHistory:
    """proposal_review 应在 stages["review_history"] 中追加记录。"""

    @pytest.mark.parametrize("decision,expected_action", [
        ("approve", "transition:plan"),
        ("revise", "rerun:propose"),
        ("unclear", "transition:brainstorm"),
    ])
    def test_review_history_entry_format(self, decision, expected_action):
        """验证 review_history entry 的字段完整性和格式。"""
        # 构造 entry，检查 decision, comment, user_id, submitted_at, from_stage, target_action
        pass

    def test_review_history_is_list(self):
        """review_history 应为 list，支持多次 append。"""
        pass

    def test_review_history_appends(self):
        """连续两次 proposal_review 应追加两条记录。"""
        pass
```

### Step 2: 写 revise 走 rerun_stage 的测试

```python
class TestProposalReviewRevise:
    """revise 决策应调用 rerun_stage("propose")，不走 transition。"""

    async def test_revise_calls_rerun_stage(self):
        """验证 revise 分支调用 rerun_stage 而非 transition_with_dispatch。"""
        # mock rerun_stage，验证被调用且参数正确
        # 验证不抛 InvalidTransition
        pass

    async def test_revise_does_not_call_transition(self):
        """验证 revise 分支不调用 transition_with_dispatch。"""
        pass
```

### Step 3: 写 approve 和 unclear 状态流转测试

```python
class TestProposalReviewApprove:
    async def test_approve_transitions_to_plan(self):
        """approve 决策后 current_stage 应变为 plan。"""
        pass

    async def test_approve_dispatches_plan_agent(self):
        """approve 决策后应 dispatch plan Agent。"""
        pass

class TestProposalReviewUnclear:
    async def test_unclear_transitions_to_brainstorm(self):
        """unclear 决策后 current_stage 应变为 brainstorm。"""
        pass

    async def test_unclear_dispatches_brainstorm_agent(self):
        """unclear 决策后应 dispatch brainstorm Agent。"""
        pass
```

### Step 4: 写 guard 条件测试

```python
class TestProposalReviewGuard:
    async def test_wrong_stage_raises(self):
        """current_stage 不是 propose 时抛 InvalidTransition。"""
        pass

    async def test_wrong_gate_raises(self):
        """human_gate 不是 need_proposal_review 时抛 InvalidTransition。"""
        pass
```

### Step 5: 实现 proposal_review 重写

- 按"接口定义"中的伪代码实现
- 运行 Step 1-4 的测试确认通过

### Step 6: 删除旧的 `stages["last_review"]` 写入

- revise 分支当前写入 `stages["last_review"]`，这被 `review_history` 替代
- 确认无其他代码读取 `last_review`
- 如果有，迁移为从 `review_history[-1]` 读取

### Step 7: 运行全量测试

```bash
cd backend && python -m pytest app/modules/change/tests/ -v
```

## 验收标准

| # | 验收项 | 验证方式 |
|---|--------|----------|
| 1 | guard 条件：`current_stage=="propose" AND human_gate=="need_proposal_review"` 不满足时抛 `InvalidTransition` | 单元测试：wrong_stage 和 wrong_gate 两类 case |
| 2 | approve 决策走 `transition_with_dispatch(propose→plan, role="reviewer")` | 单元测试 mock + 验证调用参数 |
| 3 | approve 决策 dispatch plan Agent | 验证 `transition_with_dispatch` 返回值中有 dispatch 信息 |
| 4 | revise 决策调用 `rerun_stage("propose", comment, user_id)` | 单元测试 mock `rerun_stage`，验证被调用 |
| 5 | revise 决策不抛 `InvalidTransition`（不走 transition 校验） | 单元测试确认 revise 路径无异常 |
| 6 | unclear 决策走 `transition_with_dispatch(propose→brainstorm, role="admin")` | 单元测试 mock + 验证调用参数 |
| 7 | unclear 决策 dispatch brainstorm Agent | 验证 `transition_with_dispatch` 返回值中有 dispatch 信息 |
| 8 | 所有三种决策都追加记录到 `stages["review_history"]` | 三条 case 分别检查 entry 的 decision 和 target_action |
| 9 | review_history entry 包含完整字段：decision, comment, user_id, submitted_at, from_stage, target_action | 逐字段断言 |
| 10 | review_history 是 list，多次调用追加而非覆盖 | 连续两次调用后 list 长度为 2 |
| 11 | comment 为 None 时 review_history 中记录 `"comment": null` | 单独 case 测试 |
| 12 | 旧的 `stages["last_review"]` 写入已删除（revise 分支不再单独写 last_review） | grep 确认 proposal_review 方法中无 `last_review` |
| 13 | 所有 `pytest` 通过 | `cd backend && python -m pytest` |
| 14 | `ruff check` 无新增错误 | `cd backend && ruff check app/modules/change/service.py` |
