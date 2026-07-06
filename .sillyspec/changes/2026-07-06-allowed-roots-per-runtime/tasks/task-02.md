---
id: task-02
title: register copy default + 响应带 allowed_roots
author: WhaleFall
created_at: 2026-07-06T11:40:00
priority: P0
depends_on: [task-01]
blocks: [task-07, task-08]
allowed_paths:
  - backend/app/modules/daemon/runtime/service.py
  - backend/app/modules/daemon/schema.py
  - backend/app/modules/daemon/router.py
change: 2026-07-06-allowed-roots-per-runtime
goal: "(见 body)"
implementation: "(见 body)"
acceptance: "(见 body)"
verify: "(见 body)"
constraints: "(见 body)"
---

# task-02

> goal: 新 runtime 注册 copy instance.default；register 响应返 per-runtime allowed_roots（消除首次写窗口）。FR-02/FR-07/D-003。

## implementation
- `runtime/service.py` register_daemon：upsert runtime 时，新建分支 copy `instance.allowed_roots → runtime.allowed_roots`；已存在 runtime 不覆盖
- `schema.py` DaemonRegisterRuntimeItem 加 `allowed_roots: list[str]`
- `router.py` register 端点构造响应时填 runtime.allowed_roots

## 验收标准
- 新建 runtime：allowed_roots = instance.default
- 已存在 runtime：allowed_roots 不被覆盖
- DaemonRegisterResponse.runtimes[].allowed_roots 返回 runtime 值

## 验证
- backend pytest: register 新 runtime 继承 default + 已存在不覆盖
- ruff + mypy

## constraints
- copy 仅新建时；D-004 已演化不覆盖
