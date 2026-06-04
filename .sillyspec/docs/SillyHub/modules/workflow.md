---
author: qinyi
created_at: 2026-06-01T12:00:00
---

# workflow
> 最后更新：2026-06-01
> 最近变更：scan（初始生成）
> 模块路径：backend/app/modules/workflow/**

## 职责

管理变更（Change）和任务（Task）的状态流转，提供审批（review）和审计日志功能。通过 FSM 约束合法状态转换，通过 spec_guardian 在关键转换前执行前置条件检查。

## 当前设计

```
router.py         ── HTTP 入口（/workflow）
service.py        ── WorkflowService，状态流转 + review + audit
fsm.py            ── 通用 FSM 引擎 + TaskFSM（ChangeFSM 已废弃）
spec_guardian.py  ── 转换前置条件守卫（guard rules）
model.py          ── ChangeReview / AuditLog (SQLModel tables)
schema.py         ── Pydantic DTOs（Transition/Review/AuditLog/TaskTransition）
tests/            ── test_fsm.py / test_spec_guardian.py / test_router.py / test_audit_hooks.py
```

### Change 状态机（已迁移至 change.model.StageEnum + TRANSITIONS）

```
draft -> proposed -> reviewed -> approved -> in_progress -> completed -> merged
  ^                                                               |
  +------------------------ rejected <----------------------------+
```

### Task 状态机（TaskFSM）

```
draft -> ready -> in_progress -> review -> done
                     |    ^
                     v    |
                   blocked
                     |
                     v
                 cancelled
```

### Guard Rules（spec_guardian）

| 转换 | 守卫函数 | 检查内容 |
|------|----------|----------|
| draft -> proposed | `check_change_ready_for_proposed` | 需要 master 文档非空 |
| proposed -> reviewed | `check_change_ready_for_reviewed` | 需要 proposal 文档非空 |
| reviewed -> approved | `check_change_ready_for_approved` | 需要 requirements + design 文档非空、组件存在 |
| approved -> in_progress | `check_change_ready_for_in_progress` | 需要 plan 文档非空 |
| in_progress -> completed | `check_change_ready_for_completed` | 无额外检查 |
| completed -> merged | `check_change_ready_for_merged` | 无额外检查 |

## 对外接口（表格）

| 方法 | 路径 | 说明 | 返回类型 |
|------|------|------|----------|
| POST | `/workflow/changes/{change_id}/transition` | Change 状态流转 | `TransitionResponse` |
| POST | `/workflow/changes/{change_id}/reviews` | 提交审批意见 | `ReviewResponse` |
| GET | `/workflow/changes/{change_id}/reviews` | 列出审批意见 | `list[ReviewResponse]` |
| GET | `/workflow/audit-logs` | 查询审计日志（支持 workspace_id / resource_type 过滤） | `list[AuditLogEntry]` |
| POST | `/workflow/tasks/{task_id}/transition` | Task 状态流转 | `TaskTransitionResponse` |

所有端点需要认证 + `require_permission`。

## 关键数据流

1. **change transition**：
   - 获取 Change -> `run_guard()` 执行守卫检查 -> 检查不通过返回 409 + violations
   - `can_transition()` 验证合法转换 -> 更新 status -> `_record_audit()` 记录审计日志

2. **submit_review**：
   - 创建 `ChangeReview`（verdict: approve/reject + comment）
   - 若 verdict=reject，自动将 Change 状态回退到 `draft`
   - 记录审计日志

3. **task transition**：
   - `TaskFSM.validate_transition()` 校验 -> 更新 task status
   - 记录审计日志

4. **audit log**：
   - 支持按 `workspace_id` 和 `resource_type` 过滤
   - 由 workflow 内部操作和外部 `audit_hooks` 共同写入

## 设计决策（表格）

| 决策 | 原因 |
|------|------|
| ChangeFSM 废弃迁移 | 状态定义迁移到 `change.model.StageEnum`，更贴近领域模型 |
| Guard 前置检查 | 防止不满足条件的转换（如缺少必要文档） |
| Review 即驳回 | reject verdict 自动回退到 draft，强制重新迭代 |
| 审计日志 append-only | AuditLog 只增不改，保证追溯完整性 |
| 通用 FSM 引擎 | `FSM` 类可复用于任何状态机场景 |

## 依赖关系

- `app.core.auth_deps` — get_current_user, require_permission
- `app.core.db` — get_session
- `app.core.errors` — AppError, ChangeNotFound, InvalidTransition, TaskNotFound
- `app.core.logging` — get_logger
- `app.modules.auth.model` — User
- `app.modules.auth.permissions` — Permission
- `app.modules.change.model` — Change, ChangeDocument, StageEnum, TRANSITIONS, can_transition
- `app.modules.task.model` — Task
- `app.modules.workspace.model` — Workspace

## 注意事项

- `ChangeFSM` 已废弃但保留向后兼容，通过 `__getattr__` + `DeprecationWarning` 延迟加载
- Guard rule 返回 violations 列表，空列表表示通过
- 审计日志由 `workflow` 模块内部和 `app.core.audit_hooks`（SQLAlchemy 事件钩子）双重写入
- `rejected` 状态可从 `proposed`/`reviewed`/`approved`/`in_progress` 多个状态触发

## 变更索引（表格，初始为空）

| 变更ID | 日期 | 改动摘要 |
|--------|------|----------|
