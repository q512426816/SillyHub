---
id: task-06
title: W4 task 子域四件套 + 工时统计
priority: P0
estimated_hours: 12
depends_on: [task-01]
blocks: [task-07, task-08, task-12]
requirement_ids: [FR-05]
decision_ids: [D-001@v1, D-003@v1]
author: qinyi
created_at: 2026-06-20T14:52:22+0800
---

## 目标
实现 task 任务计划/执行/工时子域,CRUD + `executePlan`(联动生成 TaskExecute)+ 工时统计(`stat-by-user` / `stat-by-project`)+ `list-by-date-range` + `personal-task-plan`(按当前登录人过滤)+ `export-excel`。覆盖 FR-05、D-001@v1、D-003@v1。

## 文件
- 新增 `backend/app/modules/ppm/task/{model,router,service,schema}.py`
- 新增 `backend/app/modules/ppm/task/tests/test_task.py`
- 新增 `backend/migrations/versions/2026mmdd_create_ppm_task_tables.py`(3 表)

## 实现要点
- model:3 表 `ppm_plan_task`(含 `kanban_order`)、`ppm_task_execute`、`ppm_work_hour`;继承 `BaseModel`;字段对齐源 DO(`dal/dataobject/task/`),`work_hour.tenant_id` 丢弃(D-008@v1)。
- service:`executePlan` 单事务联动生成 TaskExecute;统计端点 group by user / project 聚合 work_hour;`personal-task-plan` 用 `current_user.id` 过滤。
- export:openpyxl 同步 `def` 端点或 `anyio.to_thread.run_sync`(X-002),复用 `common/export.py` 配置驱动。
- router `require_permission_any(PPM_*)`;固定路径前置于参数化路由。

## 验收
- [ ] 3 表 alembic upgrade 成功
- [ ] CRUD + executePlan 联动 + 统计 + 日期范围 + 个人任务过滤 pytest 全绿
- [ ] export-excel 导出正常(同步端点 / anyio.to_thread)
- [ ] personal-task-plan 仅返回当前登录人数据
- [ ] 端点 require_permission_any 鉴权,无权限 403
