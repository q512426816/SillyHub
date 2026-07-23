---
author: qinyi
created_at: 2026-07-18 17:26:33
change: 2026-07-18-project-plan-data-scope
---

# 需求：项目计划 / 项目维护 数据权限范围

> 「项目计划」窗口产出，与并行窗口 ppm-data-scope（任务计划/问题清单）为不同模块。

## 功能需求

- **FR-1 身份解析**：解析当前用户的角色（`super_admin` / `DEPTBOSS` / `XMJL`，via `user_roles`）+ `is_platform_admin` + `UserOrganization` 部门子树，产出 `DataScope`。
- **FR-2 项目计划列表 / 导出**：按身份过滤——超管全部；部门经理=部门子树的项目；项目经理=`project_manager_id == 本人`；其他=空。
- **FR-3 项目计划详情三联表**：越权（plan 不在范围内）→ 403。
- **FR-4 项目维护列表**：同 FR-2 规则（项目经理用 `project_manager_id` 反查 `project_id` 子查询）。
- **FR-5 多身份取并集**：部门经理+项目经理 → 两范围 OR。
- **FR-6 项目挂部门**：`PpmProjectMaintenance.organization_id`，现有数据刷项目二部。

## 非功能需求

- **NFR-1**：SQLite（测试）/ PostgreSQL（生产）方言兼容。
- **NFR-2**：性能——现有数据量（20 条）无虞。
- **NFR-3**：不改前端，后端过滤对前端透明。
- **NFR-4**：复用现有角色/组织基础设施，仅 `organization_id` 列 + 索引。
- **NFR-5**：数据范围与功能权限正交（`require_permission_any(PPM_PLAN_READ/PPM_PROJECT_READ)` 保留）。

## 验收标准（详见 design.md §6 AC-1~9）

AC-1 超管全部 / AC-2 部门经理部门子树 / AC-3 项目经理本人 / AC-4 其他空 / AC-5 多身份并集 / AC-6 详情越权 403 / AC-7 项目维护同规则 / AC-8 数据刷项目二部 / AC-9 `is_platform_admin` 兜底。

## 约束

- 文档驱动（design + decisions D-001~D-009@v1 + 本 requirements + plan）。
- 后端改完 curl 实测端点（CONVENTIONS.md）。
- 开工前 `alembic heads` 确认单 head。
- `test_strategy: module`；测试 `cd backend && uv run pytest -q --no-cov`。
- 提交 hook 不跳过（CONVENTIONS.md 双层 hook）。
