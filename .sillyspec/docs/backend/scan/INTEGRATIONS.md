---
source_commit: fcbf3fa7
updated_at: 2026-06-22T18:12:26Z
generator: sillyspec-scan
author: qinyi
created_at: 2026-06-23 02:12:26
---

# Backend 外部集成（INTEGRATIONS）

> 按「数据存储 / 缓存与队列 / 进程间通信 / 外部 HTTP / 可观测 / 构建」分组，基于 `pyproject.toml` 依赖与 `app/core/*.py`、各模块 grep 摘录。

## 数据存储 — PostgreSQL

| 依赖 | 版本 | 用途 | 接入点 |
| --- | --- | --- | --- |
| asyncpg | ≥ 0.29 | PostgreSQL 异步驱动（SQLAlchemy URL `postgresql+asyncpg://...`） | `app/core/db.py::create_async_engine` |
| SQLAlchemy[asyncio] | ≥ 2.0 | 异步 ORM 引擎 + `async_sessionmaker` + 连接池（`pool_pre_ping=True`、可配 size/timeout/recycle） | `app/core/db.py` |
| SQLModel | ≥ 0.0.22 | 声明式模型基类 `BaseModel(SQLModel)`；所有表 `table=True` + `__tablename__` | `app/models/base.py`、各模块 `model.py` |
| Alembic | ≥ 1.13 | 数据库迁移；`migrations/env.py` 异步上下文；约 30 个 revision | `migrations/`、`alembic.ini` |
| aiosqlite | ≥ 0.20 | **仅测试**：内存 SQLite（`sqlite+aiosqlite:///:memory:`）替代 Postgres | `backend/conftest.py::db_engine` |

数据库连接通过 `DATABASE_URL` 配置（必填）。`create_tables.py` 提供开发期直接建表入口。

## 缓存与队列 — Redis（含 Pub/Sub）

| 依赖 | 版本 | 用途 | 接入点 |
| --- | --- | --- | --- |
| redis | ≥ 5.0（`redis.asyncio`） | 缓存 + pub/sub；AgentRun 日志走 pub/sub → SSE 推流（`AgentService.stream_run_logs`）；daemon WebSocket hub 心跳/事件；测试库 `REDIS_URL=redis://localhost:6379/15` | `app/core/redis.py::from_url` / `close_redis` |

## 进程间通信 — sillyhub-daemon（HTTP + WebSocket）

backend 与 sillyhub-daemon（独立子项目）通过两层协议协同：

- **HTTP/REST**：`app/modules/daemon/router.py` + `lease_service.py`——daemon 注册运行时、claim/start/heartbeat/complete 租约、上报 run 同步状态（run_sync）、补丁（patch）。daemon 持 API Key（`X-API-Key`）经 `get_current_principal` 鉴权。
- **WebSocket**：`app/modules/daemon/ws_hub.py` + `protocol.py`——daemon 建立 WS 长连接接收下行 RPC（如权限查询、会话消息回传）；`permission_service.py` 处理权限下行。
- **会话历史**：`session/` 子包 + `session_dialog_requests` 表存储交互式会话的对话请求/响应。

> 注：sillyhub-daemon 子项目源码不在本扫描范围；backend 侧只见上述契约。

## 外部 HTTP

| 依赖 | 版本 | 用途 | 接入点 |
| --- | --- | --- | --- |
| httpx | ≥ 0.27（`AsyncClient`） | 外部 HTTP 调用 + 测试 ASGI 客户端 | `git_identity/providers/github.py`（OAuth，`timeout=15`）；测试 `httpx.ASGITransport` 直连 app |

## LLM / Agent 进程

backend 不直接调用 LLM HTTP API，而是通过 daemon 租约把 agent run 派发到实际 agent 进程（如 claude code adapter，`agent_type="claude_code"`）。`agent/placement.py::RunPlacementService.dispatch_to_daemon` 负责调度；`provider` 列区分具体 LLM provider（claude / 其他）。日志经 daemon → Redis pub/sub → backend SSE 回传。

## 文件系统

- **spec 数据根目录**：`SPEC_DATA_ROOT`（默认 `/data/sillyspec-data`，测试指向 tempdir）。`app/core/paths.py` + `spec_paths.py` 计算托管 spec 存储路径；`layout_migration.py` 处理目录布局迁移。
- **worktree 根目录**：`WORKTREE_BASE_DIR`（Windows/Linux 不同默认），`worktree/git_runner.py` 在其下创建/释放 git worktree。
- **Docker 路径映射**：`HOST_PATH_PREFIX` / `CONTAINER_PATH_PREFIX` 处理宿主↔容器路径转换（agent-run 调度 prompt 生成宿主路径）。
- **变更文档落盘**：`change_writer/service.py` 写入 SillySpec markdown（含 frontmatter，依赖 `python-frontmatter`）。

## 可观测

| 依赖 | 版本 | 用途 | 接入点 |
| --- | --- | --- | --- |
| structlog | ≥ 24.4 | 结构化事件日志（key=value） | `app/core/logging.py::configure_logging` + `get_logger` |
| OpenTelemetry（可选） | — | 链路追踪 stub；仅当 `OTEL_ENDPOINT` 设置时初始化 | `app/core/telemetry.py`（当前 `log.info("telemetry.init", status="stub")` 占位） |

**请求追踪**：`request_id_middleware` 透传/生成 `x-request-id`，写入 `request.state` 和响应头，错误响应必带 `request_id`。

## 构建 / 工具链

| 依赖 / 工具 | 版本 | 用途 | 接入点 |
| --- | --- | --- | --- |
| hatchling | （build-backend） | 构建后端，wheel packages = `["app"]` | `[build-system]` |
| uv | — | 包管理与运行（`uv run ruff` / `uv run pytest`） | — |
| ruff | ≥ 0.6 | Lint + format | `[tool.ruff]`、`ruff.toml`（extend） |
| mypy | ≥ 1.11 | 类型检查（非严格） | `[tool.mypy]` + pydantic 插件 |
| pre-commit | ≥ 4.6 | 提交前钩子（PEP 735 dev 组） | `[dependency-groups]` |
| pytest / pytest-asyncio / pytest-cov / anyio | ≥ 8 / ≥ 0.23 / ≥ 5 / ≥ 4 | 测试运行 | `[tool.pytest.ini_options]`（asyncio_mode=auto） |

## 关键环境变量（`app/core/config.py::Settings`）

- `DATABASE_URL`（必填）：异步 PG URL
- `REDIS_URL`：默认 `redis://localhost:6379/0`
- `SECRET_KEY`（必填，≥16 字符）：JWT 签名密钥
- `LOG_LEVEL`：默认 `INFO`
- `ENVIRONMENT`：`dev` / `test` / `prod`
- `CORS_ALLOWED_ORIGINS`：JSON 数组或逗号分隔
- `OTEL_ENDPOINT`：可选，OTEL 上报地址
- `COMMIT_SHA`：可选，否则 `git rev-parse` 探测
- `AUTH_ACCESS_TTL_MINUTES` / `AUTH_REFRESH_TTL_DAYS` / `AUTH_BCRYPT_ROUNDS`
- `PLATFORM_BOOTSTRAP_ADMIN_EMAIL/PASSWORD/DISPLAY_NAME`
- `WORKTREE_BASE_DIR`：worktree 根目录
- `SPEC_DATA_ROOT`：平台托管 spec 存储根目录
- `HOST_PATH_PREFIX` / `CONTAINER_PATH_PREFIX`：Docker 路径映射
- `SILLYSPEC_MASTER_KEY`：NaCl 主密钥（`v1:` + hex）
