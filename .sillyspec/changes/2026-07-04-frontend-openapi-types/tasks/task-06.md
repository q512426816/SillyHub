---
id: task-06
title: 全量验收 + 模块文档更新
author: qinyi
created_at: 2026-07-04T00:51:06
priority: medium
depends_on: [task-01, task-02, task-03, task-04, task-05]
blocks: []
allowed_paths:
  - docs/multi-agent-platform/modules/frontend.md
---

## 目标
跑全套 lint/test 守门 + `gen:types:check`，更新前端模块文档。

## 实现步骤
- backend: `cd backend && uv run ruff check . && uv run ruff format --check . && uv run mypy app && uv run pytest -q`
- frontend: `cd frontend && pnpm lint && pnpm typecheck && pnpm test && pnpm build`
- `cd frontend && pnpm gen:types:check`（重新生成 + git diff --exit-code）
- 更新 `docs/multi-agent-platform/modules/frontend.md`：注意事项加「类型来自 api-types.ts，改后端 schema 后跑 pnpm gen:types」+ 变更索引

## 验收标准
- backend ruff/mypy/pytest 全绿
- frontend lint/typecheck/test/build 全绿
- gen:types:check exit 0
- modules/frontend.md 含本变更条目

## 验证方式
上述命令全部退出码 0

## 约束
- 失败不得改测试「通过」（CLAUDE.md 规则 8）
- 文档用中文（CLAUDE.md 规则 11）
- 不改源码（纯验收 + 文档）
