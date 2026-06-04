---
author: WhaleFall
created_at: 2026-06-04 10:50:53
task: task-09
title: plan-review API + Schema
wave: W3
priority: P0
estimate: 2h
depends_on: [task-04]
---

# task-09: plan-review API + Schema

## 目标

实现 plan 阶段的人工确认 API。approve 进入 execute，replan 重新生成，可退回 propose 或 brainstorm。

## 不在范围

- 不实现 proposal-review（task-08）和 human-test（task-10）

## 输入

- `backend/app/modules/change/router.py`
- `backend/app/modules/change/service.py`
- `backend/app/modules/change/schema.py`

## 产出

- `backend/app/modules/change/schema.py`（改，新增 PlanReviewRequest）
- `backend/app/modules/change/service.py`（改，新增 plan_review 方法）
- `backend/app/modules/change/router.py`（改，新增路由）

## 实现步骤

1. 在 `schema.py` 新增：
   ```python
   class PlanReviewRequest(BaseModel):
       decision: Literal["approve", "replan", "back_to_propose", "back_to_brainstorm"]
       comment: str | None = None
   ```
2. 在 `service.py` 新增 `plan_review()`：
   - 校验 `current_stage == "plan"` 且 `human_gate == "need_plan_review"`
   - approve: transition→execute, dispatch execute agent, human_gate=none
   - replan: 不变 stage, dispatch plan agent 携带 comment
   - back_to_propose: transition→propose, dispatch propose agent
   - back_to_brainstorm: transition→brainstorm, human_gate=need_requirement_input
3. 在 `router.py` 新增 `POST /changes/{change_id}/plan-review`

## 验收标准

- [ ] approve 后 execute agent 被 dispatch
- [ ] replan 后 plan agent 携带 comment 重新 dispatch
- [ ] back_to_propose 后 propose agent 被 dispatch
- [ ] back_to_brainstorm 后 current_stage=brainstorm, human_gate=need_requirement_input
- [ ] 非 plan stage 调用返回 409

## 风险

- approve 后 execute 自动运行，完成后自动进入 verify（task-07 的 auto_dispatch_next_step 处理）

## DoD

- [ ] 代码修改完成
- [ ] 无 lint/type 错误
