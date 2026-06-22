---
source_commit: fcbf3fa7
updated_at: 2026-06-22T18:12:59Z
generator: sillyspec-scan
author: qinyi
created_at: 2026-06-23 02:12:59
---

# SillyHub — 项目说明

> SillyHub 是本 monorepo 的**产品名**（path = `.`，与 `multi-agent-platform` 同指仓库根）。
> 本文档由 `sillyspec-scan` 在 `fcbf3fa7` 处基于产品语义重新生成，覆盖旧版。

## 项目简介

SillyHub 将 [SillySpec](https://github.com/nicepkg/sillyspec) 规范驱动开发方法论**产品化**，是一个面向研发团队的**多用户、多项目、多 Agent 协作管理平台**。它的核心目标是把软件工程流程中的规格编写、任务分解、代码实现与验证，通过 AI Agent 自动化串联起来。

**目标用户**：使用 Claude（及兼容 Agent）作为研发助手的工程团队 / 平台运维人员；希望把"规范驱动开发"沉淀为可审计、可协作平台能力的产品团队。

**核心能力**（产品视角）：

- **工作空间管理** — 注册 Git 仓库为工作空间，扫描 `.sillyspec` 目录结构，识别组件与依赖关系
- **变更全生命周期** — proposal → design → plan → tasks → execute → verify 完整流程，阶段可自动触发 Agent
- **AI Agent 编排引擎** — 通过本地 daemon 驱动 Claude Code CLI 执行任务，实时 SSE 流式输出，支持中断恢复、上下文指纹、审批门禁
- **Git Worktree 隔离** — 每个变更在独立 worktree 中执行，互不干扰
- **多用户认证与权限** — JWT + bcrypt + RBAC（25 个权限 / 7 个域），平台管理员引导，工作区级权限
- **Git 凭据网关** — 共享服务器部署下的多用户 Git 凭据隔离，操作日志与脱敏
- **本地 Daemon** — 轻量守护进程，负责宿主机 Agent 检测、交互式会话与任务执行
- **拓扑可视化** — 基于 @xyflow/react 的组件拓扑交互视图
- **知识库 / 事件 / 发布** — 内置知识库管理、事件（Incident）追踪、发布工作流
- **PPM 项目管理域** — 项目维护、客户/成员/干系人、问题清单与变更、看板评论等约 20 张表

**产品形态**：全栈 Web 应用（模块化单体 backend + Next.js 前端 + 本地 daemon）。**未正式上线**（按 `.claude/CLAUDE.md` 约定，无需考虑版本迭代兼容，数据可清空）。

## 技术栈

| 产品层 | 子项目（路径） | 技术栈 |
| --- | --- | --- |
| Web 前端 | `frontend/` | Next.js 14.2 (App Router) + React 18 + TypeScript 5.5 + Tailwind 3.4 + Ant Design 6 + Zustand + TanStack Query + @xyflow/react + ECharts |
| API 后端 | `backend/` | Python 3.12 + FastAPI 0.115 + SQLModel + SQLAlchemy(async) + asyncpg + Alembic + Redis + structlog；JWT(python-jose)+bcrypt+PyNaCl；Ruff + Mypy |
| 本地守护 | `sillyhub-daemon/` | Node ≥20 + TypeScript 5.5 + ESM(`type: module`) + `@anthropic-ai/claude-agent-sdk` + `ws` + `commander`；HTTP 用 Node 20 原生 `fetch`（零 HTTP 库依赖） |
| 数据/缓存 | 容器编排 | PostgreSQL 16 + Redis 7（Docker Compose） |
| 部署 | `deploy/` | Docker Compose（全栈 4 服务 / 开发仅 db+redis） |
| 规范驱动 | `.sillyspec/` | SillySpec 工作区（changes / docs / knowledge / projects / workflows） |

通用工具链：`pnpm@9.6.0`（前端 / daemon）、`uv`（backend）、`docker compose`（编排）、SillySpec（文档驱动开发流程）。

## 子项目索引

| 子项目 | 路径 | 技术栈 | 职责 | 构建文件 | 包管理 |
| --- | --- | --- | --- | --- | --- |
| backend | `backend/` | FastAPI + SQLModel + PostgreSQL + Redis | REST/SSE/WebSocket API、鉴权、持久化、agent-run 调度入口、约 55 张表的模块化业务（`backend/app/modules/*`） | `backend/pyproject.toml` + `backend/alembic.ini` + `backend/Dockerfile` | uv（`backend/uv.lock`） |
| frontend | `frontend/` | Next.js 14 + React 18 + TypeScript | Web UI：工作空间 / 变更 / 任务 / 会话 / PPM / 工作流 / 监控 / 拓扑 | `frontend/package.json` + `frontend/next.config.mjs` + `frontend/Dockerfile` | pnpm 9.6.0 |
| sillyhub-daemon | `sillyhub-daemon/` | Node + TypeScript + Claude Agent SDK + ws | 本地 Agent 守护进程：拉起 / 交互式会话 / SSE 流 / 权限 / spec 同步 / session 恢复 | `sillyhub-daemon/package.json` + `sillyhub-daemon/tsconfig.json` | pnpm 9.6.0 |

## 开发入口

根 `Makefile` 暴露跨子项目统一入口（根目录执行）：`make dev-up`/`dev-down`（docker 起/停 pg+redis）、`make backend-test`/`frontend-test`、`make up`/`down`（全栈 docker）、`make test`/`lint`（聚合测试与 lint）。约 30 个 target，Linux/macOS/Git Bash 通用。

API 文档：后端启动后访问 `http://localhost:8000/api/docs`（Swagger）、`/api/redoc`、`/api/openapi.json`。
