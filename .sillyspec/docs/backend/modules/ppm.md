---
schema_version: 1
doc_type: module-card
module_id: ppm
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 项目管理业务域（ppm）

## 定位
**已上线的业务域**（全仓唯一正式上线模块，改动要求最高历史兼容与回归保障）：项目管理六子域——项目维护、项目计划、任务执行与工时、问题清单与变更、协作看板、个人工作台。六个 router 自身不带 prefix，由 main.py 统一挂 `/api/ppm`。表结构沿用既有 PPM 系统（Ps*/Ppm* 前缀），非 SillySpec 侧新设计。

## 契约摘要
- **project**：项目维护（PpmProjectMaintenance + 成员 PpmProjectMember + 干系人 PpmProjectStakeholder）与客户维护（PpmCustomerMaintenance），维护 CRUD + `export-excel`；项目维度还持有 workspace↔PPM 项目绑定的对称端点（workspace 侧 `/api/workspaces/{id}/ppm-projects` 在 workspace 模块 link_router）。
- **plan**：计划节点三级（PlanNode / PlanNodeDetail / PlanNodeModule，detail 有自身 FSM 白名单）+ 项目计划（PsProjectPlan / PsPlanNode / PsPlanNodeDetail / PsPlanNodeDetailProcess），put/delete/get + `project-plan` 分页 + importer + export-excel。
- **task**：任务计划 PlanTask（`task-plan/update|get|delete|page|execute|export-excel`；`personal-task-plan/page|list-by-date-range` 按人过滤）、任务执行 TaskExecute（`task-execute/update|get|delete|page|list-by-date-range`，execute 更新带归属校验）、工时 WorkHour（`work-hour/update` 等）。
- **problem**：问题清单 PpmProblemList（status 3 态中文，对齐 PlanTask；审批流节点 `ProblemNode` 10-40）+ 问题变更 PpmProblemChange（审批流状态：审核中/已完成/已作废；`{item_id}/next` 推进、`{item_id}/reject` 作废；bug 类型跳部门经理节点）+ 流程任务/日志表 + `import-template` / importer / export。
- **kanban**：`/kanban/users|tasks|workload-grid|search/users`、任务 CRUD（`POST|PUT|DELETE /kanban/task`）、`assign`、`reorder`、评论（PpmKanbanComment）、子任务（PpmKanbanSubtask + toggle）。
- **workbench**：`profile`（支持 `target_user_id` 切换查看）/ `summary` / `calendar` / `todos` / `switchable-users`（经理‖超管可切换，D-005@v1；超管列全部 active 用户）。
- 公共能力（common/）：crud / export（excel）/ upload / fsm / ownership / uuid_type；`data_scope.py` 供 plan/project 注入 where 过滤。

## 关键逻辑
```
DataScope 三档（common/data_scope.py）:
  超管（is_platform_admin ‖ super_admin 角色）→ is_full=True 看全部
  经理（项目成员角色含 部门经理/项目经理/开发经理/业务经理 任一）→ manager_project_ids 集合
  其余 → 仅凭 created_by 可见自己创建的
resolve_owner（common/ownership.py，代填冒名防护）:
  非管理员显式把归属字段（execute_user_id/check_user_id/current_user_id/user_id）
  填成非自己 → 403 PpmOwnershipDenied; admin 可代填; None 不校验; 自填报放行
  校验在 service 层（纵深防御），router 透传登录 User
FSM（common/fsm.py）: TransitionMap 白名单 + assert_transition/can_transition,
  非法迁移抛 InvalidTransition（422）; problem/plan 各自定义 TRANSITIONS
```

## 注意事项
- **数据范围单一可信源 = PpmProjectMember.role_name**（2026-07-22 权限统一）：经理判定不再用系统 RBAC 角色 / `PsProjectPlan.project_manager_id` / 部门组织树——改权限口径必须对齐这条，不引入平行判定，否则任务计划/问题清单/项目计划三处口径分裂。
- `common/fsm.assert_transition` 被 **incident 模块跨域复用**；改 helper 签名/错误类型波及 incident 的 422 语义。
- health 的 system-status 直接 count 本域 PlanTask / PpmProjectMaintenance / PsPlanNode（users/projects/tasks/milestones 四指标之三）。
- 导出（export-excel）与导入（import-template / importer）列结构是前端契约，改字段先双侧核对模板。
- 上线模块回归底线：本域全量 pytest（500 级用例）+ mypy（pre-commit 实际跑 mypy 不只 ruff，AppError.details 为 dict|None，断言索引前须 narrow）。
- `concerns: large-domain`：单模块承载 20+ 张表，新功能优先考虑独立子域目录而非往现有 service 堆方法。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
