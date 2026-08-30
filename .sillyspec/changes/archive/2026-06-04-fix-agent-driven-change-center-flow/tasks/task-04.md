---
id: task-04
title: "修正 plan-review（approve→execute, replan→rerun, back_to_propose, back_to_brainstorm）+ 记录 review_history"
priority: P0
estimated_hours: 2
depends_on:
  - task-01
  - task-02
blocks:
  - task-07
author: WhaleFall
created_at: 2026-06-04 13:50:10
---

## 修改文件

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `backend/app/modules/change/service.py` | 修改 | 重写 `plan_review` 方法：guard 条件、rerun 调用、transition 路径、review_history 记录 |
| `backend/app/modules/change/tests/test_review_apis.py` | 新增 | plan-review 各 decision 的单元测试 |

## 实现要求

### 1. Guard 条件

`plan_review` 入口保持现有 guard 不变：

```python
if change.current_stage != "plan" or change.human_gate != "need_plan_review":
    raise InvalidTransition(...)
```

### 2. "approve" 决策 — transition plan→execute + dispatch execute Agent

调用 `transition_with_dispatch` 完成 plan→execute 的流转，user_role="reviewer"。dispatch 会自动派发 execute Agent。

**与当前代码的区别**：当前代码在 approve 时已正确走 `transition_with_dispatch(target_stage="execute")`，但需要确认 transition 方法中 `resolve_human_gate` 已按 AD-01 返回 none（由 task-01 保证），这样 dispatch 后 Agent 完成时才由 `complete_stage` 设置正确的 gate。

### 3. "replan" 决策 — 调用 rerun_stage("plan", comment)

**必须改为调用 `rerun_stage`**，不再走 `transition_with_dispatch(target_stage="plan")`。

当前代码问题：`replan` 分支手动清 gate + 记 last_review + 再走 transition_with_dispatch 跳转到 plan。但 TRANSITIONS 中 plan→plan 不存在（且按 AD-02 不加自环边），所以会抛 InvalidTransition。

修正后：
```python
elif decision == "replan":
    return await self.rerun_stage(
        workspace_id=workspace_id,
        change_id=change_id,
        stage="plan",
        comment=comment,
        user_id=user_id,
    )
```

`rerun_stage` 由 task-02 提供，它绕过 TRANSITIONS 校验，直接重置 human_gate=none 并 dispatch plan Agent。

### 4. "back_to_propose" 决策 — transition plan→propose + dispatch propose Agent

当前代码已正确：`transition_with_dispatch(target_stage="propose", user_role="admin")`。

TRANSITIONS 中 `Plan → Propose` 已存在，允许 `"reviewer"` 角色（admin 绕过）。dispatch 会自动派发 propose Agent。

**确认要点**：dispatch 派发 propose Agent 后，Agent 完成时 `complete_stage("propose")` 会设 `human_gate=need_proposal_review`（由 task-01 保证）。

### 5. "back_to_brainstorm" 决策 — transition plan→brainstorm + dispatch brainstorm Agent

当前代码已正确：`transition_with_dispatch(target_stage="brainstorm", user_role="admin")`。

TRANSITIONS 中 `Plan → Brainstorm` 已存在。dispatch 会自动派发 brainstorm Agent。

### 6. 记录 review_history

**所有 4 个决策分支都必须记录 review_history**，格式统一为：

```python
stages = change.stages or {}
review_history = stages.get("review_history", [])
review_history.append({
    "stage": "plan",
    "decision": decision,
    "comment": comment,
    "reviewer_id": str(user_id),
    "at": datetime.now(UTC).isoformat(),
})
stages["review_history"] = review_history
change.stages = stages
```

记录时机：在每个分支执行核心逻辑之前，先写入 review_history 并 commit（或在 transition/rerun 内部统一 commit，但 review_history 本身必须在决策时立即持久化，不能丢失）。

**注意**：`rerun_stage` 方法内部可能也会写 stages 字段，所以对于 "replan" 分支，需要在调用 `rerun_stage` 之前先写入 review_history。

## 接口定义

### plan_review 签名（不变）

```python
async def plan_review(
    self,
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    decision: str,       # "approve" | "replan" | "back_to_propose" | "back_to_brainstorm"
    comment: str | None,
    user_id: uuid.UUID,
) -> dict:
```

### 依赖的方法（由 task-01/task-02 提供）

| 方法 | 来源 | 签名 |
|------|------|------|
| `rerun_stage` | task-02 | `rerun_stage(workspace_id, change_id, stage, comment, user_id) -> dict` |
| `transition_with_dispatch` | 已有 | `transition_with_dispatch(workspace_id, change_id, target_stage, user_role, reason, user_id) -> dict` |

### 决策→动作映射表

| decision | 动作 | 调用方法 | target_stage | user_role |
|----------|------|----------|--------------|-----------|
| approve | plan→execute + dispatch execute Agent | `transition_with_dispatch` | execute | reviewer |
| replan | 重跑 plan 阶段 | `rerun_stage` | plan | — |
| back_to_propose | plan→propose + dispatch propose Agent | `transition_with_dispatch` | propose | admin |
| back_to_brainstorm | plan→brainstorm + dispatch brainstorm Agent | `transition_with_dispatch` | brainstorm | admin |

## 边界处理

1. **非法状态调用**：`current_stage != "plan"` 或 `human_gate != "need_plan_review"` 时，抛 InvalidTransition，附带 details 含 current_stage 和 human_gate 的实际值。保持现有行为不变。

2. **非法 decision 值**：传入不在 `{"approve", "replan", "back_to_propose", "back_to_brainstorm"}` 中的 decision 值。应在方法开头校验 decision 合法性，不合法时抛 ValueError 或 InvalidTransition，而非静默走 else 分支到 back_to_brainstorm。**这是一个对当前代码的改进点**——当前 else 默认走 back_to_brainstorm，如果前端传了 typo 会静默错误。

3. **replan 时 rerun_stage 不存在**：如果 task-02 尚未合入，调用 `self.rerun_stage` 会 AttributeError。这是正常的开发顺序依赖，测试时应确保 task-02 已完成。不需要做 fallback。

4. **comment 为 None 时的 review_history 记录**：review_history 中的 comment 字段允许 None 值，不需要做默认值转换。前端可能不传 comment。

5. **back_to_propose/back_to_brainstorm 的角色权限**：TRANSITIONS 中 plan→propose 允许 reviewer，plan→brainstorm 允许 reviewer。代码中用 user_role="admin" 是安全做法（admin 绕过所有检查），但语义上 "reviewer" 已足够。保持 "admin" 不变，避免权限过于细粒度导致回退操作被普通 reviewer 滥用。

6. **并发安全**：如果两个用户同时调用 plan_review，第二个会因为 guard 条件（human_gate 已被第一个请求改为 none 或其他值）而失败。这是正确行为。

## 非目标

- 不修改 `transition_with_dispatch` 的签名或行为
- 不修改 `rerun_stage` 的实现（由 task-02 负责）
- 不修改 TRANSITIONS 字典（plan 的出边已满足需求）
- 不修改 `resolve_human_gate`（由 task-01 负责）
- 不修改前端 Gate 面板（由 task-07 负责）
- 不处理 plan_review 的路由层（路由层已存在，不需要修改）

## 参考

- `design.md` AD-01（gate 时机）、AD-02（rerun_stage 绕过 TRANSITIONS）
- `plan.md` Wave 2 / task-04 行
- `service.py` 第 929-985 行（当前 plan_review 实现）
- `model.py` 第 84-113 行（TRANSITIONS 定义，Plan 出边）
- `service.py` 第 412-440 行（transition_with_dispatch）
- task-03 的 review_history 记录格式（同一变更同一 Wave）

## TDD

### 测试用例优先级排序

1. **test_plan_review_approve**：plan+need_plan_review 状态下 approve → 验证 transition 到 execute、dispatch execute Agent、review_history 有记录
2. **test_plan_review_replan**：plan+need_plan_review 状态下 replan → 验证调用 rerun_stage、不抛 InvalidTransition、review_history 有记录
3. **test_plan_review_back_to_propose**：plan+need_plan_review 状态下 back_to_propose → 验证 transition 到 propose、dispatch propose Agent、review_history 有记录
4. **test_plan_review_back_to_brainstorm**：plan+need_plan_review 状态下 back_to_brainstorm → 验证 transition 到 brainstorm、dispatch brainstorm Agent、review_history 有记录
5. **test_plan_review_invalid_stage**：非 plan 阶段调用 → InvalidTransition
6. **test_plan_review_invalid_gate**：plan 阶段但 human_gate 不是 need_plan_review → InvalidTransition
7. **test_plan_review_invalid_decision**：传入非法 decision 值 → ValueError 或 InvalidTransition
8. **test_plan_review_history_persistence**：验证 review_history 追加而非覆盖（多次 review 后历史完整）
9. **test_plan_review_comment_none**：comment 为 None 时不报错，review_history 中 comment 字段为 null

### 测试文件

`backend/app/modules/change/tests/test_review_apis.py`

### 测试策略

- 每个测试创建 change 记录并设 `current_stage="plan", human_gate="need_plan_review"`
- mock `rerun_stage` 和 `transition_with_dispatch` 验证调用参数
- 直接读 change.stages["review_history"] 验证记录内容

## 验收标准

| # | 标准 | 验证方式 |
|---|------|----------|
| 1 | plan_review("approve") 正确 transition 到 execute 并 dispatch execute Agent | 单元测试：mock transition_with_dispatch，验证 target_stage="execute" |
| 2 | plan_review("replan") 调用 rerun_stage("plan", comment) 而非 transition_with_dispatch | 单元测试：mock rerun_stage，验证被调用；mock transition_with_dispatch，验证未被调用 |
| 3 | plan_review("replan") 不抛 InvalidTransition | 集成测试：真实调用，确认不走 TRANSITIONS 校验 |
| 4 | plan_review("back_to_propose") 正确 transition 到 propose | 单元测试：验证 target_stage="propose" |
| 5 | plan_review("back_to_brainstorm") 正确 transition 到 brainstorm | 单元测试：验证 target_stage="brainstorm" |
| 6 | 所有 4 个决策都记录 review_history（含 stage, decision, comment, reviewer_id, at） | 单元测试：断言 change.stages["review_history"] 长度和内容 |
| 7 | review_history 是追加而非覆盖 | 多次 review 后验证 history 列表长度递增 |
| 8 | 非 plan 阶段或非 need_plan_review gate 调用时抛 InvalidTransition | 单元测试 |
| 9 | 非法 decision 值抛异常而非静默走 else | 单元测试 |
| 10 | ruff + mypy 检查通过 | `ruff check` + `mypy` |
