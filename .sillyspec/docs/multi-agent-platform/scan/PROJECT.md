---
source_commit: ba87eec
updated_at: 2026-06-23T16:35:30Z
created_at: 2026-06-24T00:35:30
author: qinyi
generator: sillyspec-scan
---

# multi-agent-platform — 项目说明（组件视角）

## 项目简介

`multi-agent-platform` 是一个 monorepo 根项目，定位为**多 Agent 协作平台**。
根目录本身**不包含任何应用源码**——根 `package.json` 仅为占位（无依赖，`test` 脚本是默认 `echo "Error: no test specified" && exit 1`）。
根目录职责限定为：

- 通过 `Makefile` 编排 3 个子项目的开发 / 构建 / 测试流程（约 30 个 target）
- 管理 docker compose 编排（`deploy/docker-compose.yml` 生产 + `deploy/docker-compose.dev.yml` 开发）
- 沉淀跨子项目的文档（`README.md`、`AGENTS.md`、`docs/`、`.sillyspec/`）
- 通过 `.claude/CLAUDE.md` 约定 SillySpec 文档驱动开发流程（文档 → 读代码 → 写测试 → 写实现 → 跑测试 → 验收 → 更新文档）

整体架构：`sillyhub-daemon` 编排本地 Claude（及兼容 Agent）进程，`frontend` 提供任务管理 / 会话 / 监控 Web UI，`backend` 提供 REST/WebSocket API 与 PostgreSQL + Redis 持久化。本项目未正式上线，数据可清空，不考虑版本迭代兼容。

## 技术栈

| 层 | 子项目 | 技术栈 |
| --- | --- | --- |
| 根 | `.` | Makefile 编排 + docker compose + SillySpec 文档驱动（`.sillyspec/`） + GitHub Actions CI |
| 后端 API | `backend/` | Python 3.12 + FastAPI + SQLModel + SQLAlchemy(async) + asyncpg + Alembic + Redis + structlog + python-jose |
| 前端 | `frontend/` | Next.js 14.2 + React 18.3 + TypeScript 5.5 + Tailwind 3.4 + Ant Design 6 + Radix UI + Zustand + TanStack Query + ECharts + xyflow |
| 本地守护 | `sillyhub-daemon/` | Node ≥20 + TypeScript 5.5 + ESM(`type: module`) + Claude Agent SDK 0.3.181 + commander + ws |

通用工具链：pnpm 9.6（frontend / daemon）、uv 0.4.18（backend）、ruff + mypy（backend lint）、eslint（frontend lint）、docker compose（编排 postgres + redis + 三服务）、SillySpec（文档驱动开发流程）。

## 组件构成

| 子项目 | 路径 | 技术栈 | 职责 | 构建文件 | 包管理 |
| --- | --- | --- | --- | --- | --- |
| backend | `backend/` | FastAPI + SQLModel + PostgreSQL + Redis | REST/WebSocket API、JWT 鉴权、持久化、agent-run 调度入口、模块化业务（`backend/app/modules/*`，24 个模块） | `backend/pyproject.toml` + `backend/alembic.ini` + `backend/Dockerfile` | uv（`backend/uv.lock`） |
| frontend | `frontend/` | Next.js 14 + React 18 + TypeScript | Web UI：任务 / 会话 / PPM（项目管理）/ 工作流 / 监控 / 知识库 | `frontend/package.json` + `frontend/next.config.*` | pnpm 9.6 |
| sillyhub-daemon | `sillyhub-daemon/` | Node + TypeScript + Claude Agent SDK + ws | 本地 Agent 守护进程：拉起 / 交互式会话 / SSE 流 / 权限 / spec 同步 / 多 runtime（claude/codex/glm）适配 | `sillyhub-daemon/package.json` + `sillyhub-daemon/tsconfig.json` | pnpm 9.6 |

### backend 模块（`backend/app/modules/`，24 个）

admin、agent、archive、auth、change、change_writer、daemon、git_gateway、git_identity、health、incident、knowledge、ppm、release、runtime、scan_docs、settings、spec_profile、spec_workspace、task、tool_gateway、workflow、workspace、worktree。

### sillyhub-daemon 源码结构（`sillyhub-daemon/src/`）

- 顶层：`daemon.ts`、`cli.ts`、`index.ts`、`config.ts`、`credential.ts`、`hub-client.ts`、`task-runner.ts`、`spec-sync.ts`、`ws-client.ts`、`protocol.ts`、`types.ts`、`workspace.ts`、`agent-detector.ts`、`terminal-launcher.ts`、`terminal-observer.ts` 等
- 子目录：`adapters/`（多 runtime 适配）、`interactive/`（交互式会话驱动）

### frontend 源码结构（`frontend/src/`）

`app/`（Next.js App Router 路由）、`components/`、`lib/`、`stores/`（Zustand）、`styles/`、`test/`（vitest setup）。

## 组件间关系

```
┌─────────────┐   WebSocket / HTTP   ┌──────────────────┐   拉起 / SSE / 权限   ┌────────────────┐
│  frontend   │ ◄──────────────────► │     backend      │ ◄──────────────────► │ sillyhub-daemon│
│ (Next.js)   │   REST API           │ (FastAPI + PG)   │    ws + http          │ (Claude SDK)   │
└─────────────┘                      └────────┬─────────┘                       └───────┬────────┘
                                              │                                          │
                                         PostgreSQL                                    │ 本地 Claude / Codex / GLM 进程
                                         + Redis                                      ▼
                                                                          本地 Agent 工作区（worktree / spec）
```

- **frontend ↔ backend**：REST API + WebSocket（会话流、监控），通过 `NEXT_PUBLIC_API_BASE_URL` 配置后端地址
- **backend ↔ daemon**：backend 作为调度入口，通过 WS / HTTP 指挥 daemon 拉起本地 Agent；daemon 反向回传 SSE 流、权限请求、spec 同步状态
- **daemon ↔ 本地 Agent**：通过 Claude Agent SDK + 多 runtime 适配器（`adapters/`）拉起 claude / codex / glm 进程，管理交互式会话生命周期
- **跨组件共享**：`tool_gateway` / `git_gateway`（backend）与 `file-rpc` / `spec-sync`（daemon）协同实现工具调用与 spec 文件同步

## 部署与开发入口

### 开发入口（根 Makefile）

根 `Makefile` 提供跨子项目统一入口（在根目录执行）：

- 开发栈：`make dev-up` / `make dev-down` / `make dev-logs` / `make dev-reset`（docker compose 起 / 停 / 看日志 / 重置 postgres + redis）
- backend：`make backend-install` / `make backend-run` / `make backend-test` / `make backend-lint` / `make backend-format` / `make backend-migrate`
- frontend：`make frontend-install` / `make frontend-run` / `make frontend-test` / `make frontend-lint` / `make frontend-typecheck` / `make frontend-build`
- 完整服务栈：`make up` / `make down` / `make logs`（docker compose 起停 postgres + redis + 三服务）
- 聚合：`make test`（= backend-test + frontend-test）、`make lint`（= backend-lint + frontend-lint）

> 注：daemon 无独立 Makefile target，需进 `sillyhub-daemon/` 直接用 pnpm。

### Docker 部署

- 生产编排：`deploy/docker-compose.yml`
- 开发编排：`deploy/docker-compose.dev.yml`
- 服务：postgres + redis + backend + frontend（+ 可选 daemon，本地运行）
- 注意：backend 容器**不热重载**（跑镜像内代码，改源码需 rebuild）；frontend healthcheck 存在 proxy 误报（详见 CONCERNS.md）

### CI（GitHub Actions）

- `backend-ci.yml`：路径触发 `backend/**`，ruff check + format check + mypy + pytest（`--cov-fail-under=60`）
- `frontend-ci.yml`：路径触发 `frontend/**`，lint + typecheck + test + build
- daemon 无 CI 工作流

## 备注

- 本项目未正式上线，按 `.claude/CLAUDE.md` 约定不需要考虑版本迭代兼容，数据可清空。
- 新功能 / 大改动必须走 SillySpec 完整流程：`sillyspec run brainstorm` → plan → execute → verify；小修复走 `sillyspec run quick`。
- UI 和文档尽量使用中文展示（特殊专业术语除外）。
