---
author: qinyi
created_at: 2026-06-03T20:35:00+08:00
---

# Backend -- 编码规范和约定

## 命名规范

| 类别 | 规则 | 示例 |
|------|------|------|
| 文件命名 | `snake_case.py` | `spec_workspace.py`, `change_writer.py` |
| 目录命名 | `snake_case/` | `tool_gateway/`, `git_identity/` |
| 类命名 | `PascalCase` | `AgentRun`, `WorkspacePathNotFound` |
| 函数/方法 | `snake_case` | `get_workspace()`, `build_spec_bundle()` |
| 常量 | `UPPER_SNAKE_CASE` | `ACCESS_TOKEN_TYPE`, `BOARD_STATUSES` |
| 私有方法 | `_leading_underscore` | `_translate_integrity_error()`, `_consume_refresh_token()` |
| FastAPI 依赖别名 | `PascalCase + Dep` | `SessionDep = Annotated[AsyncSession, Depends(get_session)]` |
| 测试文件 | `test_<module>.py` | `test_coordinator.py`, `test_router.py` |
| 测试函数 | `test_<scenario>` | `test_health_all_ok`, `test_cors_origins_accepts_csv` |
| Fixture | `_leading_underscore` | `_stub_all_ok`, `_stub_db_down` |

## 框架隐形规则

### FastAPI 依赖注入

所有路由通过 `Annotated` + `Depends()` 注入依赖：

```python
SessionDep = Annotated[AsyncSession, Depends(get_session)]
user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_WRITE))]
```

认证不是全局中间件，而是每个路由显式声明所需权限（opt-in 模式）。

### 权限控制

- 权限枚举集中在 `auth/permissions.py` 的 `Permission(StrEnum)`
- 七大权限域：platform / workspace / change / task / code / deploy / tool
- 路由使用 `require_permission(Permission.X)` 或 `require_permission_any(Permission.X)`
- `platform_admin` 角色绕过所有权限检查（V1 简化）

### SQLModel 双模式

- `model.py` 中的类带 `table=True`，同时作为 ORM 模型和 Pydantic 验证模型
- `schema.py` 中的类不带 `table=True`，专用于 API 请求/响应 DTO
- API 响应通过 `model_validate()` 从 ORM 对象转换

```python
# model.py
class Workspace(BaseModel, table=True):
    ...

# schema.py
class WorkspaceRead(BaseModel):  # 不带 table=True
    ...

# router.py
return WorkspaceRead.model_validate(workspace)
```

## 实体继承规范

### 异常类层次

所有业务异常继承 `AppError(Exception)`，按领域命名（有意忽略 N818 规则，不以 "Error" 结尾）：

```python
class AppError(Exception)
├── WorkspaceNotFound(AppError)
├── WorkspacePathNotDir(AppError)
├── WorkspacePathDuplicate(AppError)
├── ChangeNotFound(AppError)
├── TaskNotFound(AppError)
├── AgentRunNotFound(AppError)
├── AuthTokenMissing(AppError)
├── AuthTokenInvalid(AppError)
├── PermissionDenied(AppError)
├── InvalidTransition(AppError)
└── ... (30+ 子类)
```

每个异常类声明 `code`（snake_case 错误码）和 `http_status`，由全局异常处理器统一序列化为标准 JSON 响应。

### 模型基类

所有 ORM 模型继承 `app.models.base.BaseModel(SQLModel)`。

## 错误处理规范

### 统一错误响应格式

所有 API 错误统一序列化为：

```json
{
    "code": "<short.snake.code>",
    "message": "<human readable>",
    "request_id": "<uuid|null>",
    "details": { ... } | null
}
```

### 全局异常处理器

`register_exception_handlers(app)` 注册 4 个处理器：

1. `AppError` -- 业务异常，映射到 `exc.http_status`
2. `HTTPException` -- FastAPI 原生异常
3. `RequestValidationError` -- Pydantic 校验失败，清理 `ctx` 中的不可序列化对象
4. `Exception` -- 兜底处理，500 + `internal_error`

### Service 层错误处理

Service 方法抛出领域异常（如 `WorkspaceNotFound`），由 router 层自然传播到全局处理器。不在 service 中捕获业务异常。

## Service 层约定

### 构造函数

```python
class SomeService:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session
```

### 查询方法命名

- `list_(...)` -- 返回 `(items, total)` 元组
- `get(id)` -- 返回单个实体，不存在则抛异常
- `get_by_key(key)` -- 按业务键查找

### M:N 工作区关联

Cross-workspace 实体使用 M:N 关联表 + `enrich_with_workspace_ids()` 方法：

```python
async def enrich_with_workspace_ids(self, change: Change) -> ChangeRead:
    stmt = select(ChangeWorkspace.workspace_id).where(...)
    ...
    data.workspace_ids = [change.workspace_id] + secondary
    return data
```

### Reparse 模式

`workspace`、`change`、`task`、`scan_docs` 模块都有 reparse 模式：从文件系统重新解析并 UPSERT 数据库记录。

## 日志规范

使用 structlog 结构化日志：

```python
log = get_logger(__name__)
log.info("workspace.created", workspace_id=str(ws.id), slug=ws.slug)
log.warning("workspace.rescan.projects_import_failed", error=str(exc))
log.exception("unhandled_error", request_id=rid)
```

关键事件必须包含领域标识符（如 `workspace_id`, `change_id`, `run_id`）。

## Ruff 配置

- 行宽：100 字符（不强制，忽略 E501）
- 目标：Python 3.12
- 规则集：E, F, I, B, UP, N, SIM, RUF, BLE
- 忽略项：
  - E501（行宽由 formatter 处理）
  - N818（异常不以 "Error" 结尾，有意设计）
  - RUF001/002/003（项目包含中文文本）
  - BLE001（async 错误处理常见裸 except）
  - B008（FastAPI Query() 参数默认值）
  - RUF012（Pydantic 可变类属性）
  - UP037（ruff vs mypy forward-ref 冲突）
- 测试文件额外忽略：N802/N803/N806（测试函数命名自由度）、E402、B017
- 格式化：双引号 (`quote-style = "double"`)

## Mypy 配置

- 宽松模式（`strict = false`）
- 启用 `pydantic.mypy` 插件
- 忽略缺少的 import stubs
- 禁用了一批高噪音错误码（attr-defined, union-attr, assignment 等）

## 测试规范

- 异步模式：`asyncio_mode = "auto"`
- 测试发现路径：`tests/` + `app/`（`python_files = ["test_*.py"]`）
- Fixture 使用 `monkeypatch` 替换外部依赖
- 测试数据库使用 aiosqlite（SQLite 内存），不依赖真实 PostgreSQL
