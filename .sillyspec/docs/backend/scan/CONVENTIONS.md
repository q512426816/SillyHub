---
author: qinyi
created_at: 2026-06-10T00:00:00
---

# Backend 代码约定

## 框架隐形规则

### FastAPI 路由注册顺序
- 固定路径的路由必须注册在参数化路由之前（如 `/api/daemon-chat` 必须在 `/api/workspaces/{workspace_id}` 之前）
- Quick Chat 端点通过 `_register_quick_chat()` 内联函数在 `main.py` 中特殊处理

### 认证是 opt-in 的
- 没有全局认证中间件，每个路由通过 `Depends(require_permission(...))` 显式声明所需权限
- `get_current_user` / `get_optional_user` / `require_permission` / `require_permission_any` 四种策略

### SQLAlchemy 异步约束
- 全部使用 `AsyncSession`，禁止同步 session
- 引擎懒初始化，import 时不会打开连接
- `expire_on_commit=False` + `autoflush=False`

### SQLModel BaseModel 继承
- 所有 ORM 模型必须继承 `app.models.base.BaseModel`，不直接继承 `SQLModel`
- 这保证所有表共享同一 metadata 对象（Alembic autogenerate 依赖）

### Settings 单例
- 通过 `@lru_cache` 缓存的 `get_settings()` 获取配置
- 禁止在 feature 代码中直接读 `os.environ`
- CORS origins 接受 JSON 数组或逗号分隔字符串

## 代码风格

### 格式化
- ruff formatter，行宽 100 字符，双引号，目标 Python 3.12
- 配置文件：`pyproject.toml` + `ruff.toml`（后者 extend 前者）

### Lint 规则（ruff）
- 启用规则集：E, F, I, B, UP, N, SIM, RUF, BLE
- 忽略 E501（行长度由 formatter 控制）、N818（异常命名不强制 Error 后缀）、BLE001（async 错误处理中常见裸 Exception）
- 测试文件放宽：N802/N803/N806/E402/B017
- 迁移文件放宽：UP035

### 异步优先
- 所有路由处理函数和 service 方法都是 async
- 同步代码仅限于 CLI 和 migrations

### 日志
- 使用 structlog，禁止 `print()`
- 日志输出 JSON 到 stderr
- `get_logger(__name__)` 获取 logger 实例

### 错误响应
- 统一格式：`{code, message, request_id, details}`
- 业务异常继承 `AppError`，定义 `code`（snake_case）和 `http_status`
- 全局异常处理器自动序列化

### 类型注解
- 所有代码使用 `from __future__ import annotations`
- mypy strict=false，禁用多个错误码（attr-defined, union-attr 等）
- Pydantic 插件启用

### 模块结构约定
```
modules/<feature>/
  __init__.py     — 导出 router 和 model
  router.py       — FastAPI APIRouter，路由定义
  schema.py       — Pydantic 请求/响应模型
  service.py      — 业务逻辑类
  model.py        — SQLModel ORM 模型
  tests/          — pytest 测试
```

### 测试约定
- `pytest.ini_options.asyncio_mode = "auto"` — 异步测试无需额外装饰器
- 测试路径：`tests/`（集成）和 `app/`（模块内单元测试）
- 文件命名：`test_*.py`
- 覆盖率门槛：60%

### 命名约定
- Service 类：`<Feature>Service`
- 错误类：描述事件（如 `WorkspaceNotFound`），不强制 `Error` 后缀
- 路由前缀：`/api/<feature>`
- 表名：蛇形复数（如 `agent_runs`, `workspaces`）
