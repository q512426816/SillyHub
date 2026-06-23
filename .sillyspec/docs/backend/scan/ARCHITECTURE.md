---
source_commit: ba87eec
updated_at: 2026-06-23T16:19:42Z
created_at: 2026-06-24T00:19:42
author: qinyi
generator: sillyspec-scan
---

# Backend 架构文档（ARCHITECTURE）

> 扫描对象：`backend/`（FastAPI 服务 `multi-agent-platform-api` v0.1.0，包管理 uv，构建 hatchling）。

## 技术栈

| 层 | 选型 | 说明 |
| --- | --- | --- |
| 运行时 | Python ≥ 3.12（`requires-python = ">=3.12"`） | 全量使用 `from __future__ import annotations` + PEP 604 联合类型 |
| Web 框架 | FastAPI ≥ 0.115 + Uvicorn[standard] ≥ 0.30 | 入口 `app/main.py::create_app()`；OpenAPI 暴露在 `/api/docs`、`/api/redoc`、`/api/openapi.json` |
| 数据建模 | Pydantic ≥ 2.8 + Pydantic-Settings ≥ 2.4 | `Settings(BaseSettings)` 单例化（`@lru_cache`），所有运行时配置集中读取 |
| ORM | SQLModel ≥ 0.0.22 + SQLAlchemy[asyncio] ≥ 2.0 + asyncpg ≥ 0.29 | 统一基类 `app/models/base.py::BaseModel(SQLModel)`；所有表通过 `table=True` 显式声明，`__tablename__` 强制 |
| 迁移 | Alembic ≥ 1.13 | `migrations/versions/` 下约 60 个 revision，命名 `YYYYMMDDHHMM_*.py`；`migrations/env.py` 配置异步上下文 |
| 缓存/队列 | Redis ≥ 5.0（`redis.asyncio`） | `app/core/redis.py::from_url`；AgentRun 日志走 Redis pub/sub（SSE 推流） |
| 日志 | structlog ≥ 24.4 | `app/core/logging.py::configure_logging`，事件式 key=value 日志 |
| 可观测 | OpenTelemetry（stub） | `app/core/telemetry.py`：仅当 `settings.otel_endpoint` 设置时初始化，当前为占位 stub |
| 认证 | python-jose[cryptography] ≥ 3.3 + passlib[bcrypt] ≥ 1.7 + pynacl ≥ 1.5 | JWT（access/refresh）+ API Key 双路径；主密钥加密用 NaCl SecretBox（`app/core/crypto.py`） |
| HTTP 客户端 | httpx ≥ 0.27（`httpx.AsyncClient`） | 测试用 `httpx.ASGITransport` 直连 ASGI app；外部调用如 GitHub OAuth |
| Excel | openpyxl ≥ 3.1 | PPM 等模块导入/导出 |
| 测试 | pytest ≥ 8 + pytest-asyncio ≥ 0.23（`asyncio_mode = "auto"`） + pytest-cov ≥ 5 + aiosqlite | `testpaths = ["tests", "app"]`，cov 阈值 60 |
| Lint / 类型 | ruff（line-length=100, py312, E/F/I/B/UP/N/SIM/RUF/BLE）+ mypy（pydantic 插件，禁用大量 error_code） | dev 组含 pre-commit ≥ 4.6（PEP 735 dependency-groups） |
| 构建 | hatchling（`packages = ["app"]`） | 包名 `multi-agent-platform-api` |

## 架构概览

### 分层与请求流

```
HTTP Request
   │  (request_id_middleware：透传/生成 x-request-id → 写 request.state + response 头)
   ▼
FastAPI Router (app/modules/<module>/router.py)        —— 约 23 个 APIRouter，统一 /api 前缀挂载
   │  Depends(get_session)  Depends(require_permission|get_current_user|get_current_principal)
   ▼
Service 层 (app/modules/<module>/service.py)            —— 业务编排，抛 AppError 子类
   ▼
Model / Schema (app/modules/<module>/{model,schema}.py) —— SQLModel 表 + Pydantic DTO
   ▼
SQLAlchemy async engine (app/core/db.py，pool_pre_ping + 连接池)
   ▼
PostgreSQL（asyncpg）  +  Redis（pub/sub、缓存）
```

### 应用装配（`app/main.py::create_app`）

- **lifespan**：启动时 `configure_logging(settings.log_level)` → `init_telemetry(settings)` → 引导 RBAC（`bootstrap_admin_and_seed_rbac`）→ 清理 stale agent runs；关闭时 `dispose_engine` + `close_redis`。
- **中间件**：`CORSMiddleware`（`allow_credentials=True`、`expose_headers=["x-request-id"]`）+ 自定义 `request_id_middleware`（HTTP 中间件，非 `add_middleware`）。
- **错误处理**：`register_exception_handlers(app)` 注册 `AppError` / `HTTPException` / `RequestValidationError` / 兜底 `Exception` 四类 handler，统一序列化为 `{code, message, request_id, details}`。
- **路由挂载（顺序敏感）**：`qc_router`（quick-chat）必须在 `workspace_router` 之前注册，否则 `/api/daemon-chat`（定长路径）会被 `/api/workspaces/{workspace_id}/...` 参数化路由抢先匹配；`members_router` 因自带前缀只能作为兄弟挂载（否则 `include_router(prefix=...)` 会重复计数参数报 `Duplicated param name workspace_id`）。PPM 五个 router 统一挂载到 `/api/ppm`（project/plan/task/problem/kanban）。

### 分层（core 横切 + modules 业务）

- **`app/core/`（横切关注点）**：config（Settings 单例）/ db（AsyncEngine + sessionmaker + get_session 依赖）/ redis（连接管理 + close_redis）/ logging（structlog）/ telemetry（OTEL stub）/ security（JWT）/ crypto（NaCl SecretBox）/ auth_deps（鉴权依赖）/ errors（AppError + 错误码 + handler 注册）/ audit_hooks（SQLAlchemy 事件 → audit_logs）/ paths + spec_paths + layout_migration（路径工具）。
- **`app/modules/`（24 个业务目录）**：每个模块基本遵循 `router.py` + `service.py` + `model.py` + `schema.py` + `tests/`。核心域：admin / agent / archive / auth / change / change_writer / daemon / git_gateway / git_identity / health / incident / knowledge / ppm（子域）/ release / runtime / scan_docs / settings / spec_profile / spec_workspace / task / tool_gateway / workflow / workspace / worktree。

### DaemonService 5 子包拆分

`app/modules/daemon/service.py::DaemonService` 已拆分为 facade，业务逻辑下沉到 5 个子包服务：

- **`runtime/` → `RuntimeService`**：daemon 运行时注册、心跳、claim/complete。
- **`lease/` → `LeaseService`**：任务租约 create/claim/start/heartbeat/complete/expire，含 `cancel_lease`（quick-chat kill 复用）。
- **`run_sync/` → `RunSyncService`**：daemon 上报的 run 状态同步（submit_messages 等）。
- **`session/` → `SessionService`**：交互式会话历史（session_dialog_requests）。
- **`patch/` → `PatchService`**：daemon 补丁/差异上报。

facade 通过函数级 lazy import 实例化各子包服务，并反向注入 `self._facade` 引用供跨子域委托调用（如 submit_messages 经 facade 验证 lease token）。顶层仍保留 `lease_service.py`（DaemonLeaseService，供 router/placement 复用）、`permission_service.py`（DaemonPermissionService，权限下行）、`ws_hub.py`（WebSocket）、`protocol.py`（协议）。

### 鉴权模型（`app/core/auth_deps.py`）

- 无全局身份中间件，每个受保护路由显式声明依赖。
- 依赖三件套：`get_current_user`（仅 JWT）/ `require_permission(Permission.X)`（workspace 维度，路径必须含 `{workspace_id}`）/ `require_permission_any(Permission.X)`（跨 workspace）。
- `get_current_principal`：双路径——优先 `Authorization: Bearer <jwt>`，否则 `X-API-Key: <plaintext>`（供 daemon 长凭证使用）。
- `require_platform_admin`：平台管理员门禁。

### 数据访问（`app/core/db.py`）

- 进程级单例 `AsyncEngine`（`create_async_engine` + `pool_pre_ping=True` + 可配 `pool_size`/`pool_timeout`/`pool_recycle`）。
- `get_session_factory()` 返回缓存的 `async_sessionmaker[AsyncSession]`；`get_session()` 作为 FastAPI 依赖产出会话。SSE/后台任务走 `get_session_factory()` 短会话。
- **审计钩子**（`app/core/audit_hooks.py`）：拦截所有 `BaseModel(table=True)` 的增删改，写入 `audit_logs` 表。

### 数据层 Schema 概要（表名 + 说明 + 字段数估算）

仅列 SQLModel 表，字段数为粗略估算（不含多对多关联展开）：

| 域 | 表名 | 说明 | 字段数 |
| --- | --- | --- | --- |
| auth | users / sessions / roles / role_permissions / api_keys / user_workspace_roles | 用户、会话、角色、权限、API Key、用户-工作区-角色 | ~12 / ~8 / ~6 / ~4 / ~8 / ~5 |
| admin | organizations / user_organizations / user_roles | 组织、用户-组织、用户-角色 | ~10 / ~4 / ~5 |
| workspace | workspaces / workspace_relations / change_workspaces / task_workspaces / agent_run_workspaces | 工作区及其与 change/task/agent_run 的多对多关联 | ~12 / +关联 |
| change | changes / change_documents | 变更主表及文档 | ~20 / ~8 |
| workflow | change_reviews / audit_logs | 变更评审、审计日志 | ~8 / ~9 |
| task | tasks | 任务 | ~10 |
| agent | agent_runs / agent_run_logs / agent_sessions / agent_missions / agent_run_dependencies / agent_artifacts | Agent 运行、日志、会话、任务、依赖、产物 | ~25 / ~5 / ~12 / ~8 / ~4 / ~6 |
| daemon | daemon_runtimes / daemon_task_leases / session_dialog_requests | daemon 运行时、任务租约、交互式对话请求 | ~12 / ~15 / ~8 |
| worktree | worktree_leases | worktree 租约 | ~10 |
| git_gateway | git_operation_logs | git 操作日志 | ~10 |
| git_identity | git_identities | git 身份（含加密凭据） | ~12 |
| tool_gateway | tool_operation_logs / tool_policies | 工具操作日志与策略 | ~10 / ~8 |
| scan_docs | scan_documents | 扫描文档 | ~8 |
| spec_workspace | spec_workspaces | spec 工作区 | ~8 |
| spec_profile | spec_profile_manifests / spec_conflicts | spec profile 清单与冲突 | ~8 / ~6 |
| release | releases / release_approvals | 发布与审批 | ~12 / ~8 |
| incident | incidents / postmortems | 事件与复盘 | ~12 / ~8 |
| settings | platform_settings | 平台 KV 设置 | ~4 |
| ppm | ppm_project_*、ppm_customer_*、plan_tasks、task_executes、work_hours、ppm_problem_*（list/change + process_task/process_log）、ppm_kanban_*（comment/subtask）、ppm_plan_node*、ppm_ps_*（project_plan/plan_node/plan_node_detail） | PPM 项目、计划、任务、问题、看板子域，约 16+ 张表 | 各表 6~15 |

> 注：`agent_run_logs` 约 5 字段且无 metadata 列（见 CONCERNS 文档）；PPM 子域因含归档表较多，表数量会随迁移增长。

### 快速聊天（quick-chat）特例

`/api/daemon-chat*` 四个端点（POST/GET/stream/kill/logs）直接定义在 `main.py` 内（非独立模块），使用裸 `sa_text` SQL 操作 `agent_runs` 表，以 `spec_strategy='quick-chat'` 与 workspace-scoped run 区分；复用 `AgentService` / `RunPlacementService` / `DaemonLeaseService`。

### 异步架构

全链路 async/await：FastAPI 异步路由 → async service → `AsyncSession` → asyncpg 驱动；Redis 走 `redis.asyncio`；httpx 走 `AsyncClient`。后台/SSE 任务用 `asyncio` 调度，通过 `get_session_factory()` 获取独立短会话避免跨请求复用。pytest-asyncio `auto` 模式自动收集 async 测试。
