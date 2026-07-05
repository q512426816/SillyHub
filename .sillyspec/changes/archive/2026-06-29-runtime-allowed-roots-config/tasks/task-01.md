---
id: task-01
title: daemon_runtimes 加 allowed_roots 列 + migration + 模型/DTO
author: WhaleFall
created_at: 2026-06-29T10:25:55
priority: P0
depends_on: []
blocks: [task-02, task-03]
allowed_paths:
  - backend/app/modules/daemon/model.py
  - backend/app/modules/daemon/schema.py
  - backend/migrations/versions/
  - backend/app/modules/daemon/tests/
change: 2026-06-29-runtime-allowed-roots-config
---

# task-01

> goal: `DaemonRuntime` 加 `allowed_roots`（JSONB 数组，默认 `["~/.sillyhub"]`），migration 加列 + 存量回填。

## implementation
- `model.py` `DaemonRuntime` 加 `allowed_roots: list[str]`（`sa_column=Column(JSONB, nullable=False, server_default='["~/.sillyhub"]')`）
- 新 migration `add daemon_runtimes.allowed_roots`（JSONB + server_default + 存量 UPDATE 回填）
- `schema.py` Runtime DTO 加 `allowed_roots: list[str]`
- runtime 注册路径（`POST /daemon/runtimes`）默认 `["~/.sillyhub"]`

## acceptance
- `DaemonRuntime.allowed_roots` 字段存在（JSONB，非空）
- migration upgrade/downgrade 正确；存量行回填 `["~/.sillyhub"]`
- 新注册 runtime 默认 `["~/.sillyhub"]`
- Runtime DTO 含 allowed_roots

## verify
- `cd backend && uv run alembic upgrade head` 通过
- `cd backend && uv run pytest app/modules/daemon/ -k runtime`

## constraints
- `~/.sillyhub` 是占位（daemon 侧解析为 `homedir()/.sillyhub`）
- JSONB 路径字符串跨平台
- 不破坏现有 DaemonRuntime 字段
