---
author: WhaleFall
created_at: 2026-07-22T09:25:00
---

# 需求（Requirements）— 项目计划 project_name join 改造

## 功能需求

- **FR-1**：`list_ps_project_plans` 返回的 project_name 来自 `outerjoin ppm_project_maintenance`（真名），不再依赖 `PsProjectPlan.project_name` 冗余字段。
- **FR-2**：`get_ps_project_plan` 返回的 project_name 同样来自 join。
- **FR-3**：`list_ps_project_plans_for_export` 导出的 project_name 来自 join。
- **FR-4**：项目改名后，项目计划列表/详情/导出的 project_name 自动反映新名（无需任何同步逻辑）。
- **FR-5**：删除 `project/service.py:213-222` 改名同步逻辑。
- **FR-6**：按 project_name 筛选/排序基于 join 的 `PpmProjectMaintenance.project_name`。

## 非功能需求

- **NFR-1**：list 仍支持分页/排序/计数（复用 common/crud 的 apply_pagination/apply_sort/count_total）。
- **NFR-2**：补单测覆盖 list/get 返回真名、改名后反映、筛选/排序基于 join。
- **NFR-3**：后端改完 curl 实测（CONVENTIONS 教训）。
- **NFR-4**：无 DB 迁移、无 schema 变更、无 API 契约变更。

## 验收标准

- **AC-1**：项目计划列表「项目名称」列显示项目表真名（不再是 id/null）。
- **AC-2**：在 `/ppm/projects` 改某项目名称 → `/ppm/project-plans` 列表自动显示新名（无需编辑项目计划）。
- **AC-3**：按项目名称筛选/排序正常（基于 join 字段）。
- **AC-4**：导出 Excel 的项目名称列为真名。
- **AC-5**：新增单测全绿；既有测试不回归。
