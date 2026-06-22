---
source_commit: fcbf3fa7
updated_at: 2026-06-22T18:12:26Z
generator: sillyspec-scan
author: qinyi
created_at: 2026-06-23 02:12:26
---

# Backend 项目说明（PROJECT）

> 扫描对象：`backend/`（`multi-agent-platform` 仓库下的 FastAPI 子项目 `multi-agent-platform-api`）。

## 项目简介

`multi-agent-platform-api` 是多智能体协作平台的**后端 API 服务**，提供基于文档驱动（SillySpec）的多 agent 编排能力：管理项目工作区、变更（change）、任务（task）、工作流（workflow），调度 agent 运行（agent_run）并通过 daemon 租约派发到实际 agent 进程，同时提供 Git 网关、工具网关、扫描文档、发布、事件复盘、PPM（项目/计划/问题/看板）等完整能力。

核心特征：

- **模块化**：`app/modules/` 下约 23 个业务目录（含 `ppm` 子域），每个遵循 `router / service / model / schema / tests` 五件套约定。
- **文档驱动闭环**：`change → task → change_writer → workflow → archive`，配套 `change/prompts/*.md` 的 brainstorm/plan/execute/verify/scan/quick 等 SillySpec 阶段 prompt。
- **多 agent 编排**：`agent` 模块负责运行编排与日志收集，`daemon` 模块负责运行时注册、任务租约与 WebSocket RPC。DaemonService 已拆分为 5 个子包服务（Runtime/Lease/RunSync/Session/Patch），DaemonService 退化为 facade；agent run 日志经 Redis pub/sub → SSE 实时推送。
- **双路径鉴权**：JWT（浏览器会话）+ API Key（daemon 长凭证），细粒度 RBAC（workspace 维度 + 平台管理员）。
- **约 60 张数据表** + Alembic 迁移约 30 个 revision；测试用内存 SQLite + httpx ASGI client 完全 hermetic。

入口：`app/main.py::create_app()` → `app = create_app()`。OpenAPI 文档：`/api/docs`（Swagger）、`/api/redoc`。

## 技术栈

- **语言**：Python ≥ 3.12（全量 `from __future__ import annotations` + PEP 604 类型）。
- **Web**：FastAPI ≥ 0.115 + Uvicorn[standard] ≥ 0.30。
- **ORM/DB**：SQLModel ≥ 0.0.22 + SQLAlchemy[asyncio] ≥ 2.0 + asyncpg ≥ 0.29 + Alembic ≥ 1.13（PostgreSQL）。
- **缓存/消息**：Redis ≥ 5.0（`redis.asyncio`，pub/sub）。
- **认证加密**：python-jose[cryptography] ≥ 3.3（JWT）+ passlib[bcrypt] ≥ 1.7（密码）+ pynacl ≥ 1.5（NaCl SecretBox 密钥加密）。
- **日志/可观测**：structlog ≥ 24.4 + OpenTelemetry（stub）。
- **HTTP**：httpx ≥ 0.27（外部调用 + 测试 ASGI client）。
- **配置**：Pydantic ≥ 2.8 + Pydantic-Settings ≥ 2.4（`Settings` 单例 + `.env`/env 双层覆盖）。
- **文档解析**：python-frontmatter ≥ 1.1（处理 SillySpec markdown frontmatter）+ openpyxl ≥ 3.1（Excel 导出）。
- **测试**：pytest ≥ 8 + pytest-asyncio（asyncio_mode=auto）+ pytest-cov + anyio + aiosqlite（内存 SQLite）。
- **质量**：ruff ≥ 0.6（line-length=100, py312）+ mypy ≥ 1.11（非严格）+ pre-commit ≥ 4.6（PEP 735 dev 组）。
- **构建/包管理**：hatchling 构建（wheel packages=`["app"]`）+ uv 运行。

## 运行与开发

- 安装依赖：`cd backend && uv sync`（dev 组含 pre-commit/pytest/mypy/ruff/types-passlib/anyio/aiosqlite/pymysql）。
- 启动开发服务：`cd backend && uv run uvicorn app.main:app --reload`（需提供 `DATABASE_URL`、`SECRET_KEY` 等环境变量，或 `.env`）。
- 必填环境变量：`DATABASE_URL`、`SECRET_KEY`（≥16 字符）；常用：`REDIS_URL`、`ENVIRONMENT`、`CORS_ALLOWED_ORIGINS`、`SPEC_DATA_ROOT`、`SILLYSPEC_MASTER_KEY`。
- 运行测试：`cd backend && uv run pytest`（hermetic，内存 SQLite + httpx ASGI，不需要真实 PG/Redis）。
- Lint/类型：`cd backend && uv run ruff check .` / `uv run mypy app/`。

## 仓库定位

`backend/` 是 `multi-agent-platform` 单体仓库的一个子项目（另有前端、daemon 客户端等）。本次扫描严格限定在 `backend/` 目录内，不涉及主项目或其他子项目源码。
