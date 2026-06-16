---
id: task-03
title: workspace 成员管理 router（members_router.py 6 个端点）
priority: P0
estimated_hours: 2
depends_on: [task-01, task-02]
blocks: [task-04, task-05]
allowed_paths:
  - backend/app/modules/workspace/members_router.py
created_at: 2026-06-16 09:53:36
author: qinyi
---

# task-03 workspace 成员管理 router（members_router.py 6 个端点）

新增 `backend/app/modules/workspace/members_router.py`，挂载到
`/api/workspaces/{workspace_id}/members`（**prefix 含 `workspace_id` Path 参数**，让
`require_permission(Permission.WORKSPACE_MEMBER_MANAGE)` 依赖能从 path 中拿到
`workspace_id` 做权限校验）。6 个端点全部走 `require_permission(...)` 而非
`require_permission_any(...)`——后者用于"任一 ws 满足即可"的场景（如 `GET /api/workspaces`），
本变更所有操作都绑定到 path 中的具体 `workspace_id`，必须用 `require_permission` 让
依赖闭包拿到 `workspace_id: Path(...)`。

依据文档：
- `design.md` §5.1（6 个端点 + 业务规则表 + Pydantic schema 定义）
- `design.md` §7（错误响应表：400 / 403 / 404 三类错误码）
- `requirements.md` FR-01..06（每个端点的 GWT 用例）
- 现有实现参考：`backend/app/modules/workspace/router.py`（APIRouter、SessionDep、
  `require_permission_any`、`response_model`、`status_code` 写法）

## 修改文件（精确路径）

- `backend/app/modules/workspace/members_router.py`（唯一允许新增的文件）

不得修改其它任何文件。挂载（`include_router`）由 task-04 在 `app/main.py` 或
`workspace/router.py` 完成；本任务只交付 router 模块。

## 实现要求

逐项落实，缺一不可：

### 1. Router 构造

```python
router = APIRouter(
    prefix="/workspaces/{workspace_id}/members",
    tags=["workspace-members"],
)
```

**重要**：`prefix` 必须含 `{workspace_id}` Path 参数，使 `require_permission(...)`
依赖（定义在 `app/core/auth_deps.py`）能通过 `workspace_id: Annotated[uuid.UUID, Path(...)]`
自动注入到权限校验闭包。挂载时 task-04 只需 `app.include_router(members_router, prefix="/api")`。

### 2. SessionDep 别名

复用 `router.py` 已有写法：

```python
SessionDep = Annotated[AsyncSession, Depends(get_session)]
```

### 3. 6 个端点（路径 + 方法 + 权限 + body + 响应）

| # | 方法 | 路径 | 权限 | body | 响应 model | 成功 status |
|---|------|------|------|------|------------|-------------|
| 1 | GET | `/` | `WORKSPACE_READ` | — | `WorkspaceMemberListResponse` | 200 |
| 2 | GET | `/search` | `WORKSPACE_MEMBER_MANAGE` | `q: Query(min_length=2, max_length=100)`, `limit: Query(ge=1, le=50)=10` | `UserSearchResponse` | 200 |
| 3 | POST | `/` | `WORKSPACE_MEMBER_MANAGE` | `WorkspaceMemberAddRequest` | `WorkspaceMemberView` | 201（新建）/ 200（幂等更新）|
| 4 | PATCH | `/{user_id}` | `WORKSPACE_MEMBER_MANAGE` | `WorkspaceMemberUpdateRequest` | `WorkspaceMemberView` | 200 |
| 5 | DELETE | `/{user_id}` | `WORKSPACE_MEMBER_MANAGE` | — | — | 204 |
| 6 | POST | `/{user_id}/transfer-ownership` | `WORKSPACE_MEMBER_MANAGE` | — | `dict`（`{"new_owner": user_id, "demoted": current_user_id}`）| 200 |

**关于权限依赖选型**：
- 端点 1（list）用 `require_permission(Permission.WORKSPACE_READ)`——`require_permission`
  在 `app/core/auth_deps.py` 中已绑定 `workspace_id: Path(...)`，会自动从 path 抽取校验；
  任何 ws 成员（owner/dev/viewer）都至少有 `WORKSPACE_READ`，故 FR-01 第二块"developer/viewer
  可读"自动满足。
- 端点 2-6 用 `require_permission(Permission.WORKSPACE_MEMBER_MANAGE)`——仅 workspace_owner
  和 platform_admin 持有（seed 在 migration `202605280900_create_auth_and_rbac.py`）。
- `require_permission` 而非 `require_permission_any`：后者用于无 path `workspace_id` 的
  通用端点（如 `GET /api/workspaces`），返回"任一 ws 满足即放行"。本变更所有端点都
  绑定到具体 ws，必须用 `require_permission`。

### 4. Service 层调用

本 router 不写业务逻辑，全部委托 task-02 创建的 `members_service.py`（命名建议
`MembersService` 类或独立 async 函数，由 task-02 决定）。本任务**仅依赖 service
层方法签名**，task-02 必须按以下签名实现：

- `await MembersService.list_members(session, workspace_id, current_user_id) -> WorkspaceMemberListResponse`
- `await MembersService.search_users(session, workspace_id, q, limit) -> UserSearchResponse`
- `await MembersService.add_or_update_member(session, workspace_id, payload, granted_by) -> tuple[WorkspaceMemberView, bool]`（第二个返回 `created: bool`，True 返 201，False 返 200）
- `await MembersService.update_member_role(session, workspace_id, user_id, payload) -> WorkspaceMemberView`
- `await MembersService.remove_member(session, workspace_id, user_id) -> None`
- `await MembersService.transfer_ownership(session, workspace_id, target_user_id, current_user_id) -> dict`

如 task-02 选了不同签名，**优先在 task-02 调整**；本 router 文件假定上述签名。

### 5. 422 / 403 / 404 / 400 错误路径来源

| HTTP | code | 触发位置 |
|------|------|----------|
| 422 | `validation_error` | FastAPI Query/body 校验失败（自动），如 `q` 太短 |
| 403 | `HTTP_403_PERMISSION_DENIED` | `require_permission(...)` 依赖（`PermissionDenied` AppError）|
| 404 | `HTTP_404_WORKSPACE_NOT_FOUND` | service 层校验 ws 存在性（如 ws_id 不存在）|
| 404 | `HTTP_404_USER_NOT_FOUND`（**本变更新增**）| service 层校验 user_id 存在性 |
| 404 | `HTTP_404_MEMBER_NOT_FOUND`（**本变更新增**）| service 层：DELETE/PATCH 的 user 不在 ws |
| 400 | `invalid_role_key` | service 层白名单校验 |
| 400 | `cannot_remove_last_owner` | service 层最后 owner 保护 |
| 400 | `transfer_target_not_member`（可选）| service 层：transfer 目标不在 ws |

> **关于新增 AppError 类**：404 `user_not_found` / `member_not_found` 是否要在
> `app/core/errors.py` 新增 `UserNotFound` / `MemberNotFound` 子类由 task-02 决定
> （errors.py 是共享文件，超出本任务 `allowed_paths`）。task-02 至少要保证 service
> 层抛出 `AppError(code="HTTP_404_USER_NOT_FOUND", http_status=404)` 等价语义——
> 可以是 `raise AppError` 子类、或 `raise HTTPException(404, ...)`。本 router 文件
> 不直接 raise 这些错误，全部从 service 层冒泡给全局 `register_exception_handlers`。

### 6. 不在本任务做的事

- 不实现 service 层业务逻辑（task-02）
- 不定义 Pydantic schema（task-01）
- 不挂载 router 到 app（task-04）
- 不写测试（task-05）
- 不修改 `errors.py` / `auth_deps.py` / `router.py`（共享文件，超 `allowed_paths`）

## 接口定义

### 端点 1：GET `/`（列出成员）

```python
@router.get("", response_model=WorkspaceMemberListResponse)
async def list_members(
    workspace_id: Annotated[uuid.UUID, Path(...)],
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_READ))],
) -> WorkspaceMemberListResponse:
    return await MembersService.list_members(
        session, workspace_id=workspace_id, current_user_id=user.id
    )
```

- 权限：`WORKSPACE_READ`（任何 ws 成员可读，FR-01 第一/二块）
- 非 ws 成员：`require_permission` 闭包内 `has_permission(...) == False` → 403
- ws_id 不存在：service 层先 `get(Workspace, workspace_id)`，None → 404
  `HTTP_404_WORKSPACE_NOT_FOUND`
- 响应：`{"items": [WorkspaceMemberView, ...]}`，`is_current_user` 由
  `user.id == member.user_id` 计算（service 层传 `current_user_id`）

### 端点 2：GET `/search`（模糊搜索用户）

```python
@router.get("/search", response_model=UserSearchResponse)
async def search_users(
    workspace_id: Annotated[uuid.UUID, Path(...)],
    q: Annotated[str, Query(min_length=2, max_length=100, description="email or display_name fragment")],
    limit: Annotated[int, Query(ge=1, le=50)] = 10,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_MEMBER_MANAGE))],
) -> UserSearchResponse:
    return await MembersService.search_users(
        session, workspace_id=workspace_id, q=q, limit=limit
    )
```

- 权限：`WORKSPACE_MEMBER_MANAGE`（搜索会暴露其他用户 email，限 owner/admin）
- `q` 长度 < 2：FastAPI Query 校验 → 422 `validation_error`（自动）
- `q` 长度 > 100：同上 422
- `limit > 50`：同上 422
- service 层 SQL：`WHERE (email ILIKE :q OR display_name ILIKE :q) AND status='active'
  AND user_id NOT IN (SELECT user_id FROM user_workspace_role WHERE workspace_id=:ws)`
- 响应：`{"items": [UserSearchHit, ...]}`，`is_member` 通常为 False

### 端点 3：POST `/`（添加 / 幂等更新成员）

```python
@router.post("", response_model=WorkspaceMemberView)
async def add_member(
    workspace_id: Annotated[uuid.UUID, Path(...)],
    payload: WorkspaceMemberAddRequest,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_MEMBER_MANAGE))],
) -> WorkspaceMemberView:
    view, created = await MembersService.add_or_update_member(
        session, workspace_id=workspace_id, payload=payload, granted_by=user.id
    )
    # 201 新建 / 200 幂等更新：用 Response 对象显式设置状态码
    ...
```

**关于 201 vs 200 同一 response_model**：FastAPI 装饰器只能指定单一 `status_code`。
两种实现方案（任选其一）：

- **方案 A（推荐）**：装饰器写 `status_code=status.HTTP_201_CREATED`，service 返回
  `(view, created)`；若 `created=False`，在端点内通过 `from fastapi import Response`
  注入 `response: Response` 参数并 `response.status_code = status.HTTP_200_OK` 覆盖。
- **方案 B**：装饰器写 `status_code=200`，永远返 200；放弃 201 区分新建。FR-03 第二块
  只要求"幂等不报错"，未硬性要求 201。**design §5.1 表格写 "201/200 幂等"，方案 A 更贴
  近文档**，本任务推荐方案 A。

- 权限：`WORKSPACE_MEMBER_MANAGE`
- body：`{"user_id": uuid, "role_key": "workspace_owner|developer|viewer"}`
  （`role_key` 由 Pydantic Literal 限制，非法值 422 而非 400——但 FR-03 第三块要求
  `platform_admin` → 400 `invalid_role_key`。`platform_admin` 是有效字符串但非白名单，
  Pydantic Literal 不会拦它（Literal 限定三选一，platform_admin 不在内 → 422）。
  **本任务约定**：`WorkspaceMemberAddRequest.role_key` 用宽 `str` 类型（task-01 决定），
  service 层再做白名单校验返 400。**task-01 须按此设计**——见 task-01 实现要求文档）
- user_id 不存在：service 层 404 `HTTP_404_USER_NOT_FOUND`
- 已是成员：service 层 UPDATE role_id，返 `(view, created=False)` → 200

### 端点 4：PATCH `/{user_id}`（修改成员角色）

```python
@router.patch("/{user_id}", response_model=WorkspaceMemberView)
async def update_member_role(
    workspace_id: Annotated[uuid.UUID, Path(...)],
    user_id: Annotated[uuid.UUID, Path(...)],
    payload: WorkspaceMemberUpdateRequest,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_MEMBER_MANAGE))],
) -> WorkspaceMemberView:
    return await MembersService.update_member_role(
        session, workspace_id=workspace_id, user_id=user_id, payload=payload
    )
```

- 权限：`WORKSPACE_MEMBER_MANAGE`
- body：`{"role_key": "workspace_owner|developer|viewer"}`
- user_id 不在 ws：service 层 404 `HTTP_404_MEMBER_NOT_FOUND`
- 降级最后 owner（owner→developer 且 ws 只剩 1 个 owner）：service 层 400
  `cannot_remove_last_owner`
- role_key 非白名单：service 层 400 `invalid_role_key`

### 端点 5：DELETE `/{user_id}`（移除成员）

```python
@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_member(
    workspace_id: Annotated[uuid.UUID, Path(...)],
    user_id: Annotated[uuid.UUID, Path(...)],
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_MEMBER_MANAGE))],
) -> None:
    await MembersService.remove_member(
        session, workspace_id=workspace_id, user_id=user_id
    )
    return None
```

- 权限：`WORKSPACE_MEMBER_MANAGE`
- 成功：204 No Content（无 body）
- 移除最后 owner：service 层 400 `cannot_remove_last_owner`
- user_id 不在 ws（误删）：service 层 404 `HTTP_404_MEMBER_NOT_FOUND`（FR-05 第四块
  约定取 404 而非幂等 204，以暴露问题）
- ws_id 不存在：service 层 404 `HTTP_404_WORKSPACE_NOT_FOUND`

### 端点 6：POST `/{user_id}/transfer-ownership`（传递所有权）

```python
@router.post("/{user_id}/transfer-ownership")
async def transfer_ownership(
    workspace_id: Annotated[uuid.UUID, Path(...)],
    user_id: Annotated[uuid.UUID, Path(...)],
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_MEMBER_MANAGE))],
) -> dict:
    return await MembersService.transfer_ownership(
        session,
        workspace_id=workspace_id,
        target_user_id=user_id,
        current_user_id=user.id,
    )
```

- 权限：`WORKSPACE_MEMBER_MANAGE`（必须当前调用者本身是 ws 的 owner 才有意义；
  service 层应校验 `current_user` 是 owner，否则 400 `transfer_caller_not_owner`
  或 403——本任务取 400，因 `WORKSPACE_MEMBER_MANAGE` 已通过但语义不合法）
- 成功：200 + `{"new_owner": "<target_user_id>", "demoted": "<current_user_id>"}`
  （FR-06 第一块）
- target 不在 ws：service 层 400 `transfer_target_not_member` 或 404
- 并发两次 transfer：service 层单事务（`async with session.begin():`）+ SELECT FOR UPDATE
  owner 行 → 最多一次成功，另一次 409 `HTTP_409_TRANSFER_CONFLICT` 或 400
- 响应 model 不强约束（`dict` 即可，task-01 可选加 `TransferOwnershipResponse` schema）

## 边界处理（共 10 条）

1. **workspace_id 不存在**：所有 6 个端点在 service 层入口先校验 ws 存在性，
   `session.get(Workspace, workspace_id) is None` → 404 `HTTP_404_WORKSPACE_NOT_FOUND`。
   **注意**：`require_permission` 依赖本身不校验 ws 存在性——它只校验权限矩阵；service
   层必须显式 get 校验。
2. **`q` 太短（< 2 字符）**：FastAPI Query(min_length=2) 自动 422 `validation_error`，
   service 层不会被调到。task-05 测试 `q="a"` 应断言 422。
3. **`q` 太长（> 100 字符）**：同上 Query(max_length=100) 自动 422。
4. **`limit > 50`**：Query(le=50) 自动 422。
5. **POST/PATCH body `role_key = "platform_admin"`**：service 层白名单
   `{workspace_owner, developer, viewer}` 不含 platform_admin → 400 `invalid_role_key`。
   （Pydantic 层若 task-01 用 Literal，platform_admin 会先 422——本任务期望 task-01 用
   宽 str + service 白名单，让 400 路径可测；与 task-01 协调。）
6. **POST `user_id` 不存在（不在 users 表）**：service 层 `get(User, payload.user_id)
   is None` → 404 `HTTP_404_USER_NOT_FOUND`。
7. **DELETE/PATCH `user_id` 不在该 ws**：service 层 SELECT UserWorkspaceRole WHERE
   (user_id, workspace_id) 不存在 → 404 `HTTP_404_MEMBER_NOT_FOUND`。
8. **移除/降级最后一个 workspace_owner**：service 层在事务内 `SELECT COUNT(*) FROM
   user_workspace_role JOIN roles ON ... WHERE workspace_id=:ws AND role.key=
   'workspace_owner'` == 1 且本次会破坏 → 400 `cannot_remove_last_owner`。
9. **非 ws 成员访问任意端点**：`require_permission(...)` 依赖内 `has_permission(...)
   == False` → 403 `HTTP_403_PERMISSION_DENIED`（自动，全局 handler 渲染）。
   - **list 端点的特殊性**：list 只需 `WORKSPACE_READ`，所以 developer/viewer 可读；
     但完全不是 ws 成员的用户（无 UserWorkspaceRole 行）无 `WORKSPACE_READ` → 403。
10. **transfer 并发**：service 层 `async with session.begin():` + SELECT ... FOR UPDATE
    锁 owner 行，两次并发 transfer 中第二次拿不到锁或检测到当前调用者已不是 owner →
    409 `HTTP_409_TRANSFER_CONFLICT`（或 400 `transfer_caller_not_owner`）。
11. **viewer 调写端点**（FR-02/03/04/06 的"viewer 调用 → 403"块）：写端点用
    `WORKSPACE_MEMBER_MANAGE`，viewer 没有该权限 → 403。
12. **transfer 调用者本身非 owner**：service 层校验 `current_user` 当前是
    `workspace_owner`，否则 400 `transfer_caller_not_owner`（虽 caller 有 member:manage
    权限——理论上只有 owner 有——此为防御性检查）。

## 非目标

- **不做 pagination**：list 端点不接 `offset/limit`，全部返回（YAGNI，design §3）。
- **不做审计日志**：不在审计表写"谁加了谁"，`granted_by` 字段只填到 UserWorkspaceRole。
- **不做邮件通知**：加成员后不发邮件（design §3 明确）。
- **不做批量操作**：一次只加/删一个（design §3）。
- **不做自定义角色**：白名单固定 3 个（design §3）。
- **不在 router 内写业务逻辑**：全部委托 service 层。
- **不修改 `errors.py` / `auth_deps.py`**：共享文件超 `allowed_paths`；如需新增
  AppError 子类（UserNotFound/MemberNotFound），由 task-02 在 service 模块内本地定义
  或在 task-02 的 allowed_paths 内修改 errors.py。

## 参考

### 现有 router 风格（`backend/app/modules/workspace/router.py`）

- `from app.core.auth_deps import require_permission, require_permission_any`
- `from app.core.db import get_session`
- `from app.modules.auth.model import User`
- `from app.modules.auth.permissions import Permission`
- `SessionDep = Annotated[AsyncSession, Depends(get_session)]`
- 端点签名 `user: Annotated[User, Depends(require_permission_any(...))]` 或
  `_user: Annotated[User, Depends(...)]`（用 `_user` 表示"依赖只做权限校验，函数体
  不用 user"）。本任务 6 个端点：list/search 用 `_user`，add/transfer 用 `user`
  （需要 user.id 做 granted_by / current_user_id），PATCH/DELETE 用 `_user`。

### 错误响应序列化（`backend/app/core/errors.py`）

- 全局 `register_exception_handlers` 已注册 AppError / HTTPException / RequestValidationError
  → `{code, message, request_id, details}` 统一 shape
- `PermissionDenied` AppError → 403 + `code="HTTP_403_PERMISSION_DENIED"`
- 404/400 由 service 层抛 AppError 子类（task-02 负责）
- 422 由 FastAPI RequestValidationError handler 自动渲染

### 权限矩阵（`backend/app/modules/auth/permissions.py` + seed migration）

- `Permission.WORKSPACE_READ = "workspace:read"`：workspace_owner / developer /
  reviewer / qa / component_lead / viewer / platform_admin 都有
- `Permission.WORKSPACE_MEMBER_MANAGE = "workspace:member:manage"`：仅
  workspace_owner + platform_admin（platform_admin 通过 `user.is_platform_admin`
  bypass，rbac.py:54-61）

### 挂载约定（task-04 执行）

- `app.include_router(members_router, prefix="/api")` —— router 自身 prefix
  `/workspaces/{workspace_id}/members`，拼出最终 `/api/workspaces/{workspace_id}/members`
- **不需要 `dependencies=[Depends(require_permission(...))]` 装饰 router**：每个端点
  各自声明依赖，更灵活（list 用 READ，其他用 MEMBER_MANAGE）

## TDD 步骤（task-05 全覆盖，本任务不写测试）

本任务交付的 router 必须满足 task-05 ≥15 用例的所有断言点。task-05 测试矩阵预期：

| 测试块 | 端点 | 关键断言 |
|--------|------|----------|
| FR-01 list | GET `/` | 200 + items 长度 / 403 非成员 / 404 ws 不存在 |
| FR-02 search | GET `/search?q=...` | 200 + 排除成员 / 422 q 太短 / 422 limit>50 / 403 viewer |
| FR-03 add | POST `/` | 201 新建 / 200 幂等 / 400 platform_admin / 404 user_id 不存在 / 403 viewer |
| FR-04 update | PATCH `/{user_id}` | 200 / 400 最后 owner 降级 / 404 user 不在 ws / 403 viewer |
| FR-05 remove | DELETE `/{user_id}` | 204 / 400 最后 owner / 404 user 不在 ws / 403 viewer |
| FR-06 transfer | POST `/{user_id}/transfer-ownership` | 200 单事务互换角色 / 400 调用者非 owner / 403 developer 调用 |

本任务实现完成后，task-04 挂载 router，task-05 编写上述测试用例，全部应通过。

## 验收标准

| AC | 描述 | 验证方式 |
|---|------|----------|
| AC-1 | `members_router.py` 可被 Python import：`from app.modules.workspace.members_router import router`，无 ImportError / NameError | `python -c "from app.modules.workspace.members_router import router; print(router.prefix)"` |
| AC-2 | router.prefix == `/workspaces/{workspace_id}/members`，含 `{workspace_id}` Path 参数 | 同上 print 检查 |
| AC-3 | router.routes 含 6 个端点：GET `/` / GET `/search` / POST `/` / PATCH `/{user_id}` / DELETE `/{user_id}` / POST `/{user_id}/transfer-ownership` | `[ (r.methods, r.path) for r in router.routes ]` 检查 |
| AC-4 | 6 个端点的依赖含 `require_permission(Permission.WORKSPACE_READ)` 或 `require_permission(Permission.WORKSPACE_MEMBER_MANAGE)`，符合 §实现要求 表格 | 检查源码 |
| AC-5 | list 端点用 `WORKSPACE_READ`（FR-01 第二块：developer/viewer 可读），其余 5 个端点用 `WORKSPACE_MEMBER_MANAGE` | 检查源码 |
| AC-6 | search 端点的 `q` 用 `Query(min_length=2, max_length=100)`，`limit` 用 `Query(ge=1, le=50)`，默认 `limit=10` | 检查源码 + FastAPI OpenAPI schema |
| AC-7 | DELETE 端点 `status_code=204`，返回 `None`；POST 端点用 Response.status_code 覆盖实现 201/200 区分 | 检查源码 |
| AC-8 | task-04 挂载后，启动 backend `uv run uvicorn app.main:app`，访问 `/docs` Swagger UI 可见 6 个新端点，全部带 🔒 标志 | 手动 |
| AC-9 | 错误码符合 design §7：400 `invalid_role_key` / 400 `cannot_remove_last_owner` / 403 `HTTP_403_PERMISSION_DENIED` / 404 `HTTP_404_WORKSPACE_NOT_FOUND` / 404 `HTTP_404_USER_NOT_FOUND`（具体 code 字符串由 task-02 在 service 层决定，本 router 不直接 raise） | task-05 测试覆盖 |
| AC-10 | 文件未修改 `allowed_paths` 之外任何文件（仅 `members_router.py`） | `git diff --name-only` 检查 |
