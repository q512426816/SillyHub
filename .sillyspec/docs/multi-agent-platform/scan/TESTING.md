---
author: qinyi
created_at: 2026-05-29T17:42:00
---

# TESTING — multi-agent-platform (monorepo)

## 测试结构

### Backend（pytest）

- 框架：pytest 8+ (asyncio_mode=auto) + pytest-cov 5+
- 测试文件：42 个
- 测试代码：~9,026 行
- 发现路径：`tests/`（集成）+ `app/`（模块内单元测试）
- Fixture 链：`db_engine` → `db_session` → `auth_admin_token` → `auth_headers` + `db_engine` → `client`
- 数据库：测试使用 aiosqlite 内存数据库
- 覆盖率门槛：60%（CI 强制）

### Frontend（Vitest）

- 框架：Vitest 2+ + Testing Library + jsdom
- 测试文件：1 个（`src/lib/__tests__/api.test.ts`，67 行）
- 覆盖：仅 `apiFetch` 工具函数（4 个用例）
- Setup：`@testing-library/jest-dom/vitest` 注入自定义匹配器

## 当前覆盖重点

- Workspace scanner / service / router / model / relation
- `.sillyspec` 组件、扫描文档、change、task parser
- Workflow 状态机、spec guardian、FSM 转换
- Worktree 执行环境 + router
- Git gateway / Tool gateway 权限与审计
- Agent 上下文构建 + router
- Release / Incident CRUD
- Auth / RBAC / Git identity
- Knowledge parser
- Archive service
- Spec workspace bootstrap + validator
- Spec profile policy
- Change writer markdown builder

## 验证命令

| 子项目 | 命令 |
|--------|------|
| Backend | `make backend-test` 或 `uv run pytest --cov` |
| Backend lint | `make backend-lint` |
| Frontend | `make frontend-test` 或 `pnpm test` |
| Frontend lint | `make frontend-lint` + `make frontend-typecheck` |
| 全量 | `make test` + `make lint` |
