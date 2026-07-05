---
id: task-02
title: GET/PUT allowed_roots API（admin + 路径校验）
author: WhaleFall
created_at: 2026-06-29T10:25:55
priority: P0
depends_on: [task-01]
blocks: [task-06]
allowed_paths:
  - backend/app/modules/daemon/router.py
  - backend/app/modules/daemon/schema.py
  - backend/app/modules/daemon/tests/
change: 2026-06-29-runtime-allowed-roots-config
---

# task-02

> goal: admin 经 API 查看 + 更新 runtime allowed_roots（多路径，路径校验）。

## implementation
- `GET /api/admin/daemon/runtimes` 响应含 allowed_roots（复用现有列表端点，DTO 已加字段）
- `PUT /api/admin/daemon/runtimes/{id}/allowed-roots`：body `{allowed_roots: [...]}`，admin 权限（require_permission DAEMON_ADMIN 或 platform admin）
- 路径校验：每条绝对路径或 `~` 开头（后端不展开 `~`，daemon 展开）、去重、数量上限（如 50）、非空（至少含默认 ~/.sillyhub？或允许空=仅 homedir 兜底）
- 更新 DB + 返回更新后 runtime

## acceptance
- GET 列表含 allowed_roots
- PUT 更新持久化，admin 权限（非 admin 403）
- 路径校验：非法路径（相对/超长/过多）400
- PUT 返回更新后 allowed_roots

## verify
- `cd backend && uv run pytest app/modules/daemon/ -k allowed_roots`

## constraints
- `~` 不在后端展开（daemon 侧 homedir 解析），后端只校验格式
- 权限：admin only（参考现有 daemon admin 端点权限模式）
- 不改其他 runtime 字段
