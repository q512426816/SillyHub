---
author: qinyi
created_at: 2026-06-25T17:35:00
---

# design.md — 平台管理员全局守护进程与工作区管理

> 变更：`2026-06-25-admin-global-daemon-workspace-management`  
> 原型：`prototype-admin-global-daemon-workspace-management.html`  
> 方案：B，完整 API 驱动列表能力

## 1. 背景

当前守护进程运行时页面主要围绕当前用户的 daemon runtime 展示，工作区列表虽然平台管理员已有全量分支，但筛选能力停留在基础列表。平台管理员需要作为平台级运维角色查看并管理所有用户的守护进程与工作区；普通账号也需要在自己可见的数据内按名称、类型、状态快速定位资源。

两块页面都是卡片式资源列表，但缺少服务端分页、人员维度搜索和可调整别名。随着 runtime / workspace 数量增长，单次拉全量再前端筛选会影响可用性，也无法稳定表达平台管理员的全局视图。

## 2. 设计目标

- FR-01：平台管理员可查看全部用户的 daemon runtime 与 workspace，并执行卡片上的既有管理动作。
- FR-02：普通账号保持原有权限边界，仅在自己可见资源内按名称、类型、状态筛选。
- FR-03：daemon runtime 和 workspace 都支持独立 `display_alias`，卡片标题优先展示别名。
- FR-04：两类列表都支持服务端筛选和分页：`q`、`type`、`status`、`user_id`、`limit`、`offset`。
- FR-05：两类卡片样式对齐系统风格，包含人员、原始名称、类型、状态、路径/环境、操作入口和分页器。
- FR-06：新增行为有后端单测和前端类型/交互验证覆盖。

## 3. 非目标

- 不改变 daemon 注册、heartbeat、lease claim、session create/end 等运行生命周期。
- 不把平台管理员自动变成其他用户交互式 session 的 owner；本轮只做 runtime 卡片管理动作和列表可见性。
- 不引入资源别名独立表或个人化别名。
- 不重做 admin 用户中心、角色中心或菜单权限体系。
- 不为历史数据补默认别名，空别名回退原始名称。

## 4. 拆分判断

本变更不拆分、不走批量模式。权限、筛选分页、别名和卡片样式都服务于同一个资源管理闭环：平台管理员和普通账号在守护进程/工作区两类资源列表中的可见性、定位和操作。拆开会导致 API 契约与前端状态重复变更。

它也不是批量任务：目标是两类资源的统一列表能力，不是模板乘以大量页面或报表。

## 5. 总体方案

### Phase 1：后端数据模型与 DTO

在 `daemon_runtimes` 和 `workspaces` 增加 nullable `display_alias` 字段。DTO 增加 `display_alias` 和 owner 展示字段：`owner_user_id`、`owner_email`、`owner_display_name`。owner 字段由列表查询 JOIN `users` 得出，不作为 ORM 表字段存储。

### Phase 2：后端服务端筛选/分页

新增 daemon runtime 分页端点 `GET /api/daemon/runtimes/page`，保持原 `GET /api/daemon/runtimes` 返回数组用于兼容现有调用。分页端点支持 `q/type/status/user_id/limit/offset`，平台管理员查询全量，普通账号只查自己的 runtime。

扩展 `GET /api/workspaces` 的查询参数，保持响应结构 `WorkspaceListResponse` 不变。平台管理员查询全量；普通账号继续通过 `allowed_workspace_ids` 限制可见范围。`user_id` 仅平台管理员生效。

### Phase 3：后端别名与跨 owner 管理

新增 `PATCH /api/daemon/runtimes/{runtime_id}` 更新 `display_alias`。daemon `get/disable/enable/delete` 服务方法增加 `is_platform_admin` 参数，平台管理员可对任意 owner 的 runtime 执行这些管理动作，普通账号仍只能操作自己 runtime。

workspace 复用既有 `PATCH /api/workspaces/{workspace_id}`，在 `WorkspaceUpdate` 中加入 `display_alias`。

### Phase 4：前端列表与交互

`frontend/src/lib/daemon.ts` 新增分页类型和 `listDaemonRuntimesPage`、`updateDaemonRuntime`，旧 `listDaemonRuntimes` 保留。`frontend/src/lib/workspaces.ts` 的 `listWorkspaces` 支持筛选分页参数，并扩展 `updateWorkspace` 的 `display_alias`。

`runtimes/page.tsx` 与 `workspaces/page.tsx` 增加筛选条、分页状态和服务端拉取。人员筛选仅当 `useSession().user.is_platform_admin` 为 true 时展示；人员选项复用 admin 用户列表 API。

### Phase 5：卡片样式优化

守护进程和工作区卡片标题显示 `display_alias ?? name ?? slug/provider`，副标题保留原始名称，避免别名覆盖真实资源标识。卡片区显示 owner、类型、状态、路径/环境、心跳/扫描时间，操作区提供别名编辑、详情/会话、启用/禁用、删除/重新扫描。分页器显示总数、当前页和 pageSize。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | `backend/migrations/versions/<timestamp>_add_resource_display_alias.py` | 为 `daemon_runtimes`、`workspaces` 增加 `display_alias` |
| 修改 | `backend/app/modules/daemon/model.py` | `DaemonRuntime.display_alias` 字段 |
| 修改 | `backend/app/modules/daemon/schema.py` | runtime 读模型、分页响应、更新请求、owner DTO |
| 修改 | `backend/app/modules/daemon/router.py` | 新增分页端点、PATCH 别名端点、管理动作传入平台管理员标记 |
| 修改 | `backend/app/modules/daemon/service.py` | facade 透传分页、更新、跨 owner 管理参数 |
| 修改 | `backend/app/modules/daemon/runtime/service.py` | runtime 查询筛选分页、owner JOIN、平台管理员跨 owner enable/disable/delete |
| 修改 | `backend/app/modules/workspace/model.py` | `Workspace.display_alias` 字段 |
| 修改 | `backend/app/modules/workspace/schema.py` | workspace 读/更新 DTO 增加 `display_alias` 和 owner 展示字段 |
| 修改 | `backend/app/modules/workspace/router.py` | list 查询参数与 owner JOIN；普通账号权限边界不变 |
| 修改 | `backend/app/modules/workspace/service.py` | update 支持 `display_alias` |
| 新增/修改 | `backend/app/modules/daemon/tests/*` | 平台管理员全量、筛选分页、别名、跨 owner 管理测试 |
| 新增/修改 | `backend/app/modules/workspace/tests/*` | 工作区筛选分页、人员过滤、别名和普通账号隔离测试 |
| 修改 | `frontend/src/lib/daemon.ts` | 分页列表、更新别名、runtime 类型扩展 |
| 修改 | `frontend/src/lib/workspaces.ts` | 列表查询参数、workspace 类型与更新输入扩展 |
| 修改 | `frontend/src/app/(dashboard)/runtimes/page.tsx` | 筛选条、人员搜索、分页、别名编辑和卡片样式优化 |
| 修改 | `frontend/src/app/(dashboard)/workspaces/page.tsx` | 筛选条、人员搜索、分页和列表状态 |
| 修改 | `frontend/src/components/workspace-card.tsx` | 展示别名、owner、样式与别名编辑入口 |
| 新增 | `.sillyspec/changes/2026-06-25-admin-global-daemon-workspace-management/prototype-admin-global-daemon-workspace-management.html` | UI 原型 |

## 7. 接口定义

### 7.1 daemon runtime 分页查询

```http
GET /api/daemon/runtimes/page?q=&type=&status=&user_id=&limit=12&offset=0
```

```python
class OwnerRead(BaseModel):
    user_id: uuid.UUID | None
    email: str | None
    display_name: str | None

class DaemonRuntimeRead(BaseModel):
    id: uuid.UUID
    display_alias: str | None
    name: str | None
    provider: str | None
    status: str | None
    owner: OwnerRead | None
    ...

class DaemonRuntimeListResponse(BaseModel):
    items: list[DaemonRuntimeRead]
    total: int
    limit: int
    offset: int
```

### 7.2 daemon runtime 别名更新

```http
PATCH /api/daemon/runtimes/{runtime_id}
```

```python
class DaemonRuntimeUpdate(BaseModel):
    display_alias: str | None = Field(default=None, max_length=200)
```

### 7.3 workspace 列表查询

```http
GET /api/workspaces?q=&type=&status=&user_id=&limit=12&offset=0
```

既有响应结构保持：

```python
class WorkspaceListResponse(BaseModel):
    items: list[WorkspaceRead]
    total: int
```

`WorkspaceRead` 新增：

```python
display_alias: str | None
owner: OwnerRead | None
```

### 7.4 workspace 别名更新

```http
PATCH /api/workspaces/{workspace_id}
```

```python
class WorkspaceUpdate(BaseModel):
    display_alias: str | None = Field(default=None, max_length=200)
```

## 7.5 生命周期契约表

本变更涉及 daemon 页面和 runtime 状态管理，但不新增 session / lease / heartbeat 生命周期事件。只约束管理页面触发的资源事件：

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| list runtime page | frontend | backend | q, type, status, user_id, limit, offset | 无状态变化 |
| update runtime alias | frontend | backend | runtime_id, display_alias | runtime 元数据更新 |
| disable runtime | frontend | backend | runtime_id, actor_user_id, is_platform_admin | online/offline/maintenance → disabled |
| enable runtime | frontend | backend | runtime_id, actor_user_id, is_platform_admin, last_heartbeat_at | disabled → online/offline |
| delete runtime | frontend | backend | runtime_id, actor_user_id, is_platform_admin | runtime 物理删除，既有 lease/session 级联保持原逻辑 |
| list workspace page | frontend | backend | q, type, status, user_id, limit, offset | 无状态变化 |
| update workspace alias | frontend | backend | workspace_id, display_alias | workspace 元数据更新 |

## 8. 数据模型

```sql
ALTER TABLE daemon_runtimes ADD COLUMN display_alias VARCHAR(200);
ALTER TABLE workspaces ADD COLUMN display_alias VARCHAR(200);
```

字段约束：

- nullable，历史数据无需回填。
- 最大长度 200。
- 搜索时参与 `lower(display_alias) LIKE lower(:q)`，空值不影响现有查询。
- 展示逻辑：`display_alias ?? name ?? slug/provider`。

## 9. 兼容策略

- `GET /api/daemon/runtimes` 保持数组响应，避免影响工作区创建、daemon 选择器等现有调用。
- 新分页能力通过 `GET /api/daemon/runtimes/page` 使用。
- `GET /api/workspaces` 保持 `items/total` 响应；未传筛选参数时行为与现有列表一致。
- `display_alias` 为空时 UI 回退现有字段，不影响旧数据。
- 普通账号的 `user_id` 参数不扩大权限，仍只返回自己可见资源。
- 如果前端人员列表 API 因权限失败，平台管理员页面降级为隐藏人员选项并保留其他筛选。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | daemon runtime 原列表响应若直接改 shape 会破坏现有调用 | P0 | 保留旧端点，新建 `/runtimes/page` |
| R-02 | 平台管理员跨 owner 删除 runtime 可能误删仍绑定 workspace 的 runtime | P0 | 复用现有 `DaemonRuntimeInUse` 检查，未解绑 active workspace 时返回 409 |
| R-03 | 普通账号传入 `user_id` 越权查询 | P0 | 后端仅平台管理员应用 `user_id`，普通账号继续 owner / permission 限制 |
| R-04 | `display_alias` 与原始 name 语义混淆 | P1 | UI 显示“原名”副标题；搜索同时匹配别名和原名 |
| R-05 | workspace owner 来源 `created_by` 为空 | P1 | owner 字段 nullable；人员过滤只匹配有 owner 的记录 |
| R-06 | runtime 用量统计仍是全量聚合，不随分页筛选严格收敛 | P2 | 本轮保持卡片用量可用；若需要准确分页聚合，后续为 usage 增加 runtime_id 列表参数 |

## 11. 决策追踪

- D-001@v1 覆盖 FR-01、FR-02、Phase 2、Phase 3、风险 R-02/R-03。
- D-002@v1 覆盖 FR-03、Phase 1、Phase 3、数据模型、风险 R-04。
- D-003@v1 覆盖 FR-04、Phase 2、Phase 4、风险 R-03/R-05。
- D-004@v1 覆盖 FR-05、Phase 5、原型与验收标准。

当前无被 supersede 的决策。

## 12. 自审

| 检查项 | 结果 |
|---|---|
| 需求覆盖 | 通过：覆盖平台管理员全局、普通账号筛选、人员搜索、分页、别名、样式 |
| Grill 决策覆盖 | 通过：design 引用 D-001@v1 至 D-004@v1 |
| 约束一致性 | 通过：后端显式 Depends/RBAC，前端 apiFetch + client page 状态管理 |
| 真实性 | 通过：表名、字段、端点、文件路径来自源码；新增项已标注 |
| YAGNI | 通过：未引入 resource_aliases 通用表，未扩张 session/lease 生命周期 |
| 验收标准 | 通过：可用 API 测试、前端筛选分页和别名编辑验证 |
| 非目标清晰 | 通过：明确不改 session/lease/heartbeat 生命周期 |
| 兼容策略 | 通过：daemon 旧列表端点保留，workspace 默认行为不变 |
| 风险识别 | 通过：列出权限、删除、兼容、owner 空值与 usage 风险 |
| 生命周期契约表 | 通过：涉及 daemon，已列出本变更触发的资源管理事件，明确不新增 session/lease/heartbeat 事件 |
