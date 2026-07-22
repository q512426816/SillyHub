---
author: WhaleFall
created_at: 2026-07-22T13:10:00
---

# 模块影响 — 项目计划 project_name join 改造

## 影响文件

| 操作 | 文件 | 说明 |
|---|---|---|
| 改 | backend/app/modules/ppm/plan/service.py | list/get/export outerjoin 取真名；筛选/排序基于 join 字段（W1）+ ruff format 规范化 |
| 改 | backend/app/modules/ppm/project/service.py | 删项目改名同步刷新 PsProjectPlan.project_name（W1 task-05） |
| 改 | backend/app/modules/ppm/plan/tests/test_service.py | W2 单测 task-06/07/08（6 条）+ 修复 W1 改坏的 4 个现有测试 |
| 改 | backend/app/modules/ppm/project/tests/test_service.py | 改名测试改为验证冗余列不再被刷新（task-05） |

## 模块

- **ppm/plan**：项目计划 list/get/export + 筛选/排序（核心改动）。
- **ppm/project**：项目维护改名（删同步逻辑）。
- **前端**：无改动（API 契约不变，project_name 仍返回字符串）。
- **DB**：无 schema 变更（冗余列 ppm_ps_project_plan.project_name 保留）。

## 关联历史

- **替代 ql-20260717-004**（写时同步刷新冗余列）——根因治理：冗余字段易写坏（今天因此连修 4 bug），改 join 单一可信源。
- **关联 ql-20260716-006**（create 兜底 project_id 查名填冗余列）——保留不动，create 仍写冗余列（无害兼容）。
