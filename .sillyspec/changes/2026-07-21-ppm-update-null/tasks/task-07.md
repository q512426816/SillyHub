---
id: task-07
title: problem _Crud.update 清空/部分更新单测
wave: 2
status: draft
owner: WhaleFall
allowed_paths:
  - backend/app/modules/ppm/problem/tests/test_service.py
depends_on:
  - task-02
blocks:
  - task-08
---

# task-07: problem `_Crud.update` 单测

## 目标
锁定 problem _Crud.update 清空/部分更新行为。

## 完成标准
- 清空 field=None → 库 None；未传 → 保持原值。
- pytest 全绿。

## 依赖
task-02。
