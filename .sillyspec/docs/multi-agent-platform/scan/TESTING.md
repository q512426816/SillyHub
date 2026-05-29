---
author: qinyi
created_at: 2026-05-27 09:44:37
---

# TESTING

## 测试结构

- 后端使用 pytest，配置在 `backend/pyproject.toml`。
- 后端顶层测试：`backend/tests/test_health.py`、`backend/tests/test_config.py`。
- 后端模块测试覆盖 workspace、component、scan_docs、change、task、workflow、worktree、git_gateway、tool_gateway、change_writer、agent、runtime、release、knowledge、archive、incident、git_identity。
- 前端使用 Vitest，目前可见 `frontend/src/lib/__tests__/api.test.ts`。

## 当前覆盖重点

- workspace scanner / service / router。
- `.sillyspec` 组件、扫描文档、change、task parser。
- workflow 状态机、spec guardian 和审计日志。
- worktree、Git gateway、Tool gateway 的权限与审计。
- agent 上下文构建和 router。

## 验证命令

- Backend: `uv run pytest`。
- Frontend: `pnpm test`、`pnpm typecheck`、`pnpm lint`。
