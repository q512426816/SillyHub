---
author: qinyi
created_at: 2026-07-27 00:35:31
source_commit: 6e78b29a
updated_at: 2026-07-26T16:35:31Z
generator: sillyspec-scan
---

# 项目(Project)

## 项目简介

**SillyHub — 多智能体协作管理平台** 的后端服务（包名 `multi-agent-platform-api`，构建名 `app`）。它把 [SillySpec](https://github.com/nicepkg/sillyspec) 规范驱动开发方法论产品化，提供多用户、多项目、多 Agent 的全生命周期管理系统：通过 Web 界面管理工作空间（Git 仓库）、编排 AI Agent（首发 Claude Code）、跟踪结构化变更规格（proposal → design → plan → tasks → execute → verify → archive）、协调团队协作。

后端职责（来源：根 `README.md` + `backend/README.md`）：

- **工作空间管理** — 注册 Git 仓库为工作空间，扫描 `.sillyspec` 目录结构。
- **变更生命周期** — 完整 SillySpec 流程的状态机与持久化（`change` 模块四态 PendingReview + Gate 三态决策：exit 0 推进 / exit 1 重跑 / exit 2 fail-loud）。
- **AI Agent 编排** — 调度 Claude Code Agent 执行扫描 / stage / 任务 / 对话 / 初始化 / 多 agent mission，经 SSE 实时回传日志。
- **Git Worktree 隔离** — 每个变更 / 任务在独立 worktree 执行（`worktree` 模块）。
- **多用户认证** — JWT（浏览器会话）+ API Key（daemon 长凭证）双路径 + bcrypt + RBAC（7 角色、~40 权限点，`auth/permissions.py`）。
- **双层审批** — 工具级（`tool_gateway` + AskUserQuestion）+ 阶段级（PendingReview 四面板 proposal/plan/human_test/archive）。
- **本地 Daemon 协同** — 通过 WebSocket 与 per-host daemon 通信，下发 lease、回收 patch / usage / artifact。
- **PPM（项目 / 计划 / 问题管理）** — **已上线**模块：计划任务、问题清单、看板、工时、工作台待办、里程碑（`ppm` 模块族 6 feature：common / kanban / plan / problem / project / task）。

代码组织采用 **vertical slice**：每个业务模块一个独立目录 `app/modules/<feature>/`，内含 `router.py`（APIRouter）+ `schema.py`（Pydantic）+ `service.py`（业务逻辑，不依赖 HTTP / DB session）+ `models.py`（SQLModel，如有）+ `tests/`，在 `app/main.py::create_app()` 聚合挂载到 `/api` 前缀。共 **29 个业务模块**（实测 `ls app/modules/`）：admin / agent / auth / change / change_writer / daemon / file / git_gateway / git_identity / health / incident / knowledge / llm_provider / ppm / release / runtime / scan_docs / settings / skills / spec_profile / spec_workspace / storage / task / tool_gateway / workflow / workspace / worktree。

规模：`app/**/*.py` 非测试源码 273 个文件、测试文件 261 个（顶层 `tests/` 68 + 模块内 193）；alembic migration 117 个 revision；约 66 张数据表（`table=True` 标注）。基线测试 **2955 passed / 10 skipped / 5 xfailed**，静态检查 ruff ✅ / mypy ✅ 全绿（来源：`docs/code-quality-hardening-2026-07-24.md`）。入口 `app.main:app`，OpenAPI 文档 `/api/docs`（Swagger）、`/api/redoc`。

## 技术栈

| 维度 | 技术 | 版本约束（`pyproject.toml`） |
|---|---|---|
| 语言 | Python **3.12**（`requires-python = ">=3.12"`，全量 `from __future__ import annotations`） | ≥ 3.12 |
| Web 框架 | **FastAPI** + Uvicorn[standard] | ≥ 0.115 / ≥ 0.30 |
| 数据建模 | Pydantic + pydantic-settings + **SQLModel** | ≥ 2.8 / ≥ 2.4 / ≥ 0.0.22 |
| ORM / DB 驱动 | SQLAlchemy[asyncio] + **asyncpg**（生产 PG） | ≥ 2.0 / ≥ 0.29 |
| 迁移 | **Alembic**（`backend/migrations/versions/`，117 个 revision） | ≥ 1.13 |
| 缓存 / 消息 | **Redis** `redis.asyncio`（pub/sub、token / permission cache、限流） | ≥ 5.0 |
| 对象存储 | **aiobotocore**（S3 兼容 / MinIO，平台文件中心） | ≥ 3.8, <4 |
| 认证加密 | python-jose[cryptography]（JWT）+ passlib[bcrypt]（密码）+ pynacl（NaCl SecretBox） | ≥ 3.3 / ≥ 1.7 / ≥ 1.5 |
| 结构化日志 | structlog（禁 `print`）；OpenTelemetry 当前为 stub | ≥ 24.4 |
| HTTP 客户端 | httpx（GLM messages API、daemon HTTP 回调、测试 ASGI client） | ≥ 0.27 |
| Excel / 图像 | openpyxl + Pillow（PPM 导入 / DISPIMG 公式图像） | ≥ 3.1 / ≥ 10 |
| 文档解析 | python-frontmatter（SillySpec markdown frontmatter）+ python-multipart | ≥ 1.1 / ≥ 0.0.9 |
| 系统信息 | psutil | ≥ 5.9 |
| 测试 | pytest + pytest-asyncio（auto）+ pytest-cov + pytest-xdist + anyio + aiosqlite | ≥ 8 / ≥ 0.23 / ≥ 5 / ≥ 3.5 / ≥ 4 / ≥ 0.20 |
| 代码质量 | ruff（line-length=100, py312）+ mypy（非严格，pydantic 插件）+ pre-commit | ≥ 0.6 / ≥ 1.11 / ≥ 4.6 |
| 构建 / 包管理 | hatchling（wheel packages=`["app"]`）+ [uv](https://github.com/astral-sh/uv) ≥ 0.4 | — |

**生产数据库**：PostgreSQL 16；**测试数据库**：内存异步 SQLite（aiosqlite），conftest override `get_session`，零外部依赖。

**外部协作者**：

- **sillyhub-daemon**（Node.js / TypeScript）— per-host 本地守护进程，WebSocket 协议通信，负责宿主机 Agent 检测（探测 12 provider）、interactive session（claude-sdk-driver / codex-app-server-driver）、batch lease 执行、worktree 文件系统操作。
- **Claude Code CLI** — 首发被编排的 AI Agent；后端用 `agent_type='claude_code'`，daemon detector 用 `'claude'`，需 `normalizeProvider()` 归一。
- **GLM（智谱）** — team mission 的 Coordinator / Finalizer 直接走 messages API（不走 CLI，spike-04 结论：CLI 的 agentic system prompt 让 GLM 拒绝输出纯委派 JSON）。

**部署**：Docker Compose（`deploy/`），前端 Next.js 14 + 此后端 + Postgres + Redis + MinIO + daemon 分发；健康检查 `GET /api/health`。

## 运行入口与开发约定

- 安装：`cd backend && uv sync --all-extras`（dev 组含 pytest 全家桶 / ruff / mypy / pre-commit）。
- 启动：`cd backend && uv run uvicorn app.main:app --reload --port 8000`（需 `DATABASE_URL`、`SECRET_KEY` 等 env 或 `.env`）。
- 必填 env：`DATABASE_URL`、`SECRET_KEY`（≥16 字符）；常用：`REDIS_URL`、`ENVIRONMENT`、`CORS_ALLOWED_ORIGINS`、`SPEC_DATA_ROOT`、`SILLYSPEC_MASTER_KEY`、`PLATFORM_BOOTSTRAP_ADMIN_PASSWORD`。
- 测试：`uv run pytest -q --cov=app --cov-fail-under=60`（hermetic，内存 SQLite + httpx ASGI，不需真实 PG/Redis）。
- Lint / 类型：`uv run ruff check .` / `uv run mypy app`。
- 约定（`backend/README.md`）：Async-first（同步代码仅限 CLI / migrations）；settings 不可变、`get_settings()` 单例缓存；structlog 禁 `print`；错误响应统一 `{code, message, request_id, details}`。
