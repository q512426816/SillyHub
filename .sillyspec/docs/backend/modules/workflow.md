---
schema_version: 1
doc_type: module-card
module_id: workflow
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 任务流转与审计（workflow）

## 定位

任务 FSM 流转 + 变更评审读取 + 平台审计日志底座。含两块表基础设施：`ChangeReview`
（评审裁决）与 `AuditLog`（append-only 审计，全仓手工审计 + ORM hooks 双写管道的落
点）。`spec_guardian` 是变更阶段前置门禁规则的实现，**当前无生产调用方**。

## 契约摘要

- `POST /api/workspaces/{wid}/tasks/{task_id}/transition` —— 任务状态流转（body 带
  target；FSM 校验 + 审计）
- `GET /api/workspaces/{wid}/changes/{cid}/reviews` —— 评审记录列表（按时间升序）
- `GET /api/workspaces/{wid}/audit` —— 审计日志（resource_type 过滤 + 倒序 limit，
  默认 100）
- `WorkflowService`：transition_task / list_reviews / list_audit_logs
- `FSM`（fsm.py）：邻接表通用状态机（can_transition / validate_transition，非法流转
  抛 `TransitionError` 409，文案中文化）；`TASK_TRANSITIONS` 定义
  draft→ready→in_progress→review→done，in_progress↔blocked，ready/in_progress/blocked
  →cancelled，done/cancelled 终态
- 表 `change_reviews`：change_id + reviewer_id FK CASCADE、verdict（approve/reject）、
  comment
- 表 `audit_logs`：workspace_id / actor_id 可空（删时 SET NULL）、action（≤100）、
  resource_type / resource_id（非空**无 FK**）、details_json、timestamp

## 关键逻辑

```
transition_task(workspace_id, task_id, user, target):
  task = _get_task(...)            # workspace 归属校验
  TaskFSM.validate_transition(task.status, target)   # 违规 → 409
  task.status = target; _record_audit("task.transition", {from, to})
  commit; return (task, previous)
```

- spec_guardian（spec_guardian.py）：`_GUARD_RULES` 按 `(current, target)` 元组注册
  变更阶段前置检查——draft→proposed 需 master 文档、proposed→reviewed 需 proposal、
  reviewed→approved 需全部现有文档词数 ≥100（G4）、approved→in_progress 需 plan 文档
  + 无未决 reject（G7）；`run_guard` 查表执行，未注册的流转返回空
- AuditLog 是全仓审计底座：core `register_audit_hooks` 挂 ORM hooks 自动写 UUID PK
  表；非 UUID PK / 特殊路径（settings、auth 登录等）走手工插行。action 常量集中定义
  在本模块 model（`AUTH_LOGIN_*` / `PLATFORM_SETTING_*`，D-005，service 层禁内联字面
  量）；`AUDIT_PLACEHOLDER_ID`（全零 UUID）供无具体资源场景

## 注意事项

- **spec_guardian 无生产调用方**：`run_guard` 仅被本模块测试引用；变更阶段实际推进
  由 change 模块（形态A 按需触发）+ platform_sync 进度同步控制——guardian 规则若要
  生效需在 change 流转路径显式接线
- change 的阶段流转已不经过本模块（旧 transition_change 链路已不存在），本模块对外
  仅剩任务流转 + 两个读端点 + 审计底座
- AuditLog 的 resource_id 无 FK 且非空：无实体场景必须用 AUDIT_PLACEHOLDER_ID，勿造
  随机 UUID
- 审计 action 新增须先在 model 加常量再引用（守护测试拦内联字面量）
- ChangeReview 目前只有写入方在 change/审批链路，本模块仅提供读；verdict 取值
  approve/reject

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
