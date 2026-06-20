---
id: task-08
title: W5 main.py 注册所有 ppm 子域路由
priority: P0
estimated_hours: 2
depends_on: [task-03, task-04, task-05, task-06, task-07]
blocks: [task-09]
requirement_ids: []
decision_ids: [D-001@v1]
author: qinyi
created_at: 2026-06-20T14:52:22+0800
---

## 目标
在 `backend/app/main.py` 的 `create_app` 内 `include_router` 注册所有 ppm 子域 router,统一 `prefix="/api/ppm"`(平台级)。覆盖 D-001@v1。

## 文件
- 修改 `backend/app/main.py`(`create_app` 内追加 include_router)

## 实现要点
- 注册子域:project / plan / problem / task / kanban,均 `prefix="/api/ppm"`(D-001@v1 平台级,无 workspace_id)。
- 固定路径(如 `/export-excel`、`/stat-by-user`)需前置于参数化路由(如 `/{id}`),否则 FastAPI 路径匹配会误命中参数分支 —— 在各子域 router 内部已保证,本任务仅聚合注册。
- 不新增鉴权逻辑(各 router 自带 `require_permission_any(PPM_*)`)。

## 验收
- [ ] `GET /api/ppm/{project,plan,problem,task,kanban}/*` 各核心端点可访问(返回 200/401/403 而非 404)
- [ ] 现有 auth/admin/workspace/change/release 路由不受影响(回归)
- [ ] backend pytest 全绿
