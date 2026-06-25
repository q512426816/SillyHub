---
author: qinyi
created_at: 2026-06-25 17:41:14
---

# Tasks

## 任务列表

| ID | 任务 | 文件路径 | 覆盖 |
|---|---|---|---|
| task-01 | 添加 display_alias 迁移与 ORM 字段 | `backend/migrations/versions/*_add_resource_display_alias.py`, `backend/app/modules/daemon/model.py`, `backend/app/modules/workspace/model.py` | FR-03, D-002@v1 |
| task-02 | 扩展 daemon runtime DTO、分页查询和别名更新接口 | `backend/app/modules/daemon/schema.py`, `backend/app/modules/daemon/router.py`, `backend/app/modules/daemon/service.py`, `backend/app/modules/daemon/runtime/service.py` | FR-01, FR-03, FR-04, FR-06, D-001@v1, D-005@v1, D-006@v1 |
| task-03 | 扩展 workspace 列表筛选、owner DTO 和别名更新 | `backend/app/modules/workspace/schema.py`, `backend/app/modules/workspace/router.py`, `backend/app/modules/workspace/service.py` | FR-01, FR-02, FR-03, FR-04, D-001@v1, D-003@v1, D-006@v1 |
| task-04 | 增加后端权限、筛选分页、别名测试 | `backend/app/modules/daemon/tests/*`, `backend/app/modules/workspace/tests/*` | FR-01, FR-02, FR-03, FR-04, FR-06 |
| task-05 | 更新前端 daemon/workspace API client 类型与方法 | `frontend/src/lib/daemon.ts`, `frontend/src/lib/workspaces.ts` | FR-03, FR-04, FR-06, D-006@v1 |
| task-06 | 改造 `/runtimes` 页面筛选、分页、人员搜索、别名编辑和卡片样式 | `frontend/src/app/(dashboard)/runtimes/page.tsx` | FR-01, FR-04, FR-05, D-003@v1, D-004@v1 |
| task-07 | 改造 `/workspaces` 页面与 WorkspaceCard | `frontend/src/app/(dashboard)/workspaces/page.tsx`, `frontend/src/components/workspace-card.tsx` | FR-02, FR-03, FR-04, FR-05, D-002@v1, D-004@v1 |
| task-08 | 运行模块级验证 | `backend`, `frontend` | FR-06 |
