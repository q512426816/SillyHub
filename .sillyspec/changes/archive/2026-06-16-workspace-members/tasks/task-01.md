---
id: task-01
title: workspace/schema.py 新增 6 个成员管理 Pydantic schema
priority: P0
estimated_hours: 1
depends_on: []
blocks: [task-02, task-03, task-05]
allowed_paths:
  - backend/app/modules/workspace/schema.py
  - backend/app/modules/workspace/__init__.py
author: qinyi
created_at: 2026-06-16T09:53:36
---

# task-01: workspace/schema.py 新增 6 个成员管理 Pydantic schema

本任务在 `backend/app/modules/workspace/schema.py` 中追加 6 个 Pydantic 类，供 task-02（service）、task-03（router）、task-05（测试）依赖。**只写 schema 文件本身，不修改任何 ORM 模型，不实现 service/router**。完成后文件可独立 `import` 通过，不需要 DB 启动。

## 修改文件

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | `backend/app/modules/workspace/schema.py` | 在文件末尾（`slugify` 函数之前或之后均可，建议在 `WorkspaceRelationRead` 之后）追加 6 个新类；同时在文件顶部确保 `datetime`、`uuid`、`Literal`、`BaseModel`、`Field` 已 import（现有代码已 import `datetime` / `uuid` / `Literal` / `BaseModel` / `Field`，无需新增 import；若需补 `ConfigDict` 也已在文件中导入）。 |
| 不修改 | `backend/app/modules/workspace/__init__.py` | 仅在新类需要 re-export 时才动；默认不动以最小化 diff。如需 re-export，只追加 `from .schema import WorkspaceMemberView, ...`，不得删现有导出。 |

## 实现要求

1. **复用现有 `BaseModel`**：直接 `from pydantic import BaseModel`（文件顶部已 import）。**不要**新建自定义基类，不要继承 sqlmodel 的 `BaseModel`（注意：本文件现有 Pydantic 类继承的是 `pydantic.BaseModel`，保持一致）。
2. **6 个 schema 类，字段与类型与下文 §接口定义 1:1**。不得增删字段、不得改字段顺序之外的语义。
3. **`role_key` 白名单用 `typing.Literal`**（不要用 `str` + 自定义 validator）。白名单恰好 3 个值：`"workspace_owner"`、`"developer"`、`"viewer"`。**严禁**包含 `platform_admin` / `reviewer` / `qa` / `component_lead`（即使它们是有效 seed 角色，也不在本 API 可写入范围内——见 design §5.1 业务规则表）。
4. **Python 版本目标**：`str | None`、`list[...]`、`Literal[...]` 等 PEP 604 / PEP 585 语法可直接用（现有文件已用，且顶部有 `from __future__ import annotations`，但 schema 类用 Literal 作为运行时类型，**不要**依赖 future annotation 字符串化（Pydantic 会在 model rebuild 时解析 Literal，未来模式可能 fail）。现有 schema.py 文件顶部已有 `from __future__ import annotations`——保持现状即可，Pydantic v2 已正确处理 Literal 在 future-annotation 模式下的解析。
5. **复用 `model_config = ConfigDict(from_attributes=True)` 仅在"从 ORM 转 Pydantic"的响应类上**。本任务的 6 个 schema 中：
   - `WorkspaceMemberView`、`WorkspaceMemberListResponse`、`UserSearchHit`、`UserSearchResponse`：是 service 层手工构造的 DTO（service 层会从多表 JOIN 取出字段，**不是直接 `ModelValidate(orm_obj)`**），**不强制** `from_attributes=True`；但**加上也无害**（service 层用 `WorkspaceMemberView(user_id=..., email=..., ...)` 关键字构造即可）。本任务决定：4 个响应类全部不加 `ConfigDict`，保持简单；service 层用关键字构造。
   - `WorkspaceMemberAddRequest`、`WorkspaceMemberUpdateRequest`：纯请求体，无需 `ConfigDict`。
6. **不改任何其他文件**。不动 `auth/model.py`、`workspace/model.py`、`auth/schema.py`、`workspace/router.py`、`auth/service.py`。
7. **不引入新的 import 循环**。仅 import `uuid` / `datetime` / `Literal` / `pydantic.BaseModel`（文件顶部已有），**不要** import `app.modules.auth.model`（避免 schema 层反向依赖 ORM 模型；uuid.UUID 作为类型直接用即可）。
8. **保留现有所有类与函数不动**（`WorkspaceStructureDTO`、`ScanRequest`、`WorkspaceCreate`、`slugify` 等等）。

## 接口定义

直接复用 design §5.1 Pydantic 定义（保持字段名、顺序、类型不变）：

```python
class WorkspaceMemberView(BaseModel):
    user_id: uuid.UUID
    email: str
    display_name: str | None
    role_key: str
    role_name: str
    granted_at: datetime
    is_current_user: bool  # 给前端高亮"你"


class WorkspaceMemberListResponse(BaseModel):
    items: list[WorkspaceMemberView]


class WorkspaceMemberAddRequest(BaseModel):
    user_id: uuid.UUID
    # 宽 str 类型——由 service 层（task-02）的 ROLE_KEY_WHITELIST 校验，
    # 让非法值（如 platform_admin）走业务路径返 400 invalid_role_key，
    # 而不是 Pydantic Literal 路径返 422。见 FR-03 / task-03 §4.2。
    role_key: str


class WorkspaceMemberUpdateRequest(BaseModel):
    role_key: str  # 同上，service 层白名单校验


class UserSearchHit(BaseModel):
    user_id: uuid.UUID
    email: str
    display_name: str | None
    is_member: bool  # 通常为 False（搜索时已排除），保留字段供前端展示


class UserSearchResponse(BaseModel):
    items: list[UserSearchHit]
```

**字段类型与可选性明细表**：

| 类 | 字段 | Python 类型 | 可空 | 默认值 | 备注 |
|---|---|---|---|---|---|
| `WorkspaceMemberView` | `user_id` | `uuid.UUID` | 否 | — | 来自 `users.id` |
| | `email` | `str` | 否 | — | 来自 `users.email`，原样返回，前端可显示 |
| | `display_name` | `str \| None` | 是 | — | `users.display_name` 可为 NULL |
| | `role_key` | `str` | 否 | — | 来自 `roles.key`，**响应里用 `str`，不是 Literal**（service 可能返回 platform_admin 等用于显示，虽然 add/update 不允许写入） |
| | `role_name` | `str` | 否 | — | 来自 `roles.name`（如 "Workspace Owner"） |
| | `granted_at` | `datetime` | 否 | — | 来自 `user_workspace_roles.granted_at` |
| | `is_current_user` | `bool` | 否 | — | service 层根据当前 session user_id 比对设置；**Pydantic 层不设默认值**（强制 service 层显式传） |
| `WorkspaceMemberListResponse` | `items` | `list[WorkspaceMemberView]` | 否 | — | 可为空 list（ws 无成员理论上不会发生，但允许） |
| `WorkspaceMemberAddRequest` | `user_id` | `uuid.UUID` | 否 | — | 请求体必传 |
| | `role_key` | `str` | 否 | — | 宽 str 类型；service 层（task-02）用 `ROLE_KEY_WHITELIST = {"workspace_owner", "developer", "viewer"}` 校验，非法值 → 400 `invalid_role_key`（满足 FR-03 第三块） |
| `WorkspaceMemberUpdateRequest` | `role_key` | `str` | 否 | — | 同上 |
| `UserSearchHit` | `user_id` | `uuid.UUID` | 否 | — | |
| | `email` | `str` | 否 | — | |
| | `display_name` | `str \| None` | 是 | — | |
| | `is_member` | `bool` | 否 | — | 通常 False；保留字段供未来扩展（如需在搜索结果里也含已有成员） |
| `UserSearchResponse` | `items` | `list[UserSearchHit]` | 否 | — | |

## 边界处理

1. **`display_name` 可空**：`User.display_name` 在 `auth/model.py:39` 定义为 `str | None`（`String(100), nullable=True`）。`WorkspaceMemberView.display_name` 和 `UserSearchHit.display_name` 都声明为 `str | None`。service 层把 NULL 转为 `None` 传给 Pydantic；前端负责 `?? ""` 或显示 email。
2. **`role_key` 白名单失败行为**：POST `/members` body 中 `role_key="platform_admin"` → Pydantic **不**拦它（`role_key: str` 接受任意字符串），由 service 层（task-02）的 `ROLE_KEY_WHITELIST` 校验抛 `ValueError("invalid_role_key")`，router 层（task-03）翻译为 HTTP 400 `invalid_role_key`。**为什么不用 Pydantic Literal**：Literal 会让非法值走 422 路径，但 FR-03 第三块明确要求 400 `invalid_role_key`（语义差异：422 表示请求格式错误，400 表示业务规则违反）。两道防线只保留 service 层一道（router 路径必经 service），避免 schema 层与 service 层语义打架。
3. **email 格式不重校**：`WorkspaceMemberView.email` 和 `UserSearchHit.email` 是 `str` 而非 `EmailStr`。理由：email 在 `users.email` 入库时（`auth/service.py` 注册流程）已用 `EmailStr` 校验过，本 schema 只是回显。**不要** import `EmailStr`，避免引入额外 pydantic[email] 依赖。
4. **`is_current_user` 不设默认值**：service 层必须显式传入 `is_current_user=True/False`。若遗漏，Pydantic 在构造时抛 `ValidationError("field required")`——这是有意的，强制 service 层处理此字段（前端依赖它显示 "(you)" 标识）。
5. **`is_member` 不设默认值**：同上，service 层显式传。当前实现 `search_users_for_invite` 总传 `False`（已排除），但保留字段语义。
6. **`user_id` 必须是 `uuid.UUID`**：客户端传字符串 `"abc"` → Pydantic 尝试 `UUID("abc")` 失败 → 422。客户端传合法 UUID 字符串 `"550e8400-e29b-41d4-a716-446655440000"` → Pydantic 自动转 `uuid.UUID`。**不要**改为 `str` 类型——保持类型语义。
7. **`granted_at` 必须是 `datetime`**：service 层从 ORM 取出的就是 `datetime`（`DateTime(timezone=True)` 列）。Pydantic 接受 ISO 字符串或 datetime 对象。本 schema 不做 timezone 转换（service 层负责统一用 UTC）。
8. **空 list 合法**：`WorkspaceMemberListResponse(items=[])` 和 `UserSearchResponse(items=[])` 必须能构造成功——表示 ws 无成员 / 搜索无结果。
9. **不暴露 `password_hash` / `mfa_secret` / `is_platform_admin`**：本 schema 字段集刻意最小化（参考 design §10 R-02 隐私风险）。即使 `User` ORM 有这些字段，service 层也不要把它们填进 `WorkspaceMemberView`。

## 非目标

- **不修改任何 ORM 模型**（`UserWorkspaceRole` / `Role` / `User` 全部不动）。design §8 明确"无 schema 变更"。
- **不做权限校验**（`require_permission_any(Permission.WORKSPACE_MEMBER_MANAGE)` 是 task-03 router 的事）。
- **不做 service 层 helper**（list/search/add/update/remove/transfer 在 task-02）。
- **不改 `auth/schema.py`**（User schema 是注册/登录用的，与成员管理分离）。
- **不写测试**（schema 的字段约束在 task-05 router 集成测试里覆盖；本任务只保证 import 通过）。
- **不处理 `Role.is_system` 标志**（service 层读 role.key 即可，schema 不关心）。
- **不暴露 `granted_by`**（design §5.1 没有此字段——审计日志需要时可单独加，本次 YAGNI）。
- **不做 pagination**（design §10 R-03，YAGNI）。

## 参考

- `design.md` §5.1 末尾的 Pydantic 定义块（本任务字段的权威来源）
- `design.md` §5.1 业务规则表（role_key 白名单逻辑、最后 owner 保护）
- `backend/app/modules/workspace/schema.py` 现有类风格：
  - `WorkspaceRead`（用 `ConfigDict(from_attributes=True)` 从 ORM 转 Pydantic 的范例）
  - `WorkspaceListResponse`（`items: list[WorkspaceRead]` 的 list 响应范例）
  - `WorkspaceCreate` / `WorkspaceUpdate`（请求体 schema 范例）
  - 文件顶部已有 `Literal` / `uuid` / `datetime` / `BaseModel` / `Field` import
- `backend/app/modules/auth/model.py`：
  - `User.id: uuid.UUID` / `User.email: str` / `User.display_name: str | None` / `User.status: str`（确认字段类型）
  - `UserWorkspaceRole.granted_at: datetime` / `granted_by: uuid.UUID | None`
  - `Role.key: str` / `Role.name: str`
- `CLAUDE.md` 硬性规则：文档 → 读现有代码 → 写测试 → 写实现（本任务对应"读现有代码 → 写实现"，测试在 task-05）

## TDD 步骤

本任务对应的测试在 task-05（`backend/tests/modules/workspace/test_members_router.py`）覆盖。本任务**不写独立测试文件**，但必须满足"可 import"基线：

```bash
cd backend
uv run python -c "from app.modules.workspace.schema import (
    WorkspaceMemberView,
    WorkspaceMemberListResponse,
    WorkspaceMemberAddRequest,
    WorkspaceMemberUpdateRequest,
    UserSearchHit,
    UserSearchResponse,
); print('import OK')"
```

若 import 报错（语法 / 类型 / 循环依赖），**禁止**继续 task-02 / task-03，必须回来修。

后续测试覆盖（在 task-05 验证，不在本任务执行）：
- `WorkspaceMemberAddRequest(user_id=..., role_key="platform_admin")` → **Pydantic 通过**（service 层在 task-02 中负责拒绝）；这是 FR-03 第三块的关键——400 而非 422
- `WorkspaceMemberAddRequest(role_key="developer")` → 成功
- `WorkspaceMemberUpdateRequest(role_key="viewer")` → 成功
- `WorkspaceMemberView(user_id=uuid.uuid4(), email="x@y.z", display_name=None, role_key="developer", role_name="Developer", granted_at=datetime.now(UTC), is_current_user=False)` → 成功
- `WorkspaceMemberListResponse(items=[])` → 成功
- `UserSearchResponse(items=[])` → 成功

## 验收标准

| # | 标准 | 验证命令 / 方法 | 通过条件 |
|---|---|---|---|
| AC-01 | 6 个新类都存在于 `workspace/schema.py` | `uv run python -c "from app.modules.workspace.schema import WorkspaceMemberView, WorkspaceMemberListResponse, WorkspaceMemberAddRequest, WorkspaceMemberUpdateRequest, UserSearchHit, UserSearchResponse"` | exit code 0，无 ImportError |
| AC-02 | 文件 import 后不破坏现有类 | `uv run python -c "from app.modules.workspace.schema import WorkspaceRead, WorkspaceCreate, WorkspaceListResponse, slugify; print('ok')"` | exit code 0 |
| AC-03 | `role_key` schema 层用宽 str（Pydantic 不拦 platform_admin，由 service 层拒） | `uv run python -c "from app.modules.workspace.schema import WorkspaceMemberAddRequest; m = WorkspaceMemberAddRequest(user_id='550e8400-e29b-41d4-a716-446655440000', role_key='platform_admin'); assert m.role_key == 'platform_admin'; print('PASS: schema allows, service layer will reject')"` | 打印 `PASS: schema allows, service layer will reject` |
| AC-04 | `role_key` 接受白名单值（schema 层不区分） | `uv run python -c "from app.modules.workspace.schema import WorkspaceMemberAddRequest; m = WorkspaceMemberAddRequest(user_id='550e8400-e29b-41d4-a716-446655440000', role_key='developer'); assert m.role_key == 'developer'; print('PASS')"` | 打印 `PASS` |
| AC-05 | 现有 backend 测试不回归 | `cd backend && uv run pytest -x -q`（仅运行 schema 相关 quick check；可选 `--co` 仅 collect） | 现有用例 collect / 通过数量不变（当前 baseline 见 plan.md 验收标准提到 ~1081 用例） |
| AC-06 | 字段集合与 design §5.1 1:1 | 人工 diff `WorkspaceMemberView` 等类与 design.md §5.1 代码块 | 字段名 / 类型 / 顺序完全一致（含 `is_current_user` / `is_member` 这种派生字段） |
| AC-07 | 不引入新 import 循环 | `uv run python -c "import app.modules.workspace.schema; import app.modules.auth.model; print('no cycle')"` | exit code 0 |

完成后请按 sillyspec 流程更新 progress（如有 progress.json），然后回报 task-02 可以开工。
