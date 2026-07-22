---
author: WhaleFall
created_at: 2026-07-22T09:25:00
---

# 任务（Tasks）— 项目计划 project_name join 改造

> 实现阶段（plan/execute）会进一步分 Wave。此处先列任务条目。

- [ ] T1：`list_ps_project_plans`（plan/service.py:391）改显式 `outerjoin PpmProjectMaintenance` 取 project_name；不再用 `_Crud.list_paged`，自己写 query + 复用 apply_pagination/apply_sort/count_total；response project_name 用 join 值。
- [ ] T2：`get_ps_project_plan`（540）outerjoin 取 project_name。
- [ ] T3：`list_ps_project_plans_for_export`（1022）outerjoin 取 project_name。
- [ ] T4：筛选 `req.project_name` → `PpmProjectMaintenance.project_name.ilike`；排序 `order_by=project_name` → join 字段（allowed_sort 别名映射）。
- [ ] T5：删 `project/service.py:213-222` 改名同步逻辑（含 old_project_name 辅助变量）。
- [ ] T6：补单测——list/get 返回 project_name=项目表真名（plan/tests/）。
- [ ] T7：补单测——项目改名后 list_ps_project_plans 自动反映新名（验证无需同步）。
- [ ] T8：补单测——按 project_name 筛选/排序基于 join 字段。
- [ ] T9：后端 curl 实测（list/get 返回真名 + 项目改名后列表反映）。
- [ ] T10：浏览器验收（/ppm/project-plans 列表显示真名 + /ppm/projects 改名后计划列表自动更新）。
- [ ] T11：同步模块文档（ppm.md 变更索引）+ quicklog（若分批 quick）。
