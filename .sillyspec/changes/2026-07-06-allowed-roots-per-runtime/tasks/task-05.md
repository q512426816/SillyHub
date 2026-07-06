---
id: task-05
title: 心跳响应改 per-runtime map
author: WhaleFall
created_at: 2026-07-06T11:40:00
priority: P0
depends_on: [task-01]
blocks: [task-07, task-08]
allowed_paths:
  - backend/app/modules/daemon/router.py
  - backend/app/modules/daemon/schema.py
change: 2026-07-06-allowed-roots-per-runtime
goal: "(见 body)"
implementation: "(见 body)"
acceptance: "(见 body)"
verify: "(见 body)"
constraints: "(见 body)"
---

# task-05

> goal: DaemonHeartbeatResponse 改返 per-runtime allowed_roots map（替代单一 list）。FR-05。breaking（D-006）。

## implementation
- `schema.py` 加 DaemonHeartbeatRuntimePolicy（runtime_id + allowed_roots）；DaemonHeartbeatResponse 改 `runtimes: list[DaemonHeartbeatRuntimePolicy]`，移除旧 `allowed_roots: list[str]`
- `router.py` heartbeat 端点：查该 instance 下所有 runtime，构造 runtimes map（每 runtime 的 allowed_roots）

## 验收标准
- DaemonHeartbeatResponse.runtimes: list[{runtime_id, allowed_roots}]
- heartbeat 端点返该 daemon 下所有 runtime 的 map
- 旧字段 allowed_roots: list[str] 移除

## 验证
- backend pytest: heartbeat 响应结构 runtimes map
- ruff + mypy

## constraints
- breaking：旧 daemon 解析失败 → 同步升级（D-006/D-007）
