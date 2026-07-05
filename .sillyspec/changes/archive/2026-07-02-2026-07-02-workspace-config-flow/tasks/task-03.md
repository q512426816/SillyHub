---
id: task-03
title: WorkspaceMemberRuntime 加 init_synced 字段 + PUT /my-binding 适配
author: qinyi
created_at: 2026-07-02 11:00:00
priority: P1
depends_on: [task-09]
blocks: [task-05, task-07]
allowed_paths:
  - backend/app/modules/workspace/member_runtimes/model.py
  - backend/app/modules/workspace/member_runtimes/service.py
---

## 目标
`WorkspaceMemberRuntime` 加 `init_synced_at` / `init_synced_spec_version` 字段（D-010），PUT /my-binding 初始化为 null（D-007 编辑入口配合）。

## 实现步骤
- model 加两字段（migration 在 task-09 统一）。
- `upsert_my_binding`（member_runtimes/service.py）新建行时 init_synced_* = None；编辑时不动这两列（仅 init lease complete 写）。

## 验收标准
- PUT /my-binding 新建/更新 member 行，init_synced_at/spec_version 为 null（直到 task-07 init complete）。
- GET /my-binding 返回含两字段。

## 验证方式
`cd backend && uv run pytest app/modules/workspace/member_runtimes/tests/ -q`。

## 约束
- 字段实际 schema 变更在 task-09 migration；本 task 只改 model/service 代码（migration 合并到 task-09 避免多 migration 文件）。
