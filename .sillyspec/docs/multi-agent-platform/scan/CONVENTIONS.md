---
author: qinyi
created_at: 2026-06-10T17:00:01
---

# 代码约定 — multi-agent-platform

## 代码风格

### 后端 (Python)

- **格式化工具**: Ruff (line-length=100, quote-style=double)
- **Lint 规则**: E, F, I, B, UP, N, SIM, RUF, BLE
- **类型检查**: mypy (strict=false, ignore_missing_imports=true)
- **Pre-commit hooks**: ruff-format + ruff-check --fix
- **包管理**: uv (pyproject.toml + uv.lock)
- **构建系统**: hatchling

**关键 lint ignore**:
- E501: 行长度由 formatter 管理
- BLE001: 允许 bare Exception (async 错误处理常用)
- B008: FastAPI Query() 参数默认值是标准模式
- RUF012: Pydantic model 可变类属性

### 前端 (TypeScript)

- **包管理**: pnpm (packageManager: pnpm@9.6.0)
- **构建**: Next.js standalone 模式
- **测试**: vitest + @testing-library/react
- **Lint**: eslint-config-next
- **类型**: TypeScript strict (tsconfig.json)
- **CSS**: Tailwind CSS + tailwind-merge + class-variance-authority

### Daemon (Python)

- **CLI 框架**: Click
- **构建**: hatchling
- **测试**: pytest

## 框架隐形规则

### 1. 后端模块注册模式

每个新模块必须在 `app/main.py` 中 import 并注册 router：
```python
from app.modules.xxx.router import router as xxx_router
app.include_router(xxx_router, prefix="/api/xxx", tags=["xxx"])
```

### 2. BaseModel 继承 + 审计钩子

所有数据库模型必须继承 `models.base.BaseModel`（而非直接继承 SQLModel）。BaseModel 配合 `core/audit_hooks.py` 自动捕获所有 `table=True` 的模型变更并写入 AuditLog。

### 3. 配置集中管理

所有运行时配置通过 `core/config.py` 的 `Settings` 类管理，使用 pydantic-settings。禁止在业务代码中直接读取 `os.environ`。配置优先级：环境变量 > `.env` 文件 > 默认值。

### 4. 前端 API 层

每个后端模块对应一个 `lib/*.ts` 文件，导出类型安全的 API 函数。所有请求通过 `lib/api.ts` 的 `apiFetch()` 统一处理，包括认证 token 注入和错误处理。

### 5. Zustand persist

前端 session 状态通过 Zustand persist middleware 持久化到 localStorage，key 为 `multi-agent-platform.session`。使用 `hydrated` 标记避免 hydration 不匹配。

## 典型代码模式

### 模式 1: 后端模块结构 (router -> service -> model)

```python
# router.py
@router.get("/")
async def list_items(user: User = Depends(require_auth)):
    return await service.list_(user.id)

# service.py
class ItemService:
    async def list_(self, user_id: UUID) -> list[Item]:
        async with self._session() as session:
            result = await session.exec(select(Item).where(...))
            return list(result.all())
```

### 模式 2: 错误体系

```python
# core/errors.py
class AppError(Exception):
    status_code: int = 500
    detail: str = "Internal error"

class WorkspaceNotFound(AppError):
    status_code = 404
    detail = "Workspace not found"
```

### 模式 3: 前端 API 函数

```typescript
export async function listWorkspaces() {
  return apiFetch<WorkspaceList>("/api/workspaces");
}
```

### 模式 4: Daemon Backend 注册

```python
# backends/__init__.py — 每个 backend 通过 registry 注册
BACKEND_REGISTRY: dict[str, type[AgentBackend]] = {
    "json_rpc": JsonRpcBackend,
    "jsonl": JsonlBackend,
    ...
}
```

### 模式 5: Docker Compose 多阶段构建

后端 Dockerfile 使用三阶段：node-tools (安装 claude-code/sillyspec) -> builder (uv 安装 Python 依赖) -> runtime (slim 运行时)。前端使用 deps -> builder -> runtime 三阶段构建 standalone Next.js。
