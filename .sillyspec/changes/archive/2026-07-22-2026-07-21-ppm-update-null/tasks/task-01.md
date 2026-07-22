---
id: task-01
title: plan _Crud.update 去 if v is not None
wave: 1
status: draft
owner: WhaleFall
allowed_paths:
  - backend/app/modules/ppm/plan/service.py
depends_on: []
blocks:
  - task-05
  - task-06
---

# task-01: plan `_Crud.update` 去 `if v is not None`

## 目标
修复 ppm/plan `_Crud.update` 清空字段不生效。

## 完成标准
- `_Crud.update`（plan/service.py 约 174 行）for 循环改 `for k, v in data.items(): setattr(obj, k, v)`，去掉 `if v is not None` 守卫。
- 既有调用（里程碑/模块/计划节点/明细等 update）不受影响。
- tsc/ruff 不引入新错。

## 依赖
无（Wave 1 起点）。与 task-03 同文件不同函数，execute 时串行。
