---
id: task-01
title: 后端 schema — OrganizationRead +subtree_member_count、UserQueryParams +organization_id/include_children
phase: V1
priority: P0
status: draft
owner: WhaleFall
author: WhaleFall
created_at: 2026-06-25T16:10:00
estimated_hours: 0.5
depends_on: []
blocks:
  - task-03
  - task-04
requirement_ids:
  - FR-02
decision_ids:
  - D-003@v1
allowed_paths:
  - backend/app/modules/admin/schema.py
---

## 1. 目标

仅改 `admin/schema.py` 两处 Pydantic DTO 声明，为「组织树筛选 + 节点人数展示」铺路：

- `OrganizationRead`（schema.py:140-159）增 `subtree_member_count: int`（当前 + 所有下级 distinct 成员数，由 service 注入）。
- `UserQueryParams`（schema.py:247-254）增 `organization_id: uuid.UUID | None = None`、`include_children: bool = True`（保持定义同步以备未来 router 迁移；Phase 3 router 现用裸 `Query`，本 task 不改 router）。

本 task **只改 schema（DTO 声明）**，不动 service / router / model / migration。

## 2. 覆盖来源（依据）

| 来源 | 章节 | 关键结论 |
|---|---|---|
| `.sillyspec/changes/2026-06-25-admin-users-org-tree/design.md` | §5 Phase 0 | `OrganizationRead`（:140-165）增 `subtree_member_count: int`；`UserQueryParams`（:247-254）增 `organization_id: uuid.UUID \| None = None`、`include_children: bool = True`；注：router 现用裸 Query，UserQueryParams 保持定义同步以备未来迁移 |
| `.sillyspec/changes/2026-06-25-admin-users-org-tree/design.md` | §7.4 接口定义 | `subtree_member_count: int`（当前+所有下级 distinct 成员数） |
| `.sillyspec/changes/2026-06-25-admin-users-org-tree/decisions.md` | D-003@v1 | `subtree_member_count = distinct user_id`（同一用户在子树多组织只计 1）|
| `.sillyspec/changes/2026-06-25-admin-users-org-tree/plan.md` | Wave 1 task-01 | 覆盖 FR-02, D-003@v1 |
| 现状代码 | `backend/app/modules/admin/schema.py:140-159` | `OrganizationRead` 现含 member_count/children_count，无 subtree_member_count |
| 现状代码 | `backend/app/modules/admin/schema.py:247-254` | `UserQueryParams` 现仅 q/status/role/sort/order/limit/offset |

## 3. 修改文件清单

| 文件 | 改动 | allowed_paths |
|---|---|---|
| `backend/app/modules/admin/schema.py` | `OrganizationRead` 增 `subtree_member_count: int` 字段；`UserQueryParams` 增 `organization_id` / `include_children` 字段 | ✅ |

## 4. 实现要求

1. 仅改 Pydantic 字段声明，不改方法、不改 `model_config`、不改既有字段顺序。
2. `OrganizationRead` 新增 `subtree_member_count` 放在 `member_count` / `children_count` 之后、`created_at` 之前（聚合计数归组），保持 `from_attributes=True` 不变（该字段由 service 构造时显式传入，不依赖 ORM 属性）。
3. `UserQueryParams` 新增 `organization_id` / `include_children` 追加到末尾（`offset` 之后），不改既有字段。
4. 不引入新 import（`uuid.UUID` / `bool` / PEP 604 `X | None` 写法，文件已 `from __future__ import annotations` 且已 `import uuid`）。
5. `OrganizationDetail(OrganizationRead)` 继承新字段，无需单独改 `OrganizationDetail`（继承自动含 `subtree_member_count`）。
6. 不动 `__all__`（类名未变，仅加字段）。

## 5. 接口定义（精确到 Pydantic 字段）

### 5.1 `admin/schema.py` — `OrganizationRead`（增字段）

```python
class OrganizationRead(BaseModel):
    """Single org + aggregate counts.

    ``member_count`` / ``children_count`` are filled by the service via
    a single GROUP BY query (no N+1). ``subtree_member_count`` covers
    the current org plus every descendant (distinct user_id).
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    code: str
    description: str | None
    parent_id: uuid.UUID | None
    status: Literal["active", "disabled"]
    sort_order: int
    member_count: int
    children_count: int
    subtree_member_count: int        # ← 新增：当前 + 所有下级 distinct 成员数（service 注入）
    created_at: datetime
    updated_at: datetime
```

字段语义：
- `subtree_member_count`：聚合计数，等于「当前组织 + 全部下级组织」中 distinct user_id 数（同一用户在子树内多组织只计一次，D-003@v1）。service 层 `_to_read` 实时计算注入（task-02 实现），DTO 仅声明。

### 5.2 `admin/schema.py` — `UserQueryParams`（增字段）

```python
class UserQueryParams(BaseModel):
    q: str | None = None
    status: str | None = None
    role: str | None = None
    sort: str = "created_at"
    order: str = "desc"
    limit: int = Field(default=20, ge=1, le=200)
    offset: int = Field(default=0, ge=0)
    organization_id: uuid.UUID | None = None   # ← 新增：组织维度过滤（None=全部）
    include_children: bool = True              # ← 新增：是否含下级组织（默认 true，D-001@v1 前端固定 true）
```

字段语义：
- `organization_id`：组织过滤维度。`None` / 缺省 = 不过滤（全部用户，行为不变）。
- `include_children`：仅当 `organization_id` 非空时有意义；`True` = 当前 + 下级，`False` = 仅当前组织。默认 `True`（D-001@v1）。
- **注**：router 现用裸 `Query`（非 `UserQueryParams`），本字段组保持定义同步以备未来迁移；当前路由层在 task-04 单独加裸 Query 参数。

## 6. 边界处理

| # | 场景 | 行为 | 责任层 |
|---|---|---|---|
| B-01 | `OrganizationRead` 构造未传 `subtree_member_count` | Pydantic 返回 422（Field required）→ service 构造处必须传（task-02 `_to_read` 注入）| schema（本 task）；service（task-02）|
| B-02 | `UserQueryParams()` 全缺省 | 实例化成功，`.organization_id is None`、`.include_children is True`（默认不过滤、默认含下级）| schema（本 task）|
| B-03 | `UserQueryParams(organization_id="<uuid>")` 不传 include_children | `.include_children is True`（默认值，D-001@v1）| schema（本 task）|
| B-04 | `OrganizationDetail` 继承 `subtree_member_count` | 自动含该字段，service 构造 detail 时需注入（task-02 经 `_to_read` 路径自动覆盖）| schema（本 task）；service（task-02）|
| B-05 | 旧前端忽略 `subtree_member_count` | 后端响应多一个字段，前端不读不报错（brownfield 兼容，design §9）| schema（本 task）|
| B-06 | 现有 `list_organizations` / `get_organization` 序列化 | 因新字段为必填 int，service 必须在 `_to_read` 注入，否则序列化失败（task-02 强制注入）| service（task-02）|

## 7. 非目标

- 不改 service / router / model / migration（task-02/03/04）。
- 不给 `subtree_member_count` 加默认值（必填，强制 service 注入；避免默认 0 误导 UI）。
- 不改 `OrganizationBrief` / `RoleBrief` 等其他类（不在本期范围）。
- 不改 router 现有裸 `Query` 写法（task-04 单独处理）。
- 不改 `OrganizationDetail` 类定义（继承自动覆盖）。
- 不改前端类型（task-06）。
- 不为 `subtree_member_count` 加缓存（D-005@v1 实时算）。

## 8. 参考

- `backend/app/modules/admin/schema.py:140-159`（现状：`OrganizationRead`，无 subtree_member_count）
- `backend/app/modules/admin/schema.py:162-165`（`OrganizationDetail(OrganizationRead)` 继承）
- `backend/app/modules/admin/schema.py:247-254`（现状：`UserQueryParams`，无组织字段）
- `backend/app/modules/admin/organizations_service.py:100-114`（`_to_read` 注入点，task-02 改）
- `.sillyspec/changes/2026-06-25-admin-users-org-tree/design.md` §5 Phase 0 / §7.4 / §11 D-003@v1
- `.sillyspec/changes/archive/2026-06-25-2026-06-24-username-login/tasks/task-02.md`（蓝图格式参考）

## 9. TDD 步骤

> 本 task 仅改 DTO，无运行时逻辑；TDD 聚焦「字段存在性 / 类型 / 必填性 / 默认值」与「子类继承」。

1. **先写测试**（`backend/app/modules/admin/tests/test_schema_org_tree.py` 新增，或复用既有 schema 测试文件追加用例）：
   - `test_organization_read_has_subtree_member_count`：`"subtree_member_count" in OrganizationRead.model_fields` 且字段类型注解为 `int`。
   - `test_organization_read_requires_subtree_member_count`：手工构造 dict（缺 subtree_member_count）→ `ValidationError`（Field required）。
   - `test_organization_read_ok_with_subtree`：补全所有必填字段含 `subtree_member_count=5` → 实例化成功，`.subtree_member_count == 5`。
   - `test_organization_detail_inherits_subtree`：`"subtree_member_count" in OrganizationDetail.model_fields`（继承覆盖）。
   - `test_user_query_params_defaults`：`UserQueryParams()` → `.organization_id is None`、`.include_children is True`。
   - `test_user_query_params_with_org`：`UserQueryParams(organization_id=some_uuid)` → `.organization_id == some_uuid`、`.include_children is True`（默认）。
   - `test_user_query_params_include_children_false`：`UserQueryParams(organization_id=some_uuid, include_children=False)` → `.include_children is False`。
2. **跑测试**确认全红（字段还未加）。
3. **改 schema**（按 §5 加 3 个字段：OrganizationRead.subtree_member_count、UserQueryParams.organization_id、UserQueryParams.include_children）。
4. **跑测试**确认全绿。
5. `ruff check backend/app/modules/admin/schema.py` + `mypy backend/app/modules/admin/schema.py` 通过。

## 10. 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | `OrganizationRead.model_fields` 含 `subtree_member_count` | 字段存在，类型注解为 `int` |
| AC-02 | `OrganizationRead` 缺 `subtree_member_count` 构造 | Pydantic `ValidationError`（Field required）|
| AC-03 | `OrganizationRead(... subtree_member_count=5 ...)` 构造 | 成功，`.subtree_member_count == 5` |
| AC-04 | `OrganizationDetail.model_fields` 含 `subtree_member_count` | True（继承覆盖）|
| AC-05 | `UserQueryParams()` 默认 | `.organization_id is None`、`.include_children is True` |
| AC-06 | `UserQueryParams(organization_id=<uuid>)` 不传 include_children | `.include_children is True`（D-001@v1 默认）|
| AC-07 | `UserQueryParams(organization_id=<uuid>, include_children=False)` | `.include_children is False` |
| AC-08 | `ruff check backend/app/modules/admin/schema.py` | 无告警 |
| AC-09 | `mypy backend/app/modules/admin/schema.py` | 无类型错误 |
| AC-10 | 仅改 `backend/app/modules/admin/schema.py`，`git diff --stat` 不含其他文件 | true |

## 11. 完成定义

- [ ] §5 的 3 处字段改动落地（OrganizationRead.subtree_member_count、UserQueryParams.organization_id、UserQueryParams.include_children）
- [ ] §9 TDD 测试用例全绿
- [ ] §10 AC-01~AC-10 全部通过
- [ ] `git diff` 仅含 `backend/app/modules/admin/schema.py`
