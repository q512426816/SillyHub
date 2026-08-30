---
id: task-15
title: 三端 lint 与 build
title_zh: 后端前端 lint typecheck build 通过
author: qinyi
created_at: 2026-07-28 14:05:41
priority: P0
depends_on: [task-14]
blocks: []
requirement_ids: [NFR-04]
decision_ids: []
allowed_paths:
  - backend/app
  - frontend/src
goal: >
  运行后端 ruff/mypy 与前端 lint/typecheck/build,确认三端门禁通过,跨平台兼容。
implementation:
  - backend: ruff check + ruff format check + mypy app
  - frontend: pnpm lint + tsc --noEmit + pnpm build
  - 排查并修复任何 lint/type 错误
acceptance:
  - backend ruff/mypy 全过
  - frontend lint/typecheck/build 全过
verify:
  - "cd backend && uv run ruff check . && uv run ruff format --check . && uv run mypy app"
  - "cd frontend && pnpm lint && pnpm exec tsc --noEmit && pnpm build"
constraints:
  - 本变更不涉及 sillyhub-daemon,无需跑 daemon 检查
  - mypy arg-type 被禁(memory),改返回类型需 grep 调用点确认
  - 复合 git 命令绕 claude 层 hook,提交时单独 git commit
---
