---
id: task-02
title: problem _Crud.update 去 if v is not None
wave: 1
status: draft
owner: WhaleFall
allowed_paths:
  - backend/app/modules/ppm/problem/service.py
depends_on: []
blocks:
  - task-07
---

# task-02: problem `_Crud.update` 去 `if v is not None`

## 目标
修复 ppm/problem `_Crud.update` 清空字段不生效。

## 完成标准
- `_Crud.update`（problem/service.py 约 174 行）改直接 setattr，去掉守卫。
- 既有调用（问题/客户/成员/干系人/变更等 update）不受影响。

## 依赖
无。可与 task-01/03/04 并行（不同文件）。
