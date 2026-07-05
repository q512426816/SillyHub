---
id: task-10
title: lease payload 加 latest_spec_version（D-010）
author: qinyi
created_at: 2026-07-02 11:00:00
priority: P1
depends_on: [task-09]
blocks: [task-11, task-15]
allowed_paths:
  - backend/app/modules/agent/service.py
  - backend/app/modules/daemon/lease/
---

## 目标
scan/agent/init lease payload 统一加 `latest_spec_version` 字段（D-010）。

## 实现步骤
- start_scan_dispatch / start_init_dispatch / 其他 agent dispatch 建 lease 时，payload 加 `latest_spec_version = SpecWorkspace.spec_version`。
- lease payload schema（daemon/lease/）加字段。

## 验收标准
- lease payload 含 latest_spec_version；集成测覆盖。

## 验证方式
`cd backend && uv run pytest app/modules/agent/tests/ -q -k lease`。

## 约束
- 字段从 SpecWorkspace.spec_version 读（task-09）。
