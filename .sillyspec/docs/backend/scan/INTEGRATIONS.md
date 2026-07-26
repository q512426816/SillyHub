---
author: qinyi
created_at: 2026-07-27 00:35:31
source_commit: 6e78b29a
updated_at: 2026-07-26T16:35:31Z
generator: sillyspec-scan
---

# 集成(Integrations)

> 按「数据库 / 缓存 / 对象存储 / 认证 / 进程间通信(WebSocket+HTTP) / 外部 HTTP / Python 依赖库」分组,基于 `backend/pyproject.toml` 依赖与 `app/core/*.py`、各模块 grep 摘要实测于 commit `6e78b29a`。
> 本次增量:新增 MinIO 对象存储(`aiobotocore` + `storage` 模块);httpx 出站点新增 `agent/finalizer.py`、`agent/delegation.py`、`tool_gateway/service.py`。

## 数据库 — PostgreSQL(async)

| 依赖 | 用途 | 接入点 |
| --- | --- | --- |
| `asyncpg>=0.29` | PostgreSQL 异步驱动(SQLAlchemy URL `postgresql+asyncpg://...`) | `app/core/db.py::create_async_engine` |
| `sqlalchemy[asyncio]>=2.0` | 异步 ORM 引擎 + `async_sessionmaker` + 连接池 | `app/core/db.py` |
| `sqlmodel>=0.0.22` | 声明式模型基类 `BaseModel(SQLModel)`;所有表 `table=True` + `__tablename__` | `app/models/base.py`、各模块 `model.py` |
| `alembic>=1.13` | 数据库迁移;`migrations/env.py` 异步上下文;**116 个 revision**(含多份 merge head) | `migrations/`、`alembic.ini` |
| `aiosqlite`(dev) | **仅测试**:内存 SQLite(`sqlite+aiosqlite:///:memory:`)替代 Postgres | `backend/conftest.py::db_engine` |

数据库连接经 `DATABASE_URL` 配置(必填);`create_tables.py` 提供开发期直接建表入口。测试用 SQLite,生产 PG,方言差异需注意(如 `date_trunc`)。

## 缓存与队列 — Redis

| 依赖 | 用途 | 接入点 |
| --- | --- | --- |
| `redis>=5.0` | 异步缓存 + pub/sub(`redis.asyncio`);权限缓存、AgentRun 日志 pub/sub → SSE 推流、daemon WS hub 事件 | `app/core/redis.py::from_url` / `get_redis` / `close_redis`(单例);`app/core/permission_cache.py` |

连接经 `REDIS_URL` 配置(默认 `redis://localhost:6379/0`,测试用 db 15)。compose 服务:`redis`。

## 对象存储 — MinIO(S3 兼容,新增)

| 依赖 | 用途 | 接入点 |
| --- | --- | --- |
| `aiobotocore>=3.8,<4` | 异步 S3 客户端,平台文件中心后端存储 | `app/modules/storage/minio_backend.py::MinioStorage` |

- 抽象层:`app/modules/storage/base.py` 定义 `StorageBackend` 接口;`factory.py` 按 `Settings.storage_backend` 选实现,单例 + `get_storage_backend` 作为 FastAPI Depends 注入点(测试 `dependency_overrides` 注入 mock,不依赖真实 MinIO,NFR-4)。
- 配置:`Settings` 的 `s3_endpoint`/`s3_access_key`/`s3_secret_key`/`s3_bucket`/`s3_region`;预留 OSS 等扩展点(在 `factory._build` 注册)。
- compose 服务:`minio`(端口 9000 API / 9001 控制台)。

## 认证 — JWT + 口令哈希 + 加密

| 依赖 | 用途 | 接入点 |
| --- | --- | --- |
| `python-jose[cryptography]>=3.3` | JWT 签发/校验,`HS256` | `app/core/security.py`(`from jose import JWTError, jwt`;`create_access_token` 编、`jwt.decode` 解) |
| `passlib[bcrypt]>=1.7` | 口令 bcrypt 哈希 | `app/core/security.py::password_hasher`;`app/modules/auth/service.py` 调用 |
| `pynacl>=1.5` | NaCl SecretBox 主密钥对称加解密(`v1:` 前缀密文) | `app/core/crypto.py` |

FastAPI 鉴权依赖:`app/core/auth_deps.py`(`get_current_user` / `require_permission` / `get_current_principal`)。daemon 持 API Key(`X-API-Key`)经同一 principal 鉴权。

## 进程间通信 — sillyhub-daemon(HTTP + WebSocket)

backend 与 sillyhub-daemon(独立子项目)通过两层协议协同,全部在 `app/modules/daemon/`:

- **WebSocket**:`router.py` 注册 `@router.websocket("/ws")`(约 L1958);`ws_hub.py` 维护按 `daemon_id` 路由的连接池,承载下行 RPC(权限查询、会话消息回传、会话控制);`protocol.py` 定义消息格式。
- **HTTP/REST**:`router.py` + `lease_service.py` + `dist_router.py`(daemon 安装包 `sillyhub-daemon.js`/`mcp-server.js`/`install.sh|ps1` 分发)+ `change_write_router.py`(写回)。
- **租约/会话**:`lease_service.py`(claim/start/heartbeat/complete,interactive vs batch)、`permission_service.py`(权限下行)。
- **远程 daemon**:`dist_router` 提供 `/daemon/install.sh` 与 `/daemon/latest/...` 端点,镜像内 `daemon-dist/` 提供 bundle。

> sillyhub-daemon 子项目源码不在本扫描范围;backend 侧只见上述契约。

## 外部 HTTP — httpx(async)

| 调用点 | 用途 |
| --- | --- |
| `app/modules/git_identity/providers/github.py` | GitHub OAuth 身份校验(`httpx.AsyncClient(timeout=15)`) |
| `app/modules/tool_gateway/service.py` | 工具网关转发;处理 `httpx.TimeoutException` / `RequestError` |
| `app/modules/agent/finalizer.py` | agent → daemon 收尾调用(`trust_env=False`,避免读宿主代理 env) |
| `app/modules/agent/delegation.py` | agent → daemon 委派调用(`trust_env=False`) |

测试侧:`httpx.ASGITransport` 直连 app 做 ASGI 集成测试(`backend/conftest.py`)。

## Python 依赖库(`pyproject.toml`,按用途)

- **Web 框架/服务**:`fastapi>=0.115`、`uvicorn[standard]>=0.30`、`python-multipart>=0.0.9`(表单/文件上传)。
- **数据校验/配置**:`pydantic>=2.8`、`pydantic-settings>=2.4`。
- **数据库/ORM**:`sqlmodel>=0.0.22`、`sqlalchemy[asyncio]>=2.0`、`asyncpg>=0.29`、`alembic>=1.13`。
- **缓存/对象存储**:`redis>=5.0`、`aiobotocore>=3.8,<4`。
- **认证/加密**:`python-jose[cryptography]>=3.3`、`passlib[bcrypt]>=1.7`、`pynacl>=1.5`。
- **日志/可观测**:`structlog>=24.4`(`app/core/logging.py`)、`psutil>=5.9`(系统观测)。
- **HTTP 客户端**:`httpx>=0.27`。
- **文档/办公处理**:`python-frontmatter>=1.1`(SillySpec markdown frontmatter 解析)、`openpyxl>=3.1` + `Pillow>=10`(Excel/图像读写,PPM 导入导出依赖,见 pyproject 注释 D-008 / grill B-001 P0;`ws._images` 读 + `add_image` 写)。
- **dev 依赖**:`pytest`(+`pytest-asyncio`/`pytest-cov`/`pytest-xdist` 并行)、`ruff`、`mypy`、`aiosqlite`、`anyio`、`pymysql`、`pre-commit`、`types-passlib`。

## 可观测与构建工具链

- **structlog**:结构化事件日志(key=value + JSONRenderer),`configure_logging` idempotent。
- **OpenTelemetry**(可选):链路追踪 stub,仅当 `OTEL_ENDPOINT` 设置时初始化(`app/core/telemetry.py`)。
- **hatchling**:构建后端,wheel `packages = ["app"]`。
- **uv**:包管理与运行(`uv run ruff` / `uv run pytest`),`uv.lock` 锁定。
- **ruff / mypy**:Lint+format / 类型检查(`[tool.ruff]` line-length=100、`[tool.mypy]` 非严格 + pydantic 插件)。
- **pre-commit**:提交前钩子(git 层 ruff + claude 层 mypy/前端全量,见 MEMORY ci-check hook)。
