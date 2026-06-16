---
id: task-03
title: admin 模块骨架 + errors + bootstrap seed + main 注册
priority: P0
estimated_hours: 3
depends_on: [task-01, task-02]
blocks: [task-04, task-05, task-06]
allowed_paths:
  - backend/app/modules/admin/__init__.py
  - backend/app/modules/admin/router.py
  - backend/app/modules/admin/model.py
  - backend/app/modules/admin/schema.py
  - backend/app/modules/admin/services/__init__.py
  - backend/app/main.py
  - backend/app/core/errors.py
  - backend/app/modules/auth/seed.py
author: WhaleFall
created_at: 2026-06-16T15:40:00
---

# task-03: admin 模块骨架 + errors + bootstrap seed + main 注册

## 修改文件

| # | 路径 | 操作 | 说明 |
|---|---|---|---|
| 1 | `backend/app/modules/admin/__init__.py` | 新增 | 模块标记，可空文件或 `"""Admin module: users/organizations/roles."""` |
| 2 | `backend/app/modules/admin/router.py` | 新增 | 定义 `router = APIRouter(prefix="/admin", tags=["admin"])`，**不注册任何端点**（task-04/05/06 填充）；末尾 `__all__ = ["router"]` |
| 3 | `backend/app/modules/admin/model.py` | 新增 | 占位文件，仅含 docstring「ORM classes filled by task-05 (Organization/UserOrganization/UserRole)」+ 模块级 import；task-05 落地实际 ORM |
| 4 | `backend/app/modules/admin/schema.py` | 新增 | 占位文件，仅含 docstring；task-04/05/06 落地实际 Pydantic schema |
| 5 | `backend/app/modules/admin/services/__init__.py` | 新增 | 空文件，标记 services 子包；task-04/05/06 在此子包下创建 roles_service.py / organizations_service.py / users_service.py |
| 6 | `backend/app/main.py` | 修改 | 在 `include_router(...)` 序列中新增 `app.include_router(admin_router, prefix="/api")` |
| 7 | `backend/app/core/errors.py` | 修改 | 新增 7 个 AppError 子类：AuthUserLoginDisabled / RoleInUse / RoleSystemProtected / RoleNotFound / OrganizationInUse / OrganizationHasChildren / OrganizationCodeDuplicate / OrganizationParentNotFound / RoleKeyDuplicate |
| 8 | `backend/app/modules/auth/seed.py` | 新增或修改 | bootstrap 函数中：seed `platform_admin` 角色（is_system=true）+ 绑定所有 Permission；幂等（已存在则跳过） |

## 实现要求

### R-01: admin 模块骨架文件

- 5 个占位文件全部可独立 import，不依赖 task-04/05/06 的实现
- `admin/__init__.py` 不做 `from .router import router` 顶层 re-export，避免循环 import 风险（router.py 由 `main.py` 显式 `from app.modules.admin.router import router as admin_router` 引入）
- `admin/router.py` 必须能独立加载（仅 import `APIRouter` + `Depends`，不 import 任何 service）
- `admin/model.py` 顶部含 `from app.models.base import BaseModel` + `from sqlmodel import Field` 等 import，让 task-05 直接补 ORM 类
- `admin/schema.py` 顶部含 `from pydantic import BaseModel, Field` + `from datetime import datetime` + `import uuid`，让 task-04/05/06 直接补 schema

### R-02: admin/router.py 骨架

```python
"""Admin router: /api/admin/{users,organizations,roles}.

Endpoints are registered by task-04 (roles), task-05 (organizations), task-06 (users).
"""
from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(prefix="/admin", tags=["admin"])

# Endpoints registered in subsequent tasks:
# - task-04: router.include_router(roles_router)  or direct @router.get("/roles", ...)
# - task-05: /admin/organizations
# - task-06: /admin/users

__all__ = ["router"]
```

注意：task-04/05/06 可以选择直接在本 router 上 `@router.get(...)` 注册端点，或新建 sub-router 后 `router.include_router(...)`，二选一保持一致。

### R-03: main.py 注册

参考现有 `main.py` 中其它 router 的注册模式：

```python
from app.modules.admin.router import router as admin_router
# ...
app.include_router(admin_router, prefix="/api")
```

注册位置在 `settings_router` 之后、其它模块之前（按字母序或现有惯例）。

### R-04: core/errors.py 新增 7+ 个错误类

每个错误继承现有 `AppError` 基类（含 `code` / `http_status` / `details` 属性），与现有错误（如 `PermissionDenied` / `AuthInvalidCredentials`）一致：

| 错误类 | code | http_status | 用途 |
|---|---|---|---|
| `AuthUserLoginDisabled` | `AUTH_USER_LOGIN_DISABLED` | 401 | login() 检测到 login_enabled=false |
| `RoleInUse` | `ROLE_IN_USE` | 409 | 删除角色时 user_count > 0 |
| `RoleSystemProtected` | `ROLE_SYSTEM_PROTECTED` | 403 | 修改/删除/禁用 is_system=true 角色 |
| `RoleNotFound` | `ROLE_NOT_FOUND` | 404 | role_id 不存在 |
| `RoleKeyDuplicate` | `ROLE_KEY_DUPLICATE` | 409 | 创建角色 key 冲突 |
| `OrganizationInUse` | `ORGANIZATION_IN_USE` | 409 | 删除组织时 member_count > 0 |
| `OrganizationHasChildren` | `ORGANIZATION_HAS_CHILDREN` | 409 | 删除组织时 children_count > 0 |
| `OrganizationCodeDuplicate` | `ORGANIZATION_CODE_DUPLICATE` | 409 | 创建组织 code 冲突 |
| `OrganizationParentNotFound` | `ORGANIZATION_PARENT_NOT_FOUND` | 404 | 创建/更新组织时 parent_id 不存在 |
| `OrganizationNotFound` | `ORGANIZATION_NOT_FOUND` | 404 | org_id 不存在 |

每个错误类按现有 AppError 子类的模板实现（约 5-8 行），含 `__init__` 接收 `message` + 可选 `details`，`code` / `http_status` 作为类属性。

### R-05: auth/seed.py bootstrap platform_admin 角色

- 找到现有 bootstrap 函数（用 Grep 搜索 `platform_admin\|bootstrap\|PLATFORM_BOOTSTRAP` 在 backend/app/ 下定位；可能在 `auth/__init__.py` / `auth/bootstrap.py` / `core/bootstrap.py`）
- 在 bootstrap 流程中新增：检查 `Role(key="platform_admin")` 是否存在，不存在则 INSERT 一条 `Role(key="platform_admin", name="Platform Admin", is_system=True, is_active=True)` + 批量 INSERT 该 role 对应的所有 Permission（遍历 task-02 扩展后的 Permission 枚举）
- 已存在则跳过（幂等，每次启动不重复创建）
- 如 `auth/seed.py` 不存在则新建，文件含 `async def seed_platform_admin_role(session: AsyncSession) -> None` 函数
- 在 `main.py` 的 startup 钩子或现有 bootstrap 调用处调用 `seed_platform_admin_role`

## 接口定义

### admin_router

```python
router = APIRouter(prefix="/admin", tags=["admin"])
# 注册到 app:
# app.include_router(admin_router, prefix="/api")
# 实际 URL 前缀: /api/admin/{users|organizations|roles}
```

### 错误类签名模板

```python
class RoleInUse(AppError):
    code = "ROLE_IN_USE"
    http_status = 409

    def __init__(self, message: str = "Role is in use.", *, user_count: int = 0) -> None:
        super().__init__(message, details={"user_count": user_count})
```

### bootstrap seed 函数签名

```python
async def seed_platform_admin_role(session: AsyncSession) -> None:
    """Idempotent: insert platform_admin role + bind all Permissions if missing.

    Called from app startup hook. Safe to call multiple times.
    """
```

## 边界处理

1. **循环 import 规避**：admin 模块禁止 `from app.modules.settings import ...`（单向依赖，settings→admin 不反向）；admin/__init__.py 不做 router re-export
2. **router 骨架不依赖未实现的 service**：admin/router.py 仅 import `APIRouter`，不 import 任何 `*_service.py`，确保 task-04/05/06 实施前 `python -c "from app.modules.admin.router import router"` 不抛 ImportError
3. **bootstrap 幂等**：每次启动都调用 seed_platform_admin_role，已存在 platform_admin 角色则直接 return（通过 `select(Role).where(Role.key == "platform_admin")` 预检）
4. **错误码全局唯一**：新增 10 个错误码（AUTH_USER_LOGIN_DISABLED / ROLE_IN_USE / ROLE_SYSTEM_PROTECTED / ROLE_NOT_FOUND / ROLE_KEY_DUPLICATE / ORGANIZATION_IN_USE / ORGANIZATION_HAS_CHILDREN / ORGANIZATION_CODE_DUPLICATE / ORGANIZATION_PARENT_NOT_FOUND / ORGANIZATION_NOT_FOUND）必须与现有错误码无冲突（用 Grep `code = "` 在 core/errors.py 验证）
5. **is_system 字段保留**：bootstrap 创建的 platform_admin 角色 `is_system=True`，task-04 的 RoleService.update/disable/delete 会因此拒绝修改
6. **Permission 绑定覆盖全量**：bootstrap 阶段 platform_admin 角色绑定 task-02 扩展后的全部 Permission（含新增 USER_*/ORGANIZATION_*/ROLE_*），保证 platform_admin 持有人短路所有检查
7. **errors 类层级**：所有新错误继承 `AppError`，不破坏现有 `PermissionDenied` / `AuthInvalidCredentials` 等子类层级
8. **services 子包**：`admin/services/__init__.py` 空文件即可，让 task-04/05/06 在该子包下创建 service 文件，保持 service 与 router/schema/model 同级但物理隔离

## 非目标

- 不实现 roles_service / organizations_service / users_service 业务逻辑（task-04/05/06 范围）
- 不实现 13+ 个端点 handler（task-04/05/06 范围）
- 不实现 schema 实际定义（task-04/05/06 范围）
- 不实现 Organization/UserOrganization/UserRole ORM 类（task-05 范围）
- 不修改 task-01 Alembic 迁移文件
- 不修改现有 Permission 枚举本身（task-02 范围）
- 不实现「超级管理员专用」的额外角色（仅 seed platform_admin 一个）

## 参考

- `design.md` §4 总体方案（admin 模块独立 + 三个子 service）
- `design.md` §6 文件清单（admin 模块新增文件清单）
- `requirements.md` FR-01 数据模型与迁移（依赖 task-01）
- `requirements.md` FR-02 Permission 枚举扩展（依赖 task-02）
- `backend/app/main.py` 现有 router 注册模式
- `backend/app/core/errors.py` 现有 AppError 子类模板
- `backend/app/modules/auth/model.py:106-143` Role ORM 字段（含 is_system / is_active / updated_at）
- `backend/app/modules/auth/permissions.py` Permission StrEnum（task-02 扩展后 32 项）
- task-01 产出：organizations / user_organizations / user_roles 三张表已建好
- task-02 产出：Role.is_active + updated_at + User.login_enabled 字段已就绪 + 7 个新 Permission 已注册

## TDD 步骤

1. **写 import 测试**：在 `admin/tests/__init__.py` 创建空标记；新增 `admin/tests/test_module_skeleton.py`，含 3 个 import 测试：
   - `import app.modules.admin` 不抛
   - `from app.modules.admin.router import router` 不抛
   - `from app.core.errors import RoleInUse, RoleSystemProtected, RoleKeyDuplicate, OrganizationInUse, OrganizationHasChildren, OrganizationCodeDuplicate, OrganizationParentNotFound, AuthUserLoginDisabled` 不抛
2. **写 bootstrap 测试**：在 `auth/tests/test_seed.py` 新增测试 `test_seed_platform_admin_role_idempotent`：第一次调用后 Role 存在 + Permission 全绑定；第二次调用不创建新记录
3. **跑测试失败**：`pytest app/modules/admin/tests/ app/modules/auth/tests/test_seed.py` 全红（文件不存在）
4. **实现骨架**：按 R-01 ~ R-05 创建/修改文件
5. **跑测试通过**：所有 import 测试 + bootstrap 测试全绿
6. **回归验证**：`pytest app/` 现有用例全绿 + `ruff check . && mypy app` 0 错误
7. **手动验证**：启动 backend（`uvicorn app.main:app`），日志含 platform_admin seed 完成；`/docs` Swagger 页 `/api/admin` 前缀存在但无端点（task-04/05/06 才填充）

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | `python -c "from app.modules.admin.router import router; print(router.prefix)"` | 输出 `/admin`，无 ImportError |
| AC-02 | `python -c "from app.core.errors import RoleInUse, RoleSystemProtected, RoleKeyDuplicate, OrganizationInUse, OrganizationHasChildren, OrganizationCodeDuplicate, OrganizationParentNotFound, AuthUserLoginDisabled, RoleNotFound, OrganizationNotFound"` | 无 ImportError，10 个类全部存在 |
| AC-03 | `RoleInUse(user_count=3).details` | 返回 `{"user_count": 3}`，`http_status=409`，`code="ROLE_IN_USE"` |
| AC-04 | 启动 backend 后 `select * from roles where key='platform_admin'` | 存在 1 行，`is_system=true` / `is_active=true` |
| AC-05 | 启动 backend 后 `select count(*) from role_permissions where role_id=(select id from roles where key='platform_admin')` | count = Permission 枚举长度（task-02 后 32 项） |
| AC-06 | 重启 backend（再次执行 bootstrap）| `roles` 表不重复创建 platform_admin，`role_permissions` 不重复绑定 |
| AC-07 | 启动 backend 后访问 `http://127.0.0.1:8000/docs` | OpenAPI 含 `/api/admin` 前缀（具体端点由 task-04/05/06 填充） |
| AC-08 | `pytest app/modules/admin/tests/test_module_skeleton.py` | 3 个 import 测试全绿 |
| AC-09 | `pytest app/modules/auth/tests/test_seed.py` | bootstrap 幂等测试全绿 |
| AC-10 | `pytest app/` | 全部回归绿（不破坏现有用例） |
| AC-11 | `ruff check app/modules/admin/ app/core/errors.py app/modules/auth/seed.py` | 0 错误 |
| AC-12 | `mypy app/modules/admin/ app/core/errors.py app/modules/auth/seed.py` | 0 错误 |
| AC-13 | 检查 `app.modules.admin.router` 不 `import app.modules.settings` | grep 确认无循环依赖 |
