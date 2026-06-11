# SillyHub 编码规范文档

author: qinyi
created_at: 2026-06-03T12:00:02

## 框架隐形规则

- FastAPI 路由注册统一添加 `/api` 前缀，通过 `app.include_router(router, prefix="/api")`
- SQLModel 模型继承 `BaseModel`，自动包含 `id`、`created_at`、`updated_at` 审计字段
- 认证为 opt-in：路由默认无认证，需显式添加 `Depends(get_current_user)` 依赖
- 前端所有页面均为 `"use client"` 客户端组件，数据获取用 `useEffect` + `useState`
- Docker Compose 编排固定服务名和端口，前端 rewrite 到 `backend:8000`

## 代码风格

- **后端 Python**: Ruff lint+format (line-length=100), mypy type check, 遵循 PEP 8
- **前端 TypeScript**: ESLint (eslint-config-next), Tailwind CSS utility-first
- **命名**: 后端模块 snake_case，前端组件 PascalCase，API 路由 kebab-case
- **异步**: 后端全 async/await (asyncpg, sqlalchemy async)，前端 useEffect 数据获取
- **错误处理**: 后端统一 AppError 异常体系，前端 try/catch + toast 提示

## 1. 后端 Python 规范

### 1.1 项目配置

- **Python 版本**：>= 3.12
- **包管理器**：uv
- **构建系统**：hatchling
- **Lint 工具链**：Ruff（lint + format）+ Mypy（类型检查）
- **Ruff 配置**：line-length=100, target-version=py312
- **Ruff 规则集**：E, F, I, B, UP, N, SIM, RUF, BLE
- **测试框架**：pytest + pytest-asyncio（asyncio_mode=auto）

### 1.2 API 路由规范

每个业务模块包含 `router.py`，注册到 FastAPI 应用时统一添加 `/api` 前缀：

```python
# 注册路由（app/main.py）
app.include_router(workspace_router, prefix="/api")
```

路由使用 FastAPI 依赖注入获取认证信息和数据库会话：

```python
@router.get("/workspaces/{workspace_id}")
async def get_workspace(
    workspace_id: UUID,
    session: Annotated[AsyncSession, Depends(get_session)],
    user: Annotated[User, Depends(get_current_user)],
) -> WorkspaceRead:
    ...
```

权限检查通过 `require_permission()` 依赖实现，每个受保护路由显式声明所需权限。

### 1.3 Pydantic Schema 规范

每个模块的 `schema.py` 定义请求/响应模型，使用 Pydantic v2：

- **请求 schema**：以 `Create` / `Update` 命名
- **响应 schema**：以 `Read` / `ListResponse` 命名
- Schema 继承 SQLModel 模型的字段，可添加计算字段

### 1.4 SQLModel 模型规范

所有持久化模型继承自 `app.models.base.BaseModel`（而非直接继承 SQLModel），确保共享统一的 metadata 对象供 Alembic autogenerate 扫描。

模型命名使用单数形式，字段使用 snake_case：

```python
class Workspace(BaseModel, table=True):
    __tablename__ = "workspaces"
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    name: str = Field(max_length=255)
    slug: str = Field(max_length=255, unique=True)
    ...
```

### 1.5 服务层规范

`service.py` 封装业务逻辑，接收 `AsyncSession` 作为构造参数：

```python
class WorkspaceService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
```

### 1.6 错误处理规范

所有领域错误继承自 `AppError`，包含 `code`（snake_case）和 `http_status`：

```python
class WorkspaceNotFound(AppError):
    code = "HTTP_404_WORKSPACE_NOT_FOUND"
    http_status = status.HTTP_404_NOT_FOUND
```

### 1.7 日志规范

使用 structlog，通过 `get_logger(__name__)` 获取 logger：

```python
from app.core.logging import get_logger
log = get_logger(__name__)
log.info("workspace_created", workspace_id=str(ws.id), name=ws.name)
```

### 1.8 Ruff 忽略规则说明

项目有意选择忽略部分规则：
- `E501`：行长度由 formatter 控制
- `N818`：领域异常以事件命名（如 `WorkspaceNotFound`），非 `Error` 后缀
- `RUF001/002/003`：项目使用中文文本
- `BLE001`：异步错误处理中常用裸 `Exception`
- `B008`：FastAPI `Query()` 在参数默认值中是标准模式
- `SIM105`：显式 try/except 优于 contextlib.suppress（保留 traceback）

### 1.9 文件命名

- 迁移文件：`YYYYMMDDHHMI_descriptive_name.py`
- 测试文件：`test_*.py`（与被测模块同目录的 `tests/` 子目录）
- 模块文件：snake_case

## 2. 前端 TypeScript 规范

### 2.1 项目配置

- **Node 版本**：>= 20.0.0
- **包管理器**：pnpm 9.6.0
- **框架**：Next.js 14.2.5（App Router）
- **语言**：TypeScript 5.5.4（strict 模式未启用）
- **Lint**：ESLint 8 + eslint-config-next
- **测试**：Vitest 2.0 + Testing Library + jsdom
- **CSS**：Tailwind CSS 3.4 + PostCSS + autoprefixer

### 2.2 组件结构规范

- **页面组件**：放置在 `src/app/(dashboard)/` 路由目录中，使用 `"use client"` 声明客户端组件
- **共享组件**：放置在 `src/components/`，基础 UI 组件放在 `src/components/ui/`
- **组件样式**：使用 Tailwind CSS 类名，通过 `clsx` + `tailwind-merge` 合并类名

### 2.3 API 调用规范

所有 API 调用通过 `src/lib/api.ts` 的 `apiFetch()` 函数统一封装：

```typescript
import { apiFetch } from "@/lib/api";

export async function listWorkspaces(params?: {
  page?: number;
  size?: number;
}): Promise<WorkspaceListResponse> {
  return apiFetch<WorkspaceListResponse>("/api/workspaces", { query: params });
}
```

`apiFetch` 自动处理：
- Bearer token 注入（从 Zustand session store 读取）
- `x-request-id` 请求头生成
- 统一错误信封解析为 `ApiError`
- 401 时自动 refresh token + 重试一次
- refresh 失败后清除 session 并跳转登录页

### 2.4 状态管理规范

- **全局 session**：Zustand `useSession` store（localStorage 持久化），存储 user + tokens
- **服务端数据**：React Query（`@tanstack/react-query`）用于缓存和自动刷新
- **URL 路径参数**：Next.js 动态路由 `[id]`, `[cid]`, `[tid]`

### 2.5 类型定义规范

API 客户端文件中定义与后端 schema 对应的 TypeScript 接口：

```typescript
export interface Workspace {
  id: string;
  name: string;
  slug: string;
  root_path: string;
  status: WorkspaceStatus;
  // ...与后端 WorkspaceRead schema 对应
}
```

### 2.6 文件组织规范

- `src/lib/*.ts`：每个后端模块对应一个 API 客户端文件
- `src/lib/__tests__/*.test.ts`：对应 API 客户端的单元测试
- `src/stores/*.ts`：Zustand store
- `src/components/ui/*.tsx`：基础 UI 组件
- `src/app/**/*.tsx`：页面组件

## 3. 通用规范

### 3.1 编码语言

项目使用中英混合：
- 代码注释和日志消息可使用中文
- 变量名、函数名、类型名使用英文 snake_case/camelCase
- 错误消息和用户提示优先使用英文

### 3.2 导入规范

后端使用 `from __future__ import annotations` 启用延迟注解求值（所有 .py 文件）。

### 3.3 环境变量规范

所有运行时配置通过 `app.core.config.Settings` 管理，禁止在业务代码中直接读取 `os.environ`。配置优先级：环境变量 > .env 文件（仅非生产）> 默认值。
