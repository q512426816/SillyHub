---
schema_version: 1
doc_type: module-card
module_id: ppm
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:09:00
---
# ppm

## 定位
项目管理域（对齐源 ppdmq-module-ppm），5 个子域 router 由 app.main 统一挂载到 `/api/ppm`：project（项目/客户/成员/干系人）、plan（计划节点/明细/模块 + ps 执行表）、task（计划任务/执行/工时）、problem（问题列表 + 流转）、kanban（看板卡片/评论/子任务）。共享 common 子包（CRUD 分页/FSM/导出/UUID 类型）。

## 契约摘要
- `/api/ppm/project-maintenance*` — 项目维保 CRUD + 分页 + 导出 excel；`/customer-maintenance*` 同构；项目成员/干系人子资源
- `/api/ppm/plan-node*` — 计划节点 CRUD；`/plan-node-detail-tpl*` 明细模板；`/plan-node-module*` 模块；`/ps-project-plan*` / `/ps-plan-node*` ps 执行表
- `/api/ppm/task-plan/*` — 计划任务 CRUD + execute 流转 + 导出；`/personal-task-plan/*` 个人视角
- `/api/ppm/problem-list*` — 问题 CRUD + `/next` `/reject` 流转 + 按日期范围查 + 导出
- `/api/ppm/kanban/*` — 用户列 / 任务卡片 / assign / reorder / search / 评论 / 子任务
- Service：ProjectMaintenance/CustomerMaintenance/ProjectMember/ProjectStakeholder/Plan/PlanTask/TaskExecute/WorkHour/Problem/PpdKanban 等

## 关键逻辑
```
# common/crud.py 提供通用分页排序：
apply_pagination(stmt, req)   # req.offset = (page-1)*page_size
apply_sort(stmt, order_by, order, allowed)
count_total(session, stmt) → Page[T].build(items, total, req)

# common/fsm.py 通用状态机：
StateMachine(current, TRANSITIONS, entity=...).transition(target)
# 各子域自定义 TRANSITIONS（如 plan/fsm.PlanNodeDetailStatus、problem fsm）

# 列表统一默认查 20 条（PageReq 默认 page_size=20）
# 计划任务执行：execute_plan 校验 IllegalStatusTransition
```

## 注意事项
- 5 子域 router 自身不带 prefix，由 `app.main` 统一 `include_router(..., prefix="/api/ppm")` 挂载
- common/fsm.py 是通用 `StateMachine[S]`（泛型），各子域定义自己的 TRANSITIONS（如 problem、plan-node-detail）
- common/crud.py 的 `PageReq`/`Page[T]`/`apply_sort`/`apply_pagination` 是全 ppm 分页排序统一入口；列表默认 page_size=20
- common/export.py 提供 excel 导出（openpyxl），5 子域（project/plan/task/problem/kanban）均有 `/export-excel` 端点
- ⚠ **export-excel 路由顺序坑（已复现 3 次：problem ql-020、project、plan ql-20260714-001）**：FastAPI 按注册顺序匹配，字面量路径 `/xxx/export-excel` 必须声明在 `/xxx/{item_id}` **之前**，否则 `export-excel` 被 `{item_id}` 当 UUID 解析返回 422。新增导出端点务必前置注册 + 加路由顺序回归测试（参照 `ppm/project/tests/test_router.py`、`ppm/plan/tests/test_router.py`）
- plan 子域有"模板表（PlanNodeDetailTpl/Module）"与"ps 执行表（PsProjectPlan/PsPlanNode/...）"两套，前者定义后者实例化
- task 的 `execute_plan` 用 `_assert_transition` 校验状态迁移，非法抛 `IllegalStatusTransition`
- 202607220900_alter_ppm_fk_to_uuid 迁移把 ppm 外键从 varchar 改 uuid，若依式 map_fk 失败会产生孤儿 FK（plan_node_id NULL）
- health.router 延迟 import ppm.plan/project model，存在跨模块弱依赖

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->

## 变更索引
- ql-20260714-001-8c02 | plan 子域 export-excel 路由顺序修复（前置 {item_id}）+ 回归测试
