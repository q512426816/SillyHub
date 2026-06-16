---
id: task-04
title: 角色管理后端完整实现（service+router+schema+test）
priority: P0
estimated_hours: 4
depends_on: [task-02, task-03]
blocks: [task-06]
allowed_paths:
  - backend/app/modules/admin/roles_service.py
  - backend/app/modules/admin/router.py
  - backend/app/modules/admin/schema.py
  - backend/app/modules/admin/tests/__init__.py
  - backend/app/modules/admin/tests/test_roles_router.py
author: WhaleFall
created_at: 2026-06-16T15:27:48
---

# task-04: 角色管理后端

## 修改文件

| # | 路径 | 操作 | 说明 |
|---|---|---|---|
| 1 | `backend/app/modules/admin/roles_service.py` | 新增 | `RoleService` 类：list/get/create/update/disable/enable/delete，封装权限替换/系统保护/占用检查 |
| 2 | `backend/app/modules/admin/router.py` | 新增（task-03 骨架在本任务填充实业务） | 注册 7 个端点 `/admin/roles`（list/get/create/patch/disable/enable/delete），权限分别 `ROLE_READ` / `ROLE_WRITE` |
| 3 | `backend/app/modules/admin/schema.py` | 新增 | `RoleCreateRequest` / `RoleUpdateRequest` / `RoleRead` / `RoleListResponse` |
| 4 | `backend/app/modules/admin/tests/__init__.py` | 新增 | 测试包标记 |
| 5 | `backend/app/modules/admin/tests/test_roles_router.py` | 新增 | 覆盖 7 个场景：CRUD + is_system 保护 + 占用拒绝 + 非法 permission_keys + key 重复 + 无权限 403 |

## 实现要求

### roles_service.py — `RoleService`

- 类签名：`class RoleService: def __init__(self, session: AsyncSession, actor_id: uuid.UUID)`
- 复用现有 `auth/model.py` 的 `Role` + `RolePermission`（不加新表），以及 task-02 扩展后的 `Role.is_active` / `Role.updated_at` 字段
- 复用现有 `auth/model.py` 的 `UserWorkspaceRole` 与 task-02 新增的 `UserRole`（平台级）合并统计 `user_count`
- 所有写操作依赖 SQLAlchemy `audit_hooks.py` 自动捕获审计（不在业务代码显式写 audit_logs）

### router.py — 7 个端点（注册到 `admin_router`，prefix 在 `main.py` 由 `/api` 给定，本路由内部用 `/admin/roles`）

- 所有写操作 `Depends(require_permission_any(Permission.ROLE_WRITE))`
- 所有读操作 `Depends(require_permission_any(Permission.ROLE_READ))`
- 注意 `require_permission_any` 不带 workspace_id 路径参数（参考 `core/auth_deps.py:118`），与 workspace 模块的 `require_permission` 区分

### schema.py — Pydantic v2 DTO

- `permission_keys: list[Permission]` 用 `Permission` StrEnum 校验，FastAPI 自动 422 非法值
- `RoleRead.permissions` 是 `list[str]`（Permission 的 value 字符串），与 design §7.1 一致
- `RoleRead.user_count` 必须 `>= 0`，前端用于禁用「删除」按钮

### test — `test_roles_router.py`

- 使用项目现有 `conftest.py` 的 fixture（参考 workspace 模块测试模式）
- 测试 actor 需要持 `ROLE_READ` / `ROLE_WRITE` 权限（通过绑定 role + `user_roles` 或直接 `is_platform_admin=true`）
- 系统角色 fixture：直接 insert `Role(key="platform_admin", is_system=True)`

## 接口定义

### RoleService 方法签名

```python
class RoleService:
    def __init__(self, session: AsyncSession, actor_id: uuid.UUID) -> None: ...

    async def list(
        self, *, search: str = "", is_active: bool | None = None,
        page: int = 1, size: int = 20,
    ) -> RoleListResponse: ...

    async def get(self, role_id: uuid.UUID) -> RoleRead: ...

    async def create(self, payload: RoleCreateRequest) -> RoleRead: ...
        # 抛 RoleKeyDuplicate（409）当 key 冲突

    async def update(self, role_id: uuid.UUID, payload: RoleUpdateRequest) -> RoleRead: ...
        # 抛 RoleSystemProtected（403）当 is_system=true
        # 抛 RoleNotFound（404）当 id 不存在

    async def disable(self, role_id: uuid.UUID) -> RoleRead: ...
        # 抛 RoleSystemProtected（403）当 is_system=true

    async def enable(self, role_id: uuid.UUID) -> RoleRead: ...

    async def delete(self, role_id: uuid.UUID) -> None: ...
        # 抛 RoleSystemProtected（403）当 is_system=true
        # 抛 RoleInUse（409）当 user_count > 0，detail 含 user_count
```

### 7 个端点的 method / path / body / response

| # | Method | Path | Body | Response | 权限 |
|---|---|---|---|---|---|
| 1 | GET | `/admin/roles` | query: search, is_active, page=1, size=20 | 200 `RoleListResponse` | ROLE_READ |
| 2 | GET | `/admin/roles/{role_id}` | — | 200 `RoleRead` / 404 RoleNotFound | ROLE_READ |
| 3 | POST | `/admin/roles` | `RoleCreateRequest` | 201 `RoleRead` / 409 ROLE_KEY_DUPLICATE / 422 VALIDATION_ERROR | ROLE_WRITE |
| 4 | PATCH | `/admin/roles/{role_id}` | `RoleUpdateRequest` | 200 `RoleRead` / 403 ROLE_SYSTEM_PROTECTED | ROLE_WRITE |
| 5 | POST | `/admin/roles/{role_id}/disable` | — | 200 `RoleRead` / 403 ROLE_SYSTEM_PROTECTED | ROLE_WRITE |
| 6 | POST | `/admin/roles/{role_id}/enable` | — | 200 `RoleRead` | ROLE_WRITE |
| 7 | DELETE | `/admin/roles/{role_id}` | — | 204 / 403 ROLE_SYSTEM_PROTECTED / 409 ROLE_IN_USE | ROLE_WRITE |

### RoleRead schema

```python
class RoleRead(BaseModel):
    id: uuid.UUID
    key: str
    name: str
    description: str | None
    is_system: bool
    is_active: bool
    permissions: list[str]      # Permission.value 字符串
    user_count: int             # 平台 user_roles + 工作区 user_workspace_roles 合并去重计数
    created_at: datetime
    updated_at: datetime
```

### 权限矩阵

| 操作 | 权限 | 错误码（失败时） |
|---|---|---|
| list / get | `ROLE_READ` | 403 PERMISSION_DENIED（无权限） |
| create | `ROLE_WRITE` | 409 ROLE_KEY_DUPLICATE / 422 VALIDATION_ERROR |
| update | `ROLE_WRITE` | 403 ROLE_SYSTEM_PROTECTED / 404 ROLE_NOT_FOUND |
| disable | `ROLE_WRITE` | 403 ROLE_SYSTEM_PROTECTED |
| enable | `ROLE_WRITE` | — |
| delete | `ROLE_WRITE` | 403 ROLE_SYSTEM_PROTECTED / 409 ROLE_IN_USE |

## 边界处理（共 8 条）

1. **is_system=true 角色禁修改**：`update()` 入口立即检查，抛 `RoleSystemProtected`（403, code=`ROLE_SYSTEM_PROTECTED`），即便 body 仅传 `description` 也拒绝（保守策略，避免误改权限）
2. **is_system=true 角色禁删除/禁用**：`delete()` / `disable()` 同上抛 `RoleSystemProtected`
3. **permission_keys 含非法字符串**：Pydantic 校验 `list[Permission]` 自动 422（code=`VALIDATION_ERROR`），不进 service 层
4. **key 重复**：`create()` 先 `select(Role).where(Role.key == payload.key)`，存在则抛 `RoleKeyDuplicate`（409, code=`ROLE_KEY_DUPLICATE`）
5. **删除前置 user_count > 0**：`delete()` 先查 `user_roles` + `user_workspace_roles` 聚合 count，> 0 抛 `RoleInUse`（409, code=`ROLE_IN_USE`, detail=`{"user_count": N}`）
6. **事务原子（permission 替换）**：`update()` 用 delete-then-insert 模式，`BEGIN` → `DELETE FROM role_permissions WHERE role_id=...` → `INSERT` 新集合 → `COMMIT`，失败回滚不留中间态
7. **user_count 不重复计数**：同一用户既绑平台 role 又绑工作区 role 时，按 `user_id` 去重，避免前端误报占用
8. **audit 自动覆盖**：service 层不显式写 `audit_logs`，依赖 `audit_hooks.py` SQLAlchemy 事件钩子捕获所有 Role / RolePermission 写入

## 非目标

- 不实现组织管理（task-05）
- 不实现用户管理（task-06）
- 不做前端
- 不实现工作区级角色管理 UI（design §3 明确排除）
- 不引入新的审计表 / 不修改 `role_permissions` 表结构
- 不实现 `Role.is_system` 字段的逆向切换（系统角色始终受保护，无 escape hatch）

## 参考

- `design.md` §7.1 角色管理接口（GET/POST/PATCH/disable/enable/DELETE 共 7 个）
- `design.md` §11.1 自审需求覆盖（系统角色不能删除 / 有用户的角色不能删除 → 在本任务实现）
- `design.md` §10 风险登记 R-05（系统角色 is_active 不可改 false → P0 应对）
- `requirements.md` FR-03 / FR-04 / FR-05 / FR-06（角色管理完整 CRUD + 边界）
- `backend/app/modules/auth/model.py:106-143` Role + RolePermission 真实定义
- `backend/app/core/auth_deps.py:118` `require_permission_any` 用法（平台级路由用此）
- `backend/app/modules/workspace/router.py` service+router 分层模式参考（line 46 router 注册 + line 61-287 端点形态）
- task-02 产出：`Permission.ROLE_READ` / `ROLE_WRITE` / `Role.is_active` / `Role.updated_at`
- task-03 产出：`admin/router.py` 骨架已 import `admin_router`，本任务填充实际 handler

## TDD 步骤

1. **写测试**：`test_roles_router.py` 覆盖 7 个场景（见下「验收标准」AC-01 ~ AC-09），全部预期 FAIL（路由不存在 / service 不存在）
2. **跑失败**：`cd backend && pytest app/modules/admin/tests/test_roles_router.py` 全红，确认测试本身能 collect
3. **实现 schema**：先写 `schema.py` 的 4 个 DTO，确保 import 通畅
4. **实现 service**：`roles_service.py` 的 7 个方法 + 边界检查
5. **实现 router**：`router.py` 7 个 handler，调用 service 并返回 schema
6. **跑通**：再次执行测试，全部 PASS
7. **回归**：`pytest app/modules/admin/ app/modules/auth/ app/modules/settings/` 不破坏现有测试；`ruff check . && mypy app` 0 错误

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | POST /api/admin/roles 合法 body（key/name/permission_keys 均合法） | 201 + RoleRead，role_permissions 表写入，audit_logs 有记录 |
| AC-02 | POST body 含非法 `permission_keys: ["nonexistent:perm"]` | 422 + code=VALIDATION_ERROR，DB 无写入 |
| AC-03 | POST body `key` 与现有角色冲突 | 409 + code=ROLE_KEY_DUPLICATE |
| AC-04 | PATCH /api/admin/roles/{platform_admin_id}（is_system=true） | 403 + code=ROLE_SYSTEM_PROTECTED |
| AC-05 | PATCH 自定义角色更新 name + permission_keys | 200 + RoleRead，role_permissions 删旧+插新原子完成，user_count 不变 |
| AC-06 | POST /api/admin/roles/{platform_admin_id}/disable | 403 + code=ROLE_SYSTEM_PROTECTED，DB 中 is_active 仍为 true |
| AC-07 | DELETE 自定义角色且 user_count=0 | 204，role_permissions 级联删除，audit_logs 有删除记录 |
| AC-08 | DELETE 自定义角色且 user_count=1 | 409 + code=ROLE_IN_USE，detail 含 `user_count: 1`，角色未被删除 |
| AC-09 | 普通用户（无 ROLE_READ）调用 GET /api/admin/roles | 403 + code=PERMISSION_DENIED |
