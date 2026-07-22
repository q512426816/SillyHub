---
author: WhaleFall
created_at: 2026-07-22T11:52:00
---

# 模块影响 — ppm update 清空字段修复 (2026-07-21-ppm-update-null)

## 影响模块：ppm

### 后端（逻辑修复）
- `backend/app/modules/ppm/plan/service.py`：`_Crud.update`（约 175 行）+ `PlanService.update_detail`（约 730 行）去 `if v is not None`，改直接 `setattr`。
- `backend/app/modules/ppm/problem/service.py`：`_Crud.update`（约 173 行）同。
- `backend/app/modules/ppm/task/service.py`：`update` docstring 修正为「直接 setattr；未传由路由 exclude_unset 过滤」（逻辑不动）。

### 后端（测试）
- `backend/app/modules/ppm/plan/tests/test_service.py`：`TestUpdateClearVsKeep` / `TestUpdateDetailClearsField`（清空→null + 未传→不动）。
- `backend/app/modules/ppm/problem/tests/test_problem_flow.py`：`test_update_none_clears_nullable_field` / `test_update_omitted_field_kept`。

### 前端
- 无改动（前端清空发 `null` 早已正确，根因在后端 `_Crud.update` 跳过 null）。

### 不影响（明确边界）
- `change_process`（plan/service.py:1024）：保留 `if v is not None`（版本链复制 + overrides 覆盖语义，null=不覆盖正确）。
- `agent` 模块同类写法：有意设计，有测试守卫。
- schema / API 契约 / 状态机 / DB 迁移：无变更。

## 待同步模块文档
- `.sillyspec/docs/SillyHub/modules/ppm.md`：变更索引追加本变更条目（archive step3 sync-module-docs 执行）。
