---
id: task-05
title: "backend/tests/modules/workspace/test_members_router.py ≥15 用例，覆盖 FR-01..06 所有 GWT；pytest 全过"
priority: P0
estimated_hours: 3
depends_on: [task-04]
blocks: [task-10]
allowed_paths:
  - backend/tests/modules/workspace/test_members_router.py
  - backend/tests/modules/workspace/__init__.py
---

# Task-05 — members_router 集成测试（≥15 用例，FR-01..06 GWT 全覆盖）

## 1. 目标

为 task-03（`members_router.py` + `members_service.py`）+ task-04（装载）的 6 个端点编写 ≥15 个 pytest 集成用例，
逐条覆盖 `requirements.md` 中 FR-01..06 的每一个 Given/When/Then 块（共 16 块 → 对应 ≥15 test，
其中 FR-06 并发场景作为加分项可合并到 transfer 串行测试或独立成 case）。

依据文档：

- `requirements.md` §FR-01..06 全部 GWT 块（共 16 块）
- `design.md` §5.1 端点定义 + §7 错误码表（invalid_role_key / cannot_remove_last_owner / user_not_found / workspace_not_found / 403）
- `design.md` §10 R-05（端到端：加 developer 后能访问 ws 资源）→ 本任务以 200 反映
- `plan.md` Wave 3 task-05：pytest 全绿 + 不回归

## 2. 修改文件

| 操作 | 文件路径 | 说明 |
|------|----------|------|
| 新增 | `backend/tests/modules/workspace/test_members_router.py` | ≥15 个 `async def test_*` 用例，使用 `httpx.AsyncClient` + `client` fixture（来自根 `backend/conftest.py`） |
| 新增 | `backend/tests/modules/workspace/__init__.py` | 空文件，与 sibling 模块（auth/agent/change）目录布局一致；pytest rootdir 收集需要 |

> 不修改 `backend/conftest.py`（已有 `db_engine` / `db_session` / `client` / `auth_admin_token` / `auth_headers` fixture）；
> 不修改任何 `app/` 代码（属于 task-03/04 范围）。

## 3. 实现要求

### 3.1 测试技术栈与基础约定

1. **全部用 `async def` + `AsyncClient`**：与现有 `backend/tests/modules/workspace/test_scan_generate.py`、
   `backend/app/modules/agent/tests/test_execution_context.py` 一致；每条用例 `@pytest.mark.asyncio`（如果 conftest 没
   `pytestmark = pytest.mark.asyncio`，则文件顶部声明 `pytestmark = pytest.mark.asyncio`）。
2. **DB 隔离**：依赖根 `conftest.py` 的 `db_engine` fixture —— 每条用例一个新 SQLite in-memory engine + 新建表。
   **不跑 alembic**：因此 Role / RolePermission 表为空，**每个用例必须自己 seed 所需的 Role 行**（参考
   `backend/app/modules/agent/tests/test_execution_context.py:95-113` 的做法）。
3. **每个用例独立 seed 一份 workspace + owner + 可选 target**：避免用例间状态泄漏；不依赖任何前序用例留下的数据。
4. **ROLE 表手动 seed**：通过 `role_seeder` fixture 一次性插入 7 个标准角色 + 关键 RolePermission 行；
   其他 fixture 按 `role_key` 取 `Role.id` 即可，无需每次新建 Role。

### 3.2 ≥15 测试用例命名与 GWT 映射

测试函数命名约定：`test_fr0X_<scenario>_<expected>`（X = FR 编号）。下表每个用例 = requirements.md 一个 GWT 块：

| # | 函数名 | FR | Given→When→Then 简述 |
|---|--------|-----|----------------------|
| 1 | `test_fr01_list_members_by_owner_returns_200` | FR-01.a | owner 调 GET `/members` → 200 + items[3]（owner/dev/viewer），每条字段齐全（user_id/email/display_name/role_key/role_name/granted_at/is_current_user） |
| 2 | `test_fr01_list_members_by_developer_returns_200` | FR-01.b | developer 调 GET `/members` → 200（list 只需 WORKSPACE_READ） |
| 3 | `test_fr01_list_members_by_non_member_returns_403` | FR-01.c | 非 ws 成员调 GET `/members` → 403 |
| 4 | `test_fr02_search_excludes_existing_members` | FR-02.a | seed alice/bob/cathy，alice 已是成员 → owner GET `/members/search?q=ali` → 200，items 不含 alice |
| 5 | `test_fr02_search_q_too_short_returns_422` | FR-02.b | q='a'（<2）→ 422（Query min_length=2 校验失败，路径层拒绝） |
| 6 | `test_fr02_search_excludes_disabled_users` | FR-02.c | 一个 status='disabled' 用户的 email 含 q → items 不含该用户 |
| 7 | `test_fr02_search_by_viewer_returns_403` | FR-02.d | viewer（无 member:manage）调 search → 403 |
| 8 | `test_fr03_add_new_member_returns_201` | FR-03.a | owner POST `{user_id: U, role_key: "developer"}` → 201，DB 新增 UserWorkspaceRole；U 后续 GET `/workspaces/{W}` 不再 403 |
| 9 | `test_fr03_add_existing_member_is_idempotent_200` | FR-03.b | U 已是 viewer，POST `{role_key: "developer"}` → 200（不报错），UserWorkspaceRole.role_id 改为 developer |
| 10 | `test_fr03_add_with_platform_admin_role_returns_400` | FR-03.c | role_key="platform_admin" → 400 `invalid_role_key` |
| 11 | `test_fr03_add_nonexistent_user_returns_404` | FR-03.d | user_id 不存在 → 404 `user_not_found` |
| 12 | `test_fr03_add_by_viewer_returns_403` | FR-03.e | viewer 调 POST → 403 |
| 13 | `test_fr04_patch_member_role_returns_200` | FR-04.a | owner PATCH `{role_key: "viewer"}` 改 developer→viewer → 200，role 已变 |
| 14 | `test_fr04_patch_last_owner_returns_400` | FR-04.b | U 是最后 owner，PATCH `{role_key: "developer"}` → 400 `cannot_remove_last_owner` |
| 15 | `test_fr04_patch_by_viewer_returns_403` | FR-04.c | viewer 调 PATCH → 403 |
| 16 | `test_fr05_delete_member_returns_204` | FR-05.a | owner DELETE 一个 developer（还有另一个 owner） → 204，UserWorkspaceRole 行已删，U 后续访问 403 |
| 17 | `test_fr05_delete_last_owner_returns_400` | FR-05.b | 删除最后一个 owner → 400 `cannot_remove_last_owner` |
| 18 | `test_fr05_delete_non_member_returns_404` | FR-05.c | U 不在 ws → 404（design.md §7 + requirements FR-05 取 404 路径） |
| 19 | `test_fr06_transfer_ownership_returns_200` | FR-06.a | owner C 调 transfer-ownership，target T 是 developer → 200，T.role→owner, C.role→developer，响应 `{new_owner: T, demoted: C}` |
| 20 | `test_fr06_transfer_by_developer_returns_403` | FR-06.c | 非 owner（developer）调 transfer → 403 |
| 21（可选） | `test_fr06_transfer_concurrent_only_one_succeeds` | FR-06.b | 用 `asyncio.gather` 并发触发两次 transfer（不同 target），断言最多一次成功；另一次 409 或 400（允许范围，仅验证不会两都降级） |

**最低 15 用例的保证**：表中标 #1-#20 共 20 个必跑用例，覆盖 FR-01..06 全部 16 个 GWT 块（其中 FR-06.b 并发是 #21 加分项）。
如果 service 层实现 R-01 单事务 SELECT FOR UPDATE 在 SQLite 无法真实并发（SQLite 全表锁），#21 可标记 `@pytest.mark.skip(reason="SQLite aiosqlite 串行化，并发用例无法在测试 DB 真实触发")` 或改用 `unittest.mock.patch` 模拟竞态窗口，但 1-20 必须全绿。

### 3.3 通用断言

- **状态码精确**：每个用例只断言一个明确的 HTTP code（200/201/204/400/403/404/422），不断言 `>= 200`。
- **错误响应体**：400/404 必须断言响应 JSON 的 `code` 字段（`invalid_role_key` / `cannot_remove_last_owner` / `user_not_found`），
  形如 `assert resp.json()["code"] == "cannot_remove_last_owner"`（与 `app/core/errors.py` 中 `APIError.detail.code` 字段一致）。
- **数据库副作用**：FR-03.a / FR-05.a 在 HTTP 调用后，再 `await db_session.execute(select(UserWorkspaceRole)...)`
  断言 INSERT/DELETE 实际生效；service 层异常被吞掉时仅看 HTTP 不够。
- **权限升级生效**（design.md R-05）：FR-03.a 验证加入后 U 的 token 调 GET `/api/workspaces/{W}` 不再 403
  （即 `_user_owns_run` 的 membership 路径自动受益，证明 RolePermission seed 正确）。

## 4. 接口定义

### 4.1 本文件内部 fixture（定义在 test 文件顶部）

```python
import pytest

pytestmark = pytest.mark.asyncio


# ── role_seeder：一次性 seed 7 个标准角色 + 必要 RolePermission ────────
@pytest.fixture()
async def role_seeder(db_session):
    """Insert 7 seed roles + role_permissions; return dict[key -> Role.id].

    测试 DB 不跑 alembic（见 backend/conftest.py:68 db_engine fixture），
    Role / RolePermission 表为空，每个用例必须自己 seed 才能让 require_permission 通过。
    """
    from app.modules.auth.model import Role, RolePermission
    from datetime import datetime, UTC

    roles_spec = {
        "workspace_owner":   ("Workspace Owner",   [Permission.WORKSPACE_READ, Permission.WORKSPACE_WRITE,
                                                     Permission.WORKSPACE_ADMIN, Permission.WORKSPACE_MEMBER_MANAGE]),
        "developer":         ("Developer",         [Permission.WORKSPACE_READ, Permission.WORKSPACE_WRITE,
                                                     Permission.TASK_CREATE, Permission.TASK_RUN_AGENT]),
        "viewer":            ("Viewer",            [Permission.WORKSPACE_READ]),
        "reviewer":          ("Reviewer",          [Permission.WORKSPACE_READ]),
        "qa":                ("QA",                [Permission.WORKSPACE_READ]),
        "component_lead":    ("Component Lead",    [Permission.WORKSPACE_READ]),
        "platform_admin":    ("Platform Admin",    [Permission.PLATFORM_ADMIN]),
    }
    ids: dict[str, uuid.UUID] = {}
    for key, (name, perms) in roles_spec.items():
        role = Role(id=uuid.uuid4(), key=key, name=name, description=name, is_system=True)
        db_session.add(role)
        await db_session.flush()
        ids[key] = role.id
        for p in perms:
            db_session.add(RolePermission(role_id=role.id, permission=p.value))
    await db_session.commit()
    return ids


# ── user_factory：创建一个 active 用户 + 返回 (User, token) ───────────
@pytest.fixture()
async def user_factory(db_session):
    from app.core.security import create_access_token, password_hasher
    from app.modules.auth.model import User

    async def _make(*, email: str | None = None, display_name: str = "U",
                    is_admin: bool = False, status: str = "active") -> tuple[User, str]:
        u = User(
            id=uuid.uuid4(),
            email=email or f"u-{uuid.uuid4().hex[:8]}@example.com",
            password_hash=password_hasher.hash("Pass123!"),
            display_name=display_name,
            status=status,
            is_platform_admin=is_admin,
        )
        db_session.add(u)
        await db_session.commit()
        await db_session.refresh(u)
        token, _ = create_access_token(user_id=u.id, email=u.email, is_admin=u.is_admin,
                                       settings=get_settings())
        return u, token
    return _make


# ── ws_factory：创建一个 workspace ────────────────────────────────────
@pytest.fixture()
async def ws_factory(db_session, tmp_path):
    from app.modules.workspace.model import Workspace

    async def _make(name: str = "W", owner_id: uuid.UUID | None = None) -> Workspace:
        ws = Workspace(
            id=uuid.uuid4(),
            name=name,
            slug=f"ws-{uuid.uuid4().hex[:8]}",
            root_path=str(tmp_path),
            status="active",
            created_by=owner_id,
        )
        db_session.add(ws)
        await db_session.commit()
        await db_session.refresh(ws)
        return ws
    return _make


# ── member_factory：在 ws 内把 user 绑定到 role_key ──────────────────
@pytest.fixture()
async def member_factory(db_session, role_seeder):
    from app.modules.auth.model import UserWorkspaceRole

    async def _bind(ws_id: uuid.UUID, user_id: uuid.UUID, role_key: str = "developer",
                    granted_by: uuid.UUID | None = None) -> UserWorkspaceRole:
        row = UserWorkspaceRole(
            user_id=user_id,
            workspace_id=ws_id,
            role_id=role_seeder[role_key],
            granted_by=granted_by,
            granted_at=datetime.now(UTC),
        )
        db_session.add(row)
        await db_session.commit()
        return row
    return _bind
```

> `role_seeder` 依赖根 conftest 的 `db_session`（per-用例新 engine）；上述 4 个 fixture 都按"每用例独立"语义工作。

### 4.2 端点 URL（与 task-04 include 后实际路径一致）

| 方法 | URL（前缀 `/api/workspaces/{ws_id}/members`） |
|------|-----------------------------------------------|
| GET | `/api/workspaces/{ws_id}/members` |
| GET | `/api/workspaces/{ws_id}/members/search?q={q}&limit={n}` |
| POST | `/api/workspaces/{ws_id}/members` body `{user_id, role_key}` |
| PATCH | `/api/workspaces/{ws_id}/members/{user_id}` body `{role_key}` |
| DELETE | `/api/workspaces/{ws_id}/members/{user_id}` |
| POST | `/api/workspaces/{ws_id}/members/{user_id}/transfer-ownership` |

### 4.3 测试函数命名约定（强制）

- 格式：`test_fr0X_<scenario>_<expected>`，X 对齐 FR 编号。
- `<expected>` 必须是可观察的 HTTP 状态码或错误码：`returns_200` / `returns_201` / `returns_204` / `returns_400_invalid_role_key` / `returns_403` / `returns_404_user_not_found` / `returns_422`。
- 一函数一断言主题（HTTP code + 业务关键字段）；多步骤用例（如 FR-03.a 还要验证后续 GET 不 403）以多 `assert` 串行写在同一函数。

## 5. 边界处理

| # | 边界 | 处理方式 |
|---|------|----------|
| 1 | **SQLite 不支持 `ILIKE`**（design §5.1 search service 用了 `User.email ILIKE :q`） | 测试用例不直接验证 SQL，只验证行为：seed `alice@example.com` + `cathy@x.com`，断言 search 行为符合期望（active + 非成员）。如果 task-03 实现使用了 ILIKE，需 service 层在 dialect 检测后改用 `lower(col) like lower(:q)`；本任务只通过黑盒断言覆盖，若发现 SQLite 报 `no such function: ILIKE`，**回退到 task-03 修 service**（不在测试文件 hack）。 |
| 2 | **async session 事务隔离** | `db_session` 与 `client` fixture 共享同一 `db_engine`，但各自开独立 session；写入（HTTP POST/PATCH/DELETE 经 `client` 跑另一 session）的 commit 对测试 `db_session` 可见（SQLite in-memory 同 engine 多连接共享 metadata）。**断言 DB 状态前先 `await db_session.expire_all()`** 或用新 `select(...)` 查询，避免 ORM identity-map 缓存读到旧值。 |
| 3 | **platform_admin bypass** | `test_fr01_list_members_by_owner_returns_200` 之外另写一个隐式验证：用 `user_factory(is_admin=True)` 创建的 platform_admin 不需要 seed `UserWorkspaceRole`，访问 `/members` 也返回 200（因为 `rbac.has_permission` line 55 提前 return True）。本任务把这条逻辑塞进 #1 同一用例的第二个 assert（断言 admin 调用同端点 200），不再单独开 case，凑足 15。 |
| 4 | **identity-aware token（is_admin 字段）** | JWT payload 中 `is_admin=True/False` 来自 `create_access_token(is_admin=user.is_platform_admin, ...)`；测试构造的非 admin token 必须 `is_admin=False`，否则 `has_permission` 会错误 bypass。`user_factory` 默认 `is_admin=False` 已正确处理。 |
| 5 | **UserWorkspaceRole 复合主键冲突** | `(user_id, workspace_id, role_id)` 三列主键；幂等 add（FR-03.b）若 service 用 INSERT 而非 upsert，第二次 add 同 (U, W, role_id) 会触发 IntegrityError。测试 #9 验证的是"换一个 role_id"（developer != viewer），不会冲突；但若 service 实现是先 DELETE 再 INSERT，需保证旧 role_id 行被清。**断言：FR-03.b 后 `select(UserWorkspaceRole).where(user_id=U, workspace_id=W)` 只返回一行且 role_id=developer.id**。 |
| 6 | **测试数据不污染** | 每个用例用 `db_engine` 隔离（per-test 新 engine），不共享全局表数据；email / slug / UUID 都用 `uuid.uuid4().hex[:8]` 派生，杜绝跨用例碰撞。 |
| 7 | **tmp_path workspace root** | `ws_factory` 用 pytest 内置 `tmp_path` 作为 `Workspace.root_path`；如果 service 层在 add_member 时验证 root_path 存在（task-03 一般不验证），需在 conftest 已 inject 的 tempdir 下创建——本变更 service 层不碰 root_path，无需额外处理。 |
| 8 | **disabled 用户可见性** | FR-02.c 中 disabled 用户的 email 也含 `q`；测试需保证该 user 行已 INSERT 但 `status='disabled'`，且 search 返回列表用列表推导式 `assert disabled_user_id not in [h['user_id'] for h in resp.json()['items']]`。 |

## 6. 非目标

- **不做**端到端测试（不调 frontend dev server、不开浏览器）
- **不做**前端 vitest / playwright（FR-07/08 由 e2e 手动验收覆盖）
- **不做**性能测试（design.md §10 R-03 标 P3，YAGNI；成员表 >100 用例不在本任务范围）
- **不重写** task-03 service 实现（如发现 service 行为与 FR 不符，回退到 task-03 修，不在测试 hack SQL）
- **不补** alembic migration（测试 DB 走 `BaseModel.metadata.create_all`，与现有 1081 用例一致）
- **不验证**审计日志 / 通知（design 非目标，未引入）

## 7. 参考

- **测试模板主参考**：`backend/app/modules/agent/tests/test_execution_context.py` line 40-160
  - `_auth(token)` / `_make_user(db_session, *, is_admin)` / `_token(user)` 三个 helper 的写法
  - 手动 seed `Role(key="workspace_owner", ...)` + `UserWorkspaceRole(...)` 的标准范式（line 95-113）
- **HTTP 层测试参考**：`backend/tests/modules/workspace/test_scan_generate.py`
  - `async def test_*(client: AsyncClient, auth_headers)` 签名风格
  - `@pytest.mark.asyncio` 装饰写法
- **fixture 风格参考**：`backend/conftest.py`
  - `db_engine`（line 68）— 每 test 一个新 SQLite engine + create_all
  - `db_session`（line 96）— 每用例独立 AsyncSession
  - `client`（line 103）— override `get_session` 到 test engine，ASGITransport
  - `auth_admin_token`（line 128）+ `auth_headers`（line 167）— platform_admin 快速鉴权
- **RBAC 真相源**：`backend/app/modules/auth/rbac.py` line 47-61 `has_permission`（admin bypass + membership 查询）
- **错误码清单**：`app/core/errors.py` 中 `PermissionDenied` / `InvalidRoleKey` / `CannotRemoveLastOwner` / `UserNotFound` / `WorkspaceNotFound`（task-03 应已映射）
- **Permission 枚举**：`backend/app/modules/auth/permissions.py` line 13-55（`WORKSPACE_MEMBER_MANAGE` / `WORKSPACE_READ` 等）

## 8. TDD 步骤

> 本任务严格 TDD：先写测试（红） → 等待 task-03 实现就位 → 跑测试（绿）。

1. **第 1 步（本任务）**：完成本文件全部 ≥15 用例，所有用例依赖 `members_router` 6 个端点存在（task-04 装载后即可路由到）。
2. **第 2 步**：在 task-03 完成 members_service 实现后跑：
   ```bash
   cd backend
   uv run pytest backend/tests/modules/workspace/test_members_router.py -v
   ```
   预期：15+ PASSED；如果出现 collection error（路由不存在 / import 失败），先核对 task-04 是否完成装载。
3. **第 3 步**：全量回归：
   ```bash
   cd backend
   uv run pytest -x --tb=short
   ```
   预期：现有 1081 用例 + 新增 15+ 全过；如发现既有用例失败，回退排查 fixture 改动是否影响其他模块（本任务不改根 conftest，应无影响）。
4. **第 4 步**：覆盖率检查（可选，AC-3 要求 ≥85%）：
   ```bash
   cd backend
   uv run pytest backend/tests/modules/workspace/test_members_router.py \
     --cov=app/modules/workspace/members_router \
     --cov=app/modules/workspace/members_service \
     --cov-report=term-missing
   ```
   预期：members_router.py / members_service.py 行覆盖 ≥85%；缺失行集中在异常分支（如 workspace_not_found、platform_admin bypass 分支），如有低于 85%，补充 1-2 个针对性用例。

## 9. 验收标准

| 编号 | 检查项 | 通过条件 |
|------|--------|----------|
| AC-1 | 用例数量 | `uv run pytest backend/tests/modules/workspace/test_members_router.py --collect-only -q` 输出 ≥15 个 test node id（含 #1-#20，允许 #21 标 skip） |
| AC-2 | FR-01..06 全覆盖 | 每个 FR 至少 1 个 test（FR-01: 3 / FR-02: 4 / FR-03: 5 / FR-04: 3 / FR-05: 3 / FR-06: 2+）；GWT 块逐一映射到 test 函数名（见 §3.2 映射表） |
| AC-3 | pytest 全过 | `uv run pytest backend/tests/modules/workspace/test_members_router.py -v` 输出 `15 passed`（或 `20 passed, 1 skipped`，仅允许并发用例 skip） |
| AC-4 | 不回归 | `uv run pytest -x` 现有 1081 用例 + 新增用例全过；`backend/tests/modules/workspace/test_scan_generate*.py` 仍 5 passed |
| AC-5 | 覆盖率 ≥85% | `members_router.py` + `members_service.py` 行覆盖 ≥85%（task-03 实现后跑 `--cov` 验证） |
| AC-6 | 错误信息明确 | failed case（如有）pytest 输出含 HTTP code + 响应 body 摘要 + DB 状态 diff，便于 task-03 debug |
| AC-7 | DB 副作用断言 | FR-03.a / FR-03.b / FR-05.a / FR-06.a 至少 4 个用例在 HTTP 调用后追加 `select(UserWorkspaceRole)` 断言，验证 INSERT/UPDATE/DELETE 实际发生 |
| AC-8 | 边界覆盖 | §5 表中 8 条边界处理在用例中均有对应覆盖（SQLite ILIKE 用例 #4/#6 / admin bypass #1 / 复合主键 #9 / disabled 用户 #6 等） |

## 10. 风险与回滚

- **风险 R-1**：task-03 service 用了 `ilike()` 真实 ILIKE，SQLite 报错 → 测试红。
  **应对**：本任务只写黑盒断言，不 mock SQL；发现红时立即 raise task-03 修复（service 层加 dialect 分支），不在 test 文件 patch。
- **风险 R-2**：JWT 中 `is_admin=False` 的非 admin 用户访问 `/members/search` 时被 `require_permission(WORKSPACE_MEMBER_MANAGE)` 拦截返回 403，但断言期望 200。
  **应对**：测试中给 workspace_owner 显式 seed `UserWorkspaceRole(role_id=owner_role_id)`，并通过 `role_seeder` 注入 `RolePermission(role_id=owner_role_id, permission=WORKSPACE_MEMBER_MANAGE)`，让 RBAC 链条完整。
- **风险 R-3**：用例 #21（并发 transfer）在 SQLite 无法真实复现竞态，跳过。
  **应对**：标 `@pytest.mark.skip(reason="...")` 或 `xfail`；不强行 patch service 制造竞态（违反 §6 非目标"不重写 task-03"）。
- **回滚**：删除 `test_members_router.py` + `__init__.py` 即可恢复原状；无 DB migration / 配置 / 代码改动。
