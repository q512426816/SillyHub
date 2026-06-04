---
author: qinyi
created_at: 2026-06-04T10:30:00+08:00
---

# 代码约定

## 框架隐形规则

### 后端（FastAPI + SQLModel）

- **路由定义**：每个模块创建独立的 `router = APIRouter(prefix="...", tags=["..."])`
- **依赖注入模式**：使用 `Annotated[Type, Depends(dependency)]` 语法注入依赖
  ```python
  SessionDep = Annotated[AsyncSession, Depends(get_session)]
  user: Annotated[User, Depends(require_permission(...))]
  ```
- **Service 层模式**：每个模块包含一个 `XxxService` 类，通过 `__init__(self, session: AsyncSession)` 接收数据库会话
- **Schema 命名**：Pydantic 模型以用途后缀命名，如 `XxxRead`、`XxxCreate`、`XxxUpdate`、`XxxRequest`、`XxxResponse`

### 前端（Next.js 14 + React 18）

- **状态管理**：使用 Zustand 创建全局状态，通过 `useSession.getState()` 访问令牌
- **API 客户端**：所有 API 调用通过 `apiFetch<T>()` 统一处理，自动注入认证头
- **页面组件 Props**：使用 TypeScript 接口定义 Props，格式 `interface Props { params: { id: string } }`
- **UI 样式**：使用 Tailwind CSS 工具类，通过 `className` 属性应用

## 代码风格

### Python

- **异步优先**：所有数据库操作和服务方法均使用 `async def`
- **类型注解**：函数参数和返回值使用类型注解，如 `-> Xxx | None`
- **测试命名**：测试函数使用 `async def test_xxx_yyy_when_zzz()` 格式描述行为
- **行长度**：100 字符行限制（由 Ruff enforce）

### TypeScript

- **导出规范**：工具函数使用 `export async function`，接口使用 `export interface`
- **常量导出**：使用 `export const` 导出命名常量
- **Hook 模式**：自定义 hooks 以 `use` 开头，如 `useSession`

## 典型模式

### 1. FastAPI 路由依赖注入
```python
@router.post("/")
async def create_item(
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(...))],
    input: ItemCreate,
) -> ItemRead:
```

### 2. Service 层构造
```python
class XxxService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get_xxx(self, id: uuid.UUID) -> Xxx | None:
        ...
```

### 3. 前端 API 调用
```typescript
export async function apiFetch<T>(options: ApiRequestOptions): Promise<T> {
  const { accessToken } = useSession.getState();
  // 统一处理认证和错误
}
```

### 4. React 组件 Props 定义
```typescript
interface Props {
  params: { id: string };
}

export default function Page({ params }: Props) {
  ...
}
```

### 5. 测试 Fixture 使用
```python
@pytest.fixture()
async def db_session():
    ...

async def test_xxx(client, db_session) -> None:
    ...
```
