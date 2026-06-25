---
id: task-04
title: 后端 router — /api/admin/users +organization_id/include_children Query 透传
phase: V1
priority: P0
status: draft
owner: WhaleFall
author: WhaleFall
created_at: 2026-06-25T16:10:00
estimated_hours: 0.5
depends_on:
  - task-03
blocks:
  - task-05
requirement_ids:
  - FR-01
decision_ids: []
allowed_paths:
  - backend/app/modules/admin/router.py
---

## 1. 目标

给 `GET /api/admin/users` 端点（`router.py:338-365`）新增两个裸 `Query` 参数：

- `organization_id: uuid.UUID | None = Query(None)` — 组织过滤，缺省 None（全部组织，AC-09）。
- `include_children: bool = Query(True)` — 是否含下级组织，缺省 True（前端固定传 true，D-001）。

端点函数体内把这两个参数透传给 `svc.list_users(organization_id=..., include_children=...)`。**仅改 router.py 一处端点签名 + 一处调用**，不动 service（task-03）/schema（task-01）/响应序列化。

## 2. 覆盖来源（依据）

| 来源 | 章节 | 关键结论 |
|---|---|---|
| `.sillyspec/changes/2026-06-25-admin-users-org-tree/design.md` | §5 Phase 3 | router list_users 端点（:338-365）增 `organization_id: uuid.UUID \| None = Query(None)`、`include_children: bool = Query(True)`；透传 `svc.list_users(organization_id=..., include_children=...)` |
| `.sillyspec/changes/2026-06-25-admin-users-org-tree/design.md` | §7.1 接口定义 | `organization_id?: uuid (Query None)` / `include_children?: bool (Query True)` |
| `.sillyspec/changes/2026-06-25-admin-users-org-tree/design.md` | §9 兼容策略 | 现有 q/status/role/sort/order/limit/offset 全保留；organization_id 默认 None 零影响 |
| `.sillyspec/changes/2026-06-25-admin-users-org-tree/plan.md` | Wave 3 task-04 | dep task-03；覆盖 FR-01 |
| 现状代码 | `backend/app/modules/admin/router.py:338-365` | list_users 端点现状：裸 Query 风格（q/status_filter(alias=status)/role/sort/order/limit/offset），`svc = UserService(session, user.id)` → `await svc.list_users(q=..., status=status_filter, role=..., sort=..., order=..., limit=..., offset=...)` |
| 现状代码 | `backend/app/modules/admin/router.py:13, 16` | `import uuid` + `from fastapi import APIRouter, Depends, Path, Query, status`（Query/uuid 已 import，无需补）|

## 3. 修改文件清单

| 文件 | 改动 | allowed_paths |
|---|---|---|
| `backend/app/modules/admin/router.py` | `list_users` 端点签名增 `organization_id`/`include_children` 两个 Query 参数；调用 `svc.list_users` 时透传两参 | ✅ |

## 4. 实现要求

1. **签名**：在现有 `offset: int = Query(0, ge=0),`（router.py:352）之后，闭包括号 `)` 之前，追加：
   ```python
   organization_id: uuid.UUID | None = Query(None),
   include_children: bool = Query(True),
   ```
   风格与现有裸 Query 完全一致（`Query(None)` 默认值、`Query(True)` bool 默认）。
2. **透传**：在 `svc.list_users(...)` 调用（router.py:355-363）末尾 `offset=offset,` 之后，闭包 `)` 之前，追加：
   ```python
   organization_id=organization_id,
   include_children=include_children,
   ```
3. **不改**：`status_filter: str | None = Query(None, alias="status")` 的 alias 语义、`limit: int = Query(20, ge=1, le=200)` 的 ge/le 约束、`response_model=UserListResponse`、`dependencies=[Depends(require_permission_any(Permission.USER_READ))]`、`_user_with_relations` 序列化、`return UserListResponse(items=items, total=total)`。
4. **无新 import**：`uuid`（:13）与 `Query`（:16）已 import；`UserService`（同模块）已 import。
5. **不动** settings/users_service 的 re-export（forward `/api/users/*` 由 `settings.router` re-export admin router，自动透传新 Query 参数）。
6. 兼容 Windows/macOS（纯 Python）。

## 5. 接口定义（精确签名）

### 5.1 `GET /api/admin/users` 端点（增 2 Query）

```python
@router.get(
    "/users",
    response_model=UserListResponse,
    dependencies=[Depends(require_permission_any(Permission.USER_READ))],
)
async def list_users(
    session: Annotated[AsyncSession, Depends(get_session)],
    user: Annotated[User, Depends(get_current_user)],
    q: str | None = Query(None),
    status_filter: str | None = Query(None, alias="status"),
    role: str | None = Query(None),
    sort: str = Query("created_at"),
    order: str = Query("desc"),
    limit: int = Query(20, ge=1, le=200),
    offset: int = Query(0, ge=0),
    organization_id: uuid.UUID | None = Query(None),   # ← 新增
    include_children: bool = Query(True),              # ← 新增
) -> UserListResponse:
    svc = UserService(session, user.id)
    rows, total = await svc.list_users(
        q=q,
        status=status_filter,
        role=role,
        sort=sort,
        order=order,
        limit=limit,
        offset=offset,
        organization_id=organization_id,   # ← 新增透传
        include_children=include_children,  # ← 新增透传
    )
    items = [await _user_with_relations(session, u) for u in rows]
    return UserListResponse(items=items, total=total)
```

### 5.2 Query 参数契约

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `organization_id` | `uuid.UUID \| None` | `None` | 组织过滤；None=全部组织（不传 where）；UUID 字符串非法 → FastAPI 422 |
| `include_children` | `bool` | `True` | 是否含下级组织；organization_id 为 None 时短路无意义；`include_children=false/0/no/off` → False |

## 6. 边界处理

| # | 场景 | 行为 | 责任层 |
|---|---|---|---|
| B-01 | 不带任何 organization_id（`GET /api/admin/users`） | organization_id=None 透传，service 短路，返回全部用户 | router（本 task）→ service（task-03） |
| B-02 | `GET /api/admin/users?organization_id={uuid}`（不带 include_children） | include_children 默认 True，含下级 | router（本 task）→ service（task-03） |
| B-03 | `GET /api/admin/users?organization_id={uuid}&include_children=false` | include_children=False，只直接绑定 | router（本 task）→ service（task-03） |
| B-04 | `GET /api/admin/users?organization_id=not-a-uuid` | FastAPI Query 类型转换失败 → **422**（uuid.UUID 解析） | router（本 task，FastAPI 自动） |
| B-05 | `GET /api/admin/users?include_children=true`（不带 organization_id） | organization_id=None，include_children 被忽略（service 短路），返回全部 | router（本 task）→ service（task-03） |
| B-06 | 现有 q/status/role/sort/order/limit/offset 与新参叠加 | FastAPI 分别绑定，逐参透传 service 链式 AND | router（本 task）→ service（task-03） |
| B-07 | forward 端点 `GET /api/users`（settings re-export） | 自动获得 organization_id/include_children（同 router 复用），零额外改动 | 验证（本 task 不写代码） |

## 7. 非目标

- 不改 service 层（task-03）。
- 不改 schema（task-01 已改 UserQueryParams；router 继续走裸 Query，不引入 UserQueryParams 依赖注入）。
- 不做 organization_id 存在性校验（service 层短路返回空，B-10 of task-03）。
- 不改 forward `/api/users` 路由注册（re-export 自动透传）。
- 不改响应 schema `UserListResponse`（items 字段不变）。
- 不改权限依赖（`USER_READ` 保持全可见，不做"只看自己组织"授权限制，design §3 非目标）。

## 8. 参考源码

- `backend/app/modules/admin/router.py:13` — `import uuid`（已存在）
- `backend/app/modules/admin/router.py:16` — `from fastapi import APIRouter, Depends, Path, Query, status`（Query 已 import）
- `backend/app/modules/admin/router.py:338-353` — list_users 端点装饰器 + 现有 7 个 Query 参数签名（含 `status_filter: ... = Query(None, alias="status")`）
- `backend/app/modules/admin/router.py:352` — `offset: int = Query(0, ge=0),`（新参插入点）
- `backend/app/modules/admin/router.py:354-363` — `svc = UserService(session, user.id)` → `await svc.list_users(q=..., status=status_filter, role=..., sort=..., order=..., limit=..., offset=...)`（透传插入点）
- `backend/app/modules/admin/router.py:364-365` — `_user_with_relations` 序列化 + `return UserListResponse`（不改）

## 9. TDD 步骤

> 本 task 仅改端点签名透传（无业务逻辑），TDD 由 **task-05** 在 `test_users_router.py` 写端到端用例（HTTP 层带 organization_id/include_children query 验证）。本 task 执行时：
> 1. task-03 完成后，task-04 加 Query + 透传。
> 2. 手动 `curl "http://localhost:8000/api/admin/users?organization_id={uuid}&include_children=true"`（带 admin token）冒烟，确认 200 + 过滤生效。
> 3. task-05 落地后，端到端测试覆盖 B-01~B-06。
> 4. `ruff check backend/app/modules/admin/router.py` + `mypy backend/app/modules/admin/router.py` 通过。

## 10. 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | `GET /api/admin/users`（不带 organization_id） | 200，返回全部非软删用户，与改造前一致（brownfield，AC-09 of plan） |
| AC-02 | `GET /api/admin/users?organization_id={叶子uuid}` | 200，items 仅含绑定该叶子的用户 |
| AC-03 | `GET /api/admin/users?organization_id={父uuid}`（不带 include_children） | 200，items 含 父 ∪ 所有下级 用户（include_children 默认 true） |
| AC-04 | `GET /api/admin/users?organization_id={父uuid}&include_children=false` | 200，items 仅含直接绑定父的用户 |
| AC-05 | `GET /api/admin/users?organization_id=not-a-uuid` | **422**（FastAPI uuid.UUID 类型校验） |
| AC-06 | `GET /api/admin/users?organization_id={uuid}&q=abc&status=active` | 200，三条件叠加过滤 |
| AC-07 | forward `GET /api/users?organization_id={uuid}` | 200，同样过滤生效（re-export 透传） |
| AC-08 | OpenAPI /docs schema 显 organization_id、include_children 两 query 参数 | true（FastAPI 自动生成） |
| AC-09 | `ruff check backend/app/modules/admin/router.py` | 无告警 |
| AC-10 | `mypy backend/app/modules/admin/router.py` | 无类型错误 |
| AC-11 | 仅改 `backend/app/modules/admin/router.py` 一个 allowed_paths 文件，`git diff --stat` 不含其他文件 | true |

## 11. 完成定义

- [ ] §5.1 list_users 端点签名增 `organization_id`/`include_children` 两 Query 参数（裸 Query，风格照现有）
- [ ] §5.1 `svc.list_users(...)` 调用透传 `organization_id=organization_id, include_children=include_children`
- [ ] §6 B-01~B-07 边界场景均符合预期（B-04 非 UUID → 422）
- [ ] §10 AC-01~AC-11 全部通过
- [ ] `git diff` 仅含 `backend/app/modules/admin/router.py`
