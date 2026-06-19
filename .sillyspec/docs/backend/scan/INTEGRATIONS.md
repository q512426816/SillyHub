---
author: qinyi
created_at: 2026-06-19 12:50:59
source_commit: 0303536
updated_at: 2026-06-19T04:50:59Z
generator: sillyspec-scan
---

# Backend 外部集成（INTEGRATIONS）

> 按「数据存储 / 缓存与队列 / 认证与加密 / HTTP 客户端 / 可观测 / 构建」分组，基于 `pyproject.toml` 依赖与 `app/core/*.py`、各模块 grep 摘录。

## 数据存储

| 依赖 | 版本 | 用途 | 接入点 |
| --- | --- | --- | --- |
| asyncpg | ≥ 0.29 | PostgreSQL 异步驱动（通过 SQLAlchemy URL `postgresql+asyncpg://...`） | `app/core/db.py::create_async_engine` |
| SQLAlchemy[asyncio] | ≥ 2.0 | 异步 ORM 引擎 + `async_sessionmaker` + 连接池（`pool_pre_ping=True`、可配 size/timeout/recycle） | `app/core/db.py` |
| SQLModel | ≥ 0.0.22 | 声明式模型基类 `BaseModel(SQLModel)`；所有表 `table=True` + `__tablename__` | `app/models/base.py`、各模块 `model.py` |
| Alembic | ≥ 1.13 | 数据库迁移；`migrations/env.py` 异步上下文；~55 个 revision | `migrations/` |
| aiosqlite | ≥ 0.20 | **仅测试**：内存 SQLite 引擎（`sqlite+aiosqlite:///:memory:`）替代 Postgres | `backend/conftest.py::db_engine` |

**数据表清单**（grep `__tablename__` 命中，~41 张）：
`organizations`、`user_organizations`、`user_roles`、`workspaces`、`workspace_relations`、`change_workspaces`、`task_workspaces`、`agent_run_workspaces`、`users`、`sessions`、`roles`、`role_permissions`、`api_keys`、`user_workspace_roles`、`changes`、`change_documents`、`tasks`、`change_reviews`、`audit_logs`、`agent_runs`、`agent_run_logs`、`agent_sessions`、`daemon_runtimes`、`daemon_task_leases`、`worktree_leases`、`git_operation_logs`、`git_identities`、`tool_operation_logs`、`tool_policies`、`scan_documents`、`spec_workspaces`、`spec_profile_manifests`、`spec_conflicts`、`releases`、`release_approvals`、`incidents`、`postmortems`、`platform_settings` 等。

## 缓存与队列

| 依赖 | 版本 | 用途 | 接入点 |
| --- | --- | --- | --- |
| redis | ≥ 5.0（`redis.asyncio`） | 缓存 + pub/sub；AgentRun 日志走 pub/sub → SSE 推流；测试库 `REDIS_URL=redis://localhost:6379/15` | `app/core/redis.py::from_url` / `close_redis` |

## 认证与加密

| 依赖 | 版本 | 用途 | 接入点 |
| --- | --- | --- | --- |
| python-jose[cryptography] | ≥ 3.3 | JWT 编解码（access/refresh token） | `app/core/security.py`（`from jose import JWTError, jwt`） |
| passlib[bcrypt] | ≥ 1.7 | 密码哈希（bcrypt，rounds 可配 4–15，默认 12） | `app/core/security.py::password_hasher`、`auth/service.py` |
| pynacl | ≥ 1.5 | NaCl SecretBox 主密钥加解密（`v1:` 前缀密文，环境变量 `SILLYSPEC_MASTER_KEY`） | `app/core/crypto.py`（`from nacl import secret, utils`），用于加密 git 凭据等敏感字段 |

## HTTP 客户端

| 依赖 | 版本 | 用途 | 接入点 |
| --- | --- | --- | --- |
| httpx | ≥ 0.27（`AsyncClient`） | 外部 HTTP 调用 + 测试 ASGI 客户端 | `git_identity/providers/github.py`（OAuth，`timeout=15`）；测试 `httpx.ASGITransport` 直连 app |

## 可观测

| 依赖 | 版本 | 用途 | 接入点 |
| --- | --- | --- | --- |
| structlog | ≥ 24.4 | 结构化事件日志（key=value） | `app/core/logging.py::configure_logging` + `get_logger` |
| OpenTelemetry（可选） | — | 链路追踪 stub；仅当 `OTEL_ENDPOINT` 设置时初始化 | `app/core/telemetry.py`（当前为 `log.info("telemetry.init", status="stub")` 占位） |

**请求追踪**：`request_id_middleware` 透传/生成 `x-request-id`，写入 `request.state` 和响应头，错误响应必带 `request_id`。

## 构建 / 工具链

| 依赖 / 工具 | 版本 | 用途 | 接入点 |
| --- | --- | --- | --- |
| hatchling | （build-backend） | 构建后端，wheel packages = `["app"]` | `[build-system]` |
| uv | — | 包管理与运行（`uv run ruff` / `uv run pytest`） | local.yaml 命令 |
| ruff | ≥ 0.6 | Lint + format | `[tool.ruff]`、`ruff.toml`（extend） |
| mypy | ≥ 1.11 | 类型检查（非严格） | `[tool.mypy]` + pydantic 插件 |
| pre-commit | ≥ 4.6 | 提交前钩子（PEP 735 dependency-groups dev 组） | `[dependency-groups]` |
| pytest | ≥ 8 | 测试运行 | `[tool.pytest.ini_options]`（asyncio_mode=auto） |
| pytest-asyncio / pytest-cov / anyio | ≥ 0.23 / ≥ 5 / ≥ 4 | 异步测试 + 覆盖率 + 多线程安全 | `[project.optional-dependencies].dev` |

## 关键环境变量（`app/core/config.py::Settings`）

- `DATABASE_URL`（必填）：异步 PG URL
- `REDIS_URL`：默认 `redis://localhost:6379/0`
- `SECRET_KEY`（必填，≥16 字符）：JWT 签名密钥
- `LOG_LEVEL`：默认 `INFO`
- `ENVIRONMENT`：`dev` / `test` / `prod`
- `CORS_ALLOWED_ORIGINS`：JSON 数组或逗号分隔，默认 `["http://localhost:3000"]`
- `OTEL_ENDPOINT`：可选，OTEL 上报地址
- `COMMIT_SHA`：可选，否则 `git rev-parse` 探测
- `AUTH_ACCESS_TTL_MINUTES` / `AUTH_REFRESH_TTL_DAYS` / `AUTH_BCRYPT_ROUNDS`
- `PLATFORM_BOOTSTRAP_ADMIN_EMAIL/PASSWORD/DISPLAY_NAME`
- `WORKTREE_BASE_DIR`：worktree 根目录（Windows/Linux 不同默认）
- `SPEC_DATA_ROOT`：平台托管 spec 存储根目录（默认 `/data/sillyspec-data`）
- `HOST_PATH_PREFIX` / `CONTAINER_PATH_PREFIX`：Docker 路径映射
- `SILLYSPEC_MASTER_KEY`：NaCl 主密钥（`v1:` + hex，测试注入）
