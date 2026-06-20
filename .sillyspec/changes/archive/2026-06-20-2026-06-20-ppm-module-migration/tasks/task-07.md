---
id: task-07
title: W5 kanban 子域四件套(聚合 + 拖拽)
priority: P1
estimated_hours: 8
depends_on: [task-03, task-06]
blocks: [task-08, task-12]
requirement_ids: [FR-06]
decision_ids: [D-001@v1]
author: qinyi
created_at: 2026-06-20T14:52:22+0800
---

## 目标
实现 kanban 看板子域(无新表,聚合 `ppm_project_member` + `ppm_plan_task`),端点 users / tasks / assign / reorder / search。覆盖 FR-06、X-001。

## 文件
- 新增 `backend/app/modules/ppm/kanban/{model,router,service,schema}.py`(model 可空或仅聚合 schema)
- 新增 `backend/app/modules/ppm/kanban/tests/test_kanban.py`
- 无迁移(复用 task-03 / task-06 表)

## 实现要点
- 无新表:人员 = 当前用户可见的 `ppm_project_member`,可按 Organization(复用 admin org)分组(X-001);卡片 = `ppm_plan_task`。
- service:`users`(人员列,可按 org 分组)、`tasks`(按 assignee 聚合成卡片)、`assign`(更新 task.assignee_id)、`reorder`(批量持久化 `kanban_order`,W4 已建字段)、`search`(搜人)。
- 参照源 `PpdKanbanService` 的聚合逻辑(本项目平台级无 dept → 改用 org 分组)。
- router `require_permission_any(PPM_*)`;固定路径前置于参数化路由。

## 验收
- [ ] users 返回可见 project_member,支持 org 分组(X-001)
- [ ] tasks 按 assignee 聚合卡片
- [ ] assign 更新 assignee,reorder 持久化 kanban_order
- [ ] search 按关键字搜人
- [ ] 端点 require_permission_any 鉴权,无权限 403
- [ ] pytest 全绿
