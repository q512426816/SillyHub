---
id: task-05
title: plan _Crud.update 清空/部分更新单测
wave: 2
status: draft
owner: WhaleFall
allowed_paths:
  - backend/app/modules/ppm/plan/tests/test_service.py
depends_on:
  - task-01
blocks:
  - task-08
---

# task-05: plan `_Crud.update` 单测

## 目标
用单测锁定「清空→null」「未传→不动」行为。

## 完成标准
- 新增用例：update 传 `field=None` → 断言库 `field is None`。
- 新增用例：update 不含 field → 断言库 field 保持原值。
- pytest 全绿，不回归既有用例。

## 依赖
task-01（逻辑改完才能测）。
