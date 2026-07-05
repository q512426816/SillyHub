---
id: task-05
title: 组织管理后端完整实现（model+service+router+schema+test）
priority: P0
estimated_hours: 4
depends_on: [task-02, task-03]
blocks: [task-06]
allowed_paths:
  - backend/app/modules/admin/model.py
  - backend/app/modules/admin/organizations_service.py
  - backend/app/modules/admin/router.py
  - backend/app/modules/admin/schema.py
  - backend/app/modules/admin/tests/test_organizations_router.py
author: WhaleFall
created_at: 2026-06-16T15:27:48
---

# task-05: 组织管理后端

## 修改文件

| # | 文件 | 操作 | 内容 |
|---|---|---|---|
| 1 | `backend/app/modules/admin/model.py` | 修改 | 在 task-03 占位基础上落地 `Organization` / `UserOrganization` / `UserRole` 三个 SQLModel ORM 类（task-01 已建表，此处仅补 ORM） |
| 2 | `backend/app/modules/admin/organizations_service.py` | 新增 | `OrganizationService` 类，封装 list/get/create/update/disable/enable/delete 七个方法 |
| 3 | `backend/app/modules/admin/router.py` | 修改 | 注册 `/api/admin/organizations` 7 端点（list/get/create/patch/disable/enable/delete） |
| 4 | `backend/app/modules/admin/schema.py` | 修改 | 补充 `OrganizationCreateRequest` / `OrganizationUpdateRequest` / `OrganizationRead` / `OrganizationDetail` 四个 Pydantic schema |
| 5 | `backend/app/modules/admin/tests/test_organizations_router.py` | 新增 | pytest-asyncio 覆盖 CRUD + 树形查询 + code 唯一 + 删除前置（children/member） |

## 实现要求

### 5.1 model.py（参考 `auth/model.py:Role` 写法）

三个 ORM 类全部继承 `BaseModel, table=True`，字段与 task-01 Alembic 迁移一致：

```python
class Organization(BaseModel, table=True):
    __tablename__ = "organizations"
    __table_args__ = (
        Index("ix_organizations_parent_id", "parent_id"),
        Index("ix_organizations_status", "status"),
    )
    id: uuid.UUID          # primary_key, default_factory=uuid.uuid4
    name: str              # String(100), NOT NULL
    code: str              # String(50), UNIQUE, NOT NULL
    description: str | None
    parent_id: uuid.UUID | None  # FK organizations.id ON DELETE RESTRICT
    status: str            # String(16), default="active", CHECK active|disabled
    sort_order: int        # default=0
    created_at: datetime
    updated_at: datetime

class UserOrganization(BaseModel, table=True):
    __tablename__ = "user_organizations"
    __table_args__ = (Index("ix_user_organizations_org", "organization_id"),)
    user_id: uuid.UUID         # FK users.id ON DELETE CASCADE, composite PK
    organization_id: uuid.UUID # FK organizations.id ON DELETE RESTRICT, composite PK
    created_at: datetime

class UserRole(BaseModel, table=True):
    __tablename__ = "user_roles"
    __table_args__ = (Index("ix_user_roles_role", "role_id"),)
    user_id: uuid.UUID  # FK users.id ON DELETE CASCADE, composite PK
    role_id: uuid.UUID  # FK roles.id ON DELETE RESTRICT, composite PK
    created_at: datetime
```

注意：`UserRole` 表名避免与 auth 模块的 `UserWorkspaceRole` 冲突，本期只落 ORM 类，不在本任务写入数据（task-06 才使用）。

### 5.2 organizations_service.py

`OrganizationService` 类，构造与现有 `UserService` 一致（`__init__(self, session: AsyncSession, actor_id: uuid.UUID)`）。方法签名：

```python
async def list_organizations(
    self, parent_id: uuid.UUID | None = None, is_active: bool | None = None,
) -> list[OrganizationRead]:
    """扁平查询：parent_id 传 None 返回全树扁平；传具体 id 返回该组织的直接子组织（不含孙级）。"""

async def get_organization(self, org_id: uuid.UUID) -> OrganizationDetail:
    """详情：含 children 列表（直接子组织） + member_count（直接成员数 user_organizations）。"""

async def create_organization(self, req: OrganizationCreateRequest) -> OrganizationRead:
    """校验 code 全表唯一 + parent_id 存在性 → INSERT。"""

async def update_organization(self, org_id: uuid.UUID, req: OrganizationUpdateRequest) -> OrganizationRead:
    """部分更新；若改 code 走唯一校验；若改 parent_id 走存在性 + 自环检查（防止 parent_id 指向自己或后代）。"""

async def disable_organization(self, org_id: uuid.UUID) -> OrganizationRead:
    """status="disabled"，不级联子组织/用户（子组织/用户保持原状态）。"""

async def enable_organization(self, org_id: uuid.UUID) -> OrganizationRead:
    """status="active"。"""

async def delete_organization(self, org_id: uuid.UUID) -> None:
    """前置检查：children count > 0 → OrganizationHasChildren；member count > 0 → OrganizationInUse。全部为 0 才物理删除。"""
```

### 5.3 router.py（7 端点）

```python
router = APIRouter(prefix="/admin/organizations", tags=["admin-organizations"])

@router.get("", response_model=list[OrganizationRead],
            dependencies=[Depends(require_permission(Permission.ORGANIZATION_READ))])
async def list_organizations(...): parent_id, is_active -> list[OrganizationRead]

@router.get("/{org_id}", response_model=OrganizationDetail,
            dependencies=[Depends(require_permission(Permission.ORGANIZATION_READ))])
async def get_organization(...): org_id -> OrganizationDetail

@router.post("", response_model=OrganizationRead, status_code=201,
             dependencies=[Depends(require_permission(Permission.ORGANIZATION_WRITE))])
async def create_organization(...): body OrganizationCreateRequest -> OrganizationRead

@router.patch("/{org_id}", response_model=OrganizationRead,
              dependencies=[Depends(require_permission(Permission.ORGANIZATION_WRITE))])
async def update_organization(...): org_id, body OrganizationUpdateRequest -> OrganizationRead

@router.post("/{org_id}/disable", response_model=OrganizationRead,
             dependencies=[Depends(require_permission(Permission.ORGANIZATION_WRITE))])
async def disable_organization(...): org_id -> OrganizationRead

@router.post("/{org_id}/enable", response_model=OrganizationRead,
             dependencies=[Depends(require_permission(Permission.ORGANIZATION_WRITE))])
async def enable_organization(...): org_id -> OrganizationRead

@router.delete("/{org_id}", status_code=204,
               dependencies=[Depends(require_permission(Permission.ORGANIZATION_WRITE))])
async def delete_organization(...): org_id -> None
```

所有端点 session 走 `Depends(get_session)`，actor 走 `Depends(get_current_user)` 注入 service。

### 5.4 schema.py

```python
class OrganizationCreateRequest(BaseModel):
    name: str = Field(max_length=100)
    code: str = Field(max_length=50, pattern=r"^[a-z][a-z0-9_]*$")
    description: str | None = None
    parent_id: uuid.UUID | None = None
    sort_order: int = 0

class OrganizationUpdateRequest(BaseModel):
    name: str | None = Field(default=None, max_length=100)
    code: str | None = Field(default=None, max_length=50, pattern=r"^[a-z][a-z0-9_]*$")
    description: str | None = None
    parent_id: uuid.UUID | None = None
    sort_order: int | None = None

class OrganizationRead(BaseModel):
    id: uuid.UUID
    name: str
    code: str
    description: str | None
    parent_id: uuid.UUID | None
    status: Literal["active", "disabled"]
    sort_order: int
    member_count: int
    children_count: int
    created_at: datetime
    updated_at: datetime

class OrganizationDetail(OrganizationRead):
    children: list[OrganizationRead] = []
```

注意 `OrganizationRead` 必须含 `member_count` / `children_count`（service 层 GROUP BY 聚合，避免 N+1）。

### 5.5 测试覆盖矩阵

| # | 用例 | 输入 | 期望 |
|---|---|---|---|
| T01 | list 全树扁平 | 5 节点树，不带 parent_id | 返回 5 条，parent_id 反映层级 |
| T02 | list parent_id 过滤 | parent_id=HQ | 仅返回 HQ 直接子（Engineering/QA），不含孙 |
| T03 | get 详情 | GET /{HQ_id} | OrganizationDetail.children 含 Engineering/QA + member_count=HQ 直接成员 |
| T04 | create 成功 | 合法 body | 201 + OrganizationRead |
| T05 | create code 重复 | code=已存在 | 409 ORGANIZATION_CODE_DUPLICATE |
| T06 | create parent 不存在 | parent_id=不存在的 UUID | 404 ORGANIZATION_PARENT_NOT_FOUND |
| T07 | update 改 name/code | PATCH /{id} | 字段更新，code 走唯一校验 |
| T08 | update parent 自环 | parent_id=自身 | 422 VALIDATION_ERROR（防环） |
| T09 | disable + enable | POST disable / enable | status 切换；不影响子组织/成员 |
| T10 | delete children 占用 | 组织有子组织 | 409 ORGANIZATION_HAS_CHILDREN，detail 含 children_count |
| T11 | delete member 占用 | 组织无子但有 2 成员 | 409 ORGANIZATION_IN_USE，detail 含 member_count |
| T12 | delete 成功 | 无子 + 无成员 | 204，DB 中物理删除 |
| T13 | 权限拒绝 | 普通用户访问 | 403 PERMISSION_DENIED |
| T14 | 未认证 | 不带 token | 401 |

## 接口定义

### OrganizationService 方法签名

见 §5.2。

### 7 端点 method/path/query/body/response

见 §5.3，完整矩阵：

| Method | Path | Query | Body | Response | Status |
|---|---|---|---|---|---|
| GET | /api/admin/organizations | parent_id?, is_active? | — | list[OrganizationRead] | 200 |
| GET | /api/admin/organizations/{org_id} | — | — | OrganizationDetail | 200 |
| POST | /api/admin/organizations | — | OrganizationCreateRequest | OrganizationRead | 201 |
| PATCH | /api/admin/organizations/{org_id} | — | OrganizationUpdateRequest | OrganizationRead | 200 |
| POST | /api/admin/organizations/{org_id}/disable | — | — | OrganizationRead | 200 |
| POST | /api/admin/organizations/{org_id}/enable | — | — | OrganizationRead | 200 |
| DELETE | /api/admin/organizations/{org_id} | — | — | — | 204 |

### 权限矩阵

| 端点 | 权限要求 |
|---|---|
| GET list / GET detail | `Permission.ORGANIZATION_READ` |
| POST create / PATCH update / POST disable / POST enable / DELETE | `Permission.ORGANIZATION_WRITE` |
| 全部端点 | 平台超管（`is_platform_admin=true`）短路 |
| 全部端点 | 未认证 → 401 |

## 边界处理

1. **parent_id 指向不存在** → service 抛 `OrganizationParentNotFound`（AppError, http_status=404, code=`ORGANIZATION_PARENT_NOT_FOUND`）。
2. **code 全表唯一** → service 在 INSERT 前 `select(Organization).where(code==req.code)` 命中即抛 `OrganizationCodeDuplicate`（409, `ORGANIZATION_CODE_DUPLICATE`）。
3. **删除前置 - children** → service `select(func.count()).where(parent_id==org_id)` > 0 → 抛 `OrganizationHasChildren`（409, `ORGANIZATION_HAS_CHILDREN`, detail=`{children_count: N}`）。
4. **删除前置 - member** → service 查 `user_organizations` 中该 org 的成员 > 0 → 抛 `OrganizationInUse`（409, `ORGANIZATION_IN_USE`, detail=`{member_count: N}`）。
5. **disable 不级联** → 仅置当前组织 `status="disabled"`，子组织与已绑定用户的 status 不变。
6. **树形查询支持 parent_id 过滤 + 全树扁平** → parent_id=None 时返回所有节点（扁平，前端自行按 parent_id 构树）；parent_id=具体值时只返回直接子（不含孙）。
7. **update 时 parent_id 自环 / 形成环** → 校验 `parent_id != org_id` 且 `parent_id` 不在自身后代集合中，否则抛 422 `VALIDATION_ERROR`。
8. **get/update/disable/enable/delete 目标不存在** → 404 `ORGANIZATION_NOT_FOUND`。
9. **code pattern** → schema 层 `^[a-z][a-z0-9_]*$`，非法格式 422。
10. **member_count / children_count 聚合** → service 用 GROUP BY 或 LEFT JOIN + COUNT 单次查询，禁止 N+1。

## 非目标

- **不实现角色管理**（task-04 范围）：本任务的 `UserRole` ORM 类只是落表对应实体，不在本任务写入或查询 user_roles。
- **不实现用户管理**（task-06 范围）：本任务不实现 `/api/admin/users`，也不在 `OrganizationRead` 内嵌用户列表（仅返回 `member_count` 聚合数字）。
- **不实现前端组织树组件**（task-10 范围）。
- **不实现工作区级角色**（与 `UserWorkspaceRole` 完全独立）。
- **不实现组织级角色 / 数据权限 / 邀请流程**（design.md §3 非目标）。

## 参考

- `design.md` §7.2（组织管理接口）+ §8.1（organizations 表 DDL）+ §8.3（ER 关系）
- `requirements.md` FR-07（树形结构）/ FR-08（创建与更新）/ FR-09（删除前置）
- `plan.md` task-05 行
- 现有 `backend/app/modules/auth/model.py:Role` SQLModel 写法（继承 `BaseModel, table=True`，`sa_column=Column(...)` 显式定义）
- 现有 `backend/app/models/base.py:BaseModel`（仅是 `SQLModel` 别名）
- task-04 角色管理实现作为 service + router + schema + test 的模式参考（结构对称）

## TDD 步骤

1. **写测试**：在 `test_organizations_router.py` 落 §5.5 的 T01-T14 用例，使用现有 `conftest.py` 的 async session fixture + 测试用 platform_admin token。
2. **跑失败**：`cd backend && pytest app/modules/admin/tests/test_organizations_router.py -v` 全部 RED（OrganizationService 尚不存在）。
3. **实现 ORM**：写 `model.py` 三个类，确保 import 后 SQLModel.metadata 注册新表（与 task-01 迁移表名严格一致）。
4. **实现 schema**：补 `OrganizationCreateRequest/UpdateRequest/Read/Detail`。
5. **实现 service**：按 §5.2 方法签名逐个实现，边界检查与 §边界处理 对齐。
6. **实现 router**：按 §5.3 注册 7 端点 + 权限依赖。
7. **跑通**：再跑一次测试，全部 GREEN。
8. **回归**：`pytest app/modules/admin/ app/modules/auth/ app/modules/settings/ -v` 确认未破坏现有用例（特别是 task-04 的 test_roles_router.py）。
9. **lint/type**：`ruff check . && mypy app` 0 错误。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | POST /api/admin/organizations 合法 body（含 parent_id 指向现有根组织） | 201 + OrganizationRead，code/name/description/parent_id/status="active"/sort_order/member_count=0/children_count=0 字段齐备 |
| AC-02 | GET /api/admin/organizations 不带 parent_id，DB 内 5 节点树 | 200 + list 长度 5，每个 OrganizationRead.parent_id 正确反映层级 |
| AC-03 | GET /api/admin/organizations?parent_id={HQ_id} | 200 + 仅返回 HQ 直接子（Engineering/QA），不含孙级 |
| AC-04 | GET /api/admin/organizations/{HQ_id} | 200 + OrganizationDetail.children 含直接子 + member_count=HQ 直接成员数 |
| AC-05 | POST 创建时 code 与已有冲突 | 409 + `{code: "ORGANIZATION_CODE_DUPLICATE"}` |
| AC-06 | POST 创建时 parent_id 指向不存在 UUID | 404 + `{code: "ORGANIZATION_PARENT_NOT_FOUND"}` |
| AC-07 | PATCH /{id} 改 name + sort_order | 200 + OrganizationRead 字段已更新，updated_at 推进 |
| AC-08 | PATCH /{id} body parent_id=自身 id | 422 + `{code: "VALIDATION_ERROR"}`，DB 状态未变 |
| AC-09 | POST /{id}/disable 后 GET /{id} | status="disabled"，原成员 user_organizations 关系不变 |
| AC-10 | POST /{id}/enable 后 GET /{id} | status="active" |
| AC-11 | DELETE 有子组织的组织 | 409 + `{code: "ORGANIZATION_HAS_CHILDREN", details: {children_count: N}}` |
| AC-12 | DELETE 无子但有 2 成员的组织 | 409 + `{code: "ORGANIZATION_IN_USE", details: {member_count: 2}}` |
| AC-13 | DELETE 无子无成员的组织 | 204，DB 中 organizations 行物理移除 |
| AC-14 | 普通用户（无 ORGANIZATION_READ）调用 GET list | 403 + `{code: "PERMISSION_DENIED"}` |
| AC-15 | 未认证调用任意端点 | 401 |
| AC-16 | 平台超管（is_platform_admin=true）调用任意端点 | 短路通过，与持权限用户行为一致 |
| AC-17 | `pytest app/modules/admin/tests/test_organizations_router.py -v` | T01-T14 全部 GREEN |
| AC-18 | `pytest app/modules/admin/ app/modules/auth/ app/modules/settings/ -v` | 全部回归 GREEN（不破坏 task-04 与现有用例） |
| AC-19 | `ruff check app/modules/admin/ && mypy app/modules/admin/` | 0 错误 |
| AC-20 | 任意写操作完成后查 `audit_logs` 表 | 自动捕获创建/更新/状态切换/删除事件，actor_id/action/entity_type=organization/entity_id/payload diff 齐备 |
