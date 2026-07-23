---
author: qinyi
created_at: 2026-07-14 08:59:41
change: 2026-07-13-ppm-personal-workbench-prototype
---

# 决策台账（Decisions）— PPM 个人工作台

本变更的决策台账。每条含稳定版本 ID（D-xxx@vN）。原型阶段（brainstorm 前序）的 D-001~D-003@原型版 针对静态原型，本实现方案将其演进（见 D-002/D-003 的 supersedes 说明）。

---

## D-001@v1 — 页面路由独立子路径
- **type**: architecture
- **status**: accepted
- **source**: 用户范围确认（核心工作台）+ 现状调研（/ppm 当前 redirect 到 /ppm/projects）
- **question**: 工作台放在 `/ppm`（接管 redirect）还是 `/ppm/workbench`（新增子路由）？
- **answer**: 新增 `/ppm/workbench` 子路由，保留 `/ppm → /ppm/projects` 不变，菜单加"个人工作台"项放第一位。
- **normalized_requirement**: FR-路由：工作台入口 = `/ppm/workbench`；不破坏现有 `/ppm` redirect 契约。
- **impacts**: 前端新建 `ppm/workbench/page.tsx`；`app-shell.tsx` 加菜单项；不改 `ppm/page.tsx`。
- **evidence**: `frontend/src/app/(dashboard)/ppm/page.tsx`（当前 redirect）；调研结论 §前端路由。
- **priority**: P1

## D-002@v1 — 工号 = User 表加 employee_no 列
- **type**: data-model
- **status**: accepted
- **source**: 用户确认"用户表补工号"
- **question**: 当前登录人的「工号」从哪来？User 表无此字段。
- **answer**: `users` 表新增 `employee_no VARCHAR(50) NULL` 列（alembic migration，down=20260713_fix_session_zombie）+ User ORM + UserRead schema 加字段。nullable，老用户为空显示"—"。
- **normalized_requirement**: FR-工号：MeResponse.user.employee_no 可选返回；工作台 profile 显示工号，空则"—"。
- **supersedes**: 原型版 D-002@原型版（当时"只做原型不改源码"，本实现推翻为真实加列）。
- **impacts**: `auth/model.py` User 加字段；`auth/schema.py` UserRead 加字段；新增 migration；前端 api-types 重生成。
- **evidence**: `backend/app/modules/auth/model.py:27`（User 表无 employee_no）；`auth/schema.py:31` UserRead；迁移链 head=`20260713_fix_session_zombie`。
- **priority**: P0

## D-003@v1 — 部门 = user_organizations 关联 organizations 查
- **type**: data-model
- **status**: accepted
- **source**: 用户确认"部门信息应该有" + 调研发现 organizations/user_organizations 表已存在
- **question**: User 表无部门字段，部门数据在哪？
- **answer**: 经 `user_organizations`（user_id↔organization_id M2M）JOIN `organizations`（name/code/parent_id 树形）取部门名。取用户关联的第一条 active 组织作为主部门。
- **normalized_requirement**: FR-部门：profile.department_name = 当前人主部门名，无关联则 null。
- **supersedes**: 原型版 D-003@原型版（当时"样例数据"，本实现接真实组织表）。
- **impacts**: workbench service profile 查询 LEFT JOIN user_organizations+organizations。
- **evidence**: `backend/app/modules/admin/model.py:37`(Organization) `:83`(UserOrganization M2M)。
- **priority**: P0

## D-004@v1 — 角色 = workspaces role_name
- **type**: data-source
- **status**: accepted
- **source**: 调研（MeResponse.workspaces 含 role_name；平台级角色在 user_roles）
- **question**: 原型要显示"项目经理"这种角色名，从哪取？
- **answer**: 优先取 `MeResponse.workspaces[0].role_name`（工作区角色，已有接口）；若空则查 `user_roles`→`roles.name`。不新建角色字段。
- **normalized_requirement**: FR-角色：profile.role_name 取当前人首个非空工作区角色名。
- **impacts**: workbench profile 复用 `list_user_workspace_roles`（auth/rbac.py:115）。
- **evidence**: `auth/schema.py:44` WorkspaceRoleAssignment.role_name；`auth/rbac.py:115`。
- **priority**: P1

## D-005@v1 — 任务表字段缺口不扩接口
- **type**: scope
- **status**: accepted
- **source**: 调研发现 PlanTask 无 project_code / plan_type 字段
- **question**: 原型任务表要显示「项目编码」「计划类型」，但 PlanTask 无对应字段，怎么办？
- **answer**: 不扩 personal-task-plan 接口契约（避免动已有接口）。前端任务表「项目编码」列用 project_name 兼作或留空，「计划类型」列用 module_name 近似展示。任务主题/描述用 content。
- **normalized_requirement**: FR-任务表：列 = 序号/项目名/模块(platform近似)/任务内容/状态/操作；不依赖 project_code/plan_type。
- **impacts**: 前端 WorkbenchTaskTable 列定义；design §7.4。
- **evidence**: `backend/app/modules/ppm/task/model.py:37`(PlanTask 字段：有 project_name/module_name/content，无 project_code/plan_type)；`task/router.py:242`。
- **priority**: P1

## D-006@v1 — 待办从流程在办表派生
- **type**: architecture
- **status**: accepted
- **source**: 用户确认（待办派生）+ 调研（无 todo 表，process_task 记录待处理人）
- **question**: 系统无统一待办表，"我的待办"怎么做？
- **answer**: 派生，不建表。①问题审批待办 = `ppm_problem_list_process_task` / `ppm_problem_change_process_task` 的 `now_handle_user`（逗号分隔）包含当前 user_id；②任务待办 = `ppm_plan_task` where user_id=me AND status!="已完成"。service 读出后 Python 端 split 过滤（不依赖 SQL like，避免方言差异）。
- **normalized_requirement**: FR-待办：todos 列表来自上述两源，带 type 标签（任务/缺陷/计划）。
- **impacts**: workbench service summary 待办查询；design §7.2 / §10 R-02。
- **evidence**: `problem/model.py:242`(PpmProblemListProcessTask.now_handle_user) `:273`(ChangeProcessTask)；`task/model.py:58`(PlanTask.status)。
- **priority**: P1

## D-007@v1 — 消息通知/绩效考评占位
- **type**: scope
- **status**: accepted
- **source**: 用户确认（先做核心，消息/绩效后续单独开变更）
- **question**: 原型有消息通知、绩效考评，系统完全无表，本次做不做？
- **answer**: 本次只做占位空状态（EmptyState + "功能开发中"）。消息通知、绩效考评是独立大模块，后续各自单独开变更。快捷入口"绩效考评"挂占位点击提示未开放。
- **normalized_requirement**: FR-占位：消息通知/绩效考评区块显示空状态，不报错。
- **impacts**: 前端左栏消息通知、右栏快捷入口绩效考评用 EmptyState；不建后端。
- **evidence**: 调研结论（全库无 notification/performance 表）。
- **priority**: P1

## D-008@v1 — 工时数据源 = task_execute.time_spent
- **type**: data-source
- **status**: accepted
- **source**: 调研（ppm_work_hour 表空，实际工时走 task_execute.time_spent，stat-by-user 已用此口径）
- **question**: 本月工时统计从哪个表聚合？
- **answer**: 复用现有 `stat-by-user` 口径——SUM(`ppm_task_execute.time_spent`) by user + 日期范围。work_hours 指标允许为 0。
- **normalized_requirement**: FR-工时：metrics.work_hours = 当月 task_execute.time_spent 之和。
- **impacts**: workbench summary 复用 stat_by_user 逻辑或直接聚合 task_execute。
- **evidence**: `task/service.py` stat_by_user（调研 §后端聚合现状）；`task/model.py:128`(TaskExecute.time_spent)。
- **priority**: P2

## D-009@v1 — 权限复用 PPM_TASK_READ
- **type**: architecture
- **status**: accepted
- **source**: YAGNI + 现状（PPM 已有细粒度权限枚举）
- **question**: workbench 三个聚合接口要新建权限吗？
- **answer**: 不新建。复用 `require_permission_any(Permission.PPM_TASK_READ)`。凡是能看自己任务的人就能看工作台。
- **normalized_requirement**: FR-权限：workbench 接口要求 PPM_TASK_READ。
- **impacts**: workbench router 用 TaskReadUser dependency；不改 permissions.py。
- **evidence**: `task/router.py:59`(TaskReadUser) `:20`(require_permission_any import)。
- **priority**: P2

## D-010@v1 — 延期判定口径
- **type**: business-rule
- **status**: accepted
- **source**: 调研（plan_task 无 is_delay 字段需算；problem 有 is_delay_plan）
- **question**: 任务/问题延期怎么判定？
- **answer**: 任务(plan_task)延期 = `end_time < now AND status != "已完成"`；问题(problem)延期 = 直接用 `is_delay_plan` 字段。延期率 = 延期数 / 总数。
- **normalized_requirement**: FR-延期：metrics.delay_rate 按上述口径；calendar alert_level 用任务延期/临期。
- **impacts**: workbench service summary + calendar 查询逻辑。
- **evidence**: `task/model.py:71`(end_time) `:58`(status)；`problem/model.py:122`(is_delay_plan)。
- **priority**: P2
