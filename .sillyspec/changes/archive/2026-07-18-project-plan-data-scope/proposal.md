---
author: qinyi
created_at: 2026-07-18 17:26:33
change: 2026-07-18-project-plan-data-scope
---

# 提案：项目计划 / 项目维护 数据权限范围

> 本变更为「项目计划」窗口产出，与并行窗口 `2026-07-18-ppm-data-scope`（任务计划/问题清单）是**不同模块**，各自独立变更目录，互不覆盖。

## 背景

PPM「项目计划」(`GET /api/ppm/project-plan`) 与「项目维护」(`GET /api/ppm/project`) 列表当前对任何持功能权限的用户返回全部数据（各 20 条），无按人/部门的数据范围过滤。

## 目标

按当前登录用户身份限定可见的项目计划与项目：

- 超级管理员（`super_admin` 角色 OR `is_platform_admin`）→ 全部
- 部门经理（`DEPTBOSS` 角色）→ 所属部门（`UserOrganization`）+ 下级部门的全部项目
- 项目经理（`XMJL` 角色）→ 自己是项目经理的（`project_manager_id == 本人`）
- 其他用户 → 空（接口可调，返回空列表）
- 多身份取并集

## 影响范围

- 后端 PPM `plan` + `project` 子域的列表/导出/详情查询。
- 数据模型：`PpmProjectMaintenance` 新增 `organization_id`（FK→organizations.id）。
- 新增 `app/modules/ppm/data_scope.py`（`DataScope` + `get_ppm_data_scope` 依赖项）。
- 现有数据：20 个项目一次性刷到项目二部（`dept_103` / `9f968a5f-…`）。
- 前端零改动。
- 角色复用已有（`super_admin` / `DEPTBOSS` / `XMJL`），不新建。

## 非目标

- 不改前端。
- 不新建 RBAC 角色。
- 不覆盖 PPM 其他子域（problem / kanban / task）的数据范围（task 在并行窗口做）。
- 不做「项目成员表 `role_name`」维度的过滤。

## 风险

alembic 多 head 断链、`pm_user_id == None` 误命中、`in_(空集)` 方言差异、项目经理反查子查询性能、刷数据写死 UUID —— 对策见 design.md §8。
