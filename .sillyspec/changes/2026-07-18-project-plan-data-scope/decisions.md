---
author: qinyi
created_at: 2026-07-18 17:26:33
change: 2026-07-18-project-plan-data-scope
---

# 决策台账 — 2026-07-18-project-plan-data-scope（项目计划/项目维护）

> 「项目计划」窗口产出。与并行窗口 ppm-data-scope（任务计划/问题清单，按项目成员角色）是不同模块不同方案，勿混淆。

## D-001@v1 · 身份认定基于已有 RBAC 角色（复用不新建）

- **type**: requirement
- **status**: decided
- **source**: 用户对话 2026-07-18（角色已存在 XMJL/DEPTBOSS/super_admin）
- **question**: 部门经理/项目经理/超管身份怎么认定？
- **answer**: 复用已有 RBAC 角色（`super_admin`/`DEPTBOSS`/`XMJL`），查 `user_roles.role.key` 判定。
- **normalized_requirement**: 身份 = 当前用户 `user_roles` 含对应 role key。
- **impacts**: `data_scope.py` 新增 `get_user_role_keys`；无需 seed。
- **evidence**: DB roles 表（super_admin 5/DEPTBOSS 1/XMJL 5，is_system=false）；user_roles 已绑定。
- **priority**: P0

## D-002@v1 · 超管看全部 = super_admin 角色 OR is_platform_admin

- **type**: requirement
- **status**: decided
- **source**: 用户对话（选 super_admin 角色）+ 工程兜底
- **question**: super_admin 指哪些人？
- **answer**: 持 `super_admin` 角色；`is_platform_admin=true` 兜底（admin2 不应被锁）。
- **normalized_requirement**: 看全部 = `super_admin in role_keys OR user.is_platform_admin`。
- **impacts**: `get_ppm_data_scope` 第一分支。
- **evidence**: is_platform_admin=true 仅 admin2，super_admin role 5 人不重合。
- **priority**: P0

## D-003@v1 · 部门经理范围 = UserOrganization 部门 + 子树

- **type**: requirement
- **status**: decided
- **source**: 用户对话（选"所属部门+下级"）
- **question**: 部门经理能看哪些部门？
- **answer**: `UserOrganization` 关联部门 + 各自下级（子树）。
- **normalized_requirement**: `dept_org_ids` = UserOrganization.org_id ∪ 各 `_descendant_ids`。
- **impacts**: 复用 `_descendant_ids`；新增 `_user_org_subtree`。
- **evidence**: `users_service.py:98` 现成参考。
- **priority**: P0

## D-004@v1 · 项目经理锚点 = PsProjectPlan.project_manager_id

- **type**: requirement
- **status**: decided
- **source**: 用户对话（选"项目计划上的项目经理"）
- **question**: 项目经理"自己负责的"怎么判定？
- **answer**: `PsProjectPlan.project_manager_id == user.id`；项目维护反查 project_id。
- **normalized_requirement**: 项目计划 where `project_manager_id == pm_user_id`；项目维护 `id IN (SELECT project_id ...)`。
- **impacts**: plan service where；project service 子查询。
- **evidence**: `plan/model.py:195`。
- **priority**: P0

## D-005@v1 · 多身份取并集

- **type**: requirement
- **status**: decided
- **source**: 用户对话（"多身份取并集"）
- **question**: 一人既是部门经理又是项目经理？
- **answer**: 两范围 OR。
- **normalized_requirement**: `DataScope` 同时携 `dept_org_ids` + `pm_user_id`，where `or_`。
- **impacts**: DataScope 双字段。
- **evidence**: 修京廷同时 DEPTBOSS+XMJL。
- **priority**: P0

## D-006@v1 · 方案 A：依赖项解析 + service 注入

- **type**: design
- **status**: decided
- **source**: 方案对比（用户选方案 A）
- **question**: 过滤架构？
- **answer**: 方案 A（FastAPI 依赖项 `get_ppm_data_scope` → DataScope，service 注入 where）。否决 B（service 内重复）、C（PG RLS SQLite 不兼容）。
- **normalized_requirement**: 依赖项 + 4 查询点注入。
- **impacts**: data_scope.py 新建；router 4 端点；service 4 方法加 scope。
- **evidence**: 方案对比；项目惯例 current_user 依赖项。
- **priority**: P0

## D-007@v1 · 项目挂部门字段 = PpmProjectMaintenance.organization_id

- **type**: design
- **status**: decided
- **source**: 用户对话（"项目挂部门刷到项目二部 dept_103"）
- **question**: 项目怎么挂部门？
- **answer**: `PpmProjectMaintenance` 加 `organization_id`（FK→organizations.id，nullable，索引）+ migration 刷 20 项目到项目二部。
- **normalized_requirement**: 项目主表加 org FK；数据初始化全设项目二部。
- **impacts**: model 加字段；alembic migration；项目计划过滤 join project 取 org_id。
- **evidence**: project/model.py:42 无部门字段；DB 项目二部 id 9f968a5f。
- **priority**: P0

## D-008@v1 · 项目经理项目维护过滤 = project_manager_id 反查 project_id

- **type**: design
- **status**: decided
- **source**: design 推导
- **question**: 项目主表无 manager 字段，项目经理在项目维护怎么过滤？
- **answer**: `id IN (SELECT project_id FROM ppm_ps_project_plan WHERE project_manager_id == user.id)`。
- **normalized_requirement**: 项目维护 pm 分支用 PsProjectPlan 反查。
- **impacts**: project service where 子查询。
- **evidence**: 项目主表无 manager；PsProjectPlan.project_manager_id 存在。
- **priority**: P1

## D-009@v1 · 数据范围与功能权限正交

- **type**: design
- **status**: decided
- **source**: design 推导 + 用户"其他看不到"
- **question**: 数据范围要替代功能权限吗？
- **answer**: 不替代，正交。`require_permission_any(PPM_PLAN_READ/PPM_PROJECT_READ)` 保留；scope 是额外过滤层。
- **normalized_requirement**: 功能权限点不变；scope 叠加。
- **impacts**: router 保留 require_permission + 加 scope。
- **evidence**: `core/auth_deps.py:124`。
- **priority**: P1
