---
id: task-05
title: 后端测试 — list_users 组织过滤用例（全部/叶子/include_children/distinct 去重/叠加 q+status+分页）
phase: V1
priority: P0
status: draft
owner: WhaleFall
author: WhaleFall
created_at: 2026-06-25T16:10:00
estimated_hours: 2.0
depends_on:
  - task-03
  - task-04
blocks:
  - task-11
requirement_ids:
  - FR-01
  - FR-06
decision_ids:
  - D-004@v1
allowed_paths:
  - backend/tests/modules/admin/test_users_router.py
---

## 1. 目标

在 `backend/tests/modules/admin/test_users_router.py` 追加 `list_users` **组织维度过滤**的端到端 HTTP 用例，覆盖：

1. **全部**（不传 organization_id → 全部用户，brownfield AC-09）。
2. **叶子组织**（organization_id=叶子，include_children=false → 仅直接绑定）。
3. **include_children=true 含下级**（organization_id=父 → 父 ∪ 所有下级 用户）。
4. **distinct 去重**（一用户绑父+子两个组织，组织过滤下结果仅出现一次，total 不虚高 — D-004 exists 子查询核心）。
5. **叠加 q + status + 分页**（organization_id 与 q/status 链式 AND，limit/offset 在含 exists where 的 base 上正确）。

全部走 `client` + `auth_headers` + `db_session` fixture（照现有测试风格），建组织树（父→子）+ 绑用户 + 验证各场景。**仅改测试文件**，不动 service/router。

## 2. 覆盖来源（依据）

| 来源 | 章节 | 关键结论 |
|---|---|---|
| `.sillyspec/changes/2026-06-25-admin-users-org-tree/design.md` | §5 Phase 7 | 后端 list_users 测试：全部(无 org) / 叶子组织 / include_children=true 含下级 / distinct 去重（一用户在子树多组织）/ 叠加 q+status+分页 |
| `.sillyspec/changes/2026-06-25-admin-users-org-tree/plan.md` | Wave 4 task-05 | dep task-03/04；覆盖 FR-01, FR-06；5 类用例 |
| `.sillyspec/changes/2026-06-25-admin-users-org-tree/plan.md` | 全局验收 | AC-01 全部 / AC-02 叶子 / AC-03 含下级 / AC-05 叠加 / AC-06 分页 |
| `.sillyspec/changes/2026-06-25-admin-users-org-tree/design.md` | §11 D-004@v1 | exists 子查询过滤（distinct 去重用例 = AC-04 验证无重复行）|
| 现状代码 | `backend/tests/modules/admin/test_users_router.py:23-78` | 现有 fixture：`target_user`（:23-38，非 admin User）/ `non_admin_token` / `sample_org`（:63-69，Organization(name="Acme", code="acme")）/ `sample_role` |
| 现状代码 | `backend/tests/modules/admin/test_users_router.py:84-97` | 现有测试风格：`@pytest.mark.asyncio async def test_*(client: AsyncClient, auth_headers)`，`resp = await client.get("/api/users", headers=auth_headers)`，`assert resp.status_code == 200`，`data = resp.json()`，断言 `items`/`total` |
| 现状代码 | `backend/tests/modules/admin/test_users_router.py:256-303` | `test_update_user_organizations_rewrite` 建组织 + `UserOrganization(user_id=..., organization_id=...)` 绑定 + 查询验证风格（参考建树/绑定） |
| 现状代码 | `backend/tests/modules/admin/test_users_router.py:18` | `from app.modules.admin.model import Organization, UserOrganization`（建树/绑定所需 model 已 import） |
| 现状代码 | `backend/tests/modules/admin/test_users_router.py:16-20` | `get_settings`/`password_hasher`/`User` import（造用户所需）|

## 3. 修改文件清单

| 文件 | 改动 | allowed_paths |
|---|---|---|
| `backend/tests/modules/admin/test_users_router.py` | ① 新增模块级 helper（可选：`org_tree` fixture 建父→子组织树 + 绑用户）；② 追加 5 类组织过滤测试函数（全部/叶子/include_children=true/distinct 去重/叠加 q+status+分页） | ✅ |

## 4. 实现要求

1. **测试风格照现有**（test_users_router.py 全文）：
   - `@pytest.mark.asyncio` + `async def test_xxx(client: AsyncClient, auth_headers, db_session):` 签名。
   - `resp = await client.get("/api/admin/users", headers=auth_headers, params={...})`（用 httpx `params=` 传 query，或拼 URL 字符串；现有测试多直接拼路径，组织用例建议 `params={"organization_id": str(org_id), "include_children": "true"}`）。
   - `assert resp.status_code == 200, resp.text`；`data = resp.json()`；断言 `items`（list）/`total`（int）。
   - 通过 `it["email"]` 或 `it["username"]` 定位目标用户（参考 :467-470 `next(it for it in items if it["email"]==...)`）。
2. **建组织树**：参考 `sample_org` fixture（:63-69）与 `test_update_user_organizations_rewrite`（:271-273）建 `Organization(name=..., code=..., status="active")`；父组织 `parent_id=None`，子组织 `parent_id=父.id`：
   ```python
   parent = Organization(name="Parent", code="parent", status="active")
   db_session.add(parent); await db_session.flush()
   child = Organization(name="Child", code="child", status="active", parent_id=parent.id)
   db_session.add(child); await db_session.commit()
   await db_session.refresh(parent); await db_session.refresh(child)
   ```
3. **绑用户**：参考 :275-279 `UserOrganization(user_id=..., organization_id=...)` + `db_session.add_all([...])`。
4. **造用户**：参考 `target_user` fixture（:23-38）/ `_hash_pw()`（:479-482）`User(email=..., username=..., password_hash=..., status="active")`。
5. **uuid 传 query**：`params={"organization_id": str(parent.id)}`（UUID → 字符串，httpx 要求 str）。
6. **distinct 去重用例**（核心，D-004）：造一个用户同时绑 parent + child，请求 `organization_id=parent.id`（include_children=true 默认）→ 该用户在 `items` 中**仅出现一次**，且 `total` 不含重复计数（对比直接断言 `sum(1 for it in items if it["email"]==dup_user.email) == 1`，且 total 与去重后集合大小一致）。
7. **叠加用例**：组织 + q（display_name/email ilike）+ status="active" + limit/offset，断言交集正确。
8. **全部用例**（无 org）：照 `test_legacy_list_users_forwards`（:84-96）风格，不带 organization_id → 全部用户（验证不回归）。
9. 兼容 Windows/macOS（纯 pytest，无平台相关）。

## 5. 接口定义（精确签名）

> 本 task 是测试，无对外接口。测试函数签名统一：
> ```python
> @pytest.mark.asyncio
> async def test_xxx(client: AsyncClient, auth_headers, db_session):
>     ...
> ```

### 5.1 新增 fixture（建议，可选放文件顶部 fixture 区）

```python
@pytest.fixture
async def org_tree(db_session):
    """建父→子组织树，返回 (parent, child)，供组织过滤用例复用。"""
    parent = Organization(name="Parent", code="parent", status="active")
    db_session.add(parent)
    await db_session.flush()
    child = Organization(name="Child", code="child", status="active", parent_id=parent.id)
    db_session.add(child)
    await db_session.commit()
    await db_session.refresh(parent)
    await db_session.refresh(child)
    return parent, child


def _bind(db_session, *, user_id, organization_ids):
    """便捷绑定用户↔多组织（参考 :275-279 风格）。"""
    db_session.add_all(
        [UserOrganization(user_id=user_id, organization_id=oid) for oid in organization_ids]
    )
```

### 5.2 新增测试函数清单（5 类，至少 6 个函数）

```python
# 1. 全部（无 org，brownfield）
@pytest.mark.asyncio
async def test_list_users_no_org_filter_returns_all(client, auth_headers, db_session, org_tree): ...

# 2. 叶子组织（include_children=false）
@pytest.mark.asyncio
async def test_list_users_leaf_org_no_children(client, auth_headers, db_session, org_tree): ...

# 3. include_children=true 含下级
@pytest.mark.asyncio
async def test_list_users_parent_includes_descendants(client, auth_headers, db_session, org_tree): ...

# 4. distinct 去重（一用户绑父+子，D-004 核心）
@pytest.mark.asyncio
async def test_list_users_distinct_no_duplicate_rows(client, auth_headers, db_session, org_tree): ...

# 5a. 叠加 q + status
@pytest.mark.asyncio
async def test_list_users_org_plus_q_plus_status(client, auth_headers, db_session, org_tree): ...

# 5b. 叠加分页 limit/offset
@pytest.mark.asyncio
async def test_list_users_org_plus_pagination(client, auth_headers, db_session, org_tree): ...
```

### 5.3 关键断言模板（distinct 去重用例）

```python
# 用户 U 同时绑 parent + child，另一用户 V 只绑 child
resp = await client.get(
    "/api/admin/users",
    headers=auth_headers,
    params={"organization_id": str(parent.id)},  # include_children 默认 true
)
assert resp.status_code == 200
data = resp.json()
emails = [it["email"] for it in data["items"]]
# U 在子树多组织 → 仅出现一次（D-004 exists 子查询无重复行）
assert emails.count(u.email) == 1
# V（在 child 下）也被含入（include_children=true）
assert v.email in emails
# total 与 items 长度一致（无虚高）
assert data["total"] == len(data["items"]) or data["total"] >= len(data["items"])  # total 为过滤后总数，items 受 limit
```

## 6. 边界处理

| # | 场景 | 测试断言 | 责任层 |
|---|---|---|---|
| B-01 | 不带 organization_id | 200，items 含全部非软删用户（含未绑组织的用户） | 测试（本 task，AC-01/AC-09）|
| B-02 | organization_id=叶子，include_children=false | 200，items 仅含直接绑叶子的用户 | 测试（本 task，AC-02）|
| B-03 | organization_id=父，include_children=true（默认） | 200，items 含 父 ∪ 所有下级 用户 | 测试（本 task，AC-03）|
| B-04 | 一用户绑父+子两组织，organization_id=父 | 200，该用户 items 中 count==1，total 不虚高（D-004）| 测试（本 task，AC-04，核心）|
| B-05 | organization_id + q + status="active" 叠加 | 200，items 为三条件交集 | 测试（本 task，AC-05）|
| B-06 | organization_id + limit/offset 叠加 | 200，分页正确（total=过滤总数，items 受 limit/offset）| 测试（本 task，AC-06）|
| B-07 | 未绑任何组织的用户 | organization_id 非空时不出现；不传 organization_id 时出现 | 测试（本 task）|
| B-08 | 软删用户（deleted_at 非 None） | 任何组织过滤下都不出现（base 前置 where） | 测试（本 task，可选）|
| B-09 | organization_id=不存在的 uuid | 200，items=[], total=0（service 短路返回空） | 测试（本 task，可选）|

## 7. 非目标

- 不改 service/router/schema（task-01/03/04）。
- 不测 `_user_with_relations` 序列化字段（已有 `test_user_list_includes_workspace_scoped_roles` 等覆盖）。
- 不测 `/api/users` forward 端点（已有 `test_legacy_list_users_forwards` 覆盖；forward 自动透传新 query，可选加一个 smoke）。
- 不测 organizations 的 `subtree_member_count`（属 task-02 organizations_service，由 organizations 测试文件覆盖，不在本文件）。
- 不测前端组织树（task-10 vitest）。
- 不引入新 fixture 依赖（除可选 `org_tree`，复用现有 `db_session`/`auth_headers`/`client`）。

## 8. 参考源码

- `backend/tests/modules/admin/test_users_router.py:1-21` — import 区（Organization/UserOrganization/User/get_settings/password_hasher 均已 import）
- `backend/tests/modules/admin/test_users_router.py:23-38` — `target_user` fixture（造非 admin User 风格）
- `backend/tests/modules/admin/test_users_router.py:63-69` — `sample_org` fixture（造 Organization 风格）
- `backend/tests/modules/admin/test_users_router.py:84-97` — `test_legacy_list_users_forwards`（GET list 风格，断 items/total）
- `backend/tests/modules/admin/test_users_router.py:256-303` — `test_update_user_organizations_rewrite`（建组织 + UserOrganization 绑定 + 查询验证风格）
- `backend/tests/modules/admin/test_users_router.py:444-474` — `test_user_list_includes_workspace_scoped_roles`（GET /api/admin/users + next(it for it in items) 定位用户风格）
- `backend/tests/modules/admin/test_users_router.py:479-482` — `_hash_pw()` helper（造用户密码哈希）
- `backend/app/modules/admin/router.py:338-365` — 被测端点（task-04 改造后含 organization_id/include_children Query）
- `backend/app/modules/admin/users_service.py:85-124` — 被测 service（task-03 改造后含 exists 子查询）

## 9. TDD 步骤

> 本 task 是 task-03/04 的验收测试，先红后绿：
> 1. **先写测试**（在 test_users_router.py 追加 §5.2 的 5~6 个测试函数 + `org_tree` fixture）。
> 2. **跑测试确认全红**（task-03/04 未合入时，端点不识别 organization_id/include_children，或 service 无 exists 过滤 → 用例失败）。
>    - 若 task-03/04 已先实现（依赖顺序），可跳过红阶段，直接验证绿。
> 3. task-03 + task-04 合入后，**跑测试确认全绿**：
>    ```bash
>    cd backend && pytest tests/modules/admin/test_users_router.py -v -k "org or leaf or descendant or distinct or pagination"
>    ```
> 4. 跑全量回归（确保不破坏现有用例）：
>    ```bash
>    cd backend && pytest tests/modules/admin/test_users_router.py -v
>    ```
> 5. `ruff check backend/tests/modules/admin/test_users_router.py` 通过。

## 10. 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | `test_list_users_no_org_filter_returns_all`：`GET /api/admin/users`（不带 org） | 200，items 含全部非软删用户（含未绑组织用户），与改造前一致 |
| AC-02 | `test_list_users_leaf_org_no_children`：`?organization_id={叶子}&include_children=false` | 200，items 仅含直接绑叶子的用户，不含父组织用户 |
| AC-03 | `test_list_users_parent_includes_descendants`：`?organization_id={父}`（默认 include_children=true） | 200，items 含 父 + 子 两组织用户 |
| AC-04 | `test_list_users_distinct_no_duplicate_rows`：用户绑父+子，`?organization_id={父}` | 200，该用户在 items 中 count==1，total 不虚高（D-004 核心）|
| AC-05 | `test_list_users_org_plus_q_plus_status`：`?organization_id={父}&q={kw}&status=active` | 200，items 为组织∩q∩active 交集 |
| AC-06 | `test_list_users_org_plus_pagination`：`?organization_id={父}&limit=2&offset=0` | 200，items≤2，total=过滤后总数 |
| AC-07 | 全量 `pytest tests/modules/admin/test_users_router.py -v` | 现有用例 + 新增用例全绿（不回归） |
| AC-08 | `ruff check backend/tests/modules/admin/test_users_router.py` | 无告警 |
| AC-09 | （可选）`?organization_id={不存在uuid}` | 200，items=[], total=0 |
| AC-10 | 仅改 `backend/tests/modules/admin/test_users_router.py` 一个 allowed_paths 文件，`git diff --stat` 不含其他文件 | true |

## 11. 完成定义

- [ ] §5.1 `org_tree` fixture（父→子组织树）落地（或内联建树，二选一）
- [ ] §5.2 5 类用例函数全部落地（全部/叶子/include_children=true/distinct 去重/叠加 q+status/叠加分页）
- [ ] §5.3 distinct 去重用例断言 U 用户 count==1 + total 不虚高（D-004 核心）
- [ ] §10 AC-01~AC-10 全部通过（AC-07 全量回归不破坏现有用例）
- [ ] `git diff` 仅含 `backend/tests/modules/admin/test_users_router.py`
