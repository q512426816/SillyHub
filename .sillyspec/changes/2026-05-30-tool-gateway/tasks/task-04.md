---
id: task-04
title: Policy CRUD schemas + router + 注册
priority: P0
estimated_hours: 3
depends_on: [task-01]
blocks: [task-08]
allowed_paths:
  - backend/app/modules/tool_gateway/policy_schema.py
  - backend/app/modules/tool_gateway/policy_router.py
  - backend/app/main.py
  - backend/app/modules/tool_gateway/tests/test_policy_router.py
---

# task-04: Policy CRUD schemas + router + 注册

## 背景

本任务为 ToolPolicy 提供 CRUD API 层。ToolPolicy 是 tool_gateway 的新增策略模型（由 task-01 创建），存储在 `tool_policies` 表中，通过 `workspace_id` 归属到 workspace。

**关键前置**：task-01 完成后会创建 `backend/app/modules/tool_gateway/tool_policy.py`，其中定义 `ToolPolicy` SQLModel 模型。本任务依赖该模型文件存在。

## ToolPolicy 模型定义（task-01 产出，本任务只读）

task-01 会在 `backend/app/modules/tool_gateway/tool_policy.py` 中创建如下模型：

```python
class ToolPolicy(BaseModel, table=True):
    __tablename__ = "tool_policies"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, sa_column=Column(Uuid(as_uuid=True), primary_key=True))
    workspace_id: uuid.UUID = Field(sa_column=Column(Uuid(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False))
    name: str = Field(max_length=50, sa_column=Column(String(50), nullable=False))
    allowed_tools: list[str] = Field(default=["file_read","file_write","file_list","file_search","shell_exec","run_tests","http_get"], sa_column=Column(JSON, nullable=False))
    blocked_commands: list[str] = Field(default_factory=list, sa_column=Column(JSON, default=list))
    allowed_paths: list[str] = Field(default=["."], sa_column=Column(JSON, default=list))
    allowed_domains: list[str] = Field(default_factory=list, sa_column=Column(JSON, default=list))
    max_timeout: int = Field(default=30, sa_column=Column(Integer, nullable=False, default=30))
    max_output_size: int = Field(default=64000, sa_column=Column(Integer, nullable=False, default=64000))
    created_at: datetime = Field(default_factory=datetime.utcnow, sa_column=Column(DateTime, nullable=False))
    updated_at: datetime = Field(default_factory=datetime.utcnow, sa_column=Column(DateTime, nullable=False))

    __table_args__ = (
        UniqueConstraint("workspace_id", "name", name="uq_tool_policy_workspace_name"),
        Index("ix_tool_policy_workspace", "workspace_id"),
    )
```

## 修改文件（必填）

1. **新建** `backend/app/modules/tool_gateway/policy_schema.py` — Pydantic CRUD schemas（Create / Update / Read）
2. **新建** `backend/app/modules/tool_gateway/policy_router.py` — FastAPI router，5 个 CRUD 端点
3. **修改** `backend/app/main.py` — 导入并注册 policy_router（新增 2 行）
4. **新建** `backend/app/modules/tool_gateway/tests/test_policy_router.py` — CRUD 端点 HTTP 测试

## 实现要求

### 1. policy_schema.py — Pydantic DTOs

定义 3 个 schema 类：

#### ToolPolicyCreate（请求体，用于 POST）
- `name: str` — 必填，1~50 字符
- `allowed_tools: list[str]` — 可选，默认 `["file_read","file_write","file_list","file_search","shell_exec","run_tests","http_get"]`，需要校验每个值都在合法 tool_type 集合中
- `blocked_commands: list[str]` — 可选，默认 `[]`
- `allowed_paths: list[str]` — 可选，默认 `["."]`
- `allowed_domains: list[str]` — 可选，默认 `[]`
- `max_timeout: int` — 可选，默认 30，范围 1~600
- `max_output_size: int` — 可选，默认 64000，范围 1024~1_000_000

使用 Pydantic `@field_validator("allowed_tools")` 校验 allowed_tools 中的每个值属于合法集合：
```python
ALL_TOOL_TYPES = {"file_read", "file_write", "file_list", "file_search", "shell_exec", "run_tests", "http_get"}
```
校验失败抛出 `ValueError(f"Unknown tool type: {item}, allowed: {sorted(ALL_TOOL_TYPES)}")`

#### ToolPolicyUpdate（请求体，用于 PATCH）
- 所有字段均为 `Optional`，默认 `None`
- `name: str | None`
- `allowed_tools: list[str] | None`
- `blocked_commands: list[str] | None`
- `allowed_paths: list[str] | None`
- `allowed_domains: list[str] | None`
- `max_timeout: int | None`（如果提供，范围 1~600）
- `max_output_size: int | None`（如果提供，范围 1024~1_000_000）

同样对 `allowed_tools` 做 validator。**注意**：PATCH 语义 — 只有显式传入的字段才更新，使用 `exclude_unset=True`。

#### ToolPolicyRead（响应体）
- 使用 `model_config = ConfigDict(from_attributes=True)` 以支持 `model_validate(orm_obj)`
- 字段：`id: uuid.UUID`, `workspace_id: uuid.UUID`, `name: str`, `allowed_tools: list[str]`, `blocked_commands: list[str]`, `allowed_paths: list[str]`, `allowed_domains: list[str]`, `max_timeout: int`, `max_output_size: int`, `created_at: datetime`, `updated_at: datetime`

### 2. policy_router.py — 5 个 CRUD 端点

创建独立的 `APIRouter`（与 tool_gateway 主 router 分开），prefix 不含 `/workspaces` 前缀（在 main.py 注册时统一加 prefix）。

```python
router = APIRouter(tags=["tool_policy"])
```

所有端点都需要 `workspace_id: uuid.UUID` 路径参数。

**端点定义**：

#### POST /workspaces/{workspace_id}/tool-policies — 创建 policy
- 权限：`require_permission(Permission.WORKSPACE_ADMIN)`
- 请求体：`ToolPolicyCreate`
- 返回：`ToolPolicyRead`，status_code=201
- 逻辑：
  1. 创建 `ToolPolicy` ORM 对象，设置 `workspace_id` 从路径参数
  2. 将 `ToolPolicyCreate` 的字段赋值到 ORM 对象（使用 `model_dump()`）
  3. 设置 `created_at` 和 `updated_at` 为 `datetime.utcnow()`
  4. `session.add()` + `await session.commit()` + `await session.refresh()`
  5. 返回 `ToolPolicyRead.model_validate(policy)`
- 唯一约束冲突处理：捕获 `IntegrityError`，如果是 `(workspace_id, name)` 冲突，抛出自定义 `ToolPolicyNameDuplicate` 错误（409）

#### GET /workspaces/{workspace_id}/tool-policies — 列出 policies
- 权限：`require_permission(Permission.WORKSPACE_READ)`
- 返回：`list[ToolPolicyRead]`
- 逻辑：
  1. `select(ToolPolicy).where(ToolPolicy.workspace_id == workspace_id).order_by(ToolPolicy.created_at.desc())`
  2. 执行查询，返回列表

#### GET /workspaces/{workspace_id}/tool-policies/{policy_id} — 获取单个 policy
- 权限：`require_permission(Permission.WORKSPACE_READ)`
- 返回：`ToolPolicyRead`
- 逻辑：
  1. `session.get(ToolPolicy, policy_id)`
  2. 如果 None 或 `policy.workspace_id != workspace_id`，抛出 `ToolPolicyNotFound`（404）

#### PATCH /workspaces/{workspace_id}/tool-policies/{policy_id} — 更新 policy
- 权限：`require_permission(Permission.WORKSPACE_ADMIN)`
- 请求体：`ToolPolicyUpdate`
- 返回：`ToolPolicyRead`
- 逻辑：
  1. `session.get(ToolPolicy, policy_id)`，不存在则 404
  2. 校验 `policy.workspace_id == workspace_id`，否则 404
  3. `update_data = payload.model_dump(exclude_unset=True)` — 只取显式传入的字段
  4. 如果 `update_data` 为空 dict，直接返回当前 policy（幂等）
  5. 遍历 `update_data`，`setattr(policy, key, value)`
  6. 设置 `policy.updated_at = datetime.utcnow()`
  7. `await session.commit()` + `await session.refresh()`
  8. 返回 `ToolPolicyRead.model_validate(policy)`
  9. 唯一约束冲突处理同 POST

#### DELETE /workspaces/{workspace_id}/tool-policies/{policy_id} — 删除 policy
- 权限：`require_permission(Permission.WORKSPACE_ADMIN)`
- 返回：204 No Content
- 逻辑：
  1. `session.get(ToolPolicy, policy_id)`，不存在则 404
  2. 校验 `policy.workspace_id == workspace_id`，否则 404
  3. `await session.delete(policy)` + `await session.commit()`
  4. 返回 `Response(status_code=204)`

### 3. main.py — 注册 policy_router

在 `backend/app/main.py` 中：

```python
# 在 import 区域新增（约第 36 行附近，tool_gateway_router 下方）：
from app.modules.tool_gateway.policy_router import router as tool_policy_router

# 在 create_app() 函数的 app.include_router 区域新增（约第 119 行附近，tool_gateway_router 下方）：
app.include_router(tool_policy_router, prefix="/api")
```

注意：policy_router 内部路径使用 `/workspaces/{workspace_id}/tool-policies`，注册时加 `/api` 前缀即可。

### 4. 错误类定义

在 `policy_router.py` 文件顶部定义两个自定义错误（继承 `AppError`）：

```python
from app.core.errors import AppError

class ToolPolicyNotFound(AppError):
    code = "HTTP_404_TOOL_POLICY_NOT_FOUND"
    http_status = 404

class ToolPolicyNameDuplicate(AppError):
    code = "HTTP_409_TOOL_POLICY_NAME_DUPLICATE"
    http_status = 409
```

### 5. 测试文件

在 `backend/app/modules/tool_gateway/tests/test_policy_router.py` 中编写 HTTP 级别测试。

## 接口定义（代码类任务必填）

### policy_schema.py 接口

```python
# 常量
ALL_TOOL_TYPES: frozenset[str] = frozenset({
    "file_read", "file_write", "file_list", "file_search",
    "shell_exec", "run_tests", "http_get",
})

class ToolPolicyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=50)
    allowed_tools: list[str] = Field(default_factory=lambda: list(ALL_TOOL_TYPES))
    blocked_commands: list[str] = Field(default_factory=list)
    allowed_paths: list[str] = Field(default_factory=lambda: ["."])
    allowed_domains: list[str] = Field(default_factory=list)
    max_timeout: int = Field(default=30, ge=1, le=600)
    max_output_size: int = Field(default=64000, ge=1024, le=1_000_000)

    @field_validator("allowed_tools")
    @classmethod
    def _validate_allowed_tools(cls, v: list[str]) -> list[str]:
        unknown = set(v) - ALL_TOOL_TYPES
        if unknown:
            raise ValueError(f"Unknown tool types: {sorted(unknown)}, allowed: {sorted(ALL_TOOL_TYPES)}")
        return v

class ToolPolicyUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=50)
    allowed_tools: list[str] | None = Field(default=None)
    blocked_commands: list[str] | None = Field(default=None)
    allowed_paths: list[str] | None = Field(default=None)
    allowed_domains: list[str] | None = Field(default=None)
    max_timeout: int | None = Field(default=None, ge=1, le=600)
    max_output_size: int | None = Field(default=None, ge=1024, le=1_000_000)

    @field_validator("allowed_tools")
    @classmethod
    def _validate_allowed_tools(cls, v: list[str] | None) -> list[str] | None:
        if v is None:
            return None
        unknown = set(v) - ALL_TOOL_TYPES
        if unknown:
            raise ValueError(f"Unknown tool types: {sorted(unknown)}, allowed: {sorted(ALL_TOOL_TYPES)}")
        return v

class ToolPolicyRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    workspace_id: uuid.UUID
    name: str
    allowed_tools: list[str]
    blocked_commands: list[str]
    allowed_paths: list[str]
    allowed_domains: list[str]
    max_timeout: int
    max_output_size: int
    created_at: datetime
    updated_at: datetime
```

### policy_router.py 端点伪代码

```python
from app.core.auth_deps import require_permission
from app.core.db import get_session
from app.core.errors import AppError
from app.modules.auth.permissions import Permission
from app.modules.tool_gateway.policy_schema import ToolPolicyCreate, ToolPolicyUpdate, ToolPolicyRead
from app.modules.tool_gateway.tool_policy import ToolPolicy  # task-01 产出

router = APIRouter(tags=["tool_policy"])
SessionDep = Annotated[AsyncSession, Depends(get_session)]

class ToolPolicyNotFound(AppError):
    code = "HTTP_404_TOOL_POLICY_NOT_FOUND"
    http_status = 404

class ToolPolicyNameDuplicate(AppError):
    code = "HTTP_409_TOOL_POLICY_NAME_DUPLICATE"
    http_status = 409

@router.post("/workspaces/{workspace_id}/tool-policies", response_model=ToolPolicyRead, status_code=201)
async def create_policy(
    workspace_id: uuid.UUID,
    data: ToolPolicyCreate,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_ADMIN))],
) -> ToolPolicyRead:
    # 1. 构建 ToolPolicy ORM 对象
    policy = ToolPolicy(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
        **data.model_dump(),
    )
    # 2. session.add + commit（捕获 IntegrityError → ToolPolicyNameDuplicate）
    try:
        session.add(policy)
        await session.commit()
        await session.refresh(policy)
    except IntegrityError:
        await session.rollback()
        raise ToolPolicyNameDuplicate(
            f"Policy name '{data.name}' already exists in this workspace.",
            details={"workspace_id": str(workspace_id), "name": data.name},
        ) from None
    return ToolPolicyRead.model_validate(policy)

@router.get("/workspaces/{workspace_id}/tool-policies", response_model=list[ToolPolicyRead])
async def list_policies(
    workspace_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_READ))],
) -> list[ToolPolicyRead]:
    stmt = select(ToolPolicy).where(ToolPolicy.workspace_id == workspace_id).order_by(ToolPolicy.created_at.desc())
    results = (await session.execute(stmt)).scalars().all()
    return [ToolPolicyRead.model_validate(p) for p in results]

@router.get("/workspaces/{workspace_id}/tool-policies/{policy_id}", response_model=ToolPolicyRead)
async def get_policy(
    workspace_id: uuid.UUID,
    policy_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_READ))],
) -> ToolPolicyRead:
    policy = await session.get(ToolPolicy, policy_id)
    if policy is None or policy.workspace_id != workspace_id:
        raise ToolPolicyNotFound(f"ToolPolicy '{policy_id}' not found in workspace '{workspace_id}'.")
    return ToolPolicyRead.model_validate(policy)

@router.patch("/workspaces/{workspace_id}/tool-policies/{policy_id}", response_model=ToolPolicyRead)
async def update_policy(
    workspace_id: uuid.UUID,
    policy_id: uuid.UUID,
    data: ToolPolicyUpdate,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_ADMIN))],
) -> ToolPolicyRead:
    policy = await session.get(ToolPolicy, policy_id)
    if policy is None or policy.workspace_id != workspace_id:
        raise ToolPolicyNotFound(f"ToolPolicy '{policy_id}' not found in workspace '{workspace_id}'.")
    update_data = data.model_dump(exclude_unset=True)
    if not update_data:
        return ToolPolicyRead.model_validate(policy)
    for key, value in update_data.items():
        setattr(policy, key, value)
    policy.updated_at = datetime.utcnow()
    try:
        await session.commit()
        await session.refresh(policy)
    except IntegrityError:
        await session.rollback()
        raise ToolPolicyNameDuplicate(
            f"Policy name already exists in this workspace.",
            details={"workspace_id": str(workspace_id), "name": data.name},
        ) from None
    return ToolPolicyRead.model_validate(policy)

@router.delete("/workspaces/{workspace_id}/tool-policies/{policy_id}", status_code=204)
async def delete_policy(
    workspace_id: uuid.UUID,
    policy_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_ADMIN))],
) -> Response:
    policy = await session.get(ToolPolicy, policy_id)
    if policy is None or policy.workspace_id != workspace_id:
        raise ToolPolicyNotFound(f"ToolPolicy '{policy_id}' not found in workspace '{workspace_id}'.")
    await session.delete(policy)
    await session.commit()
    return Response(status_code=204)
```

### 测试辅助函数

测试复用现有的 `client` 和 `db_session` fixture（来自 `backend/conftest.py`）。需要创建一个 `_setup_workspace_with_admin` 辅助函数：

```python
async def _setup_workspace_with_admin(db_session) -> dict:
    """创建 workspace + admin user + RBAC 权限 + token，返回 refs dict。"""
    # 1. 创建 User（is_platform_admin=True）
    # 2. 创建 Workspace
    # 3. 创建 RBAC role + permission 记录（确保 require_permission 通过）
    #    - 简化：使用 is_platform_admin=True 的 user，require_permission 检查会通过
    # 4. 生成 access token
    # 5. 返回 {"ws_id", "user_id", "token", ...}
```

**重要**：由于测试使用 SQLite in-memory，而 `require_permission` 依赖 RBAC 查询，最简单的做法是创建 `is_platform_admin=True` 的用户。查看 `app/modules/auth/rbac.py` 中的 `has_permission` 实现 — 如果用户是 `is_platform_admin`，直接返回 True。

## 边界处理（必填）

1. **name 唯一约束冲突**：同一 workspace 下 name 重复时，捕获 `IntegrityError`，返回 409 `ToolPolicyNameDuplicate`，不暴露原始数据库错误。注意 SQLite 和 PostgreSQL 的 IntegrityError message 不同，不要匹配 message 文本。

2. **workspace_id 不匹配**：GET/PATCH/DELETE 时，`policy.workspace_id != workspace_id` 视为 404（不是 403，不暴露其他 workspace 的 policy 是否存在）。

3. **PATCH 空请求体**：`ToolPolicyUpdate` 所有字段都是 None（即 `exclude_unset=True` 后 `update_data` 为空 dict），直接返回当前 policy 不触发 DB 写操作，保持幂等。

4. **allowed_tools 校验**：传入不在 `ALL_TOOL_TYPES` 中的 tool type 时，Pydantic validator 拒绝并返回 422 验证错误。空列表 `[]` 是合法的（表示禁止所有工具）。

5. **DELETE 后关联清理**：`tool_policies` 表通过 `ON DELETE SET NULL` 关联到 `agent_runs.tool_policy_id`（task-02 实现），删除 policy 后 AgentRun 的 FK 自动置 NULL。本任务不需处理，但 DELETE 端点要确保 commit 成功。

6. **null/空值 JSONB 字段**：`blocked_commands`、`allowed_domains` 默认为空列表 `[]`（不是 None）。Pydantic schema 使用 `default_factory=list` 保证不传时为空列表。数据库存储为 JSON `[]`。

7. **IntegrityError 回滚**：捕获 `IntegrityError` 后必须先 `session.rollback()` 再抛出 AppError，否则 session 状态不一致会导致后续操作失败。

## 非目标（本任务不做的事）

- **不创建 ToolPolicy 模型**：模型由 task-01 创建，本任务只导入使用
- **不创建数据库迁移**：迁移由 task-01 处理
- **不实现 ToolPolicyService 策略引擎**：由 task-03 处理
- **不修改 tool_gateway/schema.py**：不修改已有的 ToolExecuteRequest/ToolExecuteResponse
- **不修改 tool_gateway/router.py**：policy_router 是独立文件
- **不实现策略校验逻辑**：CRUD 端点只做数据存取，不做策略检查
- **不处理分页**：list 端点返回全量（每个 workspace 下 policy 数量预期很少，< 50）
- **不实现 AgentRun 关联 ToolPolicy 的 API**：由 task-02 和 task-08 处理

## 参考

- **CRUD router 模式**：`backend/app/modules/workspace/router.py` — 参考其 create/list/get/update/delete 端点模式、权限检查方式、`require_permission` 用法
- **Pydantic schema 模式**：`backend/app/modules/workspace/schema.py` — 参考 WorkspaceCreate/Update/Read 的字段校验、`exclude_unset=True` 用法
- **现有 tool_gateway router**：`backend/app/modules/tool_gateway/router.py` — 参考其 SessionDep 定义和 import 结构
- **测试模式**：`backend/app/modules/tool_gateway/tests/test_router.py` — 参考 `_setup_active_lease` 辅助函数、`client` fixture 用法、`_auth()` helper
- **错误定义模式**：`backend/app/core/errors.py` — 参考 AppError 子类命名和 code 命名规范
- **conftest fixture**：`backend/conftest.py` — `db_engine`、`db_session`、`client`、`auth_admin_token` fixture

## TDD 步骤

1. **写测试**：先写 `test_policy_router.py`，覆盖 5 个端点 + 错误场景
2. **确认失败**：运行测试，确认全部失败（ImportError — 模块不存在）
3. **写 policy_schema.py**：实现 3 个 schema 类 + validator
4. **写 policy_router.py**：实现 5 个端点 + 2 个错误类
5. **修改 main.py**：注册 policy_router
6. **确认通过**：运行测试，确认全部通过
7. **回归**：运行 `pytest backend/` 确认无回归

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | `POST /api/workspaces/{ws_id}/tool-policies` 创建 policy（含合法字段） | 返回 201 + ToolPolicyRead，id 非空，workspace_id 匹配路径参数，created_at/updated_at 非空 |
| AC-02 | `POST` 创建同名 policy（同一 workspace） | 返回 409，code=`HTTP_409_TOOL_POLICY_NAME_DUPLICATE` |
| AC-03 | `POST` 创建同名 policy（不同 workspace） | 返回 201，不冲突 |
| AC-04 | `POST` 传入未知 tool_type（如 `"unknown_tool"`） | 返回 422，validation_error |
| AC-05 | `GET /api/workspaces/{ws_id}/tool-policies` | 返回 200 + list[ToolPolicyRead]，包含该 workspace 下所有 policy，按 created_at desc 排序 |
| AC-06 | `GET` 空 workspace（无 policy） | 返回 200 + 空列表 `[]` |
| AC-07 | `GET /api/workspaces/{ws_id}/tool-policies/{policy_id}` 存在的 policy | 返回 200 + ToolPolicyRead |
| AC-08 | `GET` 不存在的 policy_id | 返回 404，code=`HTTP_404_TOOL_POLICY_NOT_FOUND` |
| AC-09 | `GET` 存在但属于其他 workspace 的 policy_id | 返回 404（非 403） |
| AC-10 | `PATCH /api/workspaces/{ws_id}/tool-policies/{policy_id}` 更新 name + max_timeout | 返回 200，name 和 max_timeout 已更新，updated_at > created_at |
| AC-11 | `PATCH` 空请求体 `{}` | 返回 200，policy 内容不变（幂等） |
| AC-12 | `PATCH` 修改 name 为已存在的名称 | 返回 409 |
| AC-13 | `PATCH` 不存在的 policy_id | 返回 404 |
| AC-14 | `DELETE /api/workspaces/{ws_id}/tool-policies/{policy_id}` | 返回 204，无响应体 |
| AC-15 | `DELETE` 后再 `GET` 同一 policy_id | 返回 404 |
| AC-16 | `DELETE` 不存在的 policy_id | 返回 404 |
| AC-17 | 无 auth token 访问任意 CRUD 端点 | 返回 401 |
| AC-18 | `pytest backend/app/modules/tool_gateway/tests/test_policy_router.py` | 全部测试通过 |
| AC-19 | `pytest backend/` 全量回归 | 0 failed，所有已有测试不受影响 |
