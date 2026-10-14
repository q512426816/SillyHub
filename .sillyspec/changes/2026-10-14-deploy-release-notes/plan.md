---
plan_level: full
execution_mode: main
author: qinyi
created_at: 2026-10-14 09:58:00
---

# 计划（Plan）— 2026-10-14-deploy-release-notes

## 复杂度判定

plan_level=full：三端改动（backend 新模块 / frontend 新页面 / skill 文档），但零数据表、零写端点、无状态机；约 19 文件清单、6 任务、5 波。execution_mode=main（任务规模小、单会话可吞吐，不付派发税）（跨三端多模块，客观规模信号偏大，升 full 走完整确认门。）

需求与决策锚：FR-01（skill 写 md）→ task-06；FR-02/FR-03/FR-04（只读端点+容错）→ task-02；FR-05（页面菜单）→ task-04/task-05；FR-06（权限种子）→ task-01。D-001（独立模块）、D-002（顶层菜单）、D-003（基础版字段）、D-004（写文件+只读扫描）由上述任务共同落实。

## Wave 1 — 后端权限地基

- task-01

## Wave 2 — 后端 deploy_records 只读模块

- task-02

## Wave 3 — 契约同步 + skill 硬步骤（文件正交可并行）

- task-03
- task-06

## Wave 4 — 前端数据层与页面

- task-04

## Wave 5 — 菜单注册

- task-05

## 验收

- design.md 成功标准逐条核对（skill 产 md / 前端可见渲染 / invalid 容错 / 测试绿 / gen:types 无漂移）
- 禁全量测试，仅跑本变更相关测试（backend deploy_records + auth permissions + frontend deploy-records + admin menus）
