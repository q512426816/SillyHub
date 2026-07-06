---
id: task-08
title: backend per-runtime 测试
author: WhaleFall
created_at: 2026-07-06T11:40:00
priority: P1
depends_on: [task-02, task-03, task-04, task-05, task-06]
blocks: [task-10]
allowed_paths:
  - backend/app/modules/daemon/tests/
change: 2026-07-06-allowed-roots-per-runtime
goal: "(见 body)"
implementation: "(见 body)"
acceptance: "(见 body)"
verify: "(见 body)"
constraints: "(见 body)"
---

# task-08

> goal: 覆盖 backend 全部 per-runtime 行为。FR-01~FR-07。

## implementation
- 复用 test_runtime_admin_management.py / test_register_heartbeat_daemon.py 框架
- 新建 test_allowed_roots_per_runtime.py：CC/Hermes 同 instance，PUT CC，断言 Hermes 不变；register 新 runtime 继承 default；已存在不覆盖；心跳 runtimes map 结构；_runtime_read 读 runtime；空 fail-closed

## 验收标准
- register copy default（新建继承 + 已存在不覆盖）
- update 写 runtime 级（CC 变 Hermes 不变）
- 心跳响应 runtimes map 结构正确
- _runtime_read 读 runtime（CC/Hermes 各自）
- 空 allowed_roots fail-closed deny
- ruff + mypy 通过

## 验证
- cd backend && pytest app/modules/daemon/tests/test_allowed_roots_per_runtime.py
- ruff check . && mypy app

## constraints
- 测试不依赖外部 daemon（backend 单元/集成）
