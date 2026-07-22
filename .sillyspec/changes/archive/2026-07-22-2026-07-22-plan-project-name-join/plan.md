---
plan_level: standard
author: WhaleFall
created_at: 2026-07-22T09:30:00
---

# 计划（Plan）— 项目计划 project_name join 改造

## 概述

方案 A：list/get/export 显式 outerjoin `PpmProjectMaintenance` 取 project_name（单一可信源）；筛选/排序基于 join 字段；删 project/service.py:213-222 改名同步；保留冗余列；补测试 + 实测。3 Wave 串行（W1→W2→W3）。

## Wave 1：join 改造 + 删同步（逻辑层）

> T1-T4 同文件（plan/service.py）串行；T5 独立文件（project/service.py）可并行。

- [ ] task-01: list_ps_project_plans join 取真名
  - allowed_paths: `backend/app/modules/ppm/plan/service.py`
  - 完成：list 改 `select(PsProjectPlan, PpmProjectMaintenance.project_name).outerjoin(...)`；不用 `_Crud.list_paged`，自己写 query + 复用 apply_pagination/apply_sort/count_total；response project_name 用 join 值。
- [ ] task-02: get_ps_project_plan join 取真名
  - allowed_paths: `backend/app/modules/ppm/plan/service.py`
  - 完成：get outerjoin 取 project_name，response 用 join 值。
- [ ] task-03: list_ps_project_plans_for_export join 取真名
  - allowed_paths: `backend/app/modules/ppm/plan/service.py`
  - 完成：export outerjoin 取 project_name。
- [ ] task-04: 筛选/排序基于 join 字段
  - allowed_paths: `backend/app/modules/ppm/plan/service.py`
  - 完成：`req.project_name` → `PpmProjectMaintenance.project_name.ilike`；`order_by=project_name` → join 字段（allowed_sort 别名映射）。
- [ ] task-05: 删改名同步
  - allowed_paths: `backend/app/modules/ppm/project/service.py`
  - 完成：删 213-222 行「项目改名→UPDATE PsProjectPlan.project_name」块（含 old_project_name 辅助变量）。

## Wave 2：单测（依赖 Wave 1）

> 补测试锁定 join 行为 + 改名自动反映。

- [ ] task-06: list/get 返回真名单测
  - allowed_paths: `backend/app/modules/ppm/plan/tests/test_service.py`
  - 完成：list/get 返回 project_name = 项目表真名（非冗余/非 null/非 id）。
- [ ] task-07: 项目改名后 list 反映单测
  - allowed_paths: `backend/app/modules/ppm/plan/tests/test_service.py`
  - 完成：改 PpmProjectMaintenance.project_name → list_ps_project_plans 返回新名（验证无需同步逻辑）。
- [ ] task-08: 筛选/排序基于 join 单测
  - allowed_paths: `backend/app/modules/ppm/plan/tests/test_service.py`
  - 完成：按 project_name 筛选/排序基于 join 字段。

## Wave 3：实测与验收（依赖 Wave 2）

- [ ] task-09: curl 实测
  - allowed_paths: []
  - 完成：登录有效账号，GET list/get 返回真名；改项目名后 list 反映。
- [ ] task-10: 浏览器验收
  - allowed_paths: []
  - 完成：/ppm/project-plans 列表显示真名；/ppm/projects 改名后计划列表自动更新（AC-1/2/3/4）。
- [ ] task-11: 文档同步
  - allowed_paths: `.sillyspec/docs/SillyHub/modules/ppm.md`, `.sillyspec/quicklog/QUICKLOG-WhaleFall.md`
  - 完成：ppm.md 变更索引追加；quicklog 记录。

## 依赖关系

```
Wave 1 (task-01~05) ──► Wave 2 (task-06~08) ──► Wave 3 (task-09~11)
```
- W1→W2：测试依赖逻辑改完。
- W2→W3：验收依赖测试通过。
- W1 内：task-01~04 同文件（plan/service.py）串行；task-05 不同文件可并行。

## 验收标准映射（对照 requirements AC-1~5）

- AC-1（列表真名）/AC-2（改名反映）：task-09/10。
- AC-3（筛选/排序）：task-08/10。
- AC-4（导出真名）：task-03/10。
- AC-5（单测绿）：task-06/07/08。
