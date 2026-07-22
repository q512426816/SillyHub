---
plan_level: standard
author: WhaleFall
created_at: 2026-07-21T12:20:00
---

# 计划（Plan）— ppm update 清空字段修复

## 概述

方案 A：去掉 plan/problem `_Crud.update` + plan `update_detail` 的 `if v is not None` 改直接 setattr，补清空/部分更新单测，curl 实测 + 浏览器验收。3 Wave 串行（W1→W2→W3）。

## Wave 1：核心逻辑修复（互不依赖，可并行）

> 3 处去守卫 + task 注释修正。task-01 与 task-03 同文件（plan/service.py）但不同函数，execute 时串行避免冲突；task-02/task-04 不同文件可并行。

- [x] task-01: plan `_Crud.update` 去 `if v is not None`
  - allowed_paths: `backend/app/modules/ppm/plan/service.py`
  - 完成：`_Crud.update` 的 for 循环改 `for k,v in data.items(): setattr(obj,k,v)`，去掉 `if v is not None` 守卫；既有调用（里程碑/模块/计划节点/明细等 update）不受影响。
- [x] task-02: problem `_Crud.update` 去 `if v is not None`
  - allowed_paths: `backend/app/modules/ppm/problem/service.py`
  - 完成：同 task-01 模式。
- [x] task-03: plan `update_detail` 去 `if v is not None` + 复查 `_sync_task_fields`
  - allowed_paths: `backend/app/modules/ppm/plan/service.py`
  - 完成：`PlanService.update_detail` 直接 setattr；复查 `_sync_task_fields`（plan/service.py:1645 `uid is not None` 守卫）确认清空 `duty_user_id`/`execute_user_id` 时 `PlanTask.user_id` 非空约束仍受保护。
- [x] task-04: task update 注释修正
  - allowed_paths: `backend/app/modules/ppm/task/service.py`
  - 完成：docstring「部分更新（仅写入非 None 字段）」改为「部分更新（直接 setattr；未传字段由路由 exclude_unset 过滤）」；逻辑不动。

## Wave 2：单测（依赖 Wave 1）

> 补「清空→null」「未传→不动」单测，锁定 Wave 1 行为。pytest `asyncio_mode=auto`。

- [x] task-05: plan `_Crud.update` 单测
  - allowed_paths: `backend/app/modules/ppm/plan/tests/test_service.py`（已存在则追加）
  - 完成：新增用例——update 传 `field=None` → 断言库 `field is None`；update 不含 field → 断言库 field 保持原值。
- [x] task-06: plan `update_detail` 单测
  - allowed_paths: `backend/app/modules/ppm/plan/tests/test_service.py`
  - 完成：新增用例——update_detail 传某字段 `None` → 断言库该字段为 None。
- [x] task-07: problem `_Crud.update` 单测
  - allowed_paths: `backend/app/modules/ppm/problem/tests/test_service.py`（已存在则追加）
  - 完成：清空→null + 未传→不动两类用例。

## Wave 3：实测与验收（依赖 Wave 2）

> curl 实测 + 浏览器验收 + 文档同步。

- [x] task-08: curl 实测 PUT 清空生效
  - allowed_paths: （无文件改动，纯实测）
  - 完成：登录有效账号，PUT plan/problem 各一个端点（如 `/plan-node-ps/{id}`、`/problem/{id}`），body 含某字段 `null` → 返回 200 + 响应/库中该字段为 null。
- [x] task-09: 浏览器验收
  - allowed_paths: （无文件改动）
  - 完成：编辑里程碑/明细/问题清空某字段保存 → 前端回显空、库里 null（AC-1）；只改一字段其他不动（AC-2）；明细变更流程 change_process 正常（AC-4）。
- [x] task-10: 文档同步
  - allowed_paths: `.sillyspec/docs/SillyHub/modules/ppm.md`, `.sillyspec/quicklog/QUICKLOG-WhaleFall.md`
  - 完成：`ppm.md` 变更索引追加本次修复；若分批用 quick 记 quicklog。

## 依赖关系

```
Wave 1 (task-01/02/03/04) ──► Wave 2 (task-05/06/07) ──► Wave 3 (task-08/09/10)
```
- W1→W2：测试依赖逻辑改完。
- W2→W3：验收依赖测试通过。
- W1 内：task-01 与 task-03 同文件不同函数，串行；task-02/task-04 可与它们并行。

## 验收标准映射（对照 requirements AC-1~4）

- AC-1（清空落 null）、AC-2（未传不动）：task-08/09 实测验证。
- AC-3（单测绿、不回归）：task-05/06/07。
- AC-4（change_process 不受影响）：task-09 验证明细变更流程正常。
