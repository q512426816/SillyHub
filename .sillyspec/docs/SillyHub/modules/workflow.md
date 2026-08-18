---
schema_version: 1
doc_type: module-card
module_id: workflow
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 任务状态机与审计（workflow）

## 定位
任务状态机 + 平台审计底座。
经过多轮收敛（change 流转逻辑内聚回 change 模块后），本模块现提供：
通用 FSM 引擎与 TaskFSM、任务流转端点、ChangeReview / AuditLog 两张表的模型与查询。
AuditLog 是全平台 append-only 审计汇聚点——
core.audit_hooks / auth / admin / settings / tool_gateway / spec_workspace / change 都在写它。

## 契约摘要
- 路由（仅 3 端点，`tag=workflow`）：
  - `GET /workspaces/{ws}/changes/{change_id}/reviews` 列审批意见
    （`list[ReviewResponse]`，变更详情页审批历史数据源）
  - `GET /workspaces/{ws}/audit` 审计日志
    （resource_type 过滤 + limit 1..500 默认 100，`list[AuditLogEntry]`）
  - `POST /workspaces/{ws}/tasks/{task_id}/transition` 任务流转
    （TASK_ASSIGN 权限，返回 `TaskTransitionResponse`：id/status/previous_status）
- 数据（model.py）：
  - `ChangeReview`（change_reviews 表）：change_id + reviewer_id +
    verdict（仅 approve / reject）+ comment + created_at
  - `AuditLog`（audit_logs 表，append-only）：workspace_id（FK SET NULL）/ actor_id /
    action / resource_type / resource_id / details_json / timestamp；
    索引 (workspace_id,timestamp) 与 (resource_type,resource_id)
  - 审计 action 常量集中定义于此（AUTH_LOGIN_SUCCESS / AUTH_LOGIN_FAILED /
    PLATFORM_SETTING_CREATE / PLATFORM_SETTING_UPDATE）——service 代码禁止内联
    action 字面量（2026-08-14-audit-system-completion 方案 B）；
    `AUDIT_PLACEHOLDER_ID` 全零占位 UUID 供无具体资源场景（resource_id 非空但无 FK）
- FSM（fsm.py）：
  - 通用 `FSM` 类（邻接表驱动）：valid_states / allowed_transitions / can_transition /
    validate_transition，非法转换抛 `TransitionError`（409，details 带
    fsm/current/target/allowed，文案中文）
  - `TASK_TRANSITIONS`：draft→ready→in_progress→review→done，
    in_progress/blocked→cancelled，blocked→in_progress，review→in_progress，
    done/cancelled 终态；`TaskFSM = FSM("Task", ...)` 实例
  - 旧 ChangeFSM / CHANGE_TRANSITIONS 已删除（Change 状态机归 change 模块）

## 关键逻辑
transition_task（`WorkflowService`）：
```
task = _get_task(workspace 内校验存在性)
TaskFSM.validate_transition(prev, target)     # 非法 409
task.status = target → commit
_record_audit(action="task.transition", before/after)
```

## 注意事项
- **spec_guardian（check_change_ready_for_* / run_guard）当前无生产调用方**：
  全仓仅本模块测试 import。change 阶段流转（transition / complete_stage / rerun_stage
  及其门禁）已内聚到 change.service。重构 change 流转时需决定接回或删除，
  避免留而未用的守卫逻辑与真实门禁漂移
- Change 的 reject-回退-draft 质量门禁已随 change 模块走；本模块对 reviews 只读不写 verdict
- AuditLog 是跨模块共享模型：其它模块 import workflow.model 属正常依赖；
  改表结构影响面大（审计钩子 / 登录 / 设置 / 工具网关全在写）
- 守卫规则参考（保留在 spec_guardian）：draft→proposed 需 master 文档、
  proposed→reviewed 需 proposal、reviewed→approved 需 requirements+design 且全部
  文档 ≥100 词（G4）+ 影响组件存在（G5）、approved→in_progress 需 plan 且无未消化
  reject（G7）、completed→merged 无额外检查
- audit 查询按 workspace 隔离；resource_type 过滤覆盖 change / task / tool_operation
  等多类资源
- list_reviews / list_audit_logs 是纯查询；transition_task 是本模块唯一写路径

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
