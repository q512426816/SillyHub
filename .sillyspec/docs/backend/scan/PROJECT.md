---
source_commit: ba87eec
updated_at: 2026-06-23T16:20:03Z
created_at: 2026-06-24T00:20:03
author: qinyi
generator: sillyspec-scan
---

# Backend 项目说明（PROJECT）

> 扫描对象：`backend/`（`multi-agent-platform` / SillyHub 单体仓库下的 FastAPI 子项目，包名 `app`，wheel 构建名 `multi-agent-platform-api`）。

## 项目简介

`multi-agent-platform-api` 是多智能体协作平台的**后端 API 服务**，提供基于文档驱动（SillySpec）的多 agent 编排能力：管理项目工作区、变更（change）、任务（task）、工作流（workflow），调度 agent 运行（agent_run）并通过 daemon 租约派发到实际 agent 进程，同时提供 Git 网关、工具网关、扫描文档、发布、事件复盘、PPM（项目/计划/问题/看板/任务）等完整能力。

核心特征：

- **模块化**：`app/modules/` 下 **26 个业务目录**（实测：admin / agent / archive / auth / change / change_writer / daemon / git_gateway / git_identity / health / incident / knowledge / ppm / release / runtime / scan_docs / settings / spec_profile / spec_workspace / task / tool_gateway / workflow / workspace / worktree 等），其中 `ppm` 子域下含 6 个 feature 目录（common / kanban / plan / problem / project / task）。每个遵循 `router / service / model / schema / tests` 五件套约定。
- **文档驱动闭环**：`change → task → change_writer → workflow → archive`，配套 `change/prompts/*.md` 的 brainstorm/plan/execute/verify/scan/quick 等 SillySpec 阶段 prompt。
- **多 agent 编排**：`agent` 模块负责运行编排与日志收集，`daemon` 模块负责运行时注册、任务租约与 WebSocket RPC。DaemonService 已拆分为 5 个子包服务（lease / patch / run_sync / session / permission_service），DaemonService 退化为 facade；agent run 日志经 Redis pub/sub → SSE 实时推送。
- **双路径鉴权**：JWT（浏览器会话）+ API Key（daemon 长凭证），细粒度 RBAC（workspace 维度 + 平台管理员）。
- **约 66 张数据表**（实测 `table=True` 标注）+ Alembic 迁移约 63 个 revision；测试用内存 SQLite + httpx ASGI client 完全 hermetic。

入口：`app/main.py::create_app()` → `app = create_app()`。OpenAPI 文档：`/api/docs`（Swagger）、`/api/redoc`。

## 仓库定位（monorepo 角色）

`backend/` 是 `multi-agent-platform` / SillyHub 单体仓库的**后端 API 子项目**：

- **前端**（`frontend/`，Next.js）通过 HTTP REST API 调用本服务，消费 SSE 实时日志流。
- **daemon**（`sillyhub-daemon` 等独立客户端）通过 HTTP + WebSocket 长连接注册到本服务，按租约（lease）拉取任务、上报 agent 运行结果与交互会话事件。
- 本服务作为**编排中枢**，对外暴露 REST API（`/api/*` 前缀），对内通过 Redis pub/sub 解耦 agent run 日志推送与 daemon 会话控制。

本次扫描严格限定在 `backend/` 目录内，不涉及主项目或其他子项目源码。

## 技术栈

| 维度 | 技术 | 版本约束（pyproject.toml） |
| --- | --- | --- |
| 语言 | Python | ≥ 3.12（全量 `from __future__ import annotations` + PEP 604 类型） |
| Web 框架 | FastAPI | ≥ 0.115 |
| ASGI 服务器 | Uvicorn[standard] | ≥ 0.30 |
| ORM | SQLModel | ≥ 0.0.22 |
| DB 驱动 | SQLAlchemy[asyncio] + asyncpg | ≥ 2.0 / ≥ 0.29（PostgreSQL） |
| 迁移 | Alembic | ≥ 1.13 |
| 缓存/消息 | Redis（`redis.asyncio`，pub/sub） | ≥ 5.0 |
| 认证加密 | python-jose[cryptography]（JWT）+ passlib[bcrypt]（密码）+ pynacl（NaCl SecretBox） | ≥ 3.3 / ≥ 1.7 / ≥ 1.5 |
| 日志/可观测 | structlog + OpenTelemetry（stub） | ≥ 24.4 |
| HTTP 客户端 | httpx（外部调用 + 测试 ASGI client） | ≥ 0.27 |
| 配置 | Pydantic + Pydantic-Settings（`Settings` 单例 + `.env`/env 双层覆盖） | ≥ 2.8 / ≥ 2.4 |
| 文档解析 | python-frontmatter（SillySpec markdown frontmatter）+ openpyxl（Excel 导出） | ≥ 1.1 / ≥ 3.1 |
| 系统信息 | psutil | ≥ 5.9 |
| 测试 | pytest + pytest-asyncio（auto）+ pytest-cov + anyio + aiosqlite | ≥ 8 / ≥ 0.23 / ≥ 5 / ≥ 4 / ≥ 0.20 |
| 代码质量 | ruff（line-length=100, py312）+ mypy（非严格）+ pre-commit | ≥ 0.6 / ≥ 1.11 / ≥ 4.6 |
| 构建/包管理 | hatchling 构建（wheel packages=`["app"]`）+ uv 运行 | — |

## 关键能力

- **鉴权与权限**：JWT 会话 + API Key 双路径；workspace 维度 RBAC + 平台管理员角色（`auth` 模块 + `admin` 模块管理 organizations/users/roles）。
- **agent 编排**：`agent` 模块负责运行编排、上下文构建、diff 收集、扫描分发、交互会话调度、kill 与状态映射；日志收集经 Redis pub/sub → SSE。
- **daemon 运行时**：`daemon` 模块负责运行注册、任务租约（lease claim）、WebSocket RPC、交互会话生命周期、补丁（patch）、运行同步（run_sync）、权限定时器。5 子包各司其职。
- **workspace / spec 管理**：`workspace` 模块管理项目工作区、成员、扫描生成、迁移路径、schema 默认 agent、拓扑关系；`spec_workspace` 负责规格工作区 bootstrap / bundle 同步 / 校验 / 回填；`spec_profile` 负责 spec 策略与冲突检测（部分 TODO 未实现，见 CONCERNS）。
- **change / task / workflow**：`change` 模块驱动变更状态机（StageEnum + TRANSITIONS）、dispatch 链、门禁转换、自动分发、阶段配置；`task` 解析器；`workflow` 状态机 + 审计钩子 + spec guardian；`change_writer` 生成 markdown。
- **Git 与工具网关**：`git_gateway`（危险操作策略 + 服务）、`git_identity`（凭据加密 NaCl）、`worktree`（git worktree + exec_env）、`tool_gateway`（工具策略）。
- **PPM（项目组合管理）**：`ppm` 子域 6 feature——`project`（项目）、`plan`（计划，含三联级查询与 FSM）、`problem`（问题）、`kanban`（看板任务）、`task`（任务）、`common`（CRUD/导出/FSM 公共能力）。
- **其他**：`archive`（归档服务）、`incident`（事件复盘）、`knowledge`（知识解析）、`release`（发布）、`runtime`、`scan_docs`（扫描文档生成）、`health`、`settings`。

## 运行与开发

- 安装依赖：`cd backend && uv sync`（dev 组含 pre-commit/pytest/pytest-asyncio/pytest-cov/mypy/ruff/types-passlib/anyio/aiosqlite）。
- 启动开发服务：`cd backend && uv run uvicorn app.main:app --reload`（需提供 `DATABASE_URL`、`SECRET_KEY` 等环境变量，或 `.env`）。
- 必填环境变量：`DATABASE_URL`、`SECRET_KEY`（≥16 字符）；常用：`REDIS_URL`、`ENVIRONMENT`、`CORS_ALLOWED_ORIGINS`、`SPEC_DATA_ROOT`、`SILLYSPEC_MASTER_KEY`、`PLATFORM_BOOTSTRAP_ADMIN_PASSWORD`、`otel_endpoint`。
- 运行测试：`cd backend && uv run pytest`（hermetic，内存 SQLite + httpx ASGI，不需要真实 PG/Redis）。
- Lint/类型：`cd backend && uv run ruff check .` / `uv run mypy app`。
