---
source_commit: fcbf3fa7
updated_at: 2026-06-22T17:56:21Z
generator: sillyspec-scan
author: qinyi
created_at: 2026-06-23 01:56:21
---

# multi-agent-platform — 项目说明

## 项目简介

`multi-agent-platform` 是一个 monorepo 根项目，**根目录本身不包含任何应用源码**。
根 `package.json` 仅为占位（无依赖、`test` 脚本是默认 `echo "Error: no test specified" && exit 1`），
根目录的职责仅限于：

- 编排 3 个子项目的开发与构建流程（通过 `Makefile` 暴露统一入口）
- 管理 docker compose 编排（`deploy/docker-compose.yml` 与 `deploy/docker-compose.dev.yml`）
- 沉淀跨子项目的文档（`docs/`、`.sillyspec/`、`AGENTS.md`、`README.md`）
- 通过 `.claude/CLAUDE.md` 约定 SillySpec 文档驱动开发流程

项目整体定位是**多 Agent 协作平台**：通过 `sillyhub-daemon` 编排本地 Claude（及兼容 Agent）进程，
`frontend` 提供任务管理 / 会话 / 监控 UI，`backend` 提供 REST/WebSocket API 与持久化（PostgreSQL + Redis）。

## 技术栈

| 层 | 子项目 | 技术栈 |
| --- | --- | --- |
| 根 | `.` | Makefile 编排 + docker-compose + SillySpec 文档驱动（`.sillyspec/`） |
| 后端 API | `backend/` | Python 3.12 + FastAPI + SQLModel + SQLAlchemy(async) + asyncpg + Alembic + Redis + structlog |
| 前端 | `frontend/` | Next.js 14.2 + React 18 + TypeScript 5.5 + Tailwind 3.4 + Ant Design 6 + Zustand + TanStack Query + ECharts |
| 本地守护 | `sillyhub-daemon/` | Node ≥20 + TypeScript 5.5 + ESM(`type: module`) + Claude Agent SDK + commander + ws |

通用工具链：pnpm（前端 / daemon）、uv（backend）、ruff/mypy（backend lint）、eslint（前端 lint）、
docker compose（编排 postgres + redis + 三服务）、SillySpec（文档驱动开发流程）。

## 子项目索引

| 子项目 | 路径 | 技术栈 | 职责 | 构建文件 | 包管理 |
| --- | --- | --- | --- | --- | --- |
| backend | `backend/` | FastAPI + SQLModel + PostgreSQL + Redis | REST/WebSocket API、鉴权、持久化、agent-run 调度入口、模块化业务（`backend/app/modules/*`） | `backend/pyproject.toml` + `backend/alembic.ini` + `backend/Dockerfile` | uv（`backend/uv.lock`） |
| frontend | `frontend/` | Next.js 14 + React 18 + TypeScript | Web UI：任务 / 会话 / PPM / 工作流 / 监控 | `frontend/package.json` + `frontend/next.config.*` | pnpm 9.6 |
| sillyhub-daemon | `sillyhub-daemon/` | Node + TypeScript + Claude Agent SDK + ws | 本地 Agent 守护进程：拉起 / 交互式会话 / SSE 流 / 权限 / spec 同步 | `sillyhub-daemon/package.json` + `sillyhub-daemon/tsconfig.json` | pnpm 9.6 |

## 开发入口（根 Makefile）

根 `Makefile` 提供跨子项目统一入口（在根目录执行）：

- `make dev-up` / `make dev-down`：docker compose 起 / 停 postgres + redis
- `make backend-test` / `make frontend-test`：分别跑各子项目测试
- `make up` / `make down`：docker compose 起停完整服务栈
- `make test` / `make lint`：聚合跑 backend + frontend 的测试与 lint

详见 `Makefile`（约 30 个 target，Linux/macOS/Git Bash 通用）。

## 备注

- 本项目未正式上线，按 `.claude/CLAUDE.md` 约定不需要考虑版本迭代兼容问题，数据可清空。
- 新功能 / 大改动必须走 SillySpec 完整流程：`sillyspec run brainstorm` → plan → execute → verify。
