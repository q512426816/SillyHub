---
id: task-07
title: main.py 注册 link_router
title_zh: 主应用注册工作区关联路由
author: qinyi
created_at: 2026-07-28 14:05:41
priority: P0
depends_on: [task-05]
blocks: [task-08]
requirement_ids: [FR-03]
decision_ids: []
allowed_paths:
  - backend/app/main.py
goal: >
  在 main.py 用 sibling include 方式注册 link_router,使工作区维度关联端点挂载到 /api 下可访问。
implementation:
  - 在 main.py 仿 members_router 注册处(约 main.py:485)新增 app.include_router(link_router, prefix="/api")
  - 确认 link_router 从 workspace 模块正确 import
acceptance:
  - link_router 注册成功,GET /api/workspaces/{id}/ppm-projects 可访问
  - 应用启动无 import 错误
verify:
  - "cd backend && uv run python -c \"from app.main import app; print(any('ppm-projects' in str(r.path) for r in app.routes))\""
constraints:
  - sibling include 仿 members_router 范式,不改 workspace_router 本体
---
