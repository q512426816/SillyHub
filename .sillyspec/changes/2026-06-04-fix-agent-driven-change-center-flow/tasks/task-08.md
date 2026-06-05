---
id: task-08
title: "后端状态流转测试（complete_stage + rerun_stage + review API + archive-confirm）"
priority: P0
estimated_hours: 3
depends_on: [task-01, task-02, task-03, task-04, task-05, task-06]
blocks: []
author: WhaleFall
created_at: 2026-06-04 13:50:10
---

# task-08: 后端状态流转全链路测试

本任务为 Wave 5 收尾测试，验证 task-01 ~ task-06 实现的 complete_stage、rerun_stage、proposal_review、plan_review、human_test、archive_confirm 全部状态流转路径的正确性。

## 修改文件

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `backend/app/modules/change/tests/test_review_apis.py` | 大幅扩展 | 新增 complete_stage / rerun_stage / proposal_review / plan_review / human_test / archive_confirm 全链路集成测试 |
| `backend/app/modules/change/tests/test_gate_transitions.py` | 扩展 | 新增 verify→propose 回退边断言、resolve_human_gate 全返回 none 断言、complete_stage 阶段映射参数化测试 |
| `backend/app/modules/change/tests/test_complete_stage.py` | 新增（由 task-01 创建） | 确认已有 _resolve_stage_completion 参数化测试和 complete_stage 集成测试；本任务补充缺失场景 |

## 实现要求

### 1. resolve_human_gate 全返回 none（对应 FR-01）

验证 task-01 修改后 `resolve_human_gate` 对所有阶段返回 `HumanGate.NONE`。

```python
# test_gate_transitions.py
@pytest.mark.parametrize("stage", [
    "brainstorm", "propose", "plan", "verify", "archive",
    "execute", "quick", "scan", "draft", "blocked", "archived",
    "unknown_stage",
])
def test_resolve_human_gate_always_none(stage):
    assert resolve_human_gate(stage) == HumanGate.NONE
```

### 2. complete_stage 阶段映射（对应 FR-01, FR-02）

验证 `_resolve_stage_completion` 静态方法与 design.md 映射表一致。

测试用例表：

| # | stage | result | expected_stage | expected_gate | expected_dispatch |
|---|-------|--------|----------------|---------------|-------------------|
| 1 | brainstorm | clear | propose | none | propose |
| 2 | brainstorm | ambiguous | brainstorm | need_requirement_input | None |
| 3 | brainstorm | None | brainstorm | need_requirement_input | None |
| 4 | propose | None | propose | need_proposal_review | None |
| 5 | plan | None | plan | need_plan_review | None |
| 6 | execute | None | verify | none | verify |
| 7 | verify | passed | verify | need_human_test | None |
| 8 | verify | failed | quick | none | quick |
| 9 | verify | None | quick | none | quick |
| 10 | quick | None | verify | none | verify |
| 11 | archive | None | archived | none | None |
| 12 | unknown | None | unknown | none | None |

### 3. complete_stage 集成测试（对应 FR-02）

使用真实 DB session 验证 complete_stage 方法正确更新 Change 记录的 current_stage、human_gate、stages JSON。

关键测试：
- `test_complete_stage_brainstorm_clear`: brainstorm+clear → propose, gate=none, dispatch_target=propose
- `test_complete_stage_brainstorm_ambiguous`: brainstorm+ambiguous → brainstorm, gate=need_requirement_input, dispatch_target=None
- `test_complete_stage_propose`: propose → propose, gate=need_proposal_review
- `test_complete_stage_plan`: plan → plan, gate=need_plan_review
- `test_complete_stage_execute`: execute → verify, gate=none, dispatch_target=verify
- `test_complete_stage_verify_passed`: verify+passed → verify, gate=need_human_test
- `test_complete_stage_verify_failed`: verify+failed → quick, gate=none, dispatch_target=quick
- `test_complete_stage_archive`: archive → archived, gate=none

每个测试创建一个 change 记录，设 initial current_stage，调用 complete_stage，断言 change 刷新后的 current_stage、human_gate、stages["last_stage_completion"]。

### 4. transition 时 gate=none（对应 FR-01 场景 1）

验证 draft→brainstorm 的 transition 后 human_gate=none（不是 need_requirement_input）。

```python
async def test_transition_to_brainstorm_gate_none(db_session):
    ws = await _create_test_workspace(db_session)
    change = await _create_test_change(db_session, workspace_id=ws.id, current_stage="draft")
    svc = ChangeService(db_session)
    change = await svc.transition(ws.id, change.id, "brainstorm", "agent")
    assert change.human_gate == "none"
```

### 5. rerun_stage 测试（对应 FR-03）

验证 rerun_stage 方法绕过 TRANSITIONS 自环限制，不抛 InvalidTransition。

| # | 测试名 | 场景 | 断言 |
|---|--------|------|------|
| 1 | `test_rerun_stage_propose` | propose+need_proposal_review → rerun_stage("propose") | human_gate=none, dispatch propose Agent, 不抛 InvalidTransition |
| 2 | `test_rerun_stage_plan` | plan+need_plan_review → rerun_stage("plan") | human_gate=none, dispatch plan Agent, 不抛 InvalidTransition |
| 3 | `test_rerun_stage_with_comment` | rerun_stage("propose", comment="需要补充边界条件") | stages JSON 记录 comment |
| 4 | `test_rerun_stage_wrong_stage` | propose 阶段 rerun_stage("plan") | 抛 InvalidTransition（stage 不匹配 current_stage） |
| 5 | `test_rerun_stage_gate_none` | rerun 后 human_gate 必须为 none | 直接断言 change.human_gate == "none" |

### 6. proposal_review 测试（对应 FR-05）

| # | 测试名 | 场景 | 断言 |
|---|--------|------|------|
| 1 | `test_proposal_review_approve` | propose+need_proposal_review, decision=approve | current_stage=plan, human_gate=none（transition 设 none，后续 Agent complete_stage("plan") 再设 need_plan_review）, dispatch plan Agent |
| 2 | `test_proposal_review_revise` | propose+need_proposal_review, decision=revise | 调用 rerun_stage("propose"), 不抛 InvalidTransition, dispatch propose Agent |
| 3 | `test_proposal_review_unclear` | propose+need_proposal_review, decision=unclear | current_stage=brainstorm, dispatch brainstorm Agent |
| 4 | `test_proposal_review_invalid_stage` | plan 阶段调用 proposal_review | 抛 InvalidTransition |
| 5 | `test_proposal_review_invalid_gate` | propose 阶段但 gate=none | 抛 InvalidTransition |
| 6 | `test_proposal_review_history` | 任意 decision | stages["review_history"] 包含 {stage: "propose", decision, comment, reviewer_id, at} |

### 7. plan_review 测试（对应 FR-06）

| # | 测试名 | 场景 | 断言 |
|---|--------|------|------|
| 1 | `test_plan_review_approve` | plan+need_plan_review, decision=approve | current_stage=execute, dispatch execute Agent |
| 2 | `test_plan_review_replan` | plan+need_plan_review, decision=replan | 调用 rerun_stage("plan"), 不抛 InvalidTransition |
| 3 | `test_plan_review_back_to_propose` | plan+need_plan_review, decision=back_to_propose | current_stage=propose, dispatch propose Agent |
| 4 | `test_plan_review_back_to_brainstorm` | plan+need_plan_review, decision=back_to_brainstorm | current_stage=brainstorm, dispatch brainstorm Agent |
| 5 | `test_plan_review_invalid_stage` | propose 阶段调用 | 抛 InvalidTransition |
| 6 | `test_plan_review_invalid_gate` | plan 阶段但 gate=none | 抛 InvalidTransition |
| 7 | `test_plan_review_invalid_decision` | decision="typo_value" | 抛 ValueError 或 InvalidTransition（不静默走 else） |
| 8 | `test_plan_review_history` | 任意 decision | stages["review_history"] 包含记录 |

### 8. human_test 测试（对应 FR-07）

| # | 测试名 | 场景 | 断言 |
|---|--------|------|------|
| 1 | `test_human_test_pass` | verify+need_human_test, result=pass | current_stage=archive, human_gate=need_archive_confirm, **无** agent_dispatch |
| 2 | `test_human_test_bug` | verify+need_human_test, result=bug | current_stage=quick, dispatch quick Agent |
| 3 | `test_human_test_doc_mismatch` | verify+need_human_test, result=doc_mismatch | current_stage=propose, dispatch propose Agent（依赖 verify→propose 回退边） |
| 4 | `test_human_test_wrong_stage` | plan 阶段调用 | 抛 InvalidTransition |
| 5 | `test_human_test_wrong_gate` | verify 阶段但 gate=none | 抛 InvalidTransition |
| 6 | `test_human_test_review_history` | 任意 result | stages["last_review"] 包含 {decision, comment, user_id, submitted_at, from_stage, target_action} |

### 9. archive_confirm 测试（对应 FR-08）

| # | 测试名 | 场景 | 断言 |
|---|--------|------|------|
| 1 | `test_archive_confirm` | archive+need_archive_confirm → POST archive-confirm | human_gate=none, dispatch archive Agent |
| 2 | `test_archive_confirm_wrong_stage` | verify+need_human_test → POST archive-confirm | 返回 400 或抛 InvalidTransition |
| 3 | `test_archive_confirm_wrong_gate` | archive+gate=none → POST archive-confirm | 返回 400 或抛 InvalidTransition |
| 4 | `test_complete_stage_archive_to_archived` | complete_stage("archive") | current_stage=archived, human_gate=none, location=archive（或不变） |

### 10. TRANSITIONS verify→propose 回退边（对应 FR-04）

在 `test_gate_transitions.py` 中更新现有 `test_verify_exits` 测试，断言 verify 出边包含 PROPOSE。

```python
def test_verify_has_propose_exit(self):
    verify_targets = set(TRANSITIONS[StageEnum.VERIFY].keys())
    assert StageEnum.PROPOSE in verify_targets
```

注意：当前 test_gate_transitions.py 第 57 行 `test_verify_exits` 断言 `verify_targets == {StageEnum.QUICK, StageEnum.ARCHIVE, StageEnum.BLOCKED}`，task-02 会添加 PROPOSE 边，此测试需同步更新。

### 11. review_history 追加模式（对应 FR-05 全局要求）

验证多次 review 操作后 review_history 是追加而非覆盖。

```python
async def test_review_history_appends(db_session):
    # 1. proposal_review("approve") → 记录 1 条
    # 2. plan_review("replan") → 记录第 2 条
    # 3. 断言 stages["review_history"] 长度为 2
    assert len(change.stages["review_history"]) == 2
```

## 接口定义

本任务不新增接口。测试调用的方法签名如下（由 task-01 ~ task-06 提供）：

| 方法 | 来源任务 | 签名 |
|------|----------|------|
| `complete_stage` | task-01 | `complete_stage(workspace_id, change_id, stage, result, summary) -> CompleteStageResult` |
| `rerun_stage` | task-02 | `rerun_stage(workspace_id, change_id, stage, comment, user_id) -> dict` |
| `proposal_review` | task-03 | `proposal_review(workspace_id, change_id, decision, comment, user_id) -> dict` |
| `plan_review` | task-04 | `plan_review(workspace_id, change_id, decision, comment, user_id) -> dict` |
| `human_test` | task-05 | `human_test(workspace_id, change_id, result, comment, user_id) -> dict` |
| `archive_confirm` | task-06 | `archive_confirm(workspace_id, change_id, comment, user_id) -> dict` |
| `transition` | 已有 | `transition(workspace_id, change_id, target_stage, user_role, reason) -> Change` |

## 边界处理

| # | 边界场景 | 测试覆盖 |
|---|----------|----------|
| 1 | transition 进入 brainstorm 时 gate=none（非 need_requirement_input） | `test_transition_to_brainstorm_gate_none` — 断言 gate 不是 need_requirement_input |
| 2 | proposal_review revise 不抛 InvalidTransition（绕过 propose→propose 自环） | `test_proposal_review_revise` — 验证无异常 |
| 3 | plan_review replan 不抛 InvalidTransition（绕过 plan→plan 自环） | `test_plan_review_replan` — 验证无异常 |
| 4 | human_test pass 不 dispatch archive Agent | `test_human_test_pass` — 断言返回值中无 dispatch 或 dispatch 为空 |
| 5 | human_test doc_mismatch 从 verify 回到 propose（verify→propose 回退边） | `test_human_test_doc_mismatch` — 依赖 TRANSITIONS verify 出边含 PROPOSE |
| 6 | archive_confirm 只在 archive+need_archive_confirm 时允许 | `test_archive_confirm_wrong_stage` + `test_archive_confirm_wrong_gate` |
| 7 | review_history 多次操作追加而非覆盖 | `test_review_history_appends` — 两次操作后长度为 2 |
| 8 | 无效 decision 值被拒绝而非静默走 else | `test_plan_review_invalid_decision` — 断言抛异常 |
| 9 | complete_stage 对未知 stage 不崩溃 | `_resolve_stage_completion` 参数化测试含 unknown stage |
| 10 | rerun_stage 的 stage 与 current_stage 不匹配时拒绝 | `test_rerun_stage_wrong_stage` |

## 非目标

- 不修改任何 production 代码（service.py / model.py / router.py / schema.py）
- 不修改前端代码
- 不修改 test_dispatch.py（dispatch 细节由 test_dispatch.py 已有测试覆盖）
- 不测试 auto_dispatch_next_step 的内部逻辑（已有 test_dispatch.py 覆盖）
- 不测试 verify auto-fix count >= 3 的 blocked 逻辑（由 test_dispatch.py 覆盖）
- 不测试 chain limit 逻辑（由 test_dispatch.py 覆盖）

## 参考

- design.md: AD-01（gate 时机）、AD-02（rerun_stage）、AD-03（verify→propose）、AD-04（pass 不 dispatch archive）、AD-05（archive-confirm API）、complete_stage 映射表
- plan.md: Wave 5, task-08 描述
- requirements.md: FR-01 ~ FR-08
- `service.py`: L37-48（resolve_human_gate）、L340-467（transition/transition_with_dispatch）、L880-1035（proposal_review/plan_review/human_test）
- `model.py`: L72-81（HumanGate 枚举）、L84-127（TRANSITIONS 字典）
- `backend/conftest.py`: db_session / db_engine / client fixture
- `test_dispatch.py`: L173-198（_create_test_change / _create_test_workspace helper 函数）
- `test_review_apis.py`: 现有 schema 验证测试
- `test_gate_transitions.py`: 现有 TRANSITIONS 表测试

## TDD

本任务本身就是 TDD 的验证阶段。task-01 ~ task-06 的每个任务都有各自的单元测试要求。本任务补充全链路集成测试，确保各 task 实现之间的交互正确。

### 测试执行顺序

1. **先运行 task-01 ~ task-06 各自的单元测试**，确认全部通过
2. **运行本任务的集成测试**，覆盖跨 task 的状态流转
3. **运行全量 pytest**，确认无回归

### 测试辅助函数

复用 test_dispatch.py 中的 `_create_test_change` 和 `_create_test_workspace` helper。若需要更多定制（如设 human_gate），可新增 helper：

```python
async def _create_change_at_stage(
    session: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    current_stage: str,
    human_gate: str = "none",
) -> Change:
    change = Change(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        change_key=f"test-{uuid.uuid4().hex[:8]}",
        title="Test Change",
        status="in_progress",
        location="active",
        path="/tmp/test-change",
        current_stage=current_stage,
        human_gate=human_gate,
        stages={},
    )
    session.add(change)
    await session.commit()
    await session.refresh(change)
    return change
```

### Mock 策略

- `transition_with_dispatch` 内部的 dispatch 调用需要 mock（避免真实 Agent 启动）
- `complete_stage` 本身不需要 mock（直接测试 DB 更新）
- `rerun_stage` 内部的 dispatch 需要 mock
- archive_confirm 的 dispatch 需要 mock

Mock 模式参考 test_dispatch.py：

```python
with patch("app.modules.agent.service.AgentService.start_stage_dispatch", new_callable=AsyncMock) as mock_start:
    mock_start.return_value = AgentRun(id=uuid.uuid4(), change_id=change.id, agent_type="claude_code", status="pending")
    # ... 调用被测方法
```

## 验收标准

| # | 标准 | 验证方式 |
|---|------|----------|
| 1 | transition 进入 brainstorm 时 human_gate=none（非 need_requirement_input） | `test_transition_to_brainstorm_gate_none` |
| 2 | complete_stage("propose") 设 human_gate=need_proposal_review | `test_complete_stage_propose` |
| 3 | complete_stage("plan") 设 human_gate=need_plan_review | `test_complete_stage_plan` |
| 4 | complete_stage("verify", passed) 设 human_gate=need_human_test | `test_complete_stage_verify_passed` |
| 5 | complete_stage("brainstorm", clear) → propose + gate=none + dispatch propose | `test_complete_stage_brainstorm_clear` |
| 6 | complete_stage("brainstorm", ambiguous) → gate=need_requirement_input | `test_complete_stage_brainstorm_ambiguous` |
| 7 | complete_stage("execute") → verify + gate=none + dispatch verify | `test_complete_stage_execute` |
| 8 | rerun_stage("propose") 不抛 InvalidTransition | `test_rerun_stage_propose` |
| 9 | rerun_stage("plan") 不抛 InvalidTransition | `test_rerun_stage_plan` |
| 10 | proposal_review approve → plan + dispatch | `test_proposal_review_approve` |
| 11 | proposal_review revise → rerun propose | `test_proposal_review_revise` |
| 12 | proposal_review unclear → brainstorm + dispatch | `test_proposal_review_unclear` |
| 13 | plan_review approve → execute + dispatch | `test_plan_review_approve` |
| 14 | plan_review replan → rerun plan | `test_plan_review_replan` |
| 15 | human_test pass → archive + need_archive_confirm, 无 dispatch | `test_human_test_pass` |
| 16 | human_test bug → quick + dispatch | `test_human_test_bug` |
| 17 | human_test doc_mismatch → propose + dispatch | `test_human_test_doc_mismatch` |
| 18 | archive-confirm → dispatch archive | `test_archive_confirm` |
| 19 | TRANSITIONS verify→propose 回退边存在 | `test_verify_has_propose_exit` |
| 20 | review_history 对所有 review 操作正确记录 | `test_proposal_review_history` + `test_plan_review_history` + `test_review_history_appends` |
| 21 | 全部 pytest 通过 | `cd backend && python -m pytest app/modules/change/tests/ -v` |
| 22 | ruff check 无新增错误 | `cd backend && ruff check app/modules/change/` |
