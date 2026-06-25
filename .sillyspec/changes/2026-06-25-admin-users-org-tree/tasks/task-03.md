---
id: task-03
title: 后端 UserService.list_users — organization_id/include_children + exists 子查询过滤
phase: V1
priority: P0
status: draft
owner: WhaleFall
author: WhaleFall
created_at: 2026-06-25T16:10:00
estimated_hours: 2.0
depends_on:
  - task-01
  - task-02
blocks:
  - task-04
  - task-05
requirement_ids:
  - FR-01
decision_ids:
  - D-004@v1
allowed_paths:
  - backend/app/modules/admin/users_service.py
---

## 1. 目标

给 `UserService.list_users` 增加组织维度过滤：新增 `organization_id` + `include_children` 两个关键字参数，当 `organization_id` 非空时，用 **exists 子查询** 过滤出「任一绑定组织 ∈ org_ids」的用户（org_ids = 当前组织 ∪ 下级组织），实现：

- **无 join、无 group_by、无 distinct**，User 主表行不重复 → total/分页天然正确（D-004@v1）。
- 默认 `organization_id=None` 时行为完全不变（brownfield 零影响，AC-09）。
- 复用同模块 `organizations_service._descendant_ids(session, root_id)` 取下级组织集合（不含 root），组织树浅，BFS 在 SQLite/Postgres 均可移植。

本 task **只改 `users_service.py` 一个文件**（list_users 签名 + import + exists 子查询块）。schema 已由 task-01 在 `UserQueryParams` 同步加字段（router 现走裸 Query，见 task-04，不强制用 UserQueryParams）。

## 2. 覆盖来源（依据）

| 来源 | 章节 | 关键结论 |
|---|---|---|
| `.sillyspec/changes/2026-06-25-admin-users-org-tree/design.md` | §5 Phase 2 | list_users 签名增 organization_id/include_children；非空时 org_ids = {organization_id} ∪ (_descendant_ids if include_children else ∅)；base 加 `.where(exists(select(1).select_from(user_organizations).where((user_organizations.c.user_id==User.id)&(user_organizations.c.organization_id.in_(org_ids)))))`；无 join 无 group_by；从 organizations_service import _descendant_ids |
| `.sillyspec/changes/2026-06-25-admin-users-org-tree/design.md` | §7.2 接口定义 | `list_users(*, q=None, status=None, role=None, sort="created_at", order="desc", limit=20, offset=0, organization_id: uuid.UUID \| None = None, include_children: bool = True) -> tuple[list[User], int]` |
| `.sillyspec/changes/2026-06-25-admin-users-org-tree/design.md` | §11 D-004@v1 | exists 子查询过滤（无 join 无重复行，total/分页天然正确）|
| `.sillyspec/changes/2026-06-25-admin-users-org-tree/design.md` | §9 兼容策略 | organization_id 未传（默认 None）→ list_users 行为完全不变；include_children 默认 true，但 organization_id 为空时短路无意义 |
| `.sillyspec/changes/2026-06-25-admin-users-org-tree/design.md` | §3 非目标 | 不做 include_children UI 开关；不优化 _user_with_relations N+1 |
| `.sillyspec/changes/2026-06-25-admin-users-org-tree/plan.md` | Wave 2 task-03 | dep task-01/02；覆盖 FR-01, D-004@v1 |
| 现状代码 | `backend/app/modules/admin/organizations_service.py:51-76` | `_descendant_ids(session, root_id) -> set[uuid]`：BFS，返回**不含 root**；模块级函数，可 import |
| 现状代码 | `backend/app/modules/admin/users_service.py:85-124` | 现有 list_users（q/status/role/sort/order/limit/offset），base/total_q/sort_col 结构 |
| 现状代码 | `backend/app/modules/admin/model.py:83-108` | `UserOrganization`（M2N 复合主键 user_id+organization_id），`__table__` 可 `.c`；users_service 现有 import 已含 `UserOrganization`（:36）|
| 现状代码 | `backend/app/modules/admin/users_service.py:36, 29` | 现有 import：`from app.modules.admin.model import Organization, UserOrganization, UserRole`；`from sqlalchemy import func, or_, select`（需补 `exists`）|

## 3. 修改文件清单

| 文件 | 改动 | allowed_paths |
|---|---|---|
| `backend/app/modules/admin/users_service.py` | ① import 区补 `exists`（sqlalchemy）；补 `from app.modules.admin.organizations_service import _descendant_ids`；② `list_users` 签名增 `organization_id`/`include_children`；③ organization_id 非空时构造 org_ids + 给 base 加 exists 子查询 where | ✅ |

## 4. 实现要求

1. **import**：
   - 现有 `from sqlalchemy import func, or_, select`（users_service.py:29）→ 改为 `from sqlalchemy import exists, func, or_, select`（按字母序补 `exists`，ruff 风格）。
   - 在 model import 块后（约 :36-41 区域之后、`log = get_logger(__name__)` 之前）新增：
     ```python
     from app.modules.admin.organizations_service import _descendant_ids
     ```
     注意：`organizations_service` 同样 import `app.modules.admin.model`，但**不** import `users_service`，无循环依赖；`_descendant_ids` 是模块级函数（非 UserService 方法），直接 `from ... import _descendant_ids` 即可。
2. **签名**：`list_users` 在 `offset: int = 0,` 之后追加两个关键字参数（保持 `*,` 强制 kw-only 不变）：
   ```python
   organization_id: uuid.UUID | None = None,
   include_children: bool = True,
   ```
3. **过滤逻辑**：在现有 `if role:` 分支之后、`total_q = ...` 之前，插入：
   ```python
   if organization_id is not None:
       org_ids: set[uuid.UUID] = {organization_id}
       if include_children:
           org_ids |= await _descendant_ids(self.session, organization_id)
       base = base.where(
           exists(
               select(1)
               .select_from(UserOrganization.__table__)
               .where(
                   (UserOrganization.__table__.c.user_id == User.id)
                   & (UserOrganization.__table__.c.organization_id.in_(org_ids))
               )
           )
       )
   ```
   - 用 `UserOrganization.__table__.c.*`（与文件内 `_rewrite_organizations` :453-457 风格一致，已 import `UserOrganization`）；不用裸 `user_organizations` 变量名。
   - organization_id 为 None → 整块短路，base 不变，行为零变化。
   - org_ids 含 root + 下级（include_children 默认 true）；前端固定传 true（D-001），参数保留灵活性。
4. **total_q**：保持 `select(func.count()).select_from(base.subquery())`（base 已含 exists where）→ total 天然正确，无需 distinct。**不引入 join、不引入 group_by**。
5. **不改动**：q/status/role/sort/order/limit/offset 各分支、total_q/sort_col/order_fn/rows 构造、return 语句、`_user_with_relations`（router 侧，本 task 不动）。
6. 兼容 Windows/macOS（纯 Python，无平台相关调用）。

## 5. 接口定义（精确签名）

### 5.1 `UserService.list_users`（增参）

```python
async def list_users(
    self,
    *,
    q: str | None = None,
    status: str | None = None,
    role: str | None = None,
    sort: str = "created_at",
    order: str = "desc",
    limit: int = 20,
    offset: int = 0,
    organization_id: uuid.UUID | None = None,   # ← 新增
    include_children: bool = True,              # ← 新增
) -> tuple[list[User], int]:
    base = select(User).where(col(User.deleted_at).is_(None))

    if q:
        pattern = f"%{q}%"
        base = base.where(
            (col(User.email).ilike(pattern)) | (col(User.display_name).ilike(pattern))
        )
    if status:
        base = base.where(col(User.status) == status)
    if role == "admin":
        base = base.where(User.is_platform_admin.is_(True))
    elif role == "user":
        base = base.where(User.is_platform_admin.is_(False))

    # ← 新增：组织维度过滤（exists 子查询，无 join 无重复）
    if organization_id is not None:
        org_ids: set[uuid.UUID] = {organization_id}
        if include_children:
            org_ids |= await _descendant_ids(self.session, organization_id)
        base = base.where(
            exists(
                select(1)
                .select_from(UserOrganization.__table__)
                .where(
                    (UserOrganization.__table__.c.user_id == User.id)
                    & (UserOrganization.__table__.c.organization_id.in_(org_ids))
                )
            )
        )

    total_q = select(func.count()).select_from(base.subquery())
    total = (await self.session.execute(total_q)).scalar() or 0

    sort_col = {
        "email": User.email,
        "last_login_at": User.last_login_at,
    }.get(sort, User.created_at)
    order_fn = col(sort_col).desc if order == "desc" else col(sort_col).asc

    rows = (
        (await self.session.execute(base.order_by(order_fn()).limit(limit).offset(offset)))
        .scalars()
        .all()
    )
    return list(rows), total
```

### 5.2 import 改动

```python
# 行 29（现有）
from sqlalchemy import func, or_, select
# → 改为
from sqlalchemy import exists, func, or_, select

# 行 36-41 之后新增（model import 块与 log 之间）
from app.modules.admin.organizations_service import _descendant_ids
```

### 5.3 复用的 `_descendant_ids`（不改，仅引用）

```python
# organizations_service.py:51-76（现状）
async def _descendant_ids(session: AsyncSession, root_id: uuid.UUID) -> set[uuid.UUID]:
    """Return IDs of every descendant of ``root_id`` (BFS via SQL,不含 root)。"""
    ...
```

## 6. 边界处理

| # | 场景 | 行为 | 责任层 |
|---|---|---|---|
| B-01 | `organization_id=None`（默认/未传） | 整个 exists 块短路，base 不变，返回全部非软删用户 | service（本 task，AC-09）|
| B-02 | `organization_id=X, include_children=True`（默认） | org_ids = {X} ∪ 下级；返回绑定任一 org ∈ org_ids 的用户 | service（本 task，AC-03）|
| B-03 | `organization_id=X, include_children=False` | org_ids = {X}（不展开下级）；只返回直接绑定 X 的用户 | service（本 task，AC-02）|
| B-04 | 一用户在子树多个组织（父+子） | exists 子查询命中即返回该用户**一次**（无 join 无重复），total 正确 | service（本 task，D-004）|
| B-05 | `organization_id=X` 但 X 无任何用户绑定 | org_ids 非空但 exists 无命中 → rows=[], total=0 | service（本 task）|
| B-06 | `organization_id=X` 且 X 无下级（叶子） | `_descendant_ids` 返回 ∅，org_ids={X}，行为同 B-03 | service（本 task，AC-02）|
| B-07 | 软删用户（`deleted_at` 非 None） | base 已有 `col(User.deleted_at).is_(None)` 前置过滤，exists 不影响 | service（本 task，不变）|
| B-08 | `organization_id` 叠加 `q`/`status`/`role` | 各 where 链式叠加 AND，互不干扰（base.where 可多次调用）| service（本 task，AC-05）|
| B-09 | 分页 `limit/offset` 与组织过滤叠加 | order/limit/offset 在最终 base（含 exists where）上执行，分页正确 | service（本 task）|
| B-10 | `organization_id` 指向不存在/已删组织 | exists 仍按 org_ids 查（命中 0 行），返回空列表；**不做 org 存在性校验**（非目标，router/前端保证） | service（本 task）|

## 7. 非目标

- 不改 router（task-04 加裸 Query 透传）。
- 不改 schema 的 `UserQueryParams`（task-01 已加；router 现走裸 Query）。
- 不做 `organization_id` 存在性/启用状态校验（保持 `USER_READ` 全可见语义；org_id 无效 → 空结果，B-10）。
- 不做 include_children 的 UI 开关（前端固定 true，D-001）。
- 不优化 `_user_with_relations` 的 N+1（design §3 非目标）。
- 不加 ORM relationship（手写 exists 子查询，design §3）。
- 不改 `_descendant_ids`（仅 import 复用）。
- 不改任何测试文件（task-05）。

## 8. 参考源码

- `backend/app/modules/admin/users_service.py:29` — 现有 `from sqlalchemy import func, or_, select`（待补 `exists`）
- `backend/app/modules/admin/users_service.py:36-41` — model/schema import 块（待在其后补 `from app.modules.admin.organizations_service import _descendant_ids`）
- `backend/app/modules/admin/users_service.py:85-124` — 现有 `list_users` 全貌（base/where 链/total_q/sort/order/rows）
- `backend/app/modules/admin/users_service.py:110` — `total_q = select(func.count()).select_from(base.subquery())`（exists where 透传到 subquery，total 天然正确）
- `backend/app/modules/admin/users_service.py:453-457` — `_rewrite_organizations` 用 `UserOrganization.__table__.delete().where(...c.user_id==...)` 的 `.c` 风格参考
- `backend/app/modules/admin/organizations_service.py:51-76` — `_descendant_ids` 全貌（BFS，返回不含 root 的 set[uuid]）
- `backend/app/modules/admin/organizations_service.py:41` — `from app.modules.admin.model import Organization, UserOrganization`（证明 organizations_service 不 import users_service，无循环依赖）
- `backend/app/modules/admin/model.py:83-108` — `UserOrganization` 表（复合主键 user_id+organization_id）

## 9. TDD 步骤

> 本 task 改 service 层逻辑，TDD 由 **task-05** 在 `backend/tests/modules/admin/test_users_router.py` 写组织过滤用例（全部/叶子/include_children=true 含下级/distinct 去重/叠加 q+status+分页）。本 task 执行时：
> 1. 在 task-05 测试落地前，可先手写一段一次性脚本/pytest 临时用例验证 exists 子查询在 SQLite 下生成正确 SQL（无 join、无重复行），验证后丢弃。
> 2. task-03 实现 §5.1 后，等待 task-04 router 透传，再由 task-05 跑端到端测试。
> 3. `ruff check backend/app/modules/admin/users_service.py` + `mypy backend/app/modules/admin/users_service.py` 通过。

## 10. 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | `list_users()` 不传 organization_id | 返回全部非软删用户，与改造前行为完全一致（brownfield） |
| AC-02 | `list_users(organization_id=叶子org_id, include_children=False)` | 只返回直接绑定该叶子的用户 |
| AC-03 | `list_users(organization_id=父org_id)`（include_children 默认 True） | 返回绑定 父 ∪ 所有下级 的用户 |
| AC-04 | 一用户在子树多组织（父+子），`list_users(organization_id=父)` | 该用户在结果中**仅出现一次**，total 不虚高（无 join 无 group_by，D-004）|
| AC-05 | `list_users(organization_id=X, q="abc", status="active")` | exists where 与 q/status where 链式 AND 叠加，三条件同时满足 |
| AC-06 | `list_users(organization_id=X, limit=10, offset=20)` | 分页在含 exists where 的 base 上执行，offset/limit 正确 |
| AC-07 | `list_users(organization_id=不存在的uuid)` | exists 无命中，rows=[], total=0（不报错，不做 org 存在性校验）|
| AC-08 | exists 子查询生成的 SQL | **无 JOIN、无 GROUP BY、无 DISTINCT**，仅 WHERE EXISTS (... SELECT 1 FROM user_organizations WHERE ...) |
| AC-09 | `ruff check backend/app/modules/admin/users_service.py` | 无告警 |
| AC-10 | `mypy backend/app/modules/admin/users_service.py` | 无类型错误 |
| AC-11 | 仅改 `backend/app/modules/admin/users_service.py` 一个 allowed_paths 文件，`git diff --stat` 不含其他文件 | true |

## 11. 完成定义

- [ ] §5.1 `list_users` 签名增 `organization_id`/`include_children` 两参（kw-only）
- [ ] §5.2 import 落地（`exists` + `_descendant_ids`）
- [ ] §5.1 exists 子查询 where 块落地（organization_id 非空时 org_ids = {X} ∪ _descendant_ids(if include_children)，base.where(exists(...))）
- [ ] §6 B-01~B-10 边界场景均符合预期（B-04 无重复行 = D-004 核心）
- [ ] §10 AC-01~AC-11 全部通过（AC-08 验 SQL 无 join/group_by/distinct）
- [ ] `git diff` 仅含 `backend/app/modules/admin/users_service.py`
