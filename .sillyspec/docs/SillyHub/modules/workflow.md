---
schema_version: 1
doc_type: module-card
module_id: workflow
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:16:36
---
# workflow

## 定位
SillySpec 变更与任务的状态流转中枢。用 FSM 约束 Change/Task 合法状态转换，用 spec_guardian 在关键转换前跑前置文档守卫，提供审批（review）与 append-only 审计日志。是 spec 工作流的「状态机引擎 + 质量门禁」。

产品视角：这是 spec「文档驱动开发」的流程引擎。变更从 draft 走到 merged，每个阶段转换都要过质量门禁（proposal/reviewed 需对应文档存在），审批 reject 自动打回 draft 强制迭代。任务有独立状态机。所有转换写审计日志，形成完整的流程追溯链。前端变更详情页的 Gate 面板、阶段进度条都由此驱动。

## 契约摘要
- 路由：`API tag=workflow`
  - `POST /changes/{id}/transition` Change 流转（`TransitionResponse`）
  - `POST /tasks/{id}/transition` Task 流转（`TaskTransitionResponse`）
  - `POST/GET /changes/{id}/reviews` 提交/列审批意见（`ReviewResponse`）
  - `GET /audit-logs` 审计日志（支持 workspace_id / resource_type 过滤，`list[AuditLogEntry]`）
- 数据：`ChangeReview`（verdict approve/reject + comment）、`AuditLog`（append-only）
- FSM：通用 `FSM` 类（name + transitions）；`TaskFSM`；ChangeFSM 已废弃，CHANGE_TRANSITIONS 保留
- spec_guardian：`check_change_ready_for_*` 系列守卫函数，`run_guard` 统一调度
- 依赖：`core`、`models`、`change`（StageEnum/TRANSITIONS/can_transition）、`task`、`release`、`workspace`
- 跨组件协作：change 模块调 transition 推进状态；前端 `lib/workflow.ts` + 变更详情页 Gate 面板；core.audit_hooks 双写审计

## 关键逻辑
转换主链路（`WorkflowService.transition_change`）：
```
change = _get_change(change_id)
violations = run_guard(change, target)           # spec_guardian 前置文档检查
if violations: raise 409 + violations
change.model.can_transition(current, target)     # FSM 校验
change.status = target; _record_audit(...)
```
- guard 规则：draft→proposed 需 master 文档非空；proposed→reviewed 需 proposal；reviewed→approved 需 requirements+design+组件存在；approved→in_progress 需 plan；completed→merged 无额外检查
- submit_review：verdict=reject 自动回退 Change 到 draft，强制重新迭代
- Change 状态：draft→proposed→reviewed→approved→in_progress→completed→merged（rejected 可从多状态触发）
- Task 状态：draft→ready→in_progress→review→done（含 blocked/cancelled 分支）
- guard 内部用 `_check_docs_non_trivial` / `_check_components_exist` / `_check_no_unresolved_reject` 等细粒度检查

### 状态机定义
- Change（change.model）：StageEnum 枚举 + TRANSITIONS 字典，`can_transition(current,target)` 校验
- Task（workflow.fsm）：TASK_TRANSITIONS + TaskFSM，draft→ready→in_progress→review→done（blocked/cancelled 分支）
- FSM 通用类：`valid_states` / `allowed_transitions` / `can_transition` / `validate_transition`，任何状态机可复用
- CHANGE_TRANSITIONS 保留供向后兼容，ChangeFSM 经 `__getattr__` 延迟加载 + DeprecationWarning

## 注意事项
- ChangeFSM 保留向后兼容但已废弃，新代码用 `change.model.StageEnum + TRANSITIONS`
- guard 返回 violations 列表，空列表表示通过，非空返回 409 + violations
- 审计日志由 workflow 内部 + `core.audit_hooks`（SQLA 事件钩子）双写，append-only 不改
- `rejected` 可从 proposed/reviewed/approved/in_progress 多个状态触发
- review reject 强制回退 draft 迭代，是质量门禁的关键设计
- 通用 FSM 引擎可复用于任何状态机场景，TaskFSM 即基于它
- `__getattr__` 延迟加载 ChangeFSM 并发 DeprecationWarning，避免导入即警告
- audit-logs 支持多维过滤，是平台追溯的核心数据源
- `_get_change`/`_get_task` 取实体并校验存在性，缺失抛 NotFound
- `_record_audit` 统一写审计，含 actor/action/resource/before/after
- submit_review 创建 ChangeReview 行，verdict=approve/reject + comment
- list_reviews 按 change_id 列审批历史，供详情页展示
- transition 返回 TransitionResponse 含新状态 + 是否触发副作用
- spec_guardian 各 check 函数返回 violations 列表，run_guard 聚合
- guard 检查文档「非平凡」（非空非模板），避免空文档过门禁
- ChangeFSM 经 __getattr__ 延迟加载，导入 workflow.fsm 不会立即警告
- TASK_TRANSITIONS 含 blocked/cancelled 分支，TaskFSM 基于 FSM 通用类
- transition_change/transition_task 入口分别处理两类实体，共用 _record_audit
- submit_review 的 reject 回退是强制的，无法跳过
- audit-logs 的 resource_type 过滤覆盖 change/task/review 等多类资源
- 前端变更详情页 Gate 面板读取守卫规则展示当前阶段要求
- review verdict 仅 approve/reject 两值，comment 可选
- ChangeReview 记录 reviewer_id + verdict + comment + 时间
- transition 的非法目标状态抛 InvalidTransition
- FSM.allowed_transitions 返回当前状态可去的全部目标
- transition_task 用 TaskFSM 校验后更新 task.status
- list_audit_logs 支持 resource_id 精确定位某实体历史

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
