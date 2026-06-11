---
author: qinyi
created_at: 2026-06-10T00:00:00
---

# Backend 技术架构

## 技术栈

| 层级 | 技术 | 版本要求 |
|------|------|----------|
| Web 框架 | FastAPI | >= 0.115 |
| 运行时 | uvicorn (async) | >= 0.30 |
| 数据校验 | Pydantic + pydantic-settings | >= 2.8 |
| ORM | SQLModel + SQLAlchemy (async) | >= 0.0.22 / >= 2.0 |
| 数据库 | PostgreSQL via asyncpg | >= 0.29 |
| 缓存 | Redis (async) | >= 5.0 |
| 迁移 | Alembic | >= 1.13 |
| 日志 | structlog (JSON) | >= 24.4 |
| 认证 | python-jose (JWT HS256) + bcrypt + pynacl | - |
| HTTP 客户端 | httpx | >= 0.27 |
| 构建 | hatchling | - |
| Lint | ruff | >= 0.6 |
| 类型检查 | mypy | >= 1.11 |
| 测试 | pytest + pytest-asyncio + pytest-cov | >= 8 / >= 0.23 |

## 架构概览

Backend 采用 **垂直切片模块化架构**，以 FastAPI 为 HTTP 入口，所有业务逻辑按功能域划分到 `app/modules/<feature>/` 目录下。

### 分层结构

```
请求 → FastAPI Router → Service → SQLModel/SQLAlchemy → PostgreSQL
                     ↘ Redis (缓存/锁/队列)
                     ↘ structlog (JSON 结构化日志)
```

### 核心层 (`app/core/`)

- **config.py** — pydantic-settings 单例 `Settings`，通过 `get_settings()` 获取，支持 env/.env/默认值三层优先级
- **db.py** — 异步 SQLAlchemy 引擎 + session 工厂，懒初始化，支持审计上下文注入
- **redis.py** — 全局异步 Redis 客户端单例
- **logging.py** — structlog JSON 输出到 stderr，便于容器日志收集
- **errors.py** — 统一 `AppError` 基类，注册全局异常处理器，统一错误响应格式 `{code, message, request_id, details}`
- **security.py** — JWT (HS256) + bcrypt 密码哈希 + refresh token 机制
- **auth_deps.py** — FastAPI 依赖注入：`get_current_user`, `require_permission`, `require_permission_any`
- **crypto.py** — NaCl secretbox 对称加密，用于凭证存储
- **audit_hooks.py** — SQLAlchemy event hooks，自动审计 BaseModel 变更
- **telemetry.py** — OpenTelemetry 预留（当前为 stub）

### 模块层 (`app/modules/`)

每个模块遵循统一结构：`router.py` + `schema.py` + `service.py` + `model.py` + `tests/`

共 **20 个功能模块**：
- **health** — 健康检查、版本信息
- **workspace** — 工作空间管理、扫描、拓扑关系
- **auth** — 登录/登出/刷新、RBAC 权限
- **change** — 变更管理（SillySpec 核心流程）
- **task** — 任务管理
- **agent** — AI Agent 调度（Claude Code 适配器）
- **daemon** — 守护进程管理、WebSocket 通信、租约系统
- **worktree** — Git worktree 租约管理
- **git_gateway** — Git 操作网关
- **git_identity** — Git 凭证管理（GitHub provider）
- **tool_gateway** — 工具执行网关 + 策略控制
- **change_writer** — 变更文档生成
- **workflow** — 工作流状态机（FSM）
- **scan_docs** — 扫描文档管理
- **incident** — 事件管理
- **release** — 发布管理
- **runtime** — 运行时进度追踪
- **settings** — 平台设置 + 用户管理
- **knowledge** — 知识库
- **archive** — 变更归档
- **spec_profile/spec_workspace** — Spec 配置管理

### 数据层

- **BaseModel** — 所有 ORM 模型继承自 `app.models.base.BaseModel(SQLModel)`
- 33 张数据库表，通过 Alembic 迁移管理
- 模型分散在各模块 `model.py` 中，共享同一 metadata 对象
- 异步引擎，连接池大小 10 + 溢出 10，30 分钟回收

### 通信协议

- HTTP REST API — 所有前端交互
- WebSocket (`/api/daemon/ws`) — Daemon 双向通信
- Daemon 消息协议：`DaemonMessage` 信封 + 类型化 Payload

## 典型代码模式

### 1. 模块注册模式
每个模块在 `__init__.py` 导出 router，在 `main.py` 中统一注册：
```python
from app.modules.feature.router import router as feature_router
app.include_router(feature_router, prefix="/api")
```

### 2. 依赖注入模式
```python
async def endpoint(
    session: AsyncSession = Depends(get_session),
    user: User = Depends(require_permission(Permission.CHANGE_CREATE)),
    workspace_id: uuid.UUID = Path(...),
):
```

### 3. Service 层模式
构造函数接收 `AsyncSession`，业务逻辑不直接依赖 FastAPI：
```python
class FeatureService:
    def __init__(self, session: AsyncSession): ...
```

### 4. 错误处理模式
```python
class FeatureNotFound(AppError):
    code = "HTTP_404_FEATURE_NOT_FOUND"
    http_status = status.HTTP_404_NOT_FOUND
```

### 5. Schema 分离模式
Pydantic BaseModel 用于 API 请求/响应，SQLModel (table=True) 用于 ORM 模型，两者独立。
