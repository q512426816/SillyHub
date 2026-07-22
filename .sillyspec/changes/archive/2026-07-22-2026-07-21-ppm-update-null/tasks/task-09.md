---
id: task-09
title: 浏览器验收
wave: 3
status: draft
owner: WhaleFall
allowed_paths: []
depends_on:
  - task-08
blocks:
  - task-10
---

# task-09: 浏览器验收

## 目标
端到端验收清空落库（AC-1/2/4）。

## 完成标准
- 编辑里程碑/明细/问题清空某字段保存 → 前端回显空、库里 null（AC-1）。
- 只改一字段其他不动（AC-2）。
- 明细变更流程 change_process 正常（AC-4）。

## 依赖
task-08（后端部署实测过）。
