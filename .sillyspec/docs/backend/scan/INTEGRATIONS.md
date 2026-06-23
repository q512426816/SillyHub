---
source_commit: ba87eec
updated_at: 2026-06-23T16:20:18Z
created_at: 2026-06-24T00:20:18
author: qinyi
generator: sillyspec-scan
---

# Backend 外部集成（INTEGRATIONS）

> 按「数据存储 / 缓存与队列 / 进程间通信 / 外部 HTTP / 可观测 / 构建」分组，基于 `pyproject.toml` 依赖与 `app/core/*.py`、各模块 grep 摘要实测于 commit `ba87eec`。

## 数据存储 — PostgreSQL

| 依赖 | 用途 | 接入点 |
| --- | --- | --- |
| asyncpg | PostgreSQL 异步驱动（SQLAlchemy URL `postgresql+asyncpg://...`） | `app/core/db.py::create_async_engine` |
| SQLAlchemy[asyncio] | 异步 ORM 引擎 + `async_sessionmaker` + 连接池 | `app/core/db.py` |
| SQLModel | 声明式模型基类 `BaseModel(SQLModel)`；所有表 `table=True` + `__tablename__` | `app/models/base.py`、各模块 `model.py` |
| Alembic | 数据库迁移；`migrations/env.py` 异步上下文；63 个 revision（含 2 个 merge head） | `migrations/`、`alembic.ini` |
| aiosqlite | **仅测试**：内存 SQLite（`sqlite+aiosqlite:///:memory:`）替代 Postgres | `backend/conftest.py::db_engine` |

数据库连接通过 `DATABASE_URL` 配置（必填）。`create_tables.py` 提供开发期直接建表入口。

## 缓存与队列 — Redis（含 Pub/Sub）

| 依赖 | 用途 | 接入点 |
| --- | --- | --- |
| redis | 缓存 + pub/sub（`redis.asyncio`）；AgentRun 日志走 pub/sub → SSE 推流；daemon WebSocket hub 心跳/事件；测试库 `REDIS_URL=redis://localhost:6379/15` | `app/core/redis.py::from_url` / `get_redis` / `close_redis`（单例） |

## 进程间通信 — sillyhub-daemon（HTTP + WebSocket）

backend 与 sillyhub-daemon（独立子项目）通过两层协议协同：

- **HTTP/REST**：`app/modules/daemon/router.py` + `lease_service.py` + 5 子包 service（runtime/lease/run_sync/session/patch）——daemon 注册运行时、claim/start/heartbeat/complete 租约、上报 run 同步状态（run_sync）、补丁（patch）、交互式会话（session）增删/历史/SSE/重开/恢复。daemon 持 API Key（`X-API-Key`）经 `get_current_principal` 鉴权。
- **WebSocket**：`app/modules/daemon/ws_hub.py` + `protocol.py`——daemon 建立 WS 长连接接收下行 RPC（权限查询、会话消息回传、会话控制）；`permission_service.py` 处理权限下行。
- **会话历史**：`daemon/session/service.py` + `session_dialog_requests` 表存储交互式会话的对话请求/响应；`/sessions/{id}/end` 端点 daemon 身份改用 runtime 归属校验（近期修复）。
- **quick-chat**：`main.py` 内联 `qc_router` 提供 `/api/daemon-chat*` 一组端点（创建/结果/流式/kill/日志），底层走 daemon 调度。

> 注：sillyhub-daemon 子项目源码不在本扫描范围；backend 侧只见上述契约。

## 外部 HTTP

| 依赖 | 用途 | 接入点 |
| --- | --- | --- |
| httpx | 外部 HTTP 调用 + 测试 ASGI 客户端 | `git_identity/providers/github.py`（OAuth，`timeout=15`）；测试 `httpx.ASGITransport` 直连 app |

## LLM / Agent 进程

backend 不直接调用 LLM HTTP API，而是通过 daemon 租约把 agent run 派发到实际 agent 进程。`agent/placement.py::RunPlacementService.dispatch_to_daemon` 负责调度；`agent/coordinator.py` + `mission.py` + `execution.py` + `delegation.py` 编排运行；日志经 daemon → Redis pub/sub → backend SSE 回传。

> 注：`agent/adapters/` 目录当前仅含 `__init__.py`，未发现具体 LLM adapter 实现。

## 文件系统

- **spec 数据根目录**：`SPEC_DATA_ROOT`（容器内路径，默认 `/data/sillyspec-data`，测试指向 tempdir），宿主路径由 `SPEC_DATA_HOST_DIR` 指定。`app/core/paths.py::resolve_spec_data_root` + `spec_paths.py` 计算托管 spec 存储路径；`layout_migration.py` 处理目录布局迁移。
- **worktree 根目录**：`WORKTREE_BASE_DIR`（Windows/Linux 不同默认），`worktree/git_runner.py` 在其下创建/释放 git worktree。
- **Docker 路径映射**：`HOST_PATH_PREFIX` / `CONTAINER_PATH_PREFIX` 处理宿主↔容器路径转换（agent-run 调度 prompt 生成宿主路径）。
- **变更文档落盘**：`change_writer/service.py` 写入 SillySpec markdown（含 frontmatter，依赖 `python-frontmatter`）。

## 可观测

| 依赖 | 用途 | 接入点 |
| --- | --- | --- |
| structlog | 结构化事件日志（key=value + JSONRenderer），`configure_logging` idempotent | `app/core/logging.py::configure_logging` + `get_logger` |
| OpenTelemetry（可选） | 链路追踪 stub；仅当 `OTEL_ENDPOINT` 设置时初始化 | `app/core/telemetry.py`（占位） |

**请求追踪**：`request_id_middleware` 透传/生成 `x-request-id`，写入 `request.state` 和响应头，错误响应必带 `request_id`。

## 构建 / 工具链

| 依赖 / 工具 | 用途 | 接入点 |
| --- | --- | --- |
| hatchling | 构建后端，wheel packages = `["app"]` | `[build-system]` |
| uv | 包管理与运行（`uv run ruff` / `uv run pytest`）；`uv.lock` 锁定 | — |
| ruff | Lint + format | `[tool.ruff]`、`ruff.toml`（extend） |
| mypy | 类型检查（非严格） | `[tool.mypy]` + pydantic 插件 |
| pre-commit | 提交前钩子 | `[dependency-groups]` dev 组 |
| pytest / pytest-asyncio / pytest-cov / anyio | 测试运行 | `[tool.pytest.ini_options]`（asyncio_mode=auto） |

## 关键环境变量（`app/core/config.py::Settings`）

- `DATABASE_URL`（必填）：异步 PG URL
- `REDIS_URL`：默认 `redis://localhost:6379/0`
- `SECRET_KEY`（必填，≥16 字符）：JWT 签名密钥
- `LOG_LEVEL`：默认 `INFO`
- `ENVIRONMENT`：`dev` / `test` / `prod`（Literal）
- `CORS_ALLOWED_ORIGINS`：JSON 数组或逗号分隔（含 `before` validator）
- `OTEL_ENDPOINT`：可选，OTEL 上报地址
- `COMMIT_SHA`：可选，否则 `git rev-parse` 探测（`resolved_commit_sha` 属性）
- `WORKTREE_BASE_DIR`：worktree 根目录（平台相关默认）
- `SPEC_DATA_ROOT`：平台托管 spec 存储的容器内根目录
- `SPEC_DATA_HOST_DIR`：与 `SPEC_DATA_ROOT` 对应的宿主路径（daemon 零客户端配置用）
- `HOST_PATH_PREFIX` / `CONTAINER_PATH_PREFIX`：Docker 路径映射
- `SILLYSPEC_MASTER_KEY`：NaCl 主密钥（`v1:` + hex）
