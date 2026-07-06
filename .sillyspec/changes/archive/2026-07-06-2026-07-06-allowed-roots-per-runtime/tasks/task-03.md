---
id: task-03
title: update_allowed_roots 改写 runtime 级
author: WhaleFall
created_at: 2026-07-06T11:40:00
priority: P0
depends_on: [task-01]
blocks: [task-06, task-08]
allowed_paths:
  - backend/app/modules/daemon/runtime/service.py
change: 2026-07-06-allowed-roots-per-runtime
goal: "(见 body)"
implementation: "(见 body)"
acceptance: "(见 body)"
verify: "(见 body)"
constraints: "(见 body)"
---

# task-03

> goal: PUT update_allowed_roots 改写 runtime.allowed_roots（不再写 instance）。FR-01/D-002。

## implementation
- `runtime/service.py` update_allowed_roots：改写 `runtime.allowed_roots`（原经 runtime.daemon_instance_id 写 instance 的逻辑改为写 runtime 自身列）
- instance.allowed_roots 语义不变（机器级 default，daemon 心跳上报刷新）

## 验收标准
- PUT 写 daemon_runtimes.allowed_roots（仅目标 runtime 行）
- 不写 daemon_instances.allowed_roots
- DB 仅目标 runtime 行变，其他 runtime 不动

## 验证
- backend pytest: PUT CC allowed_roots，Hermes 行不变
- ruff + mypy

## constraints
- instance.allowed_roots 仍由 daemon 心跳上报（不动）
