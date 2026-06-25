---
id: task-05
title: 扩展 workspace DTO、列表筛选分页、owner 返回和别名更新
priority: P0
estimated_hours: 3
depends_on:
  - task-01
  - task-03
blocks:
  - task-06
  - task-08
  - task-09
requirement_ids:
  - FR-01
  - FR-02
  - FR-03
  - FR-04
  - FR-06
decision_ids:
  - D-001@v1
  - D-002@v1
  - D-003@v1
  - D-006@v1
allowed_paths:
  - backend/app/modules/workspace/schema.py
  - backend/app/modules/workspace/router.py
  - backend/app/modules/workspace/service.py
  - .sillyspec/changes/2026-06-25-admin-global-daemon-workspace-management/tasks/task-05.md
author: qinyi
created_at: "2026-06-25 17:48:59"
---

# task-05: 扩展 workspace DTO、列表筛选分页、owner 返回和别名更新

> 本 task 依赖 task-03 已为 `Workspace` ORM / migration 增加 `display_alias` 字段，依赖 task-01 已提供后端权限、筛选分页、别名与 owner DTO 测试安全网。执行本 task 时只改 allowed_paths 内文件，不新增或修改测试文件、前端文件、迁移文件。

## 修改文件

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | `backend/app/modules/workspace/schema.py` | 新增 workspace owner DTO；`WorkspaceRead` 增加 `display_alias` 和 `owner`；`WorkspaceUpdate` 增加 `display_alias` |
| 修改 | `backend/app/modules/workspace/service.py` | 增加 workspace 列表筛选、分页计数、owner JOIN 查询能力；保留既有 `list_()` 默认兼容 |
| 修改 | `backend/app/modules/workspace/router.py` | `GET /api/workspaces` 增加 `q/type/status/user_id/limit/offset` 查询参数；平台管理员全量筛选，普通账号继续按 `allowed_workspace_ids` 限制 |
| 新增 | `.sillyspec/changes/2026-06-25-admin-global-daemon-workspace-management/tasks/task-05.md` | 本任务蓝图；execute 阶段不再修改本文件 |

## 覆盖来源

| 来源 | 约束 | 本 task 落点 |
|---|---|---|
| `requirements.md` FR-01 | 平台管理员访问 workspace 列表返回全部未删除 workspace，并包含 owner 展示信息 | router 平台管理员分支不传 `allowed_workspace_ids`，支持按 `created_by` 的 `user_id` 过滤，列表 items 填充 `owner` |
| `requirements.md` FR-02 | 普通账号传入其他人的 `user_id` 仍不能扩大 workspace 可见范围 | router 普通账号分支先取 `allowed_workspace_ids`，并忽略 `user_id` 查询参数 |
| `requirements.md` FR-03 | workspace 支持独立 `display_alias`，PATCH 后持久化，空值回退原始名称 | schema 暴露 `display_alias`；`WorkspaceUpdate.display_alias` 进入既有 service `update()` 的 `exclude_unset=True` 流程 |
| `requirements.md` FR-04 | `GET /api/workspaces` 支持 `q/type/status/user_id/limit/offset`，返回当前页和总数 | service 构建同一组过滤条件用于 items 查询和 total 查询 |
| `requirements.md` FR-06 | 旧调用不传筛选参数时，`GET /api/workspaces` 仍返回 `{items,total}` 且默认行为兼容 | response_model 保持 `WorkspaceListResponse`，默认 `limit=100/offset=0` 不改变响应 shape |
| `decisions.md` D-001@v1 | 平台管理员沿用 `is_platform_admin` 全权限短路，普通账号保持权限隔离 | router 沿用 `user.is_platform_admin` 和 `allowed_workspace_ids()` |
| `decisions.md` D-002@v1 | 别名独立于资源原始名称 | 只新增 `display_alias`，不改 `name/slug/root_path` 语义 |
| `decisions.md` D-003@v1 | 人员搜索只扩展平台管理员全局视图 | `user_id` 仅平台管理员生效，普通账号不应用该过滤 |
| `decisions.md` D-006@v1 | owner 展示字段使用嵌套 `OwnerRead \| None` | `WorkspaceRead.owner` 使用嵌套 DTO，列表端点填充，详情/创建/更新端点可为 `None` |
| `design.md` §7.3/§7.4 | workspace 列表查询和别名更新接口定义 | 扩展 `GET /api/workspaces` 与 `PATCH /api/workspaces/{workspace_id}` 的 DTO |
| `plan.md` Wave 2 task-05 | 依赖 task-01、task-03，阻塞 task-06、task-08、task-09 | frontmatter 依赖与阻塞关系对齐 |

## 实现要求

### 1. `schema.py` DTO 扩展

1. 在 workspace schema 中新增本模块本地 `OwnerRead`，不要从 daemon schema import，避免跨模块 DTO 依赖：

   ```python
   class OwnerRead(BaseModel):
       user_id: uuid.UUID | None = None
       email: str | None = None
       display_name: str | None = None
   ```

2. `WorkspaceRead` 增加：
   - `display_alias: str | None = None`
   - `owner: OwnerRead | None = None`

   `owner` 必须有默认 `None`，因为 `GET /api/workspaces/{workspace_id}`、创建、更新等非列表端点仍直接 `WorkspaceRead.model_validate(workspace)`，不会 JOIN user。

3. `WorkspaceUpdate` 增加：

   ```python
   display_alias: str | None = Field(default=None, max_length=200)
   ```

   继续依赖 `WorkspaceService.update()` 的 `payload.model_dump(exclude_unset=True)`：字段省略时不修改，显式传 `null` 时清空别名，字符串时更新别名。

### 2. `service.py` 列表查询能力

1. 保留既有 `WorkspaceService.list_()` 的默认调用兼容：现有测试中 `items, total = await service.list_()` 仍返回 `list[Workspace]` 和 `int`。
2. 新增一个列表响应专用方法，推荐命名为 `list_with_owner()`；如执行时选择其他名称，必须同步 router，且不改变 `list_()` 默认返回 shape。
3. `list_with_owner()` 支持这些参数：
   - `include_deleted: bool = False`
   - `limit: int = 100`
   - `offset: int = 0`
   - `q: str | None = None`
   - `workspace_type: str | None = None`
   - `status: str | None = None`
   - `user_id: uuid.UUID | None = None`
   - `allowed_workspace_ids: list[uuid.UUID] | None = None`
4. `allowed_workspace_ids is None` 表示平台管理员全量查询；`allowed_workspace_ids == []` 表示普通账号没有可读 workspace，必须直接返回 `([], 0)`，不要生成不稳定的空 `IN` 查询。
5. 使用同一组过滤条件构建 items 查询与 total 查询。total 不要用 `len(all rows)`，改用 `select(func.count()).select_from(filtered_subquery)` 或等价 count 查询。
6. owner 查询使用 `Workspace.created_by` 到 `User.id` 的 `outerjoin`，不要在 ORM `Workspace` 上伪造非持久字段。若 `created_by` 无对应 user 行，router 仍可用 `created_by` 构造只有 `user_id` 的 owner。
7. `q` 过滤：
   - 先 `strip()`，空字符串视为未传。
   - 使用大小写不敏感匹配。
   - 至少匹配 `Workspace.display_alias`、`Workspace.name`、`Workspace.slug`、`Workspace.root_path`、`Workspace.component_key`。
8. `type` 查询参数在 service 内命名为 `workspace_type`：
   - 精确匹配 `Workspace.type`。
   - 同时兼容原型中的来源筛选：当值为 `server-local` 或 `daemon-client` 时也匹配 `Workspace.path_source`。
9. `status` 精确匹配 `Workspace.status`。
10. `user_id` 精确匹配 `Workspace.created_by`，且只由 router 平台管理员分支传入。
11. 排序保持现状：`created_at desc`，再应用 `limit/offset`。

### 3. `router.py` 列表端点扩展

1. `GET /api/workspaces` 保持 `response_model=WorkspaceListResponse`，响应结构仍为：

   ```json
   {
     "items": [],
     "total": 0
   }
   ```

2. 在既有参数上新增：

   ```python
   q: Annotated[str | None, Query(max_length=200)] = None
   workspace_type: Annotated[str | None, Query(alias="type", max_length=50)] = None
   status_filter: Annotated[str | None, Query(alias="status", max_length=20)] = None
   user_id: Annotated[uuid.UUID | None, Query()] = None
   ```

   `limit`、`offset` 保留现有参数和约束。

3. 平台管理员分支：
   - 不调用 `allowed_workspace_ids()`。
   - 将 `user_id` 传给 service，以 `Workspace.created_by == user_id` 过滤人员。
   - `include_deleted` 保持现有能力；未传时默认排除软删除。

4. 普通账号分支：
   - 必须先调用 `allowed_workspace_ids(session, user_id=user.id, permission=Permission.WORKSPACE_READ)`。
   - 将返回的 allowed id 列表传给 service。
   - 不传递请求中的 `user_id`，即普通账号传入任意 `user_id` 都不能扩大或改变权限边界。
   - 仍允许在可见集合内使用 `q/type/status/limit/offset`。

5. 增加本地序列化 helper，推荐：

   ```python
   def _build_owner_read(workspace: Workspace, owner: User | None) -> OwnerRead | None:
       ...

   def _workspace_read_with_owner(workspace: Workspace, owner: User | None) -> WorkspaceRead:
       ...
   ```

   helper 使用 `WorkspaceRead.model_validate(workspace).model_copy(update={"owner": owner_read})`，不要把 `owner` 动态挂到 ORM 对象上。

### 4. 别名更新

1. 不新增 workspace PATCH 路由；复用既有 `PATCH /api/workspaces/{workspace_id}`。
2. `WorkspaceUpdate` 加入 `display_alias` 后，既有 `WorkspaceService.update()` 的通用字段赋值会自动持久化该字段。
3. 不改变 slug 唯一性预检查逻辑；`display_alias` 不参与 slug/root_path 唯一性。
4. update 响应可保持 `owner=None`，列表刷新后由 `GET /api/workspaces` 填充 owner。

### 5. 兼容性和权限约束

1. 不改变 `require_permission_any(Permission.WORKSPACE_READ)` 和 `require_permission(Permission.WORKSPACE_ADMIN)` 等现有依赖声明。
2. 不改变 `WorkspaceListResponse` 字段；不要添加 `limit/offset` 到响应体，避免破坏旧前端类型。
3. 不改变 `GET /api/workspaces/{workspace_id}`、创建、删除、rescan、activate、relations 等端点行为。
4. 不把平台管理员人员过滤推广到普通账号。
5. 不为 owner 新增数据库字段；owner 来自 `Workspace.created_by` 和 `users` 表。

## 接口定义

### `GET /api/workspaces`

```http
GET /api/workspaces?q=&type=&status=&user_id=&limit=12&offset=0
```

查询参数：

| 参数 | 类型 | 生效范围 | 说明 |
|---|---|---|---|
| `q` | `string \| null` | 平台管理员、普通账号 | 在 `display_alias/name/slug/root_path/component_key` 中大小写不敏感搜索 |
| `type` | `string \| null` | 平台管理员、普通账号 | 精确匹配 `Workspace.type`；值为 `server-local`/`daemon-client` 时也匹配 `Workspace.path_source` |
| `status` | `string \| null` | 平台管理员、普通账号 | 精确匹配 `Workspace.status` |
| `user_id` | `uuid \| null` | 仅平台管理员 | 精确匹配 `Workspace.created_by`；普通账号传入时忽略 |
| `limit` | `int` | 平台管理员、普通账号 | 现有约束 `1 <= limit <= 500` |
| `offset` | `int` | 平台管理员、普通账号 | 现有约束 `offset >= 0` |

响应结构保持：

```python
class WorkspaceListResponse(BaseModel):
    items: list[WorkspaceRead]
    total: int
```

### DTO

```python
class OwnerRead(BaseModel):
    user_id: uuid.UUID | None = None
    email: str | None = None
    display_name: str | None = None


class WorkspaceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    display_alias: str | None = None
    ...
    created_by: uuid.UUID | None
    owner: OwnerRead | None = None


class WorkspaceUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    display_alias: str | None = Field(default=None, max_length=200)
    ...
```

### `PATCH /api/workspaces/{workspace_id}`

```json
{
  "display_alias": "主平台研发工作区"
}
```

清空别名：

```json
{
  "display_alias": null
}
```

### Service 建议签名

```python
async def list_with_owner(
    self,
    *,
    include_deleted: bool = False,
    limit: int = 100,
    offset: int = 0,
    q: str | None = None,
    workspace_type: str | None = None,
    status: str | None = None,
    user_id: uuid.UUID | None = None,
    allowed_workspace_ids: list[uuid.UUID] | None = None,
) -> tuple[list[tuple[Workspace, User | None]], int]:
    ...
```

## 边界处理

1. **普通账号传其他 `user_id`**：不得按该 `user_id` 查询全局数据；router 必须忽略该参数，最终结果只来自 `allowed_workspace_ids` 交集。
2. **普通账号无可读 workspace**：`allowed_workspace_ids == []` 时直接返回 `{items: [], total: 0}`，避免空 `IN` 方言差异。
3. **`created_by` 为空**：列表 item 的 `owner` 返回 `None`；不得因为 owner JOIN 失败丢弃 workspace。
4. **`created_by` 有值但 user 行不存在**：保留 workspace，`owner.user_id` 使用 `created_by`，`email/display_name` 为 `None`。
5. **`q` 为空白字符串**：strip 后视为未传，不生成 `LIKE '%%'`。
6. **`type=server-local/daemon-client`**：需要匹配 `path_source`，否则原型中的工作区来源筛选无法命中。
7. **`status=deleted` 但 `include_deleted=false`**：保持现有软删除过滤优先级，返回空结果是可接受行为；不为了 status 自动打开 `include_deleted`。
8. **`display_alias=null`**：表示清空别名；字段省略表示不修改；空字符串不在本 task 强制转 `None`。
9. **旧调用不传新参数**：默认仍按 `created_at desc` 返回未删除 workspace，响应仍为 `{items,total}`。
10. **分页 total**：必须是过滤后的总数，不是当前页长度，也不是未过滤总数。

## 非目标

- 不新增或修改 migration；`display_alias` ORM 字段由 task-03 负责。
- 不新增 `PATCH` 路由；workspace 别名更新复用既有 `PATCH /api/workspaces/{workspace_id}`。
- 不修改 daemon runtime 相关 DTO、路由或 service；daemon 后端能力由 task-04 负责。
- 不修改前端 API client、页面、卡片或类型；这些由 task-06、task-08 负责。
- 不新增测试文件；测试安全网由 task-01 提供，本 task 只运行相关测试并实现通过。
- 不改变 workspace members、relations、topology、scan/rescan、activate、delete 的业务语义。
- 不引入通用 owner 表、别名表或资源抽象层。

## 参考

- `.claude/CLAUDE.md`：SillySpec 流程、先文档后代码、文档默认中文。
- `.sillyspec/docs/backend/scan/CONVENTIONS.md`：FastAPI router/service/schema 分层、Pydantic v2、权限依赖和 SQLModel 约定。
- `.sillyspec/docs/backend/scan/ARCHITECTURE.md`：后端请求流、显式鉴权、模块分层。
- `.sillyspec/docs/backend/modules/workspace.md`：workspace 模块契约和注意事项。
- `.sillyspec/docs/backend/modules/auth.md`：RBAC 与 `allowed_workspace_ids` 来源。
- `.sillyspec/docs/backend/modules/admin.md`：用户管理和人员数据来源。
- `.sillyspec/changes/2026-06-25-admin-global-daemon-workspace-management/design.md`：§5 Phase 2/3、§7.3/7.4、§9 兼容策略。
- `.sillyspec/changes/2026-06-25-admin-global-daemon-workspace-management/requirements.md`：FR-01、FR-02、FR-03、FR-04、FR-06。
- `.sillyspec/changes/2026-06-25-admin-global-daemon-workspace-management/decisions.md`：D-001@v1、D-002@v1、D-003@v1、D-006@v1。
- `backend/app/modules/workspace/router.py`：现有 `list_workspaces()` 已区分平台管理员全量和普通账号 `allowed_workspace_ids`。
- `backend/app/modules/workspace/service.py`：现有 `list_()` 和 `update()` 是本 task 的主要扩展点。
- `backend/app/modules/workspace/schema.py`：现有 `WorkspaceRead`、`WorkspaceUpdate`、`WorkspaceListResponse` 是 DTO 扩展点。
- `backend/app/modules/auth/rbac.py`：`has_permission()` 的 `is_platform_admin` 短路和 `allowed_workspace_ids()` 的 workspace 权限集合。
- `backend/app/modules/auth/model.py`：`User.id/email/display_name/is_platform_admin` 字段定义。

## TDD步骤

1. **确认依赖已完成**：确认 task-03 已让 `Workspace` ORM 具备 `display_alias`；确认 task-01 的 workspace 相关测试已存在或已在当前分支准备好。若依赖未完成，停止执行本 task。
2. **先跑失败用例**：运行 task-01 提供的 workspace DTO、列表筛选分页、owner、普通账号越权、别名更新相关测试，确认它们在本 task 实现前失败或被标记为待实现。
3. **实现 schema**：新增 `OwnerRead`，扩展 `WorkspaceRead` 和 `WorkspaceUpdate`，使 DTO 字段存在性测试通过。
4. **实现 service 查询**：添加列表响应专用查询方法，覆盖 `q/type/status/user_id/allowed_workspace_ids/limit/offset` 和过滤后 total。
5. **实现 router 参数和权限分支**：扩展 `list_workspaces()` 查询参数，平台管理员传 `user_id`，普通账号只传 allowed ids，并用 helper 填充 owner DTO。
6. **跑 workspace 模块测试**：优先运行 task-01 中 workspace 相关测试；再运行 `backend/app/modules/workspace/tests` 中已有列表、service、router 测试，确认旧默认行为不回归。
7. **跑格式/静态检查**：按项目后端命令运行 ruff/mypy 或 task-09 指定的后端检查；本 task 若无法运行完整检查，需要记录原因给 task-09。
8. **自检 allowed paths**：`git diff --name-only` 只能出现 `backend/app/modules/workspace/schema.py`、`backend/app/modules/workspace/router.py`、`backend/app/modules/workspace/service.py`。

## 验收标准

| 编号 | 验收条件 | 验证方式 |
|---|---|---|
| AC-01 | `WorkspaceRead` 包含 `display_alias` 和 `owner: OwnerRead \| None`，非列表端点可返回 `owner=None` | DTO 单测或 `WorkspaceRead.model_validate(workspace)` |
| AC-02 | `WorkspaceUpdate` 接受 `display_alias`，省略不改，传 `null` 清空，传字符串持久化 | service/router PATCH 测试 |
| AC-03 | `GET /api/workspaces` 支持 `q/type/status/user_id/limit/offset` 查询参数 | router 测试请求断言 |
| AC-04 | `GET /api/workspaces` 响应结构保持 `{items,total}`，不新增顶层 `limit/offset` | API 响应 shape 测试 |
| AC-05 | 平台管理员可查看全部未删除 workspace，并可用 `user_id` 按 `created_by` 过滤 | admin 列表测试 |
| AC-06 | 普通账号只返回 `allowed_workspace_ids` 范围内 workspace，传其他用户 `user_id` 不越权 | 权限隔离测试 |
| AC-07 | `q` 能匹配 `display_alias/name/slug/root_path/component_key`，大小写不敏感 | service 或 router 筛选测试 |
| AC-08 | `type` 可匹配 `Workspace.type`，且 `server-local`/`daemon-client` 可匹配 `path_source` | 筛选测试 |
| AC-09 | `status`、`limit`、`offset` 与过滤后 `total` 正确，total 不是当前页长度 | 分页测试 |
| AC-10 | owner JOIN 不会丢弃 `created_by=None` 或 user 行缺失的 workspace | owner 边界测试 |
| AC-11 | 旧调用不传新参数时，列表默认行为与现状兼容，既有 workspace tests 通过 | 既有测试回归 |
| AC-12 | diff 只包含 allowed paths 中的 workspace 三个后端文件 | `git diff --name-only` |
