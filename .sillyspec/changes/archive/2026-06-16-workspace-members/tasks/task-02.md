---
id: task-02
title: "backend/app/modules/workspace/members_service.py 业务逻辑：list_members / search_users_for_invite / add_or_update_member / update_member_role / remove_member / transfer_ownership；包含白名单校验、最后 owner 保护、单事务 transfer"
priority: P0
estimated_hours: 3
depends_on: [task-01]
blocks: [task-03, task-05]
allowed_paths:
  - backend/app/modules/workspace/members_service.py
---

# task-02 — members_service.py 业务逻辑

> 本任务负责实现成员管理的 6 个服务层 helper。所有 HTTP 翻译由 task-03 router 完成；本文件只暴露纯 `async def(session, ...) -> ...` 函数，便于单测和复用。无 schema 变更，全部基于 `UserWorkspaceRole` + `Role` + `User` 现有模型。

## 修改文件

| 操作 | 路径 | 说明 |
|---|---|---|
| 新增 | `backend/app/modules/workspace/members_service.py` | 6 个 async helper + 1 个模块级常量 `ROLE_KEY_WHITELIST` |

不修改任何现有文件。`schema.py` 中的 `WorkspaceMemberView` 等 Pydantic 类由 task-01 提供，本任务**导入使用**即可。

## 实现要求

1. **必须**是模块级 `async def`（不放进 class，参考 `auth/rbac.py` 而非 `workspace/service.py` 的 `WorkspaceService` class——保持成员函数无状态、易测试）。
2. **必须**定义模块级常量：
   ```python
   ROLE_KEY_WHITELIST = frozenset({"workspace_owner", "developer", "viewer"})
   ```
   用于 `add_or_update_member` / `update_member_role` 的入参校验。`platform_admin` / `reviewer` / `qa` / `component_lead` 不在白名单（禁止通过该 API 授予）。
3. **必须**用以下三类异常表达业务错误（task-03 翻译为 HTTP）：
   - `ValueError("invalid_role_key")` — `role_key` 不在 `ROLE_KEY_WHITELIST`。
   - `ValueError("cannot_remove_last_owner")` — `remove_member` 或 `transfer_ownership` 或 `update_member_role` 会导致该 ws 失去最后一个 `workspace_owner`。
   - `LookupError("user_not_found")` — `add_or_update_member` 时 `user_id` 在 `users` 表不存在或 `status != 'active'`。
   - 同时复用 `app.core.errors.WorkspaceNotFound`（来自 `workspace/service.py` 同款）：`list_members` / `search_users_for_invite` 入口先校验 ws 存在，否则 raise。
4. **必须**用 `sqlalchemy.ext.asyncio.AsyncSession` + `sqlmodel.col` + `sqlalchemy.select` 风格（参考 `workspace/service.py` 的 `_find_active_by_root_path` / `rbac.py` 的 `collect_permissions`）。**不**用原生 SQL 字符串。
5. **必须**所有 mutation（add/update/remove/transfer）显式 `await session.commit()`；只读函数（list/search）不 commit。
6. **必须** `transfer_ownership` 是单事务原子：先在同一 session 内 `SELECT FOR UPDATE` 锁住该 ws 所有 `workspace_owner` 行（用 `with_for_update()`），再连续两行 `UPDATE`（旧 owner→developer；新 owner→workspace_owner），最后单次 commit。失败抛 `await session.rollback()` 后 re-raise。
7. **必须**导入 task-01 定义的 4 个 schema 类（`WorkspaceMemberView`, `UserSearchHit`）作为返回类型注解；如果 task-01 还没合并，先用 `from __future__ import annotations` + 字符串注解，**不**在运行时引用。
8. **不要**实现邮件通知、审计日志、cache、pagination——明确非目标（见下）。
9. **必须** `from __future__ import annotations` 作为第一行非 docstring 代码（与 `auth/model.py` / `auth/rbac.py` 一致）。
10. **必须**所有 `datetime.now()` 调用使用 `datetime.now(UTC)`（与 `workspace/service.py` 一致），保证 `granted_at` 时区一致。

## 接口定义

> 文件顶部 docstring 说明用途，然后是 `ROLE_KEY_WHITELIST` 常量，然后 6 个函数。完整签名如下。

### 常量

```python
ROLE_KEY_WHITELIST: frozenset[str] = frozenset({"workspace_owner", "developer", "viewer"})
```

### 1) `list_members`

```python
async def list_members(
    session: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    current_user_id: uuid.UUID | None = None,
) -> list[WorkspaceMemberView]:
    """List every (user, role) row in this workspace, joined to users + roles.

    Raises:
        WorkspaceNotFound: ws_id 不存在或已软删（复用 WorkspaceService.get 校验，
            或直接 select Workspace where deleted_at IS NULL）。
    """
```

伪代码 SQL（Postgres 方言，实际用 SQLAlchemy ORM 表达）：

```sql
SELECT u.id, u.email, u.display_name, r.key, r.name, uwr.granted_at
FROM user_workspace_roles uwr
JOIN users u          ON u.id = uwr.user_id
JOIN roles  r         ON r.id = uwr.role_id
WHERE uwr.workspace_id = :ws_id
  AND u.status = 'active'
ORDER BY uwr.granted_at ASC;
```

`is_current_user = (u.id == current_user_id)` 在 Python 层计算（不在 SQL 里）。

### 2) `search_users_for_invite`

```python
async def search_users_for_invite(
    session: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    q: str,
    limit: int = 10,
) -> list[UserSearchHit]:
    """Fuzzy search active users by display_name OR email, excluding those
    who are already members of this workspace.

    Args:
        q: 已由 router 层校验 min_length=2；本函数额外做空串 fallback（见边界）。
        limit: 默认 10，上限 50（router 层 Query(le=50)）。

    Raises:
        WorkspaceNotFound: ws_id 不存在。
    """
```

伪代码 SQL（LEFT JOIN 排除已成员）：

```sql
SELECT u.id, u.email, u.display_name
FROM users u
LEFT JOIN user_workspace_roles m
       ON m.user_id = u.id
      AND m.workspace_id = :ws_id
WHERE u.status = 'active'
  AND (u.email ILIKE :pattern OR u.display_name ILIKE :pattern)
  AND m.user_id IS NULL   -- 排除已是该 ws 成员的
ORDER BY u.email ASC
LIMIT :limit;
```

`pattern = f"%{q}%"`；`is_member` 字段在 Python 层固定为 `False`（搜索结果本身就是非成员）。

### 3) `add_or_update_member`

```python
async def add_or_update_member(
    session: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    role_key: str,
    granted_by: uuid.UUID | None,
) -> UserWorkspaceRole:
    """Idempotent upsert: 已成员则改 role_key，否则插入新行。

    Raises:
        ValueError("invalid_role_key"): role_key 不在 ROLE_KEY_WHITELIST。
        LookupError("user_not_found"): user_id 不存在或 status != 'active'。
        WorkspaceNotFound: ws_id 不存在。
    """
```

伪代码：

```text
1. assert role_key in ROLE_KEY_WHITELIST else raise ValueError("invalid_role_key")
2. user = SELECT User WHERE id=:user_id AND status='active'; if None raise LookupError("user_not_found")
3. role = SELECT Role WHERE key=:role_key LIMIT 1;  # 白名单保证存在
4. existing = SELECT UserWorkspaceRole WHERE user_id+workspace_id LIMIT 1
5. if existing:
       existing.role_id = role.id
       existing.granted_at = now(UTC)
       existing.granted_by = granted_by
   else:
       existing = UserWorkspaceRole(user_id, workspace_id, role.id, granted_by, now(UTC))
       session.add(existing)
6. await session.commit(); await session.refresh(existing)
7. return existing
```

### 4) `update_member_role`

```python
async def update_member_role(
    session: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    role_key: str,
) -> UserWorkspaceRole:
    """Change an existing member's role. Reject if it would leave the
    workspace with zero workspace_owner rows.

    Raises:
        ValueError("invalid_role_key"): role_key 不在白名单。
        ValueError("cannot_remove_last_owner"): 当前 user 是最后一个 owner，
            且 new role != 'workspace_owner'。
        LookupError("user_not_found"): user 不是该 ws 的成员（没有 row 可 update）。
        WorkspaceNotFound: ws_id 不存在。
    """
```

伪代码：

```text
1. assert role_key in ROLE_KEY_WHITELIST else raise ValueError("invalid_role_key")
2. existing = SELECT UserWorkspaceRole WHERE (user_id, workspace_id) LIMIT 1
   if existing is None: raise LookupError("user_not_found")
3. new_role = SELECT Role WHERE key=:role_key
4. if existing.role.key == 'workspace_owner' and role_key != 'workspace_owner':
       owner_count = SELECT COUNT(*) FROM user_workspace_roles
                     JOIN roles ON roles.id=uwr.role_id
                     WHERE workspace_id=:ws_id AND roles.key='workspace_owner'
       if owner_count <= 1: raise ValueError("cannot_remove_last_owner")
5. existing.role_id = new_role.id; existing.granted_at = now(UTC)
6. await session.commit(); await session.refresh(existing); return existing
```

### 5) `remove_member`

```python
async def remove_member(
    session: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
) -> None:
    """Delete the (user_id, workspace_id, *) rows for this member.
    Refuses if that user is the last workspace_owner.

    Raises:
        ValueError("cannot_remove_last_owner").
        LookupError("user_not_found"): 该 user 不是 ws 成员。
        WorkspaceNotFound: ws_id 不存在。
    """
```

伪代码：

```text
1. existing_rows = SELECT UserWorkspaceRole WHERE (user_id, workspace_id)  -- 可能多行（一用户多角色）
   if not existing_rows: raise LookupError("user_not_found")
2. has_owner_role = any(r.role.key == 'workspace_owner' for r in existing_rows)
3. if has_owner_role:
       owner_count = SELECT COUNT(*) ... WHERE roles.key='workspace_owner' AND ws_id=...
       if owner_count <= 1: raise ValueError("cannot_remove_last_owner")
4. for r in existing_rows: await session.delete(r)
5. await session.commit()
```

> 注：`UserWorkspaceRole` 复合主键含 `role_id`，所以一个 (user, ws) 可能有多行（developer + reviewer 同时持有）。本函数删除该 (user, ws) 的**全部**行。

### 6) `transfer_ownership`

```python
async def transfer_ownership(
    session: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    target_user_id: uuid.UUID,
    current_user_id: uuid.UUID,
) -> None:
    """Atomically: target -> workspace_owner, current -> developer.
    Single transaction. Locks all owner rows of this ws via SELECT FOR UPDATE
    to prevent concurrent transfer leaving the ws ownerless or double-owner.

    Raises:
        LookupError("user_not_found"): target_user_id 不是该 ws 成员，
            或 status != 'active'。
        ValueError("cannot_remove_last_owner"): 理论上不会触发（current_user 升级
            target 为 owner 再降级自己，不变量保持）；保留防御性校验。
        WorkspaceNotFound: ws_id 不存在。
    """
```

伪代码（**核心：单事务 + FOR UPDATE 锁**）：

```text
1. target = SELECT UserWorkspaceRole WHERE (target_user_id, workspace_id) LIMIT 1
   if target is None: raise LookupError("user_not_found")
2. owner_role = SELECT Role WHERE key='workspace_owner'
   developer_role = SELECT Role WHERE key='developer'
3. async with session.begin():   # 开启/加入事务；退出时自动 commit/rollback
       # 锁住所有 owner 行，防止并发 transfer
       owner_rows = (
           SELECT UserWorkspaceRole
           JOIN roles ON roles.id=uwr.role_id
           WHERE roles.key='workspace_owner' AND workspace_id=:ws_id
           FOR UPDATE
       )
       if not owner_rows:
           raise ValueError("cannot_remove_last_owner")  # 防御

       # 第 1 行 UPDATE：target 升 owner
       target.role_id = owner_role.id
       target.granted_at = now(UTC)
       await session.flush()

       # 第 2 行 UPDATE：current 降 developer（如果它原本是 owner）
       current_rows = SELECT UserWorkspaceRole WHERE (current_user_id, workspace_id)
       for r in current_rows:
           if r.role_id == owner_role.id:
               r.role_id = developer_role.id
               r.granted_at = now(UTC)
       await session.flush()
# 退出 with 块 -> commit
```

> 关键：必须在同一 `session.begin()` 上下文里完成「锁 → 改 target → 改 current → flush」；任何步骤抛错都会 rollback，旧 owner 关系保留。

## 边界处理

| # | 场景 | 处理 |
|---|------|------|
| 1 | `search_users_for_invite` 收到 `q=None` 或空串 `""` | 直接返回 `[]`（不报错；router 层用 Query(min_length=2) 提前挡，但 service 兜底防御） |
| 2 | `search_users_for_invite` 收到 `q="  "`（纯空格） | `.strip()` 后按空串处理，返回 `[]` |
| 3 | `add_or_update_member` 的 `user_id` 在 `users` 表不存在 | raise `LookupError("user_not_found")` |
| 4 | `add_or_update_member` 的 `user_id` 存在但 `status='disabled'` 或 `'deleted'` | 同样 raise `LookupError("user_not_found")`（disabled 用户不应被加入 ws） |
| 5 | `add_or_update_member` 的 `user_id` 已是该 ws 成员 | 走 update 分支：只改 `role_id` + `granted_at` + `granted_by`，不重复 INSERT，不报错（幂等） |
| 6 | `role_key` 不在 `ROLE_KEY_WHITELIST`（如 `platform_admin` / `qa` / 笔误） | raise `ValueError("invalid_role_key")`；不查 DB 直接拒 |
| 7 | `remove_member` 目标是最后一个 `workspace_owner` | raise `ValueError("cannot_remove_last_owner")`；事务回滚不删任何行 |
| 8 | `update_member_role` 把最后一个 owner 降级为 developer/viewer | 同上，raise `ValueError("cannot_remove_last_owner")` |
| 9 | `transfer_ownership` 两个并发请求同时执行 | `SELECT ... FOR UPDATE` 串行化；第二个请求拿到锁后看到 target 已是 owner，current 已是 developer，操作幂等无副作用 |
| 10 | `list_members` / `search_users_for_invite` 时 `User.display_name IS NULL` | 返回值 `display_name=None`（Pydantic schema 允许 `str \| None`）；前端展示 fallback 到 email local-part |
| 11 | `search_users_for_invite` 时用户 `status != 'active'`（disabled/deleted） | SQL WHERE 已过滤，不返回 |
| 12 | `granted_at` 时区 | 全部用 `datetime.now(UTC)`（不要用 `datetime.utcnow()` 已 deprecated）；schema 用 `datetime` 不带 tz 假设，前端按 ISO 8601 with offset 渲染 |
| 13 | `transfer_ownership` 的 `current_user_id` 不是该 ws 成员 | 不报错（current_rows 为空，for 循环空跑）；只升 target 为 owner。这种场景正常路径不该出现（router 层用户必有 member:manage 权限），但 service 不强假设 |
| 14 | `transfer_ownership` 的 `target_user_id == current_user_id` | 同上自然幂等：target 升 owner，current 空集，无副作用。不报错 |
| 15 | `add_or_update_member` 时 `Role` 表里没有 `workspace_owner`（极端：DB 未 seed） | role 查询返回 None；raise `LookupError("role_not_seeded")`（防御性，正常 migration 已 seed 7 个角色，正常路径不触发） |

## 非目标

本任务**不做**以下事项（避免范围蔓延）：

1. **不做**邮件通知：加成员后不发邮件给被加用户（design §3 明确非目标）。
2. **不做**审计日志：不写 `audit_events` 表（V1 不存在该表，task-Auth-v2 再做）。
3. **不做**结果缓存：list/search 每次都查 DB（YAGNI；workspace 成员 < 100）。
4. **不做**pagination：`list_members` 一次返回全部；`search_users_for_invite` 只做 `limit` 截断（design §10 R-03）。
5. **不做**HTTP 错误码翻译：异常类型由 task-03 router 翻译成 400/404/403。
6. **不做**自定义角色：只用白名单 3 个 key；`platform_admin` / `reviewer` / `qa` / `component_lead` 不通过本 API 授予。
7. **不做**workspace 创建/删除/软删：复用现有 `WorkspaceService`。
8. **不做**`Permission.WORKSPACE_MEMBER_MANAGE` 权限校验：那是 router 依赖层（`require_permission_any`）的职责，service 假设调用方已有权限。
9. **不做**platform_admin bypass 逻辑：service 只看数据，不看 user.is_platform_admin（router 依赖已经 bypass）。

## 参考

### 现有代码风格

- **`backend/app/modules/auth/rbac.py`**：模块级 `async def collect_permissions(session, *, user_id, workspace_id) -> set[str]` 是本任务最佳模板——纯函数、`AsyncSession` 注入、`sqlalchemy.select` + `sqlmodel.col` + `JOIN` 链。
- **`backend/app/modules/workspace/service.py`**：`WorkspaceService._find_active_by_root_path` / `_find_active_by_slug` 是「select + where + limit + scalars().first()」的标准 pattern；`update()` 方法展示了 `setattr` + `commit()` + `refresh()` 的 mutation 流程。
- **`backend/app/modules/auth/service.py:bootstrap_admin_and_seed_rbac`**（L220-326）：seed workspace_owner 角色的参考。它展示了：
  - `select(Role).where(col(Role.key) == "workspace_owner")` 查 role
  - `UserWorkspaceRole(user_id=..., workspace_id=..., role_id=..., granted_by=None, granted_at=_utc_now())` 构造 row
  - `db.add(...)` + `await db.commit()`
  - **注意**：本任务不能直接复用 `_utc_now()`（auth 模块私有），用 `datetime.now(UTC)` 等价。

### 数据模型（来自 `auth/model.py`）

- `User`：`id`、`email`、`display_name`、`status`（`'active'` / `'disabled'` / `'deleted'`）、`is_platform_admin`。
- `Role`：`id`、`key`（unique，e.g. `'workspace_owner'`）、`name`、`is_system`。
- `UserWorkspaceRole`：复合主键 `(user_id, workspace_id, role_id)`，加 `granted_by` + `granted_at`。**一个 (user, ws) 可有多行**（同时持有多个 role）。

### 错误类（来自 `app/core/errors.py`）

- `WorkspaceNotFound(AppError)`：ws_id 不存在或软删。直接 `from app.core.errors import WorkspaceNotFound` 复用。
- 本任务的 `ValueError` / `LookupError` 是 Python 内置异常，task-03 router 用 `try/except` 捕获并翻译为 HTTP 400/404。

### 权限（来自 `auth/permissions.py`）

- 本 service **不直接引用** `Permission`；router 层用 `Permission.WORKSPACE_MEMBER_MANAGE` 做权限门。本文件只看 `Role.key` 是否在 `ROLE_KEY_WHITELIST`。

## TDD 步骤

> 完整业务规则测试由 **task-05** 覆盖（`backend/tests/modules/workspace/test_members_router.py` ≥15 用例）。本任务的最小自测要求：

1. **import 通过**：写完 `members_service.py` 后，在 backend 容器内执行：
   ```bash
   cd backend && uv run python -c "from app.modules.workspace.members_service import (
       ROLE_KEY_WHITELIST,
       list_members,
       search_users_for_invite,
       add_or_update_member,
       update_member_role,
       remove_member,
       transfer_ownership,
   ); print('OK', len(ROLE_KEY_WHITELIST))"
   ```
   预期输出：`OK 3`。如果 ImportError，检查 task-01 schema 是否已合并；如果未合并，临时把返回类型注解改成字符串或注释掉，确保 import 不依赖未完成任务。

2. **白名单单测**（最小冒烟，可选）：
   ```python
   # backend/tests/modules/workspace/test_members_service_smoke.py
   from app.modules.workspace.members_service import ROLE_KEY_WHITELIST

   def test_whitelist_contents():
       assert ROLE_KEY_WHITELIST == frozenset({"workspace_owner", "developer", "viewer"})
       assert "platform_admin" not in ROLE_KEY_WHITELIST
       assert "reviewer" not in ROLE_KEY_WHITELIST
   ```
   `uv run pytest backend/tests/modules/workspace/test_members_service_smoke.py -v`。

3. **手测 happy path**（在 Docker backend 内用 `uv run python` REPL）：
   ```python
   import asyncio, uuid
   from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
   from app.core.config import get_settings
   from app.modules.workspace.members_service import (
       list_members, add_or_update_member, transfer_ownership,
   )

   async def main():
       settings = get_settings()
       engine = create_async_engine(settings.database_url_async)
       Session = async_sessionmaker(engine, expire_on_commit=False)
       async with Session() as s:
           # 替换为真实 ws_id / user_id（从 DB 查）
           ws_id = uuid.UUID("...")
           admin_id = uuid.UUID("...")
           other_id = uuid.UUID("...")
           members = await list_members(s, workspace_id=ws_id, current_user_id=admin_id)
           print("before:", [(m.email, m.role_key) for m in members])
           await add_or_update_member(s, workspace_id=ws_id, user_id=other_id,
                                       role_key="developer", granted_by=admin_id)
           await transfer_ownership(s, workspace_id=ws_id,
                                     target_user_id=other_id, current_user_id=admin_id)
           members = await list_members(s, workspace_id=ws_id, current_user_id=admin_id)
           print("after:", [(m.email, m.role_key) for m in members])
           # 期望：other 是 workspace_owner，admin 是 developer

   asyncio.run(main())
   ```

4. **业务规则完整覆盖**留给 task-05（最后 owner 保护 / 并发 transfer / 白名单拒绝 / 用户不存在 / 幂等 add / 搜索排除成员 / 搜索过滤 disabled）。

## 验收标准

| # | 标准 | 验证方法 |
|---|------|----------|
| 1 | 文件 `backend/app/modules/workspace/members_service.py` 存在 | `ls backend/app/modules/workspace/members_service.py` |
| 2 | 6 个 helper 都能被 `from app.modules.workspace.members_service import ...` 导入 | 上面 TDD 步骤 1 的 python -c 命令 |
| 3 | `ROLE_KEY_WHITELIST` 是 `frozenset` 且包含恰好 3 项：`workspace_owner` / `developer` / `viewer` | `assert ROLE_KEY_WHITELIST == frozenset({"workspace_owner", "developer", "viewer"})` |
| 4 | `add_or_update_member(role_key="platform_admin")` raise `ValueError("invalid_role_key")` | task-05 用例 + 手测 |
| 5 | `remove_member` 最后一个 owner 时 raise `ValueError("cannot_remove_last_owner")` | task-05 用例 + 手测；事务回滚（owner 行未被删） |
| 6 | `add_or_update_member(user_id=<不存在>)` raise `LookupError("user_not_found")` | task-05 用例 + 手测 |
| 7 | `transfer_ownership` 是单事务：`async with session.begin()` 包裹 SELECT FOR UPDATE + 两行 UPDATE | 代码 review：grep `session.begin()` + `with_for_update()` |
| 8 | `transfer_ownership` 抛错时不残留中间状态（target 未升、current 未降） | task-05 并发用例 + 手动注入异常验证回滚 |
| 9 | `list_members` 返回的每一项 `is_current_user` 正确反映传入的 `current_user_id` | task-05 用例 |
| 10 | `search_users_for_invite` 的 SQL 包含 `ILIKE` + `LEFT JOIN ... IS NULL` + `status='active'` 过滤 | 代码 review；可用 `echo=True` 的 engine 打印 SQL 验证 |
| 11 | 所有 mutation 函数显式 `await session.commit()`；只读函数不 commit | 代码 review |
| 12 | 所有 `datetime.now()` 都带 `UTC`（grep 检查无裸 `datetime.now()`） | `grep -n "datetime.now()" backend/app/modules/workspace/members_service.py` 应无输出 |
| 13 | 无 lint 错误：`uv run ruff check backend/app/modules/workspace/members_service.py` 全过 | CI |
| 14 | 类型检查通过：`uv run mypy backend/app/modules/workspace/members_service.py` 无 error（如有 task-01 schema 未合并导致的 forward-ref，允许 `# type: ignore[import-not-found]` 临时标注，task-01 合并后移除） | CI |
