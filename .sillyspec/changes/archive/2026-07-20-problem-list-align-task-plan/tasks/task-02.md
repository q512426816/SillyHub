---
author: qinyi
created_at: 2026-07-20 11:30:22
id: task-02
title: model status 中文化 + effective_status 简化
wave: 1
blockedBy: [task-01]
allowed_paths: [backend/app/modules/ppm/problem/model.py]
acceptance: [FR-1]
---

## 目标
`PpmProblemList.status` 默认值 + 列宽对齐 `PlanTask.status`（中文 3 态），`effective_status` property 简化。

## 实现步骤
1. `model.py:118-121` `status` 字段：`default="1"` → `default="新建"`，`String(8)` → `String(30)`，`Column(..., default="新建")`。
2. `model.py:150-159` `_problem_effective_status` + property：简化为直接 `return self.status`（删 `getattr(self, "_effective_status", None) or` 的 7 覆盖逻辑）；保留 property 名 `effective_status`（schema 字段依赖）。
3. 废弃字段 `now_node` / `now_handle_user(_name)` / `handle_info` / `check_info` / `check_result` / `check_time` / `audit_user_id(_name/_time)` **保留不删**（service 不再写入，减少 migration 爆炸半径）；更新字段注释标注「deprecated，简化后不再写入」。
4. docstring 更新（status 取值改中文 3 态）。

## 测试点
- 新建 `PpmProblemList()` 默认 `status == "新建"`。
- `effective_status` 直接返回 `status`（无内存覆盖）。

## 验收
- model import 无误；`status` 列宽 30 默认「新建」；`effective_status == status`。
