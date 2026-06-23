---
schema_version: 1
doc_type: module-card
module_id: workflow
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:09:00
---
# workflow

## 定位
变更（change）与任务（task）的状态机门禁中枢。负责流转合法性校验（FSM）、spec guardian 质量门（文档齐全/组件存在/无未决驳回）、以及全程审计（ChangeReview + AuditLog）。是变更从 draft→merged 全生命周期的唯一推进通道。

## 契约摘要
- `POST /api/workspaces/{workspace_id}/workflow/changes/{id}/transition` — 流转 change 到 target 状态
- `POST .../workflow/changes/{id}/review` — 提交评审意见（approve/reject/changes_requested）
- `GET .../workflow/changes/{id}/reviews` — 列评审记录
- `GET .../workflow/changes/{id}/audit-logs` — 列审计日志
- `POST .../workflow/tasks/{id}/transition` — 流转 task
- `WorkflowService.transition_change/transition_task/submit_review/list_reviews/list_audit_logs`
- `run_guard(session, change, target)` → `list[str]`（违规清单，空则放行）
- `FSM`（fsm.py）通用状态机；`CHANGE_TRANSITIONS`/`TASK_TRANSITIONS` 定义迁移图

## 关键逻辑
```
transition_change(workspace, change_id, user, target):
  change = _get_change(...)
  cur = StageEnum(change.current_stage or 'draft')
  tgt = StageEnum(target)
  if not can_transition(cur, tgt): raise InvalidTransition
  violations = await run_guard(session, change, target)   # guardian 检查文档/组件/驳回
  if violations: raise InvalidTransition(violations)
  change.status = change.current_stage = target
  change.human_gate = resolve_human_gate(target)
  _record_audit(action='change.transition', from=prev, to=target)
  commit; return change, prev
```

## 注意事项
- 状态源以 `change.current_stage` 为准（非 `status`），流转同时更新二者保持一致；`status` 为兼容字段
- guardian 规则在 `spec_guardian._GUARD_RULES` 按 `(from, to)` 元组注册，新增门禁加一条 entry
- `ChangeFSM` 已废弃（`__getattr__` 抛 DeprecationWarning），新代码用 `StageEnum + TRANSITIONS`
- 每次流转必写 AuditLog（action=`change.transition`/`task.transition`），admin.organizations_service 也写本表
- `human_gate` 由 `resolve_human_gate(target)` 推导，决定该阶段是否需人工评审
- Spec Guardian 仅对 change 生效，task 流转无 guardian 检查
- reject 评审会自动尝试转入 rejected 状态（若 FSM 允许），任何有审批权者可单方面 reject

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
