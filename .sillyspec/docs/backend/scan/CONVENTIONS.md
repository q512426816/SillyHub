---
source_commit: ba87eec
updated_at: 2026-06-23T16:21:42Z
created_at: 2026-06-24T00:21:42
author: qinyi
generator: sillyspec-scan
---

# Backend 代码约定（CONVENTIONS）

> 基于 `backend/pyproject.toml`（ruff/mypy/pytest 配置）、`app/core/*.py`、`app/models/base.py`、`app/main.py` 及各模块 `router/service/model/schema` 的 rg 摘要。所有规则均可在源码中 grep 验证。

## 框架隐形规则

1. **模块四件套**：每个业务模块目录固定含 `router.py`（`APIRouter(tags=[...])`）+ `service.py`（业务编排）+ `model.py`（`BaseModel(SQLModel, table=True)` 表）+ `schema.py`（Pydantic v2 DTO）+ `tests/`（模块内单测）；个别模块额外有 `policy.py` / `fsm.py` / `providers/` / `dispatch.py` / `tool_policy.py`。PPM 子域在 `app/modules/ppm/<feature>/` 下重复该结构。
2. **统一前缀挂载**：所有路由在 `app/main.py::create_app` 内以 `app.include_router(<x>_router, prefix="/api")` 挂载（共 30+ 个）；PPM 五个 router 统一 `prefix="/api/ppm"`（`ppm_project_router` / `ppm_plan_router` / `ppm_task_router` / `ppm_problem_router` / `ppm_kanban_router`）；workspace 维度路由由 router 自带 `prefix="/workspaces/{workspace_id}"`。
3. **配置只走 Settings**：所有运行时配置必须经 `app/core/config.py::get_settings()`（`@lru_cache(maxsize=1)` 单例），禁止业务代码直接 `os.environ`。`Settings` 支持 `.env` + 环境变量 + 显式默认值三层覆盖。
4. **鉴权显式声明**：无全局身份中间件；受保护路由必须用 `Depends(...)` 显式声明，五类依赖在 `app/core/auth_deps.py`：
   - `get_current_user`（JWT 必需）
   - `get_optional_user`（JWT 可选，失败返回 None）
   - `require_permission(Permission.X)` / `require_permission_any(...)`（RBAC 权限校验）
   - `require_platform_admin`（平台管理员）
   - `get_current_principal`（JWT 或 API Key 双通道）
5. **错误统一抛 `AppError` 子类**：`app/core/errors.py::AppError(Exception)` 是抽象基类，每个错误子类带类属性 `code`（形如 `HTTP_404_WORKSPACE_NOT_FOUND`）+ `http_status`（`status.HTTP_xxx`）；`__init__` 支持实例级覆盖 `code`/`http_status`/`details` 而不污染类属性。由 `register_exception_handlers` 统一翻译为 `{code, message, request_id, details}` 响应。模块内 service 也常自定义 `AppError` 子类（如 `tool_gateway` 的 `ToolOperationForbidden` / `ToolOperationFailed` / `ToolPathForbidden` / `ToolPolicyNotFound`）。
6. **审计自动**：所有 `BaseModel(table=True)` 子类的增删改由 `app/core/audit_hooks.py` 捕获（`_after_insert_hook` / `_after_update_hook` / `_after_delete_hook` + `register_audit_hooks`），自动写入 `audit_logs`，无需手工埋点。
7. **请求 ID 透传**：`request_id_middleware`（`main.py`）优先取 `x-request-id` 头，否则生成 UUID，写入 `request.state.request_id` 和响应头；异常 handler 经同一逻辑读取。
8. **异步优先**：所有 DB/外部 IO 为 `async def`；`pytest-asyncio` 配 `asyncio_mode = "auto"`，测试协程无需 `@pytest.mark.asyncio` 装饰器。
9. **lifespan 启动钩子**：`lifespan(_app)` 内顺序执行 `configure_logging` → `init_telemetry` → RBAC 引导（`bootstrap_admin_and_seed_rbac`）→ stale agent run 清理（`AgentService.cleanup_stale_runs`）。stale 清理失败用 `log.exception("agent.stale_run_cleanup_failed")` 吞掉不阻断启动；`finally` 块负责 `dispose_engine()` + `close_redis()`。
10. **structlog 事件式日志**：全用 `log.info("app.start", version=..., environment=...)` 事件名 + kv 上下文风格，事件名点分蛇形（`app.start`、`app.shutdown`、`agent.stale_runs_cleaned_on_startup`、`runtime.sqlite_read_failed`、`migration.moved_change`），禁止 f-string 拼接消息。异常处理统一 `log.exception("<event>", ...)`。
11. **daemon facade + 子包**：`DaemonService` 是 facade，业务逻辑在 `runtime/lease/run_sync/session/patch` 五子包的 `service.py`；跨子域调用经 `self._facade.<method>` 反向委托；新功能应落到对应子包，不要塞回 facade。

## 代码风格

### 类型与标注

- **类型标注强制**：全量 `from __future__ import annotations`（`rg` 命中 294 个文件）；函数签名用 PEP 604 联合类型（`str | None`）和 `Annotated[T, Depends(...)]` / `Annotated[T, Field(...)]`。
- **依赖注入别名**：模块 router 顶部常定义 `SessionDep = Annotated[AsyncSession, Depends(get_session)]` 和 `CurrentUser = Annotated[User, Depends(get_current_user)]`，handler 参数直接引用；权限依赖直接内联 `Annotated[User, Depends(require_permission(Permission.WORKSPACE_READ))]`。
- **Pydantic v2**：DTO 继承 `pydantic.BaseModel`；字段用 `Field(default_factory=dict)` / `Field(description="...")`；可变默认值必用 `default_factory` 防共享。

### ruff 配置（`pyproject.toml [tool.ruff]`）

- **行宽 100**：`line-length = 100`，`target-version = "py312"`，`extend-exclude = ["docker-entrypoint.sh"]`。
- **select**：`E, F, I, B, UP, N, SIM, RUF, BLE`（pycodestyle errors / pyflakes / isort / bugbear / pyupgrade / pep8-naming / simplify / ruff-specific / blind-except）。
- **ignore（显式匹配项目惯例）**：
  - `E501`：行长交给 formatter 兜底。
  - `N818`：领域异常按事件命名（`WorkspaceNotFound`）而非 `Error` 后缀；抽象基类 `AppError` 仍带 `Error`。
  - `RUF001/002/003`：代码/注释含中文标点与字符。
  - `BLE001`：async 错误处理常用 `except Exception`。
  - `SIM105/SIM117`：偏好显式 `try/except`、嵌套 `with` 可读性可接受。
  - `B008`：FastAPI `Query()` / `Depends()` 作参数默认值是标准模式。
  - `RUF012`：Pydantic/SQLModel 模型有意使用可变类属性。
  - `RUF006`：fire-and-forget task 不需要引用。
  - `RUF005`：list concat 风格偏好。
  - `UP037`：注解中允许引号化的前向引用（配合 `from __future__ import annotations`）。
- **format**：`quote-style = "double"`（见 `[tool.ruff.format]`）。
- **per-file-ignores**：`tests/*` 与 `**/tests/*` 忽略 `N802/N803/N806/E402/B017`（测试函数大写、变量命名、import 顺序、宽泛 except）；`migrations/versions/*` 忽略 `UP035`（alembic 模板用 `typing.Sequence`）。

### mypy 配置（`pyproject.toml [tool.mypy]`）

- `strict = false`，`warn_unused_ignores = true`，`ignore_missing_imports = true`，`plugins = ["pydantic.mypy"]`。
- `disable_error_code` 显式关闭一批：`attr-defined / union-attr / assignment / arg-type / valid-type / operator / call-overload / call-arg / unused-ignore`——实质上类型检查约束较弱（见 CONCERNS）。

### 命名约定

- **表名复数蛇形**：`agent_runs`、`change_documents`、`tool_operation_logs`、`tool_policies`、`incidents`、`postmortems`、`workspaces`、`users`。
- **错误码**：`HTTP_<STATUS>_<RESOURCE>_<EVENT>` 蛇形大写（如 `HTTP_404_WORKSPACE_NOT_FOUND`、`HTTP_409_WORKSPACE_SLUG_DUPLICATE`、`HTTP_403_WORKSPACE_PERMISSION_DENIED`）。
- **structlog 事件名**：点分蛇形（`app.start`、`agent.stale_runs_cleaned_on_startup`、`runtime.sqlite_read_failed`、`migration.moved_change`）。
- **注释与 docstring**：业务注释用中文（如 `"ql-20260618-009：与 service.py / bootstrap.py / dispatch.py 一致"`），故 ruff 关闭中文相关 RUF 规则。

### SQLModel 用法约定

- 所有表继承 `app/models/base.py::BaseModel(SQLModel)`（`table=True`），`__tablename__` 强制复数蛇形。`BaseModel` 仅共享 metadata 对象（Alembic autogenerate 扫描用），无额外字段。
- **UUID 主键**（两种并存写法）：
  - `id: uuid.UUID = Field(default_factory=uuid.uuid4, sa_column=Column(Uuid, primary_key=True))`
  - `id: uuid.UUID = Field(default_factory=uuid.uuid4, sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False))`
- **外键**：`ForeignKey("target.id", ondelete="CASCADE")`，配 `Column(Uuid, ..., nullable=False)`；自引用或可空 FK 用 `nullable=True`（如 incident 的 `owner_id`）。
- **时间戳**：`datetime` + `Column(DateTime(timezone=True))`，值用 `datetime.now(UTC)`。
- 复合索引 `__table_args__ = (Index("ix_<tbl>_<col>", "<col>"),)`。

### 典型代码模式（5 个）

**模式 1：路由 + 依赖注入（tool_gateway/router.py）**
```python
SessionDep = Annotated[AsyncSession, Depends(get_session)]
CurrentUser = Annotated[User, Depends(get_current_user)]

@router.post("/{policy_id}/execute", tags=["tool-gateway"])
async def execute_tool(
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.CHANGE_APPROVE))],
    req: ToolExecuteRequest,
) -> ToolExecuteResponse: ...
```

**模式 2：错误类定义（core/errors.py）**
```python
class WorkspaceNotFound(AppError):
    code = "HTTP_404_WORKSPACE_NOT_FOUND"
    http_status = status.HTTP_404_NOT_FOUND
```

**模式 3：SQLModel 表定义（incident/model.py）**
```python
class Incident(BaseModel, table=True):
    __tablename__ = "incidents"
    id: uuid.UUID = Field(default_factory=uuid.uuid4, sa_column=Column(Uuid, primary_key=True))
    workspace_id: uuid.UUID = Field(
        sa_column=Column(Uuid, ForeignKey("workspaces.id"), nullable=False)
    )
```

**模式 4：structlog 事件日志（main.py lifespan）**
```python
log.info("app.start", version=__version__, environment=settings.environment, commit=settings.resolved_commit_sha)
log.warning("agent.stale_runs_cleaned_on_startup", count=stale_count)
log.exception("agent.stale_run_cleanup_failed")
```

**模式 5：鉴权依赖分支（core/auth_deps.py）**
```python
async def get_current_user(token, session):
    if not token: raise AuthTokenMissing(...)
    try: payload = decode(token)
    except AccessTokenError as exc:
        if exc.code == "expired": raise AuthTokenExpired(exc.message) from exc
        raise AuthTokenInvalid(exc.message, details={"reason": exc.code}) from exc
```

## 相关文件

- 配置：`backend/pyproject.toml`（ruff / mypy / pytest 全部在此）
- 基础设施：`backend/app/main.py`、`backend/app/core/{config,errors,auth_deps,audit_hooks,redis}.py`
- 模型基类：`backend/app/models/base.py`
- 测试夹具：`backend/conftest.py`（pytest-asyncio auto 模式、async engine fixture）
