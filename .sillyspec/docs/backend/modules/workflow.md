---
author: qinyi
created_at: 2026-05-31T23:30:00
---

# workflow

> 最后更新：2026-05-31
> 最近变更：`bead9ea` fix: QA round 1 — 6 issues; `0d9acde` workflow-sm audit hooks + conftest fix
> 模块路径：`app/modules/workflow/**`

## 职责

工作流/审批流程引擎，提供变更（Change）和任务（Task）的状态机驱动流转、审批投票和统一审计日志。内置 FSM（有限状态机）约束合法转换，Spec Guardian 在转换前检查前置条件（文档完整性、词数门槛、组件存在性等）。

## 当前设计（架构 + 关键逻辑）

**核心组件**：

1. **FSM（`fsm.py`）**：通用有限状态机，基于邻接表实现
   - `FSM` 类：接收 name + transitions dict，提供 `validate_transition()` / `can_transition()` / `allowed_transitions()`
   - 非法转换抛出 `TransitionError`（HTTP 409）

2. **ChangeFSM 状态图**：
   ```
   draft → proposed → reviewed → approved → in_progress → completed → merged
                      ↘ rejected → draft（返工）
   ```
   所有中间状态均可转入 rejected（reviewed/approved/in_progress 亦可 reject）

3. **TaskFSM 状态图**：
   ```
   draft → ready → in_progress → review → done
                       ↘ blocked → in_progress
                       ↘ cancelled
   ready / in_progress / blocked 均可 → cancelled
   review → done | in_progress（驳回）
   ```

4. **Spec Guardian（`spec_guardian.py`）**：转换前置条件检查
   - `draft → proposed`：MASTER.md 必须存在
   - `proposed → reviewed`：Proposal 文档必须存在
   - `reviewed → approved`：Requirements + Design 文档必须存在 + G4（词数 ≥ 100）+ G5（affected_components 对应活跃 workspace）
   - `approved → in_progress`：Plan 文档必须存在 + G7（无未解决的 reject 审批）
   - `in_progress → completed` / `completed → merged`：无硬性要求

5. **WorkflowService（`service.py`）**：
   - `transition_change()`：FSM 校验 → Guardian 检查 → 更新状态 → 审计日志
   - `transition_task()`：FSM 校验 → 更新状态 → 审计日志
   - `submit_review()`：创建审批记录；reject 时自动尝试转 rejected 状态
   - `list_reviews()` / `list_audit_logs()`：查询接口

6. **审计日志（AuditLog）**：所有变更操作 + 工具操作（tool_gateway 双写）统一记录

## 对外接口

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| POST | `/workspaces/{ws_id}/changes/{chg_id}/transition` | 变更状态转换 | CHANGE_UPDATE |
| POST | `/workspaces/{ws_id}/changes/{chg_id}/reviews` | 提交审批 | CHANGE_APPROVE |
| GET | `/workspaces/{ws_id}/changes/{chg_id}/reviews` | 列出审批记录 | CHANGE_READ |
| GET | `/workspaces/{ws_id}/audit` | 查询审计日志（支持 ?resource_type=） | CHANGE_READ |
| POST | `/workspaces/{ws_id}/tasks/{task_id}/transition` | 任务状态转换 | TASK_ASSIGN |

## 关键数据流

```
POST .../changes/{id}/transition {target: "proposed"}
  → WorkflowService.transition_change()
    → _get_change()                    # 加载 + 验证归属
    → ChangeFSM.validate_transition()   # FSM 合法性
    → run_guard()                       # Spec Guardian 前置条件
      → check_change_ready_for_proposed()  # MASTER.md 存在？
      → 返回 violations list
    → violations 非空 → 抛 TransitionError
    → 更新 change.status → 记录 AuditLog → commit

POST .../changes/{id}/reviews {verdict: "reject"}
  → WorkflowService.submit_review()
    → 创建 ChangeReview
    → verdict="reject" → 尝试 ChangeFSM can_transition(current, "rejected")
      → 若允许 → 自动转 rejected 状态
    → 记录 AuditLog → commit
```

## 设计决策

| 决策 | 原因 |
|------|------|
| FSM 通用化（adjacency map） | 可复用于 Change / Task，新增状态机仅需定义 dict |
| Guardian 独立于 FSM | FSM 只管"能不能去"，Guardian 管"该不该去"，职责分离 |
| reject 审批自动触发 rejected 转换 | 减少手动操作，审批流程更流畅 |
| G4 词数门槛 100 | 确保文档非空壳，保证质量基线 |
| G5 组件存在性检查 | 防止引用不存在的组件导致下游执行失败 |
| 审计日志 workspace_id 允许 NULL | tool_gateway 的工具操作日志可能无明确 workspace 上下文 |

## 依赖关系

- **上游**：change（Change / ChangeDocument 模型）、task（Task 模型）
- **下游**：tool_gateway（双写 AuditLog）
- **模型**：ChangeReview（change_reviews 表）、AuditLog（audit_logs 表）
- **索引**：`ix_audit_workspace_ts`、`ix_audit_resource`、`ix_change_reviews_change`

## 注意事项

- Spec Guardian 仅对 Change 转换生效，Task 转换无 Guardian 检查
- `run_guard` 返回的 violations 为 list[str]，不为空时抛 TransitionError 而非逐条返回
- 审计日志为 append-only 模式，无删除/修改接口
- `ChangeFSM` 中 `proposed → rejected` 和 `reviewed → rejected` 等路径意味着任何有审批权的人可单方面 reject

## 变更索引

| 日期 | 变更 |
|------|------|
| 2026-05-31 | 初始归档文档 |
