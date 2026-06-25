---
id: task-02
title: 后端 schema 改造 — username 必填、email 改 Optional（auth/admin）
phase: V1
priority: P0
status: draft
owner: WhaleFall
author: WhaleFall
created_at: 2026-06-25T08:43:50
estimated_hours: 1.5
depends_on: []
blocks:
  - task-03
  - task-06
requirement_ids: []
decision_ids:
  - D-001@v1
  - D-003@v1
  - D-004@v1
allowed_paths:
  - backend/app/modules/auth/schema.py
  - backend/app/modules/admin/schema.py
---

## 1. 目标

把 `username` 提升为**必填**登录主账号、`email` 降为**非必填**（非空仍唯一，唯一性由 DB 索引 + service 层保证），仅改后端 Pydantic schema 两处文件，为零契约改动铺路：

- `auth/schema.py`：`UserRead.email: str` → `str | None`。
- `admin/schema.py`：
  - `UserCreateRequest.email` 改 `str | None = None`（去 `min_length=3` 必填约束）；`username` 改必填 `str = Field(min_length=3)`。
  - `UserUpdateRequest` 增 `username: str | None = None`、`email: str | None = None`（PATCH 语义，全 Optional）。
  - `UserRead.email: str` → `str | None`。
- `settings/schema.py` re-export `admin.schema` 的 `UserCreateRequest/UserUpdateRequest/UserRead`，改 admin 一处自动同步，**本 task 不改 settings/schema.py**。

本 task **只改 schema（DTO 声明）**，不动 service / router / model / migration。

## 2. 覆盖来源（依据）

| 来源 | 章节 | 关键结论 |
|---|---|---|
| `.sillyspec/changes/2026-06-24-username-login/design.md` | §3 Phase 1 | `auth/schema.py UserRead.email: str \| None`；`admin/schema.py`：create email Optional、username 必填；update 增 username/email；read email Optional |
| `.sillyspec/changes/2026-06-24-username-login/design.md` | §2 现状 | auth/schema.py `UserRead.email: str`（必填）；admin/schema.py create email 必填、username 可选；update 无 username/email；read email 必填 |
| `.sillyspec/changes/2026-06-24-username-login/decisions.md` | D-001@v1 | 纯登录名登录（schema 层 username 必填前置） |
| `.sillyspec/changes/2026-06-24-username-login/decisions.md` | D-003@v1 | 非空 email 仍唯一（schema 层 email Optional，唯一约束仍在 DB 索引） |
| `.sillyspec/changes/2026-06-24-username-login/decisions.md` | D-004@v1 | username 可编辑（update 增 username 字段） |
| `.sillyspec/changes/2026-06-24-username-login/plan.md` | Wave 1 task-02 | 覆盖 D-001/D-003/D-004@v1 |
| 现状代码 | `backend/app/modules/settings/schema.py:38-52` | re-export admin 的 UserCreateRequest/UserUpdateRequest/UserRead，改 admin 自动同步 |

## 3. 修改文件清单

| 文件 | 改动 | allowed_paths |
|---|---|---|
| `backend/app/modules/auth/schema.py` | `UserRead.email: str` → `str | None` | ✅ |
| `backend/app/modules/admin/schema.py` | `UserCreateRequest`（email Optional、username 必填）、`UserUpdateRequest`（增 username/email）、`UserRead.email` Optional | ✅ |
| `backend/app/modules/settings/schema.py` | **不改**（re-export 自动同步） | ❌（不在 allowed_paths，仅验证 re-export 仍可用） |

## 4. 实现要求

1. 仅改 Pydantic 字段声明，不改方法、不改 `model_config`、不动 `__all__`。
2. `auth/schema.py` 与 `admin/schema.py` 是**两个独立的 `UserRead`** 类（不同模块），分别改各自的 `email` 字段，不可混淆。
3. `UserCreateRequest` 保持 `model_config = ConfigDict(extra="forbid")`（拒绝未知字段），username 改必填后 Pydantic 自动在缺失时返回 422。
4. `UserUpdateRequest` 新增字段一律 `str | None = None`（PATCH 语义：`None` = 不改，由 service 层判定）。
5. 不引入新 import（`str | None` 用 PEP 604 写法，文件已 `from __future__ import annotations`）。
6. 不动 `admin/schema.py` 中 `RoleUserRead.email`、`OrganizationBrief` 等其他类（不在本期范围）。

## 5. 接口定义（精确到 Pydantic 字段）

### 5.1 `auth/schema.py` — `UserRead`（仅 email 改动）

```python
class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str | None                    # ← 由 str 改 str | None
    username: str | None
    display_name: str | None
    status: str
    is_platform_admin: bool
    last_login_at: datetime | None
    created_at: datetime
```

### 5.2 `admin/schema.py` — `UserCreateRequest`

```python
class UserCreateRequest(BaseModel):
    """Body of ``POST /api/admin/users`` (and forwarded ``/api/users``)."""

    model_config = ConfigDict(extra="forbid")

    email: str | None = None             # ← 由 str = Field(min_length=3) 改 Optional（去 min_length）
    password: str = Field(min_length=8)
    username: str = Field(min_length=3)  # ← 由 str | None = None 改必填 min_length=3
    display_name: str | None = None
    is_platform_admin: bool = False
    login_enabled: bool = True
    organization_ids: list[uuid.UUID] = Field(default_factory=list)
    role_ids: list[uuid.UUID] = Field(default_factory=list)
```

字段语义：
- `email`：可选。`None` 或缺省 = 不绑定邮箱；非空值由 service 层小写归一 + 唯一校验（DB `ux_users_email_active` 保证）。
- `username`：**必填**，`min_length=3`。缺省 / 缺失 / 空串 → Pydantic 422。
- `password`：必填，`min_length=8`（不变）。

### 5.3 `admin/schema.py` — `UserUpdateRequest`

```python
class UserUpdateRequest(BaseModel):
    """Body of ``PATCH /api/admin/users/{user_id}``.

    ``organization_ids`` / ``role_ids`` follow rewrite semantics:
    ``None`` → leave alone, ``[]`` → clear, ``[a, b]`` → replace.

    ``username`` / ``email`` 全 Optional（PATCH 语义）：
    缺省/``None`` → 不改；提供非空值 → service 层做唯一校验后更新。
    """

    model_config = ConfigDict(extra="forbid")

    username: str | None = None          # ← 新增（可编辑登录名，唯一冲突由 service 抛 409）
    email: str | None = None             # ← 新增（可改邮箱，非空时 service 小写归一 + 唯一校验）
    display_name: str | None = None
    is_platform_admin: bool | None = None
    status: str | None = None
    login_enabled: bool | None = None
    organization_ids: list[uuid.UUID] | None = None
    role_ids: list[uuid.UUID] | None = None
```

字段语义：
- `username`：Optional。`None`/缺省 = 不改；非空值 → service 走 `_resolve_username`（排除自身 id）+ 冲突抛 `HTTP_409`（task-03 实现，本 task 仅声明字段）。
- `email`：Optional。`None`/缺省 = 不改；非空值 → service 小写归一 + 非空唯一校验（task-03 实现）。

### 5.4 `admin/schema.py` — `UserRead`（仅 email 改动）

```python
class UserRead(BaseModel):
    """User row + login flag. Org/role lists are injected by the router."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str | None                    # ← 由 str 改 str | None
    username: str | None
    display_name: str | None
    status: str
    is_platform_admin: bool
    login_enabled: bool
    last_login_at: datetime | None
    created_at: datetime
    organizations: list[OrganizationBrief] = Field(default_factory=list)
    roles: list[RoleBrief] = Field(default_factory=list)
```

## 6. 边界处理

| # | 场景 | 行为 | 责任层 |
|---|---|---|---|
| B-01 | `UserCreateRequest` 缺 `username` 字段 | Pydantic 返回 422（`Field required`） | schema（本 task） |
| B-02 | `UserCreateRequest.username=""` 或长度 < 3 | Pydantic 返回 422（`min_length=3`） | schema（本 task） |
| B-03 | `UserCreateRequest.email=None` 或缺省 | schema 放行，`None` 原样透传 service | schema（本 task）；service 消化（task-03） |
| B-04 | `UserUpdateRequest` 全字段缺省（空 PATCH body） | schema 放行（`{}` 合法），service 视为无改动返回当前值 | schema（本 task）；service（task-03） |
| B-05 | `UserUpdateRequest.username` / `email` 同时提供 | schema 放行，逐字段透传 service 各自做唯一校验 | schema（本 task）；service（task-03） |
| B-06 | `UserRead` 序列化 `email=None` 的用户 | JSON 输出 `"email": null`（不再报 Pydantic validation error） | schema（本 task） |
| B-07 | `extra="forbid"` 仍生效 | 传未知字段（如 `foo=1`）返回 422 | schema（本 task，不变） |
| B-08 | `settings/schema.py` re-export | 改 admin 后 `from app.modules.settings.schema import UserCreateRequest` 自动拿到新定义，无需改 settings | 验证（本 task 不写代码） |

## 7. 非目标

- 不改 `auth/schema.py LoginRequest.account`（字段名保留，零契约改动；task-03 改 service 内部分支）。
- 不改 service / router / model / migration（task-03/04/05）。
- 不给 `username` 加 `pattern` 正则约束（design.md §5 非目标：应用层校验格式留给 service）。
- 不改 `RoleUserRead.email`（admin/schema.py 中独立类，不在本期范围）。
- 不改前端类型（task-06）。
- 不改 `min_length=8` 的 password 约束。

## 8. 参考

- `backend/app/modules/auth/schema.py`（现状：`UserRead.email: str`）
- `backend/app/modules/admin/schema.py:187-234`（现状：create/update/read）
- `backend/app/modules/settings/schema.py:38-52`（re-export）
- `archive/2026-05-25-multi-agent-platform-bootstrap-v2/tasks/task-04a-auth.md`（task 格式参考）

## 9. TDD 步骤

> 本 task 仅改 DTO，无运行时逻辑；TDD 聚焦「字段类型/必填性/422 行为」与「re-export 同步」。

1. **先写测试**（`backend/app/modules/admin/tests/test_schema_username_login.py` 新增，或复用既有 schema 测试文件追加用例）：
   - `test_create_username_required`：`UserCreateRequest(password="longpass", email=None)` 缺 username → `ValidationError`（缺 required 字段）。
   - `test_create_username_min_length`：`username="ab"`（长度 2）→ `ValidationError`。
   - `test_create_username_ok_email_none`：`UserCreateRequest(username="alice", password="longpass", email=None)` → 实例化成功，`.email is None`、`.username == "alice"`。
   - `test_create_email_optional_default_none`：不传 email → `.email is None`。
   - `test_update_has_username_email_optional`：`UserUpdateRequest(username="alice2", email=None)` → `.username == "alice2"`、`.email is None`；`UserUpdateRequest()` 空体 → `.username is None and .email is None`。
   - `test_admin_user_read_email_optional`：手工构造对象 `email=None` 馈入 `UserRead.model_validate(...)` → 不报错、`.email is None`。
   - `test_auth_user_read_email_optional`：同上针对 `auth.schema.UserRead`。
   - `test_settings_reexport_synced`：`from app.modules.settings.schema import UserCreateRequest as S; from app.modules.admin.schema import UserCreateRequest as A; assert S is A`（re-export 同一对象，改 admin 自动同步）。
2. **跑测试**确认全红（字段还未改）。
3. **改 schema**（按 §5 改 4 个字段）。
4. **跑测试**确认全绿。
5. `ruff check` + `mypy` 通过。

## 10. 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | `UserCreateRequest(username="alice", password="longpass")` 不传 email | 实例化成功，`.email is None`，`.username == "alice"` |
| AC-02 | `UserCreateRequest(password="longpass", email=None)` 缺 username | Pydantic `ValidationError`（Field required）→ API 层 422 |
| AC-03 | `UserCreateRequest(username="ab", password="longpass")` | Pydantic `ValidationError`（`min_length=3`）→ API 层 422 |
| AC-04 | `UserUpdateRequest(username="alice2", email=None)` | 实例化成功，`.username == "alice2"`、`.email is None` |
| AC-05 | `UserUpdateRequest()`（空体） | 实例化成功，`.username is None and .email is None`（合法空 PATCH） |
| AC-06 | `admin.schema.UserRead` 馈入 `email=None` 的对象 | `model_validate` 不报错，`.email is None`，JSON 序列化输出 `"email": null` |
| AC-07 | `auth.schema.UserRead` 馈入 `email=None` 的对象 | 同 AC-06 |
| AC-08 | `from app.modules.settings.schema import UserCreateRequest` 拿到的类与 `admin.schema.UserCreateRequest` 同一对象（`is` 判定） | True（re-export 自动同步，settings/schema.py 未改） |
| AC-09 | `ruff check backend/app/modules/auth/schema.py backend/app/modules/admin/schema.py` | 无告警 |
| AC-10 | `mypy backend/app/modules/auth/schema.py backend/app/modules/admin/schema.py` | 无类型错误 |
| AC-11 | 仅改两个 allowed_paths 文件，`git diff --stat` 不含其他文件 | true |

## 11. 完成定义

- [ ] §5 的 4 处字段改动落地（auth/UserRead.email、admin/UserCreateRequest、admin/UserUpdateRequest、admin/UserRead.email）
- [ ] §9 TDD 测试用例全绿
- [ ] §10 AC-01~AC-11 全部通过
- [ ] `settings/schema.py` 未改动（验证 re-export 仍指向 admin 新定义）
- [ ] `git diff` 仅含两个 allowed_paths 文件
