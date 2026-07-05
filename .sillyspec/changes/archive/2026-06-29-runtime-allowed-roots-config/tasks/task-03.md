---
id: task-03
title: 心跳响应带 allowed_roots
author: WhaleFall
created_at: 2026-06-29T10:25:55
priority: P0
depends_on: [task-01]
blocks: [task-04]
allowed_paths:
  - backend/app/modules/daemon/router.py
  - backend/app/modules/daemon/schema.py
  - backend/app/modules/daemon/tests/
change: 2026-06-29-runtime-allowed-roots-config
---

# task-03

> goal: `POST /daemon/heartbeat` 响应 body 加 `allowed_roots`，供 daemon 心跳拉取同步。

## implementation
- 找到 daemon heartbeat 端点（`POST /daemon/heartbeat` 或 `/runtimes/{id}/heartbeat`），响应 DTO 加 `allowed_roots: list[str]`
- 响应取该 runtime 的 allowed_roots（DB 读）
- 向后兼容：新增字段，旧 daemon 不读不影响

## acceptance
- heartbeat 响应含 `allowed_roots`（runtime 当前值）
- 旧 daemon 不读该字段仍正常心跳（向后兼容）
- runtime 不存在时响应不含或空（不崩）

## verify
- `cd backend && uv run pytest app/modules/daemon/ -k heartbeat`

## constraints
- 新增字段不破坏现有 heartbeat 响应契约
- allowed_roots 来自 DB（task-01 字段）
