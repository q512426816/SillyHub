---
id: task-08
title: curl 实测 PUT 清空生效
wave: 3
status: draft
owner: WhaleFall
allowed_paths: []
depends_on:
  - task-05
  - task-06
  - task-07
blocks:
  - task-09
---

# task-08: curl 实测 PUT 清空

## 目标
后端实测（CONVENTIONS 教训：改后端必实测）。

## 完成标准
- 登录有效账号，PUT plan/problem 各一个端点（如 `/plan-node-ps/{id}`、`/problem/{id}`），body 含某字段 `null` → 返回 200 + 响应中该字段为 null。
- 重建 backend 镜像后实测。

## 依赖
task-05/06/07（测试通过）。
