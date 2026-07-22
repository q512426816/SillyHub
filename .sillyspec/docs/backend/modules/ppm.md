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
- `/api/ppm/plan-node*` — 计划节点 CRUD；`/plan-node-detail-tpl*` 明细模板；`/plan-node-module*` 模块；`/plan-node/{id}/modules/import-preview|import-commit` 实施阶段模块 Excel 导入（两级：模块+明细，2026-07-14-milestone-module-import）；`/ps-project-plan*` / `/ps-plan-node*` ps 执行表
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
- 导出文件名统一用 `common/export.py::timestamped_filename(label)` 生成「中文标签_YYYYMMDD_HHMMSS.xlsx」（ql-20260714-002）；各子域导出端点直接传中文 label（如 `timestamped_filename("里程碑明细")`），勿内联 f-string 重复造轮子
- plan 子域有"模板表（PlanNodeDetailTpl/Module）"与"ps 执行表（PsProjectPlan/PsPlanNode/...）"两套，前者定义后者实例化
- task 的 `execute_plan` 用 `_assert_transition` 校验状态迁移，非法抛 `IllegalStatusTransition`
- 202607220900_alter_ppm_fk_to_uuid 迁移把 ppm 外键从 varchar 改 uuid，若依式 map_fk 失败会产生孤儿 FK（plan_node_id NULL）
- health.router 延迟 import ppm.plan/project model，存在跨模块弱依赖
- **模块导入（2026-07-14-milestone-module-import）**：实施阶段里程碑下 `PlanNodeModule` 加 `plan_type`（正常/临时计划，String(32) nullable，旧数据 NULL）；`importer.py` 按表头名解析 Excel（D-007，非列号，容错列位变化）；service `import_preview`/`import_commit` 两阶段无状态端点（预览后确认 D-006），`import_commit` 用 `session.add()`+末尾单次 `commit()` 原子提交（**不复用 `_Crud.create`** 其逐条 commit 破坏原子性，D-008），含同名合并/模块自动汇总(min/max/sum/首个)；router 加文件大小(10MB)/类型校验(413/415)+`plan_node_id`/`pm_project_id` 用 `uuid.UUID`(422)；责任人按姓名 ORM 全量反查 `PpmProjectMember`（不走分页），未匹配行跳过

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->

## 变更索引
- ql-20260714-001-8c02 | plan 子域 export-excel 路由顺序修复（前置 {item_id}）+ 回归测试
- ql-20260714-002-1036 | ppm 导出文件名统一「中文+日期时间」timestamped_filename（common helper，5 端点共用）
- 2026-07-14-milestone-module-import | 里程碑明细·实施阶段 模块导入（plan_type 字段+migration；Excel 两级导入：importer 按表头名/import_preview 责任人反查/import_commit D-008 单事务原子/router 两端点/前端三态弹窗 + 单测&集成测试）
- ql-20260722-003-f7d9 | problem-list 列表页改造（前端归属默认全部/问题类型入展开/17列重排+bug标红+责任人&处置人合并列+预估·已消耗合并列；后端 service 排序白名单加 plan_start_time 支持按计划开始时间正序；router list 回填 now_handle_user_name 历史仅存 id 处置人反查 display_name）
- ql-20260722-004 | problem 数据范围补创建人可见(common/data_scope.problem_scope_clause 加 created_by==user.id,修"能编辑却在列表看不见自己创建的问题"矛盾)+ 详情页展示创建人/创建时间(schema ProblemListResp 加 created_by_name,router 列表批量+详情单条反查 display_name)
- 2026-07-22-ppm-permission-by-project-member-role | PPM 权限统一到「项目成员角色」:项目计划/项目维护数据范围(data_scope.py 根)从「系统 RBAC 角色 XMJL/DEPTBOSS + PsProjectPlan.project_manager_id + 部门组织树」改为复用 common.data_scope 的 manager_project_ids(PpmProjectMember.role_name),与任务/问题同口径;DataScope 改 (is_full, manager_project_ids, creator_user_id)。项目计划编辑/删除加 can_operate_plan(超管‖创建人‖本项目经理)+ PsProjectPlanResp.can_edit/can_delete,前端 project-plans/milestone-details 编辑门改读后端标志(对齐问题清单)。行为变化:普通用户获自建可见;部门经理不再自动看本部门全部项目(需配成员角色);里程碑页经理角色成员可编辑。项目维护写操作/任务编辑不在本次范围
