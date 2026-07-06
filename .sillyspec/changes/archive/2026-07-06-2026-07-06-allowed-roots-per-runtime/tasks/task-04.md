---
id: task-04
title: _runtime_read 读 runtime 级 + 回退 ql-003
author: WhaleFall
created_at: 2026-07-06T11:40:00
priority: P0
depends_on: [task-01]
blocks: [task-08]
allowed_paths:
  - backend/app/modules/daemon/router.py
change: 2026-07-06-allowed-roots-per-runtime
goal: "(见 body)"
implementation: "(见 body)"
acceptance: "(见 body)"
verify: "(见 body)"
constraints: "(见 body)"
---

# task-04

> goal: _runtime_read 改读 runtime.allowed_roots；删除 ql-20260706-003 加的 instance 兜底填充行。FR-01。

## implementation
- `router.py` _runtime_read：runtime 有自己的 allowed_roots 列后，DaemonRuntimeRead.model_validate(runtime) 直接读 runtime.allowed_roots
- 删除 ql-003 加的 `update["allowed_roots"] = list(getattr(instance, "allowed_roots", None) or [])`
- instance 分支保留 daemon_version/daemon_build_id 填充（那两个仍在 instance）

## 验收标准
- _runtime_read 读 runtime.allowed_roots（model_validate 直接命中列）
- ql-003 的 instance 填充行已删
- list/GET 返回真实 runtime 值（CC/Hermes 各自）

## 验证
- backend pytest: list runtimes，CC/Hermes 各自 allowed_roots
- ruff + mypy

## constraints
- schema.py DaemonRuntimeRead.allowed_roots 字段不变（来源从 instance fallback 改 runtime 自身）
