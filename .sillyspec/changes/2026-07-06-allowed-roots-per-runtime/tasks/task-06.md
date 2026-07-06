---
id: task-06
title: WS push roots 来源改 runtime
author: WhaleFall
created_at: 2026-07-06T11:40:00
priority: P1
depends_on: [task-03]
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

# task-06

> goal: PUT 后 WS POLICY_UPDATE 的 roots 从 instance 改为 runtime 级。FR-04。

## implementation
- `router.py` update_runtime_allowed_roots 端点：roots_to_push 从 `instance.allowed_roots` 改为 `runtime.allowed_roots`
- `send_policy_update(daemon_id, runtime.allowed_roots, payload_runtime_id=rid)`（已支持，ws_hub.py:174）
- daemon_id 仍从 instance.id 取（WS 按 daemon_id 路由）

## 验收标准
- PUT 后 WS 仅 push 被 PUT 的 runtime（payload_runtime_id=rid）
- 其他 runtime 不受影响
- roots 来源是 runtime.allowed_roots

## 验证
- backend pytest: PUT CC，WS payload 含 CC runtime_id + CC allowed_roots
- ruff + mypy

## constraints
- payload_runtime_id 已支持（task-13/ql-002），仅改 roots 来源
