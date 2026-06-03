---
author: qinyi
created_at: 2026-06-03T10:00:00
---

# CONVENTIONS — backend

## 命名规范

- **文件命名**: `snake_case.py`（如 `spec_workspace.py`, `change_writer.py`）
- **目录命名**: `snake_case/`（如 `tool_gateway/`, `git_identity/`）
- **类命名**: `PascalCase`（如 `AgentRun`, `WorkspacePathNotFound`）
- **模块级常量**: `UPPER_SNAKE_CASE`（如 `SessionDep`）
- **测试文件**: `test_<module>.py`

## 框架隐形规则

### FastAPI 依赖注入
所有路由通过 `Annotated` + `Depends()` 注入依赖：
```python
SessionDep = Annotated[AsyncSession, Depends(get_session)]
user: Annotated[User, Depends(require_permission(Permission.TASK_RUN_AGENT))]
```

### 权限控制
使用 `require_permission()` 依赖，基于 RBAC 模型：
- 每个 API 端点声明所需权限（如 `Permission.TASK_RUN_AGENT`）
- 权限定义集中在 auth 模块

### SQLModel 双模式
同一个类同时用于 ORM 和 API Schema：
```python
class AgentRun(BaseModel, table=True):  # ORM + Pydantic
```
API 请求/响应使用不带 `table=True` 的模型或嵌套模型。

## 实体继承规范

### 基类
- `AppError(Exception)` — 所有业务异常的基类
- `BaseModel` (SQLModel) — 所有数据模型的基类，配合 `table=True` 映射数据库表

### 审计钩子
`audit_hooks.py` 自动捕获所有 `BaseModel(table=True)` 的变更并写入 `AuditLog`。

### 错误类层次
业务异常按领域命名（有意忽略 N818 规则，不以 "Error" 结尾）：
```python
class WorkspaceNotFound(AppError)
class WorkspacePathNotDir(AppError)
class SpecWorkspaceNotFound(AppError)
class RelationSelfLoop(AppError)
```

## 代码风格

### ruff 配置
- 行宽: 100 字符
- 目标: Python 3.12
- 规则集: E, F, I, B, UP, N, SIM, RUF, BLE
- 忽略: E501(行宽), N818(异常命名), RUF001-003(中文), BLE001(裸异常)

### 格式化
- 引号风格: 双引号 (`quote-style = "double"`)

### mypy 配置
- 宽松模式（`strict = false`）
- 启用 pydantic 插件

## API 设计规范

### 路由结构
```python
router = APIRouter(prefix="/workspaces/{workspace_id}", tags=["change"])
```
- 路径参数用于资源嵌套
- `tags` 用于 OpenAPI 分组

### 模块标准结构
```
module/
├── router.py      # API 端点定义
├── service.py     # 业务逻辑
├── model.py       # 数据模型
└── tests/         # 模块测试
    └── test_*.py
```

## 错误处理规范

- 业务异常继承 `AppError`，由全局异常处理器统一捕获
- 错误响应格式统一（由 FastAPI exception handler 处理）
