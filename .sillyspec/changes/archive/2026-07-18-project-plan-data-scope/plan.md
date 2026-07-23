---
author: qinyi
created_at: 2026-07-18 17:26:33
change: 2026-07-18-project-plan-data-scope
---
plan_level: full

---

# 实现计划（Plan）— 项目计划/项目维护 数据权限范围

> 「项目计划」窗口产出，与并行窗口 ppm-data-scope（任务计划/问题清单）不同模块。

## Spike 前置验证

无。方案 A 复用现有 Role/UserRole/Organization/UserOrganization/_descendant_ids，无新技术不确定性。

## Wave 1（并行，无依赖）

- [ ] task-01: `PpmProjectMaintenance` 加 `organization_id` + alembic migration（加列+索引 + 刷 20 项目到项目二部 `9f968a5f`）（覆盖：FR-6, D-007@v1）
- [ ] task-02: 新建 `app/modules/ppm/data_scope.py`（`DataScope` + role key 常量 + `get_user_role_keys` + `_user_org_subtree` + `get_ppm_data_scope` 依赖项）（覆盖：FR-1, FR-5, D-001/002/003/005/006@v1）

## Wave 2（依赖 Wave 1）

- [ ] task-03: `PlanService` 列表+导出接 scope 注入 where（join project organization_id OR project_manager_id）（覆盖：FR-2, D-004/005@v1）
- [ ] task-04: `PlanService` 详情三联表接 scope 越权 403（覆盖：FR-3）
- [ ] task-05: `ProjectMaintenanceService.page` 接 scope 注入 where（organization_id IN OR id IN pm 反查 project_id）（覆盖：FR-4, D-008/005@v1）

## Wave 3（依赖 Wave 2）

- [ ] task-06: router 接 scope 依赖（plan/router.py 3 端点 + project/router.py page，`Depends(get_ppm_data_scope)` 透传，require_permission 保留）（覆盖：D-006/009@v1）

## Wave 4（依赖 Wave 1-3）

- [ ] task-07: `data_scope` 单测（4 类用户 + 多身份并集修京廷 + is_platform_admin 兜底 admin2）（覆盖：AC-1~5,9）
- [ ] task-08: `service` 单测（4 查询点 list/export/three-level/page 按 scope full/scoped/empty）（覆盖：AC-1~7）
- [ ] task-09: `router` 单测（越权 403 + scope 依赖）（覆盖：AC-6）

## Wave 5（依赖 Wave 1-4）

- [ ] task-10: 部署 backend + curl 实测 4 类用户范围 + migration 后 20 项目 organization_id 核验（覆盖：AC-1~9）

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | organization_id 字段 + migration + 刷数据 | W1 | P0 | — | FR-6, D-007 | 加列+索引，UPDATE 20 项目=项目二部 |
| task-02 | data_scope.py DataScope + 依赖项 | W1 | P0 | — | FR-1/5, D-001/002/003/005/006 | 身份解析核心 |
| task-03 | 项目计划列表+导出 where | W2 | P0 | task-01,02 | FR-2, D-004/005 | join project org_id OR pm |
| task-04 | 项目计划详情三联表 403 | W2 | P0 | task-01,02 | FR-3 | 越权校验 |
| task-05 | 项目维护 page where | W2 | P0 | task-01,02 | FR-4, D-008/005 | org_id IN OR id IN pm 反查 |
| task-06 | router 4 端点接 scope 依赖 | W3 | P0 | task-02~05 | D-006/009 | Depends(get_ppm_data_scope) |
| task-07 | data_scope 单测 | W4 | P0 | task-02 | AC-1~5,9 | 4类+并集+兜底 |
| task-08 | service 单测 | W4 | P0 | task-03~05 | AC-1~7 | 4查询点 full/scoped/empty |
| task-09 | router 单测 | W4 | P1 | task-06 | AC-6 | 越权 403 |
| task-10 | 部署 + curl 实测 | W5 | P0 | task-01~09 | AC-1~9 | 4类用户实测 + 数据核验 |

## 关键路径

task-01 → task-03 → task-06 → task-08 → task-10（最长路径）

## 全局验收标准

- [ ] `data_scope`/`service`/`router` 单测全绿（task-07/08/09），SQLite/PG 方言兼容
- [ ] `cd backend && uv run alembic heads` 单 head；`alembic upgrade head` 无报错
- [ ] migration 后 20 项目 `organization_id = 9f968a5f-a9ef-55ae-9488-bdc20205d210`（AC-8）
- [ ] `cd backend && uv run pytest -q --no-cov` 全绿（含新单测，无回归）
- [ ] `cd backend && uv run ruff check . && uv run ruff format --check . && uv run mypy app` 全绿
- [ ] curl 实测 4 类用户范围正确（AC-1~5,9）
- [ ] 详情越权 → 403（AC-6）
- [ ] brownfield：require_permission_any 功能权限点不变；scope 为新增过滤层

## 覆盖矩阵（decisions.md）

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-02 | AC-1~5 |
| D-002@v1 | task-02 | AC-1, AC-9 |
| D-003@v1 | task-02 | AC-2 |
| D-004@v1 | task-03, task-05 | AC-3 |
| D-005@v1 | task-02, task-03, task-05 | AC-5 |
| D-006@v1 | task-02, task-06 | 方案 A |
| D-007@v1 | task-01 | AC-8 |
| D-008@v1 | task-05 | AC-7 |
| D-009@v1 | task-06 | require_permission 保留 |
