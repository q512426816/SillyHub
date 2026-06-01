---
author: qinyi
created_at: 2026-05-31T23:30:00
---

# SillyHub Backend — 编码规范与约定

## 1. Python 版本与风格

- **Python >= 3.12**：使用 `from __future__ import annotations` 启用延迟注解
- **Ruff** 作为唯一 linter + formatter，替代 flake8 + isort + black
- **行宽**：100 字符（ruff.toml）
- **引号**：双引号
- **目标版本**：py312

### Ruff 规则集

```
select = ["E", "F", "I", "B", "UP", "N", "SIM", "RUF", "BLE"]
ignore = ["E501", "N818"]
```

- E501：行长度由 formatter 控制
- N818：领域异常以事件命名（如 `WorkspaceNotFound`），不强制 `Error` 后缀
- 测试文件放宽：N802/N803/N806（允许 test 函数大写命名）
- 迁移文件放宽：UP035（alembic 使用 `typing.Sequence`）

## 2. 命名约定

### 2.1 文件命名

- **model.py**：SQLModel table 定义
- **schema.py**：Pydantic request/response schema
- **router.py**：FastAPI 路由定义
- **service.py**：业务逻辑服务
- **parser.py**：文件系统解析器
- **test_*.py**：测试文件

### 2.2 类命名

| 模式 | 示例 | 用途 |
|------|------|------|
| PascalCase | `Workspace`, `Change`, `AgentRun` | SQLModel model |
| PascalCase + Action | `WorkspaceService`, `AgentService` | Service 类 |
| PascalCase + Error | `WorkspaceNotFound`, `ChangeNotFound` | AppError 子类 |
| PascalCase + Schema | `WorkspaceCreate`, `AgentRunResponse` | Pydantic schema |
| PascalCase + ABC | `AgentAdapter`, `IdentityProvider` | 抽象基类 |
| PascalCase + Config | `Settings`, `TokenPayload` | 配置/值对象 |

### 2.3 函数/方法命名

- **动词开头**：`get_workspace`, `create_change`, `can_transition`
- **私有方法**：`_build_stream_input`, `_try_inject_audit_context`
- **async**：所有 I/O 操作必须 async，命名无特殊前缀

### 2.4 常量命名

- **UPPER_SNAKE_CASE**：`ALLOWED_OPERATIONS`, `CHANGE_TRANSITIONS`
- **模块级单例**：`ChangeFSM`, `TaskFSM`, `password_hasher`, `ADAPTERS`

### 2.5 数据库命名

- **表名**：复数 snake_case：`workspaces`, `agent_runs`, `change_documents`
- **列名**：snake_case：`created_at`, `workspace_id`, `password_hash`
- **索引前缀**：`ix_`（普通）、`ux_`（唯一）：`ix_workspaces_status`, `ux_users_email_active`

## 3. 错误处理模式

### 3.1 AppError 层级

所有业务错误继承 `AppError(Exception)`，定义两个类属性：

```python
class WorkspaceNotFound(AppError):
    code = "HTTP_404_WORKSPACE_NOT_FOUND"   # 短 snake case 错误码
    http_status = status.HTTP_404_NOT_FOUND  # HTTP 状态码
```

### 3.2 错误响应格式

```json
{
    "code": "HTTP_404_WORKSPACE_NOT_FOUND",
    "message": "Workspace not found.",
    "request_id": "uuid",
    "details": null
}
```

### 3.3 Service 层规则

- **禁止抛出 ValueError**：Service 层只抛 AppError 子类
- **禁止抛出 HTTPException**：只在 router 层或 core/errors.py 处理
- **router 层不捕获**：让异常自然冒泡到全局 handler

### 3.4 异常处理器链

`register_exception_handlers(app)` 注册四层处理器：

1. **AppError** → 业务错误，返回 code + message
2. **HTTPException** → 框架错误，返回 http_{status}
3. **RequestValidationError** → 校验错误，返回 validation_error + details.errors
4. **Exception** → 未预期错误，返回 internal_error（500）

## 4. API 设计规范

### 4.1 URL 结构

```
/api/{resource}                    # 集合
/api/{resource}/{id}               # 单资源
/api/{workspace_id}/{resource}     # workspace 作用域资源
```

所有路由统一前缀 `/api`，在 `main.py` 中注册。

### 4.2 请求/响应模式

- **Create**：POST body → 201 Created
- **Read**：GET → 200 OK
- **Update**：PUT/PATCH body → 200 OK
- **Delete**：DELETE → 200/204
- **List**：GET ?page=&per_page= → 200 OK + 分页元数据

### 4.3 认证模式

- **Bearer Token**：`Authorization: Bearer <access_token>`
- **可选认证**：`Depends(get_optional_user)` 返回 User | None
- **强制认证**：`Depends(get_current_user)` 返回 User 或 401
- **权限检查**：`Depends(require_permission(Permission.X))` 返回 User 或 403

### 4.4 Request-ID

- 入站：读取 `x-request-id` header
- 缺失时：自动生成 UUID v4
- 出站：`x-request-id` header 返回
- 全链路透传到审计日志

## 5. 数据库约定

### 5.1 Model 继承

```python
from app.models.base import BaseModel  # 不是 SQLModel

class Workspace(BaseModel, table=True):
    __tablename__ = "workspaces"
    ...
```

所有 table model 必须继承 `BaseModel`（自定义基类，共享 metadata 给 Alembic）。

### 5.2 主键

```python
id: uuid.UUID = Field(
    default_factory=uuid.uuid4,
    sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
)
```

统一使用 UUID v4 主键。

### 5.3 时间戳

- `created_at`：创建时间，`default_factory=lambda: datetime.now(UTC)`
- `updated_at`：更新时间，`sa_column_kwargs={"onupdate": ...}`
- `deleted_at`：软删除时间，None 表示未删除

### 5.4 Session 使用

```python
async def get_session(request: Request) -> AsyncIterator[AsyncSession]:
    factory = get_session_factory()
    async with factory() as session:
        _try_inject_audit_context(session, request)
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
```

- `expire_on_commit=False`：commit 后对象属性仍可访问
- `autoflush=False`：手动控制 flush 时机
- 异常自动 rollback

## 6. 配置管理

```python
class Settings(BaseSettings):
    database_url: str = Field(...)
    redis_url: str = Field("redis://localhost:6379/0")
    secret_key: str = Field(...)
    ...
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")
```

- 所有运行时配置集中在 `app/core/config.py`
- 优先级：环境变量 > .env 文件 > 默认值
- 通过 `get_settings()` 获取单例（lru_cache）
- **禁止在 feature 代码中直接读 `os.environ`**

## 7. 日志规范

```python
from app.core.logging import get_logger
log = get_logger(__name__)

log.info("agent.run.start", run_id=run_id, workspace_id=workspace_id)
log.warning("app_error", code=exc.code, request_id=rid)
log.error("unhandled_error", request_id=rid, exc_info=True)
```

- JSON 格式输出到 stderr
- 事件名用 dot-notation：`module.action`
- 关键上下文作为 keyword 参数
- 避免 f-string 拼接消息（结构化日志优势）

## 8. 测试约定

- 测试文件：`test_*.py`，放在模块内 `tests/` 或顶层 `tests/`
- Fixtures：通过 `conftest.py` 共享
- 数据库测试：内存 SQLite，不依赖外部 Postgres
- 异步测试：`asyncio_mode = "auto"`
- Settings 缓存：每个测试自动清理 `_reset_settings_cache`
