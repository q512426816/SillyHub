---
author: qinyi
created_at: 2026-06-19 12:50:59
source_commit: 0303536
updated_at: 2026-06-19T04:50:59Z
generator: sillyspec-scan
---

# Backend 代码约定（CONVENTIONS）

> 基于 `pyproject.toml`、`ruff.toml`、`app/core/*.py`、各模块 `router/service/model` 的 grep 摘录。

## 框架隐形规则

1. **模块四件套**：每个业务模块目录固定含 `router.py`（`APIRouter(tags=[...])`）+ `service.py`（业务编排）+ `model.py`（`BaseModel(SQLModel, table=True)`）+ `schema.py`（Pydantic DTO）+ `tests/`（模块内单测）；个别模块额外有 `policy.py` / `fsm.py` / `providers/`。
2. **统一前缀挂载**：所有路由在 `app/main.py::create_app` 内以 `app.include_router(<x>_router, prefix="/api")` 挂载；workspace 维度的路由由 router 自带 `prefix="/workspaces/{workspace_id}"`。
3. **配置只走 Settings**：所有运行时配置必须经 `app/core/config.py::get_settings()`（`@lru_cache` 单例），禁止业务代码直接 `os.environ`。`Settings` 支持 `.env`（仅非生产）、环境变量、显式默认值三层覆盖。
4. **鉴权显式声明**：无全局身份中间件；受保护路由必须 `Depends(get_current_user | require_permission(Permission.X) | require_permission_any(...) | require_platform_admin | get_current_principal)`。
5. **错误统一抛 `AppError` 子类**：`app/core/errors.py` 内每个错误类带 `code`（形如 `HTTP_404_WORKSPACE_NOT_FOUND`）+ `http_status` 类属性；由 `register_exception_handlers` 统一翻译为 `{code, message, request_id, details}`。模块内 service 也常自定义 `AppError` 子类（如 `DaemonRpcForbiddenError`、`ArchiveError`、`ChangeWriteError`、`AgentRunError`、`ReleaseError`、`IncidentError`、`OptimisticLockError`）。
6. **审计自动**：所有 `BaseModel(table=True)` 子类的增删改由 `app/core/audit_hooks.py` 捕获并写入 `audit_logs`，无需手工埋点。
7. **请求 ID 透传**：`request_id_middleware` 优先取 `x-request-id` 头，否则生成 UUID，写入 `request.state.request_id` 和响应头；异常 handler 经 `_request_id(request)` 读取。
8. **异步优先**：所有 DB/外部 IO 为 `async def`；`pytest-asyncio` 配 `asyncio_mode = "auto"`，测试协程无需 `@pytest.mark.asyncio`。
9. **lifespan 启动钩子**：RBAC 引导（`bootstrap_admin_and_seed_rbac`）和 stale agent run 清理放在 `lifespan` 内，失败用 `log.exception(...)` 吞掉不阻断启动。
10. **quick-chat 端点是例外**：四个 `/api/daemon-chat*` 路由因挂载顺序约束，直接内联在 `main.py`，未走模块四件套。

## 代码风格

- **类型标注强制**：全量 `from __future__ import annotations`；函数签名用 PEP 604 联合类型（`str | None`）和 `Annotated[T, Depends(...)]` / `Annotated[T, Field(...)]`。
- **行宽 100**（ruff `line-length = 100`），但 `E501` 被忽略——交给 formatter 兜底，`[tool.ruff.format] quote-style = "double"`。
- **ruff select**：`E, F, I, B, UP, N, SIM, RUF, BLE`，但显式忽略一批以匹配项目惯例：
  - `N818`：领域异常按事件命名（`WorkspaceNotFound`）而非 `Error` 后缀（抽象基类 `AppError` 仍带 `Error`）。
  - `RUF001/002/003`：代码含中文标点/字符。
  - `BLE001`：async 错误处理常用 `except Exception`。
  - `SIM105/SIM117`：偏好显式 `try/except`、嵌套 `with` 可读性可接受。
  - `B008`：FastAPI `Query()` 作为参数默认值是标准模式。
  - `RUF012`：Pydantic 模型有意使用可变类属性。
  - `RUF006`：fire-and-forget task 不需要引用。
- **测试放宽命名**：`tests/*` 与 `**/tests/*` 忽略 `N802/N803/N806/E402/B017`；迁移文件忽略 `UP035`（alembic 模板用 `typing.Sequence`）。
- **mypy 非严格**：`strict = false`，且 `disable_error_code` 列表显式关闭 `attr-defined/union-attr/assignment/arg-type/valid-type/operator/call-overload/call-arg/unused-ignore`——实质上类型检查约束很弱（见 CONCERNS）。
- **命名约定**：表名复数蛇形（`agent_runs`、`change_documents`、`tool_operation_logs`）；错误码 `HTTP_<STATUS>_<RESOURCE>_<EVENT>` 蛇形大写。
- **structlog 事件式日志**：`log.info("app.start", version=..., environment=...)`、`log.warning("agent.stale_runs_cleaned_on_startup", count=...)`、`log.exception("unhandled_error", request_id=rid)`——事件名 + kv 上下文，不用 f-string 拼接消息。
- **注释与 docstring 用中文**：业务注释和部分 docstring 用中文（如 `"ql-20260618-009：与 service.py / bootstrap.py / dispatch.py 一致"`），故 ruff 关闭中文相关的 RUF 规则。
