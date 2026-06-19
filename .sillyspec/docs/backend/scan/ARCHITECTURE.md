---
author: qinyi
created_at: 2026-06-19 12:50:59
source_commit: 0303536
updated_at: 2026-06-19T04:50:59Z
generator: sillyspec-scan
---

# Backend 架构文档（ARCHITECTURE）

> 扫描对象：`backend/`（FastAPI 服务 `multi-agent-platform-api`）。

## 技术栈

| 层 | 选型 | 说明 |
| --- | --- | --- |
| 运行时 | Python ≥ 3.12（`requires-python = ">=3.12"`） | 全量使用 `from __future__ import annotations` + PEP 604 联合类型 |
| Web 框架 | FastAPI ≥ 0.115 + Uvicorn[standard] ≥ 0.30 | 入口 `app/main.py::create_app()`；OpenAPI 暴露在 `/api/docs`、`/api/redoc`、`/api/openapi.json` |
| 数据建模 | Pydantic ≥ 2.8 + Pydantic-Settings ≥ 2.4 | `Settings(BaseSettings)` 单例化（`@lru_cache`），所有运行时配置集中读取，禁止业务代码直接读 `os.environ` |
| ORM | SQLModel ≥ 0.0.22 + SQLAlchemy[asyncio] ≥ 2.0 + asyncpg ≥ 0.29 | 统一基类 `app/models/base.py::BaseModel(SQLModel)`；所有表通过 `table=True` 显式声明，`__tablename__` 强制 |
| 迁移 | Alembic ≥ 1.13 | `migrations/versions/` 下 ~55 个 revision，命名 `YYYYMMDDHHMM_*.py`；`migrations/env.py` 配置异步上下文 |
| 缓存/队列 | Redis ≥ 5.0（`redis.asyncio`） | `app/core/redis.py::from_url`；AgentRun 日志走 Redis pub/sub（SSE 推流） |
| 日志 | structlog ≥ 24.4 | `app/core/logging.py::configure_logging`，事件式 key=value 日志（如 `log.info("app.start", ...)`） |
| 可观测 | OpenTelemetry（stub） | `app/core/telemetry.py`：仅当 `settings.otel_endpoint` 设置时初始化，当前为占位 stub |
| 认证 | python-jose[cryptography] + passlib[bcrypt] + pynacl | JWT（access/refresh）+ API Key 双路径；主密钥加密用 NaCl SecretBox（`app/core/crypto.py`） |
| HTTP 客户端 | httpx ≥ 0.27（`httpx.AsyncClient`） | 测试用 `httpx.ASGITransport` 直连 ASGI app；外部调用如 GitHub OAuth（`git_identity/providers/github.py`） |
| 测试 | pytest ≥ 8 + pytest-asyncio（`asyncio_mode = "auto"`） + pytest-cov + aiosqlite | `testpaths = ["tests", "app"]`，同时收集顶层集成与模块内单测 |
| Lint / 类型 | ruff（line-length=100, py312, E/F/I/B/UP/N/SIM/RUF/BLE）+ mypy（`strict=false`，启用 pydantic 插件，但禁用了大量 error_code） | dev 组含 pre-commit ≥ 4.6（PEP 735 dependency-groups） |
| 构建 | hatchling（`[tool.hatch.build.targets.wheel] packages = ["app"]`） | 包名 `multi-agent-platform-api` v0.1.0 |

## 架构概览

### 分层与请求流

```
HTTP Request
   │  (x-request-id 中间件：透传/生成 UUID → 写 request.state + response 头)
   ▼
FastAPI Router (app/modules/<module>/router.py)        —— 22 个 APIRouter，统一 /api 前缀挂载
   │  Depends(get_session)  Depends(require_permission(...)|get_current_user|get_current_principal)
   ▼
Service 层 (app/modules/<module>/service.py)            —— 业务编排，20 个 service 模块
   │  抛 AppError 子类（app/core/errors.py 统一错误码 + http_status）
   ▼
Model / Schema (app/modules/<module>/{model,schema}.py) —— SQLModel 表 + Pydantic DTO
   │
   ▼
SQLAlchemy async engine (app/core/db.py，pool_pre_ping + 连接池)
   │
   ▼
PostgreSQL（asyncpg）  +  Redis（pub/sub、缓存）
```

### 应用装配（`app/main.py::create_app`）

- **lifespan**：启动时 `configure_logging` → `init_telemetry` → 引导 RBAC（`bootstrap_admin_and_seed_rbac`）→ 清理 stale agent runs；关闭时 `dispose_engine` + `close_redis`。
- **中间件**：`CORSMiddleware`（`allow_credentials=True`、`expose_headers=["x-request-id"]`）+ 自定义 `request_id_middleware`（HTTP 中间件，非 `add_middleware`）。
- **错误处理**：`register_exception_handlers(app)` 注册 `AppError` / `HTTPException` / `RequestValidationError` / 兜底 `Exception` 四类 handler，统一序列化为 `{code, message, request_id, details}`。
- **路由挂载顺序敏感**：`_register_quick_chat(app)` 必须在 `workspace_router` 之前注册，否则 `/api/daemon-chat`（定长路径）会被 `/api/workspaces/{workspace_id}/...` 参数化路由抢先匹配；`members_router` 因自带前缀只能作为兄弟挂载（否则 `include_router(prefix=...)` 会重复计数参数报 `Duplicated param name workspace_id`）。

### 模块化（24 个业务模块）

`app/modules/` 下 24 个模块，每个模块基本遵循 `router.py` + `service.py` + `model.py` + `schema.py` + `tests/` 的约定。核心模块：

- **auth**：User/Session/Role/RolePermission/ApiKey/UserWorkspaceRole 六张表；JWT + API Key 双路径鉴权（`get_current_principal`）。
- **admin**：Organization/UserOrganization/UserRole，组织 + 角色 RBAC 管理中心。
- **workspace**：Workspace + WorkspaceRelation（多对多图） + 三张关联表（change/task/agent_run ↔ workspace）。
- **change / task / change_writer / workflow**：SillySpec 变更-任务-工作流闭环；`workflow/fsm.py` 已标记 `deprecated`，状态机迁至 `change.model.StageEnum + TRANSITIONS`。
- **agent / daemon**：AgentRun + AgentRunLog + AgentSession + DaemonRuntime + DaemonTaskLease；agent run 通过 daemon lease 派发，日志走 Redis pub/sub → SSE（`AgentService.stream_run_logs`）。
- **tool_gateway / git_gateway / git_identity / worktree**：工具网关策略 + Git 操作审计 + GitHub OAuth 身份 + git worktree 租约。
- **scan_docs / spec_workspace / spec_profile**：项目扫描文档 + spec 工作区 + spec profile（多处 `TODO: implement in follow-up task` 未完成）。
- **release / incident / archive / knowledge / runtime / settings / health**：发布、事件复盘、归档、知识库、运行时、平台设置、健康探针。

### 鉴权模型（`app/core/auth_deps.py`）

- 无全局身份中间件，每个受保护路由显式声明依赖。
- 三种依赖：`get_current_user`（仅 JWT）、`require_permission(Permission.X)`（workspace 维度鉴权，路径必须含 `{workspace_id}`）、`require_permission_any(Permission.X)`（跨 workspace）。
- `get_current_principal`：双路径——优先 `Authorization: Bearer <jwt>`，否则 `X-API-Key: <plaintext>`（供 daemon 长凭证使用）。
- `require_platform_admin`：平台管理员门禁。

### 数据访问（`app/core/db.py`）

- 进程级单例 `AsyncEngine`（`create_async_engine` + `pool_pre_ping=True` + 可配 `pool_size`/`pool_timeout`/`pool_recycle`）。
- `get_session_factory()` 返回缓存的 `async_sessionmaker[AsyncSession]`；`get_session()` 作为 FastAPI 依赖产出会话。
- **审计钩子**（`app/core/audit_hooks.py`）：拦截所有 `BaseModel(table=True)` 的增删改，写入 `audit_logs` 表。

### 快速聊天（quick-chat）特例

`/api/daemon-chat*` 四个端点直接定义在 `main.py` 内（非独立模块），使用裸 `sa_text` SQL 操作 `agent_runs` 表，以 `spec_strategy='quick-chat'` 与 workspace-scoped run 区分；复用 `AgentService` / `RunPlacementService` / `DaemonLeaseService`。
