---
author: WhaleFall
created_at: 2026-06-04 10:50:53
task: task-08
title: proposal-review API + Schema
wave: W3
priority: P0
estimate: 2h
depends_on: [task-04]
---

# task-08: proposal-review API + Schema

## 目标

实现 propose 阶段的人工确认 API。approve 进入 plan，revise 重新生成，unclear 回到 brainstorm。

## 不在范围

- 不实现 plan-review（task-09）和 human-test（task-10）
- 不修改 transition 逻辑（task-04 已处理）

## 输入

- `backend/app/modules/change/router.py`（现有路由）
- `backend/app/modules/change/service.py`（现有 service）
- `backend/app/modules/change/schema.py`（现有 DTO）

## 产出

- `backend/app/modules/change/schema.py`（改，新增 ProposalReviewRequest/Response）
- `backend/app/modules/change/service.py`（改，新增 proposal_review 方法）
- `backend/app/modules/change/router.py`（改，新增路由）

## 实现步骤

1. 在 `schema.py` 新增：
   ```python
   class ProposalReviewRequest(BaseModel):
       decision: Literal["approve", "revise", "unclear"]
       comment: str | None = None
   ```
2. 在 `service.py` 新增 `proposal_review(workspace_id, change_id, request, user_id)`：
   - 校验 `current_stage == "propose"` 且 `human_gate == "need_proposal_review"`
   - approve: `transition(change, "plan")` → dispatch plan agent → `human_gate = "none"`
   - revise: 不变 stage，dispatch propose agent 并携带 comment → `human_gate = "none"`
   - unclear: `transition(change, "brainstorm")` → `human_gate = "need_requirement_input"`
3. 在 `router.py` 新增 `POST /changes/{change_id}/proposal-review`
4. 记录 review decision 到 `change.stages` JSON 和 AuditLog

## 验收标准

- [ ] approve 后 current_stage=plan, human_gate=none, plan agent 被 dispatch
- [ ] revise 后 propose agent 重新 dispatch，携带 comment
- [ ] unclear 后 current_stage=brainstorm, human_gate=need_requirement_input
- [ ] 非 propose stage 调用返回 409
- [ ] review decision 记录到 AuditLog

## 风险

- approve 的 dispatch 可能需要 worktree——plan stage 的 config 有 `requires_worktree=true`

## DoD

- [ ] 代码修改完成
- [ ] 无 lint/type 错误
