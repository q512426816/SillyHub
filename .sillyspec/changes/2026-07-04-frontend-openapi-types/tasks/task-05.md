---
id: task-05
title: pre-commit 提醒式守门
author: qinyi
created_at: 2026-07-04T00:51:06
priority: medium
depends_on: []
blocks: [task-06]
allowed_paths:
  - .claude/hooks/pre-commit-ci-check.cjs
---

## 目标
在已有 pre-commit hook 加提醒式检查：backend `schema.py` 改 + `api-types.ts` 未同步 → log 提醒（不 block commit）。

## 实现步骤
- 读 `.claude/hooks/pre-commit-ci-check.cjs` 现状
- 在 `hasBackend` 分支内、mypy 之后追加：检测 `files` 中是否有 `backend/app/modules/**/*.schema.py` 改动且无 `frontend/src/lib/api-types.ts` / `backend/openapi.json` → `log("提醒...")`
- 不调用 `deny()`（不 block）

## 验收标准
- 只改 `backend/app/modules/workspace/schema.py` 的 commit 触发提醒 log
- 提醒不 block commit（commit 仍成功）

## 验证方式
手动构造一次只改 schema.py 的 staged 改动，git commit，确认 stderr 含提醒且 commit 成功

## 约束
- 提醒式而非强制 block（D-004@V1），避免 commit 跑 Python dump 拖慢
- 强制 block 留后续（全量迁移后开启）
- 不破坏现有 mypy/ruff/frontend 检查链
