---
task_id: task-05
title: 后端 router 透传 — admin/router.py + settings/router.py 的 create/update 端点手动逐字段透传补 username（create）/ username+email（update）
author: WhaleFall
created_at: 2026-06-25T08:43:50
priority: P0
depends_on: [task-03]
blocks: [task-08]
decision_ids: [D-004@v1]
requirement_ids: []
allowed_paths:
  - backend/app/modules/admin/router.py
  - backend/app/modules/settings/router.py
---

# task-05 — 后端 router 透传（admin/settings create/update 补字段）

## 1. 背景

`admin/router.py` 与 `settings/router.py` 的 `create_user` / `update_user` 端点是**手动逐字段透传** service（非 `**payload` 解包），task-02 给 schema 加字段、task-03 给 `UserService.create_user/update_user` 加参数后，router 透传层必须各自显式补传新增字段，否则前端传入的 `username`（create/update）、`email`（update）会被吞掉。

现状（已核实）：

| 端点 | 位置 | 缺失透传 |
|---|---|---|
| admin `create_user` | `admin/router.py:394-403` | 已透传 `username=payload.username`（无需改） |
| admin `update_user` | `admin/router.py:419-427` | 缺 `username` / `email` |
| settings `create_user` | `settings/router.py:145-153` | 缺 `username` |
| settings `update_user` | `settings/router.py:165-173` | 缺 `username` / `email` |

> design.md Phase 2 router 段明确：「schema 虽共享（settings re-export admin），但 router 透传层必须分别改」（Grill 修订点）。两个 router 各自改，不可只改一处。

## 2. 修改文件

- `backend/app/modules/admin/router.py`：仅 `update_user` 端点补 `username` / `email` 透传（`create_user` 已透传 `username`，不动）。
- `backend/app/modules/settings/router.py`：`create_user` 补 `username`；`update_user` 补 `username` / `email`。

## 3. 覆盖来源

- `design.md` Phase 2 — 后端 service / router 段（L56-59：两 router create/update 各自补字段）。
- `plan.md` Wave 3 task-05 行（L26）+ 调用点搜索记录（L99-100：`UserService.create_user` / `update_user` 仅 admin + settings 两 router 调用，无遗漏）。
- 决策：`D-004@v1`（username 可编辑）— update 端点透传 `username` 才能让前端编辑登录名生效。
- task-03：service 签名已加 `username` / `email` 参数（本任务不动 service）。

## 4. 实现要求

- 不改 service 签名（task-03 已改），**只改 router 透传调用**。
- 不改端点路径、HTTP 方法、权限依赖、response_model、status_code。
- schema 共享（settings re-export admin），但 router 透传分别改。
- `username` / `email` 在 `UserUpdateRequest` 为 `Optional`（`None = 不改`），直接透传 `payload.username` / `payload.email`，由 service 层判断 None 跳过；router 不做默认值替换。
- `email` 透传保持原值，归一/唯一校验由 service 层负责（task-03），router 不做 `.lower()`。

## 5. 接口定义（透传后的调用代码片段）

### 5.1 `admin/router.py` — `update_user`（补 username/email）

```python
    svc = UserService(session, user.id)
    target = await svc.update_user(
        user_id,
        display_name=payload.display_name,
        is_platform_admin=payload.is_platform_admin,
        status=payload.status,
        login_enabled=payload.login_enabled,
        username=payload.username,
        email=payload.email,
        organization_ids=payload.organization_ids,
        role_ids=payload.role_ids,
    )
    return await _user_with_relations(session, target)
```

> admin `create_user`（394-403）已透传 `username=payload.username`，本任务不动。

### 5.2 `settings/router.py` — `create_user`（补 username）

```python
    svc = _svc(session, user.id)
    target = await svc.create_user(
        email=payload.email,
        password=payload.password,
        username=payload.username,
        display_name=payload.display_name,
        is_platform_admin=payload.is_platform_admin,
        login_enabled=payload.login_enabled,
        organization_ids=payload.organization_ids or None,
        role_ids=payload.role_ids or None,
    )
    return await _enrich(session, target)
```

### 5.3 `settings/router.py` — `update_user`（补 username/email）

```python
    svc = _svc(session, user.id)
    target = await svc.update_user(
        uuid.UUID(user_id),
        display_name=payload.display_name,
        is_platform_admin=payload.is_platform_admin,
        status=payload.status,
        login_enabled=payload.login_enabled,
        username=payload.username,
        email=payload.email,
        organization_ids=payload.organization_ids,
        role_ids=payload.role_ids,
    )
    return await _enrich(session, target)
```

## 6. 边界处理

1. **`username` / `email` 为 Optional（None = 不改）**：直接透传 `payload.username` / `payload.email`，None 由 service 层 `update_user` 判断跳过（task-03 实现）；router 不把 None 改成空串或别的默认。
2. **email 归一职责归属**：router 原样透传，`.lower()` / 非空唯一校验在 service 层（task-03），避免两 router 各自归一导致行为发散。
3. **两 router 行为一致**：admin 与 settings 的 create/update 透传字段集对齐（create 都传 `username`；update 都传 `username`+`email`），仅参数包装形式不同（admin 用 `AsyncSession`/`User`，settings 用 `SessionDep`/`AdminUser`，`user_id` 一为 `uuid.UUID` 一为 `str`+`uuid.UUID(user_id)` 转换）— 不改这些差异。
4. **不改 create 的 username 缺省逻辑**：admin create 已透传 username 不动；settings create 仅补 `username=payload.username`，不加 fallback（username 必填，task-02 schema 保证非 None）。
5. **`organization_ids` / `role_ids` 处理保持现状**：settings 端 create 用 `or None`、update 不用；admin 端 create 用 `or None`、update 不用 — 本任务不动这些既有写法，只新增 username/email 两行。
6. **空 list vs None 语义**：`organization_ids=[]` 在 settings create 走 `or None` 归零；username/email 是标量无此问题，直接透传不归一。
7. **不引入 `**payload` 解包**：保持手动逐字段透传风格（design.md 明确两 router 是手动透传），避免误传未来 schema 新增字段引发隐式契约。

## 7. 非目标

- 不改 service 签名或逻辑（task-03 范围）。
- 不改 schema（task-02 范围）。
- 不改端点路径、HTTP 方法、权限依赖、response_model、status_code。
- 不引入 `**payload` 解包替代手动透传。
- 不改前端（task-06/07 范围）。
- 不写新测试（task-08 范围），本任务只保证透传层打通。

## 8. 参考

- `design.md` Phase 2（L50-61）、风险表「settings/admin 两路由行为发散」（L106）。
- `plan.md` Wave 3 task-05、调用点搜索记录（L99-100）。
- `decisions.md` D-004@v1（username 可编辑）。
- `backend/app/modules/admin/router.py:382-428`（create/update 现状）。
- `backend/app/modules/settings/router.py:138-174`（create/update 现状）。

## 9. TDD 步骤

> router 透传层是纯接线，测试由 task-08 覆盖（create username 必填/缺失 422、update username 冲突 409、email 可选）。本任务执行阶段做：

1. 改 `admin/router.py` `update_user` 补 `username` / `email` 两行。
2. 改 `settings/router.py` `create_user` 补 `username` 一行。
3. 改 `settings/router.py` `update_user` 补 `username` / `email` 两行。
4. `cd backend && ruff check app/modules/admin/router.py app/modules/settings/router.py` 通过。
5. `cd backend && mypy app/modules/admin/router.py app/modules/settings/router.py` 通过（参数名与服务签名一致）。
6. 跑既有相关测试不回归：`cd backend && pytest tests/admin tests/settings -k user -x`（若 task-08 用例尚未写，至少保证现有用例不因透传字段新增而报错）。
7. 手测冒烟（可选）：admin/settings 各 create 一个带 username 用户、update 改 username，确认请求体字段被 service 接收。

## 10. 验收标准

| 编号 | 验收项 | 验证方式 |
|---|---|---|
| AC-1 | `admin/router.py` `update_user` 透传 `username=payload.username`、`email=payload.email` | 读 diff / grep `update_user` 块含两字段 |
| AC-2 | `settings/router.py` `create_user` 透传 `username=payload.username` | 读 diff / grep `create_user` 块含 username |
| AC-3 | `settings/router.py` `update_user` 透传 `username`、`email` | 读 diff |
| AC-4 | `admin/router.py` `create_user` 未被改动（已透传 username） | git diff 该端点为空 |
| AC-5 | 不改端点路径/方法/权限/response_model/status_code | git diff 仅新增透传行 |
| AC-6 | 不改 service 签名（本任务零改 service） | git diff 不含 `users_service.py` |
| AC-7 | ruff + mypy 对两 router 文件通过 | 本地命令 |
| AC-8 | 既有 admin/settings user 相关测试不回归 | pytest |
| AC-9 | 两 router update 透传字段集一致（都含 username+email） | 人工比对 |
