---
id: task-04
title: 扩展 daemon runtime DTO、分页查询、别名更新和平台管理员跨 owner 管理
priority: P0
estimated_hours: 6
depends_on: [task-01, task-03]
blocks: [task-06, task-07, task-09]
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-06]
decision_ids: [D-001@v1, D-002@v1, D-003@v1, D-005@v1, D-006@v1]
allowed_paths:
  - backend/app/modules/daemon/schema.py
  - backend/app/modules/daemon/router.py
  - backend/app/modules/daemon/service.py
  - backend/app/modules/daemon/runtime/service.py
  - .sillyspec/changes/2026-06-25-admin-global-daemon-workspace-management/tasks/task-04.md
author: qinyi
created_at: 2026-06-25 17:48:59
---

# task-04: 扩展 daemon runtime DTO、分页查询、别名更新和平台管理员跨 owner 管理

## 修改文件（必填）

- `backend/app/modules/daemon/schema.py`
  - 新增 `OwnerRead`、`DaemonRuntimeUpdate`、`DaemonRuntimeListResponse`。
  - 扩展 `DaemonRuntimeRead`，增加 `display_alias: str | None` 和 `owner: OwnerRead | None = None`。
- `backend/app/modules/daemon/router.py`
  - 新增 `GET /api/daemon/runtimes/page`。
  - 新增 `PATCH /api/daemon/runtimes/{runtime_id}`。
  - 调整 `GET /api/daemon/runtimes/{runtime_id}`、`POST /disable`、`POST /enable`、`DELETE /{runtime_id}` 的调用参数，传入 `user.id` 与 `user.is_platform_admin`。
  - 保持旧 `GET /api/daemon/runtimes` 仍返回数组。
- `backend/app/modules/daemon/service.py`
  - 在 facade 中新增分页列表与别名更新委托方法。
  - 给 `get_runtime`、`disable_runtime`、`enable_runtime`、`delete_runtime` 委托签名增加 `is_platform_admin` 参数，默认 `False` 保持内部旧调用兼容。
- `backend/app/modules/daemon/runtime/service.py`
  - 实现 runtime 分页查询、owner join、筛选、总数统计。
  - 实现 `display_alias` 更新。
  - 扩展 get/disable/enable/delete 的 owner 校验逻辑：平台管理员可跨 owner，普通用户仍 owner 限制。
- `.sillyspec/changes/2026-06-25-admin-global-daemon-workspace-management/tasks/task-04.md`
  - 本任务蓝图文件；execute 阶段不再修改本文件，除非发现蓝图与设计文档矛盾并先回到 plan 修正。

## 覆盖来源

- Requirements: FR-01 平台管理员可查看全部用户 runtime，并可对非本人 runtime 执行别名更新、启用、禁用或删除；删除仍沿用 workspace 绑定 409 保护。
- Requirements: FR-02 普通账号查询 daemon runtime 分页列表时只返回自己的 runtime，传入其他人的 `user_id` 不扩大可见范围。
- Requirements: FR-03 daemon runtime 支持独立 `display_alias`，空值回退原始名称，不覆盖 daemon 注册用的 `name/provider` 语义。
- Requirements: FR-04 daemon runtime 列表支持服务端 `q/type/status/user_id/limit/offset` 筛选分页，`GET /api/daemon/runtimes/page` 必须命中固定分页端点。
- Requirements: FR-06 旧 `GET /api/daemon/runtimes` 仍返回 `DaemonRuntimeRead[]`，不能变成分页对象。
- Decisions: D-001@v1 平台管理员沿用 `is_platform_admin` 全权限短路；普通账号仍 owner 约束。
- Decisions: D-002@v1 别名独立于资源原始名称，新增 `display_alias` 且可清空。
- Decisions: D-003@v1 `user_id` 仅平台管理员生效，普通账号不能因筛选参数越权。
- Decisions: D-005@v1 `/runtimes/page` 固定路径必须先于 `/runtimes/{runtime_id}` 声明。
- Decisions: D-006@v1 owner 展示字段使用嵌套 `OwnerRead | None`，列表端点填充，详情端点可返回 `None`。

## 实现要求

1. 在 `schema.py` 增加嵌套 owner DTO。
   - `OwnerRead.user_id: uuid.UUID | None`
   - `OwnerRead.email: str | None`
   - `OwnerRead.display_name: str | None`
   - `DaemonRuntimeRead.owner: OwnerRead | None = None`
   - `DaemonRuntimeRead.display_alias: str | None`
   - `DaemonRuntimeUpdate.display_alias: str | None = Field(default=None, max_length=200)`
   - `DaemonRuntimeListResponse.items: list[DaemonRuntimeRead]`
   - `DaemonRuntimeListResponse.total: int`
   - `DaemonRuntimeListResponse.limit: int`
   - `DaemonRuntimeListResponse.offset: int`
2. 在 `router.py` 新增 `GET /runtimes/page`，完整路径为 `GET /api/daemon/runtimes/page`。
   - 必须放在现有 `GET /runtimes/{runtime_id}` 之前。
   - 建议放在现有 `GET /runtimes/usage` 之后、动态 runtime 路由之前，沿用源码中 `/runtimes/usage` 的顺序注释风格。
   - 查询参数：
     - `q: str | None = Query(default=None, max_length=200)`
     - `type_filter: str | None = Query(default=None, alias="type", max_length=50)`
     - `status_filter: str | None = Query(default=None, alias="status", max_length=20)`
     - `user_id: uuid.UUID | None = Query(default=None)`
     - `limit: int = Query(default=12, ge=1, le=100)`
     - `offset: int = Query(default=0, ge=0)`
   - 调用 service 前保留 `await svc.cleanup_stale_runtimes()`，让分页列表与旧数组列表看到一致的在线/离线状态。
3. 保留旧 `GET /api/daemon/runtimes`。
   - response_model 仍为 `list[DaemonRuntimeRead]`。
   - 不把旧端点改为 `{items,total}`。
   - 默认仍按 `user.id` 获取当前用户 runtime；平台管理员全量视图走新增 `/runtimes/page`。
   - 旧端点可以返回新增的可选字段，但不得改变顶层数组 shape。
4. 在 `router.py` 新增 `PATCH /runtimes/{runtime_id}`，完整路径为 `PATCH /api/daemon/runtimes/{runtime_id}`。
   - 请求体 `DaemonRuntimeUpdate`。
   - 仅处理 `display_alias`。
   - `display_alias=null` 表示清空别名。
   - 空 body 不做变更，返回当前 runtime；不要把空 body 误当成清空。
   - 返回 `DaemonRuntimeRead`。
5. 在 `router.py` 调整管理动作权限透传。
   - `GET /runtimes/{runtime_id}` 调用 `svc.get_runtime(runtime_id, user.id, is_platform_admin=user.is_platform_admin)`。
   - `PATCH /runtimes/{runtime_id}` 调用 `svc.update_runtime(..., user.id, is_platform_admin=user.is_platform_admin)`。
   - `POST /disable`、`POST /enable`、`DELETE /{runtime_id}` 传入同样的 `is_platform_admin`。
   - `mark_runtime_offline` 是 daemon 自身下线通道，仍使用 `get_current_principal` 与 owner 语义，不在本任务扩展为平台管理员跨 owner。
6. 在 `service.py` facade 保持薄委托。
   - 新增 `list_runtimes_page(...)` 委托到 `self._rt.list_runtimes_page(...)`。
   - 新增 `update_runtime(...)` 委托到 `self._rt.update_runtime(...)`。
   - 扩展 `get_runtime`、`disable_runtime`、`enable_runtime`、`delete_runtime` 参数，默认 `is_platform_admin=False`，避免内部旧调用被迫同步修改。
7. 在 `runtime/service.py` 实现 actor-aware 查询辅助。
   - 建议新增私有方法 `_get_runtime_for_actor(runtime_id, actor_user_id, *, is_platform_admin)`。
   - 当 runtime 不存在时抛/返回与现有语义一致的 `DaemonRuntimeNotFound` 或 `None`。
   - 当 `is_platform_admin=False` 且 `runtime.user_id != actor_user_id` 时，按现有资源隐藏策略返回 404/None，不返回 403，不泄露其他 owner runtime 是否存在。
   - 当 `is_platform_admin=True` 时不限制 `runtime.user_id`。
8. 在 `runtime/service.py` 实现分页查询。
   - 普通用户固定追加 `DaemonRuntime.user_id == actor_user_id`。
   - 平台管理员不追加 owner 限制；仅当传入 `user_id` 时追加 `DaemonRuntime.user_id == user_id`。
   - `q` 去首尾空白后为空则不加搜索条件。
   - `q` 大小写不敏感匹配 `display_alias`、`name`、`provider`、`version`。
   - `type` 精确匹配 `DaemonRuntime.provider`。
   - `status` 精确匹配 `DaemonRuntime.status`。
   - `limit/offset` 在 router 层完成边界校验，service 不重新放宽。
   - 先用同一组过滤条件查询 `total`，再查询 items，排序沿用旧 `created_at DESC`。
   - items 查询 `outerjoin(User, DaemonRuntime.user_id == User.id)`，返回 `(runtime, owner_user)` 供 router 构造 `OwnerRead`。
9. 在 `runtime/service.py` 实现别名更新。
   - 只更新 `display_alias` 与 `updated_at`。
   - 字符串别名前后空白需 `strip()`；strip 后空字符串存为 `None`。
   - 不修改 `name`、`provider`、`capabilities`、`metadata_` 等 daemon 注册字段。
   - commit 后 refresh runtime。
10. 删除保护必须保留。
    - `delete_runtime` 继续复用现有未软删 workspace 绑定检查。
    - 被未软删 workspace 绑定时仍抛 `DaemonRuntimeInUse`，HTTP 409 和 `details.workspaces` 不变。
    - 软删 workspace 引用自动 SET NULL 的逻辑不改变。

## 接口定义（代码类任务必填）

### DTO

```python
class OwnerRead(BaseModel):
    user_id: uuid.UUID | None = None
    email: str | None = None
    display_name: str | None = None


class DaemonRuntimeRead(BaseModel):
    id: uuid.UUID
    display_alias: str | None = None
    name: str | None
    provider: str | None
    version: str | None
    os: str | None
    arch: str | None
    status: str | None
    last_heartbeat_at: datetime | None
    capabilities: dict | None
    owner: OwnerRead | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class DaemonRuntimeUpdate(BaseModel):
    display_alias: str | None = Field(default=None, max_length=200)


class DaemonRuntimeListResponse(BaseModel):
    items: list[DaemonRuntimeRead]
    total: int
    limit: int
    offset: int
```

### Router 方法

```python
@router.get("/runtimes/page", response_model=DaemonRuntimeListResponse)
async def list_runtimes_page(
    session: SessionDep,
    user: RuntimeAdminUser,
    q: str | None = Query(default=None, max_length=200),
    type_filter: str | None = Query(default=None, alias="type", max_length=50),
    status_filter: str | None = Query(default=None, alias="status", max_length=20),
    user_id: uuid.UUID | None = Query(default=None),
    limit: int = Query(default=12, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> DaemonRuntimeListResponse:
    svc = DaemonService(session)
    await svc.cleanup_stale_runtimes()
    rows, total = await svc.list_runtimes_page(
        actor_user_id=user.id,
        is_platform_admin=user.is_platform_admin,
        q=q,
        type_filter=type_filter,
        status_filter=status_filter,
        user_id=user_id,
        limit=limit,
        offset=offset,
    )
    return DaemonRuntimeListResponse(
        items=[_runtime_read(runtime, owner) for runtime, owner in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.patch("/runtimes/{runtime_id}", response_model=DaemonRuntimeRead)
async def update_runtime(
    runtime_id: uuid.UUID,
    data: DaemonRuntimeUpdate,
    session: SessionDep,
    user: RuntimeAdminUser,
) -> DaemonRuntimeRead:
    svc = DaemonService(session)
    runtime = await svc.update_runtime(
        runtime_id,
        user.id,
        display_alias=data.display_alias,
        display_alias_set="display_alias" in data.model_fields_set,
        is_platform_admin=user.is_platform_admin,
    )
    return DaemonRuntimeRead.model_validate(runtime)
```

`_runtime_read` 可作为 `router.py` 内部小 helper：

```python
def _runtime_read(runtime: DaemonRuntime, owner: User | None = None) -> DaemonRuntimeRead:
    read = DaemonRuntimeRead.model_validate(runtime)
    if owner is None:
        return read
    return read.model_copy(
        update={
            "owner": OwnerRead(
                user_id=owner.id,
                email=owner.email,
                display_name=owner.display_name,
            )
        }
    )
```

### DaemonService facade

```python
async def get_runtime(
    self,
    runtime_id: uuid.UUID,
    user_id: uuid.UUID | None = None,
    *,
    is_platform_admin: bool = False,
) -> DaemonRuntime | None: ...


async def list_runtimes_page(
    self,
    *,
    actor_user_id: uuid.UUID,
    is_platform_admin: bool,
    q: str | None,
    type_filter: str | None,
    status_filter: str | None,
    user_id: uuid.UUID | None,
    limit: int,
    offset: int,
) -> tuple[list[tuple[DaemonRuntime, User | None]], int]: ...


async def update_runtime(
    self,
    runtime_id: uuid.UUID,
    actor_user_id: uuid.UUID,
    *,
    display_alias: str | None,
    display_alias_set: bool,
    is_platform_admin: bool = False,
) -> DaemonRuntime: ...


async def disable_runtime(
    self,
    runtime_id: uuid.UUID,
    user_id: uuid.UUID,
    *,
    is_platform_admin: bool = False,
) -> DaemonRuntime: ...
```

`enable_runtime` 和 `delete_runtime` 同样增加 `is_platform_admin` keyword-only 参数。

### RuntimeService 控制流伪代码

```python
def _normalize_alias(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


async def _get_runtime_for_actor(runtime_id, actor_user_id, *, is_platform_admin):
    runtime = await session.get(DaemonRuntime, runtime_id)
    if runtime is None:
        raise DaemonRuntimeNotFound(...)
    if not is_platform_admin and runtime.user_id != actor_user_id:
        raise DaemonRuntimeNotFound(...)
    return runtime


async def list_runtimes_page(...):
    filters = []
    if is_platform_admin:
        if user_id is not None:
            filters.append(DaemonRuntime.user_id == user_id)
    else:
        filters.append(DaemonRuntime.user_id == actor_user_id)

    if q and q.strip():
        pattern = f"%{q.strip()}%"
        filters.append(or_(
            DaemonRuntime.display_alias.ilike(pattern),
            DaemonRuntime.name.ilike(pattern),
            DaemonRuntime.provider.ilike(pattern),
            DaemonRuntime.version.ilike(pattern),
        ))
    if type_filter:
        filters.append(DaemonRuntime.provider == type_filter)
    if status_filter:
        filters.append(DaemonRuntime.status == status_filter)

    total = await session.scalar(select(func.count()).select_from(DaemonRuntime).where(*filters))
    result = await session.execute(
        select(DaemonRuntime, User)
        .outerjoin(User, DaemonRuntime.user_id == User.id)
        .where(*filters)
        .order_by(DaemonRuntime.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    return list(result.all()), int(total or 0)
```

## 边界处理（必填）

- `display_alias` 为空字段未传时：PATCH 不修改别名，返回当前 runtime，避免空 body 意外清空。
- `display_alias=null` 时：明确清空别名并持久化为 `NULL`。
- `display_alias=""` 或全空白字符串时：`strip()` 后存为 `NULL`，避免 UI 显示空标题。
- `display_alias` 超过 200 字符时：由 `Field(max_length=200)` 返回 422，不在 service 中静默截断。
- 普通账号传入 `user_id` 时：忽略该过滤参数，仍强制 `DaemonRuntime.user_id == actor_user_id`。
- 平台管理员传入不存在的 `user_id` 时：返回 `items=[]`、`total=0`，不抛 404。
- 普通账号访问、禁用、启用、删除或更新其他 owner 的 runtime 时：返回现有 `DaemonRuntimeNotFound` 404，不返回 403，避免资源存在性泄露。
- 平台管理员删除被未软删 workspace 绑定的 runtime 时：仍返回 `DaemonRuntimeInUse` 409，不能绕过绑定保护。
- `GET /api/daemon/runtimes/page` 必须在动态 `GET /api/daemon/runtimes/{runtime_id}` 前声明，否则 `"page"` 会被当成 UUID 路径参数导致 422。
- `GET /api/daemon/runtimes` 必须保持数组响应；新增分页能力只能放在 `/runtimes/page`。
- `q` 为 `None`、空字符串或空白字符串时：不增加搜索条件，避免 `LIKE '%%'` 影响查询计划。
- `type/status` 为未知值时：按精确匹配返回空列表，不做枚举强制，保持现有 runtime 状态/provider 的自由字符串兼容。
- 查询构造不得修改传入的 Pydantic 请求对象；所有清洗结果使用局部变量。
- 异常不得静默吞掉：not found、in use、422 校验错误都沿用 FastAPI/AppError 机制返回。

## 非目标（本任务不做的事）

- 不修改 `backend/app/modules/daemon/model.py`，`display_alias` ORM 字段由 task-03 提供。
- 不新增或修改 Alembic migration，迁移由 task-03 提供。
- 不修改 daemon 注册、heartbeat、lease claim/complete、session create/end、WebSocket 或 pending leases 行为。
- 不修改 workspace 后端 DTO、列表筛选或别名逻辑；这些由 task-05 负责。
- 不修改任何测试文件；后端测试由 task-01 准备，本任务只实现使测试通过的生产代码。
- 不修改前端 API client 或页面；这些由 task-06、task-07 负责。
- 不新增 admin 用户搜索 API；前端人员搜索复用既有 admin 用户列表能力。
- 不让旧 `GET /api/daemon/runtimes` 返回平台管理员全量分页对象；平台管理员全量使用新 `/runtimes/page`。
- 不改变 `mark_runtime_offline` 的 daemon owner 语义。

## 参考

- 变更设计：`.sillyspec/changes/2026-06-25-admin-global-daemon-workspace-management/design.md`
- 实现计划：`.sillyspec/changes/2026-06-25-admin-global-daemon-workspace-management/plan.md`
- 需求：`.sillyspec/changes/2026-06-25-admin-global-daemon-workspace-management/requirements.md`
- 决策：`.sillyspec/changes/2026-06-25-admin-global-daemon-workspace-management/decisions.md`
- Backend 约定：`.sillyspec/docs/backend/scan/CONVENTIONS.md`
- Backend 架构：`.sillyspec/docs/backend/scan/ARCHITECTURE.md`
- Daemon 模块文档：`.sillyspec/docs/backend/modules/daemon.md`
- Auth 模块文档：`.sillyspec/docs/backend/modules/auth.md`
- Workspace 模块文档：`.sillyspec/docs/backend/modules/workspace.md`
- 当前 runtime 路由顺序：`backend/app/modules/daemon/router.py` 中 `/runtimes/usage` 已在 `/runtimes/{runtime_id}` 前声明，并有顺序注释。
- 当前 runtime owner 限制：`backend/app/modules/daemon/runtime/service.py` 的 `_get_owned_runtime`、`disable_runtime`、`enable_runtime`、`delete_runtime`。
- 当前删除保护：`backend/app/modules/daemon/runtime/service.py` 的 `DaemonRuntimeInUse` 与 workspace 绑定检查。
- 平台管理员短路：`backend/app/modules/auth/rbac.py` 的 `has_permission`，先判断 `user.is_platform_admin`。
- Owner 字段来源：`backend/app/modules/auth/model.py` 的 `User.id/email/display_name`。

## TDD 步骤

1. 确认 task-01 已提供后端测试，至少覆盖：
   - 平台管理员 `GET /api/daemon/runtimes/page` 可见全部 owner runtime。
   - 普通账号 `GET /api/daemon/runtimes/page?user_id=<other>` 仍只返回自己的 runtime。
   - `PATCH /api/daemon/runtimes/{id}` 可设置和清空 `display_alias`。
   - 平台管理员可 get/disable/enable/delete 其他 owner runtime。
   - 普通账号 get/disable/enable/delete 其他 owner runtime 返回 404。
   - 旧 `GET /api/daemon/runtimes` 仍返回数组。
   - `/api/daemon/runtimes/page` 不被 `{runtime_id}` 抢占。
2. 若 task-01 测试缺失，停止本任务并返回 task-01 补测试；不要在本任务直接新增测试文件。
3. 运行 task-01 指定的 daemon 后端测试，确认新增场景在实现前失败。
4. 按本蓝图修改 `schema.py`、`runtime/service.py`、`service.py`、`router.py`。
5. 重新运行同一组 daemon 后端测试，确认失败项变为通过。
6. 运行与现有 runtime 管理相关的回归测试，至少包含旧 `list_runtimes`、disable、enable、delete、usage 路由相关测试。
7. 若格式检查失败，只在 allowed paths 内修复 ruff/mypy 可定位的问题。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | 调用 `GET /api/daemon/runtimes/page`，当前用户为平台管理员且库内有多个 owner runtime | 返回 200；响应为 `{items,total,limit,offset}`；`items` 包含全部 owner 的 runtime；每项包含 `owner.user_id/email/display_name` |
| AC-02 | 普通账号调用 `GET /api/daemon/runtimes/page?user_id=<other_user_id>` | 返回 200；只包含当前账号自己的 runtime；`user_id` 参数未扩大可见范围 |
| AC-03 | 调用 `GET /api/daemon/runtimes/page?q=<alias_or_name>&type=<provider>&status=<status>&limit=1&offset=1` | q 大小写不敏感匹配别名/名称/provider/version；type/status 精确过滤；total 为过滤后总数；items 长度不超过 limit |
| AC-04 | 调用旧 `GET /api/daemon/runtimes` | 返回顶层 JSON 数组，不是分页对象；旧调用方无需改造即可继续读取 |
| AC-05 | 调用 `GET /api/daemon/runtimes/page` | 命中分页端点并返回 200 或业务空列表；不会被 `/runtimes/{runtime_id}` 当成 UUID 导致 422 |
| AC-06 | 调用 `PATCH /api/daemon/runtimes/{runtime_id}`，body 为 `{"display_alias":"  新别名  "}` | 返回 200；runtime `display_alias` 持久化为 `新别名`；`name/provider` 不变 |
| AC-07 | 调用 `PATCH /api/daemon/runtimes/{runtime_id}`，body 为 `{"display_alias":null}` 或空白字符串 | 返回 200；runtime `display_alias` 持久化为 `NULL` |
| AC-08 | 平台管理员调用 `GET/PATCH/POST disable/POST enable/DELETE` 操作其他 owner runtime | get/patch/disable/enable 成功返回 runtime；delete 在无未软删 workspace 绑定时返回 204 |
| AC-09 | 普通账号调用 `GET/PATCH/POST disable/POST enable/DELETE` 操作其他 owner runtime | 返回 `DaemonRuntimeNotFound` 对应 404，不泄露资源存在性 |
| AC-10 | 平台管理员删除被未软删 workspace 绑定的其他 owner runtime | 返回 `DaemonRuntimeInUse` 对应 409；`details.workspaces` 仍包含绑定 workspace 列表 |
| AC-11 | 运行 task-01 指定 daemon 后端测试 | 新增权限、分页、别名、路由顺序测试全部通过；旧 runtime 管理测试无回归 |
| AC-12 | 检查 `router.py` 中路由声明顺序 | `/runtimes/page` 位于 `/runtimes/{runtime_id}` 前；`/runtimes/usage` 顺序注释风格保留或扩展 |
