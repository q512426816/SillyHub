---
id: task-04
title: task update 注释修正
wave: 1
status: draft
owner: WhaleFall
allowed_paths:
  - backend/app/modules/ppm/task/service.py
depends_on: []
blocks: []
---

# task-04: task `update` 注释修正

## 目标
修正 task update 误导性注释（逻辑不动）。

## 完成标准
- `update`（task/service.py 约 139 行）docstring「部分更新（仅写入非 None 字段）」改为「部分更新（直接 setattr；未传字段由路由 exclude_unset 过滤）」。
- 代码逻辑零改动。

## 依赖
无。可与 task-01/02/03 并行。
