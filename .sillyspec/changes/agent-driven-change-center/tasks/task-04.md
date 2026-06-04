---
author: WhaleFall
created_at: 2026-06-04 10:50:53
task: task-04
title: transition() human_gate 联动
wave: W1
priority: P0
estimate: 3h
depends_on: [task-01]
---

# task-04: transition() human_gate 联动

## 目标

`ChangeService.transition()` 完成后根据目标 stage 自动设置 `human_gate`，统一 `ChangeService` 和 `WorkflowService` 两套 transition 路径。

## 不在范围

- 不实现 review API（task-08~10）
- 不修改 dispatch 逻辑（task-07）

## 输入

- `backend/app/modules/change/service.py`（transition 方法）
- `backend/app/modules/workflow/service.py`（transition_change 方法）
- `backend/app/modules/change/model.py`（task-01 产出的 TRANSITIONS）

## 产出

- `backend/app/modules/change/service.py`（改）
- `backend/app/modules/workflow/service.py`（改）

## 实现步骤

1. 在 `ChangeService` 中新增 `_resolve_human_gate(target_stage)` 方法：
   ```python
   def _resolve_human_gate(self, target_stage: str) -> str:
       gate_map = {
           "brainstorm": "need_requirement_input",
           "propose": "need_proposal_review",
           "plan": "need_plan_review",
           "verify": "need_human_test",
           "archive": "need_archive_confirm",
       }
       return gate_map.get(target_stage, "none")
   ```
2. 在 `transition()` 方法中，成功 transition 后调用 `_resolve_human_gate(target_stage)` 设置 `change.human_gate`
3. 在 `WorkflowService.transition_change()` 中同步设置 `change.human_gate`（保持两套路径一致）
4. 确保 `transition_with_dispatch()` 不覆盖 dispatch 设置的 human_gate（dispatch 在 task-07 中处理）

## 验收标准

- [ ] transition 到 propose 后 human_gate=need_proposal_review
- [ ] transition 到 plan 后 human_gate=need_plan_review
- [ ] transition 到 execute 后 human_gate=none
- [ ] transition 到 verify 后 human_gate=need_human_test
- [ ] transition 到 brainstorm 后 human_gate=need_requirement_input
- [ ] WorkflowService.transition_change() 同步设置 human_gate

## 风险

- 两套 transition 路径可能遗漏——逐一检查两个 service 的 transition 方法

## DoD

- [ ] 代码修改完成
- [ ] 无 lint 错误
