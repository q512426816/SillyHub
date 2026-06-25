---
id: task-02
title: 后端 organizations_service — +_subtree_member_count（distinct user_id 复用 _descendant_ids）、_to_read 注入
phase: V1
priority: P0
status: draft
owner: WhaleFall
author: WhaleFall
created_at: 2026-06-25T16:10:00
estimated_hours: 1
depends_on: []
blocks:
  - task-03
requirement_ids:
  - FR-02
decision_ids:
  - D-003@v1
  - D-005@v1
allowed_paths:
  - backend/app/modules/admin/organizations_service.py
---

## 1. 目标

在 `organizations_service.py` 新增 `_subtree_member_count` 工具函数，并在 `_to_read` 注入，使 `OrganizationRead.subtree_member_count`（task-01 新增字段）对所有 list/get 路径生效：

- 新增 `_subtree_member_count(session, org_id) -> int`：`org_ids = {org_id} ∪ _descendant_ids(session, org_id)`；`SELECT count(distinct user_id) FROM user_organizations WHERE organization_id IN :org_ids`（distinct user_id，同一用户在子树多组织只计一次，D-003@v1）。
- 改 `_to_read`（organizations_service.py:100-114）：调用 `_subtree_member_count` 注入 `subtree_member_count`。
- **关键**：`_descendant_ids`（:51-76）返回的集合**不含 root**，`_subtree_member_count` 必须自己把 `org_id` 加进 IN 集合（`{org_id} ∪ descendants`），否则当前组织直接成员会被漏算。
- 复用现有模块级 `_descendant_ids`，**不复制 BFS 逻辑**。

本 task **只改 organizations_service.py**，不动 schema / router / model / migration（依赖 task-01 的 schema 字段，但本 task allowed_paths 仅含 service 文件，schema 字段由 task-01 先行落地）。

## 2. 覆盖来源（依据）

| 来源 | 章节 | 关键结论 |
|---|---|---|
| `.sillyspec/changes/2026-06-25-admin-users-org-tree/design.md` | §5 Phase 1 | 复用模块级 `_descendant_ids`（:51-76，BFS，返回**不含 root**）；新增 `_subtree_member_count`：`org_ids = {org_id} ∪ _descendant_ids(session, org_id)`；`SELECT count(distinct user_id) FROM user_organizations WHERE organization_id IN :org_ids`；`_to_read`（:100-114）注入 |
| `.sillyspec/changes/2026-06-25-admin-users-org-tree/design.md` | §7.3 接口定义 | `async def _subtree_member_count(session, org_id: uuid.UUID) -> int` |
| `.sillyspec/changes/2026-06-25-admin-users-org-tree/decisions.md` | D-003@v1 | `subtree_member_count = distinct user_id`（同一用户子树多组织去重）|
| `.sillyspec/changes/2026-06-25-admin-users-org-tree/decisions.md` | D-005@v1 | 实时算不缓存（每次 `_to_read` 现算，数据量小未上线）|
| `.sillyspec/changes/2026-06-25-admin-users-org-tree/plan.md` | Wave 1 task-02 | 覆盖 FR-02, D-003@v1, D-005@v1；depends_on: []（与 task-01 同 Wave 并行）|
| 现状代码 | `backend/app/modules/admin/organizations_service.py:51-76` | `_descendant_ids` BFS，`discovered.discard(root_id)` 后返回（**不含 root**）|
| 现状代码 | `backend/app/modules/admin/organizations_service.py:100-114` | `_to_read` 现仅注入 member_count/children_count，无 subtree_member_count |
| 现状代码 | `backend/app/modules/admin/organizations_service.py:79-97` | `_counts` 用 `select_from(UserOrganization.__table__)` + `.where(c.organization_id == org_id)` 的写法可参考 |

## 3. 修改文件清单

| 文件 | 改动 | allowed_paths |
|---|---|---|
| `backend/app/modules/admin/organizations_service.py` | 新增 `_subtree_member_count` 模块级函数；改 `_to_read` 注入 `subtree_member_count` 字段 | ✅ |

## 4. 实现要求

1. 新增 `_subtree_member_count` 为**模块级 async 函数**（与 `_descendant_ids` / `_counts` / `_to_read` 同级，签名风格一致：`(session: AsyncSession, org_id: uuid.UUID) -> int`）。
2. 复用 `_descendant_ids(session, org_id)`，**不复制 BFS 逻辑**。
3. **root 自加**：`org_ids = {org_id} | await _descendant_ids(session, org_id)`（`_descendant_ids` 返回不含 root，必须显式加 `org_id`）。
4. **distinct user_id**：`select(func.count(distinct(UserOrganization.user_id)))` 或等价 `.select_from(UserOrganization.__table__).with_only_columns(func.count(UserOrganization.__table__.c.user_id), ...)` 写法，确保同一用户多组织只计一次（D-003@v1）。
5. **空集合兜底**：`org_ids` 至少含 `org_id` 本身（永不为空），`IN` 子句恒有值，无需特判空集。
6. 改 `_to_read`：在 `members, children = await _counts(...)` 之后追加 `subtree = await _subtree_member_count(session, org.id)`，构造 `OrganizationRead(...)` 时加 `subtree_member_count=subtree`。
7. 不改 `list_organizations` / `get_organization` 等业务方法（它们经 `_to_read` 自动覆盖子树计数）。
8. 不改 import（`func` / `select` 已 import；`distinct` 若用需补 `from sqlalchemy import distinct`，否则用 `func.count(UserOrganization.__table__.c.user_id.distinct())` 风格避免新 import — 见 §5 选定写法）。
9. 实时算不缓存（D-005@v1），每次 `_to_read` 调用即查 DB。

## 5. 接口定义（精确到函数签名）

### 5.1 新增 `_subtree_member_count`

```python
async def _subtree_member_count(session: AsyncSession, org_id: uuid.UUID) -> int:
    """Count distinct members across ``org_id`` plus all its descendants.

    ``_descendant_ids`` excludes the root, so we union ``{org_id}`` back
    in before the IN lookup. A user bound to multiple orgs in the subtree
    is counted once (distinct user_id, decision D-003@v1). Computed live
    per call — no cache (D-005@v1).
    """
    descendant_ids = await _descendant_ids(session, org_id)
    org_ids = {org_id} | descendant_ids
    count = (
        await session.execute(
            select(func.count(UserOrganization.__table__.c.user_id.distinct()))
            .select_from(UserOrganization.__table__)
            .where(UserOrganization.__table__.c.organization_id.in_(org_ids))
        )
    ).scalar_one()
    return int(count)
```

要点：
- `c.user_id.distinct()` 写法等价 `count(distinct user_id)`，且无需新 import `distinct`（`func` + 列的 `.distinct()` 均已可用）。
- `org_ids` 至少 `{org_id}`，`IN` 恒非空。
- `scalar_one()` 返回 int（SQLite/PG 均返回整数）。

### 5.2 改 `_to_read`（organizations_service.py:100-114）

```python
async def _to_read(session: AsyncSession, org: Organization) -> OrganizationRead:
    members, children = await _counts(session, org.id)
    subtree = await _subtree_member_count(session, org.id)   # ← 新增
    return OrganizationRead(
        id=org.id,
        name=org.name,
        code=org.code,
        description=org.description,
        parent_id=org.parent_id,
        status=org.status,  # type: ignore[arg-type]
        sort_order=org.sort_order,
        member_count=members,
        children_count=children,
        subtree_member_count=subtree,                        # ← 新增注入
        created_at=org.created_at,
        updated_at=org.updated_at,
    )
```

要点：
- 新增 2 行：`subtree = ...` 与 `subtree_member_count=subtree`。
- 字段顺序与 `OrganizationRead`（task-01）声明一致。

## 6. 边界处理

| # | 场景 | 行为 | 责任层 |
|---|---|---|---|
| B-01 | `_descendant_ids` 返回不含 root | `_subtree_member_count` 显式 `{org_id} ∪ descendants`，root 直接成员计入 | service（本 task）|
| B-02 | 当前组织无下级（叶子） | `descendant_ids = set()`，`org_ids = {org_id}`，仅查当前组织，等价 member_count | service（本 task）|
| B-03 | 子树内一用户绑定多个组织 | `distinct user_id` 去重，只计 1 次（D-003@v1）| service（本 task）|
| B-04 | 当前组织 0 成员 + 下级 0 成员 | `count = 0`，`.subtree_member_count == 0` | service（本 task）|
| B-05 | 子树含 disabled 下级组织 | 聚合按结构（parent_id 树）算，**含 disabled 下级成员**（D-002@v1：UI 只显 active，但 subtree 按结构聚合）| service（本 task）|
| B-06 | `org_id` 不存在于 organizations 表（孤儿引用） | `_descendant_ids` 返回空集，`org_ids = {org_id}`，查 user_organizations 该 org 无行 → 0（不抛错；正常路径 org 由上层 `session.get` 已校验存在）| service（本 task）|
| B-07 | `list_organizations` 多个 org 各算子树（N 次 BFS） | 实时算，组织数小可接受（R-02 P2）| service（本 task）|
| B-08 | `get_organization` 走 `_to_read` 后再 `children` 各走 `_to_read` | 父 + 每个子各算各自子树，互不干扰（子树定义以各自为根）| service（本 task）|

## 7. 非目标

- 不改 schema（task-01）/ router（task-04）/ model / migration。
- 不改 `_descendant_ids` / `_counts` 现有实现（仅复用）。
- 不做 `subtree_member_count` 缓存 / 批量预计算（D-005@v1，R-02 留待量大再优化）。
- 不改 `list_organizations` / `get_organization` 业务方法签名（经 `_to_read` 自动覆盖）。
- 不修复 list_organizations 的 N 次 BFS 性能（R-02，明确非目标）。
- 不改 UserService.list_users 的组织过滤（task-03）。
- 不在 service 层过滤 disabled 组织（UI 层 task-07 处理，service 按结构聚合）。

## 8. 参考

- `backend/app/modules/admin/organizations_service.py:51-76`（`_descendant_ids`，BFS，`discovered.discard(root_id)` 不含 root）
- `backend/app/modules/admin/organizations_service.py:79-97`（`_counts` 写法参考：`select_from(UserOrganization.__table__).where(c.organization_id == org_id)`）
- `backend/app/modules/admin/organizations_service.py:100-114`（`_to_read` 注入点）
- `backend/app/modules/admin/organizations_service.py:153-205`（`list_organizations` / `get_organization` 经 `_to_read` 自动覆盖）
- `backend/app/modules/admin/model.py:83-108`（`UserOrganization` M2N 复合主键 `(user_id, organization_id)`）
- `.sillyspec/changes/2026-06-25-admin-users-org-tree/design.md` §5 Phase 1 / §7.3 / §11 D-003@v1 D-005@v1 / §10 R-02
- `.sillyspec/changes/archive/2026-06-25-2026-06-24-username-login/tasks/task-02.md`（蓝图格式参考）

## 9. TDD 步骤

> 本 task 改 service 运行时逻辑；TDD 聚焦「子树 distinct 计数正确性 + root 自加 + 注入生效」。

1. **先写测试**（`backend/tests/modules/admin/test_organizations_service_subtree.py` 新增，或复用既有 organizations_service 测试文件追加用例，需 async session fixture）：
   - `test_subtree_leaf_org_equals_member_count`：叶子组织（无下级），`_subtree_member_count` == 该组织直接 member_count。
   - `test_subtree_parent_includes_children`：父组织 A + 子 B + 孙 C，A/B/C 各绑定不同用户 → `A.subtree_member_count == 3`（含下级）。
   - `test_subtree_distinct_dedup`：一用户 U 同时绑定 A 和 B（A 是 B 父）→ `A.subtree_member_count` 对 U 只计 1 次（distinct，D-003@v1）。
   - `test_subtree_zero_members`：A/B 全无成员 → `A.subtree_member_count == 0`。
   - `test_subtree_includes_disabled_descendant`：子 B disabled 且绑用户 → `A.subtree_member_count` 仍含该用户（D-002@v1 按结构聚合）。
   - `test_to_read_injects_subtree`：`_to_read(session, org)` 返回的 `OrganizationRead` 含 `subtree_member_count` 字段且值正确（>0 或 ==0 视数据）。
   - `test_list_organizations_has_subtree_field`：`list_organizations` 返回每项 `.subtree_member_count` 为 int（非 None / 非 missing）。
   - `test_descendant_ids_excludes_root`（回归保护）：确认 `_descendant_ids(root)` 不含 root → 验证 `_subtree_member_count` 必须自加 root（防漏算）。
2. **跑测试**确认全红（`_subtree_member_count` 未实现 / `_to_read` 未注入）。
3. **改 service**（按 §5.1 新增 `_subtree_member_count`，§5.2 改 `_to_read` 注入）。
4. **跑测试**确认全绿。
5. 跑既有 `test_organizations_service` 全量（回归：member_count/children_count/delete 前置校验不受影响）。
6. `ruff check backend/app/modules/admin/organizations_service.py` + `mypy backend/app/modules/admin/organizations_service.py` 通过。

## 10. 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | `_subtree_member_count` 存在且为模块级 async 函数 | `callable(_subtree_member_count)` 且签名 `(session, org_id) -> int` |
| AC-02 | 叶子组织子树计数 | `_subtree_member_count(leaf) == member_count(leaf)`（无下级时等于直接成员数）|
| AC-03 | 父组织含下级 | A→B→C 各绑不同用户，`A.subtree == 3` |
| AC-04 | distinct 去重（D-003@v1）| 一用户绑 A+B（A 父 B），`A.subtree` 对该用户只计 1 次 |
| AC-05 | root 自加（关键）| A 绑用户、A 无下级，`A.subtree >= 1`（不漏算 root 直接成员）|
| AC-06 | `_to_read` 注入 | `_to_read(session, org)` 返回对象 `.subtree_member_count` 为 int |
| AC-07 | `list_organizations` 覆盖 | 每项 `.subtree_member_count` 非 None（service 经 `_to_read` 自动注入）|
| AC-08 | 含 disabled 下级（D-002@v1）| A 子 B disabled 且绑用户，`A.subtree` 含该用户 |
| AC-09 | 0 成员 | 无成员子树 `.subtree_member_count == 0` |
| AC-10 | 回归 | 既有 organizations_service 测试全绿（member_count/children_count/delete 不受影响）|
| AC-11 | `ruff check backend/app/modules/admin/organizations_service.py` | 无告警 |
| AC-12 | `mypy backend/app/modules/admin/organizations_service.py` | 无类型错误 |
| AC-13 | 仅改 `backend/app/modules/admin/organizations_service.py`，`git diff --stat` 不含其他文件 | true |

## 11. 完成定义

- [ ] §5.1 `_subtree_member_count` 落地（复用 `_descendant_ids` + root 自加 + distinct user_id）
- [ ] §5.2 `_to_read` 注入 `subtree_member_count`
- [ ] §9 TDD 测试用例全绿（含 distinct 去重 + root 自加 + disabled 下级 + 回归保护）
- [ ] 既有 organizations_service 测试全绿（无回归）
- [ ] §10 AC-01~AC-13 全部通过
- [ ] `git diff` 仅含 `backend/app/modules/admin/organizations_service.py`
