---
id: task-06
title: plan update_detail 清空单测
wave: 2
status: draft
owner: WhaleFall
allowed_paths:
  - backend/app/modules/ppm/plan/tests/test_service.py
depends_on:
  - task-03
blocks:
  - task-08
---

# task-06: plan `update_detail` 清空单测

## 目标
锁定 update_detail 清空字段落 null。

## 完成标准
- 新增用例：update_detail 传某字段 `None` → 断言库该字段为 None。
- 不回归既有 test_detail_task_link 等。

## 依赖
task-03。
