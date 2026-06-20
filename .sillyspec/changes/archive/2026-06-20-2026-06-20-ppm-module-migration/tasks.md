---
author: qinyi
created_at: 2026-06-20T14:46:30+0800
change: 2026-06-20-ppm-module-migration
---

# Tasks(细节在 plan 阶段展开为 Wave/Task)

| 任务 | 文件路径 | 覆盖 |
|---|---|---|
| **W0 基础设施** | | |
| ppm 模块骨架 + common(crud/export/fsm/perms) | backend/app/modules/ppm/{__init__.py,common/*.py} | D-005@v1, FR-01~06 |
| PPM_* 权限枚举 + RBAC 种子迁移 | backend/app/modules/auth/permissions.py + 新迁移 | D-005@v1 |
| 建 19 表迁移 + migrations/env.py import | backend/migrations/versions/ + env.py | D-001@v1/D-002@v1 |
| openpyxl 依赖 | backend/pyproject.toml | D-003@v1 |
| **W1 pm 项目管理** | | |
| project 子域 model/router/service/schema/tests | backend/app/modules/ppm/project/ | FR-01 |
| **W2 plan 计划策划** | | |
| plan 子域(模板 + ps + 里程碑状态机) | backend/app/modules/ppm/plan/ | FR-02/04 |
| **W3 problem 问题清单** | | |
| problem 子域(审批流状态机 + 变更) | backend/app/modules/ppm/problem/ | FR-03 |
| **W4 task 任务工时** | | |
| task 子域(计划/执行/工时统计) | backend/app/modules/ppm/task/ | FR-05 |
| **W5 kanban 看板** | | |
| kanban 子域(聚合/分配/拖拽) | backend/app/modules/ppm/kanban/ | FR-06 |
| main.py 注册 /api/ppm | backend/app/main.py | D-001@v1 |
| **W6 前端** | | |
| ppm 各子域页面(AntD 重写) | frontend/src/app/(dashboard)/ppm/** | FR-01~06 |
| lib/ppm API client + 菜单权限登记 | frontend/src/lib/ppm/*.ts + menu-permissions.ts | FR-01~06 |
