---
author: qinyi
created_at: 2026-06-25 17:41:14
---

# Requirements

## 角色

| 角色 | 说明 |
|---|---|
| 平台管理员 | `is_platform_admin=true` 或等效全权限用户，可全局查看和管理 daemon runtime / workspace 卡片资源 |
| 普通账号 | 非平台管理员，只能查看和操作自己拥有或具备 workspace 权限的数据 |
| 前端使用者 | 在 `/runtimes`、`/workspaces` 页面筛选、分页、编辑别名 |

## 功能需求

### FR-01: 平台管理员全局查看与操作资源

覆盖决策：D-001@v1

Given 当前用户是平台管理员  
When 访问 daemon runtime 分页列表  
Then 返回全部用户的 runtime，并包含 owner 展示信息

Given 当前用户是平台管理员  
When 对非本人 runtime 执行别名更新、启用、禁用或删除  
Then 后端允许操作，并沿用现有绑定 workspace 时删除返回 409 的保护

Given 当前用户是平台管理员  
When 访问 workspace 列表  
Then 返回全部未删除 workspace（除非显式 include_deleted），并包含 owner 展示信息

### FR-02: 普通账号权限边界不扩大

覆盖决策：D-001@v1, D-003@v1

Given 当前用户不是平台管理员  
When 查询 daemon runtime 分页列表  
Then 只返回该用户自己的 runtime

Given 当前用户不是平台管理员  
When 查询 workspace 列表并传入其他人的 `user_id`  
Then 仍只返回该用户已有 `workspace:read` 权限的 workspace

### FR-03: 两类资源支持独立别名

覆盖决策：D-002@v1, D-006@v1

Given runtime 或 workspace 尚未设置 `display_alias`  
When 前端渲染卡片标题  
Then 标题回退到原始 `name`、`slug` 或 `provider`

Given 用户在卡片中保存新的别名  
When PATCH 对应资源的 `display_alias`  
Then 后端持久化别名，列表刷新后标题优先显示该别名，原始名称仍在副标题展示

### FR-04: 服务端筛选与分页

覆盖决策：D-003@v1, D-005@v1

Given 调用方传入 `q`  
When 查询 runtime 或 workspace 列表  
Then 后端在 `display_alias`、原始名称和关键标识字段中做大小写不敏感匹配

Given 调用方传入 `type` 和 `status`  
When 查询 runtime 或 workspace 列表  
Then 后端按 provider/path_source/type 和 status 精确过滤

Given 调用方传入 `limit` 和 `offset`  
When 查询 runtime 或 workspace 列表  
Then 返回当前页 items 和匹配总数 total

Given 请求 `GET /api/daemon/runtimes/page`  
When FastAPI 路由匹配  
Then 命中分页端点而不是 `/runtimes/{runtime_id}` 动态 UUID 端点

### FR-05: 两页卡片与分页 UI 统一

覆盖决策：D-004@v1

Given 用户打开 `/runtimes` 或 `/workspaces`  
When 数据加载成功  
Then 页面展示筛选条、摘要统计、卡片网格和分页器

Given 当前用户是平台管理员  
When 页面渲染筛选条  
Then 展示人员筛选控件，并可通过 `lib-admin.listUsers` 搜索用户

Given 当前用户不是平台管理员  
When 页面渲染筛选条  
Then 不展示人员筛选控件

### FR-06: 兼容旧调用

覆盖决策：D-001@v1, D-005@v1

Given 现有前端组件调用 `listDaemonRuntimes()`  
When 请求 `GET /api/daemon/runtimes`  
Then 响应仍为 `DaemonRuntimeRead[]`

Given 现有调用不传 workspace 筛选参数  
When 请求 `GET /api/workspaces`  
Then 响应结构仍为 `{ items, total }`，默认行为保持兼容

## 非功能需求

- 兼容性：新增 daemon 分页能力不得改变旧数组端点响应 shape。
- 可回退：`display_alias` 为空时完全回退旧展示字段。
- 权限安全：普通账号任何查询参数都不能扩大可见范围。
- 可测试：后端单测覆盖 admin/global、normal/scoped、筛选分页、别名更新、固定路径顺序。
- UI 稳定：卡片标题、路径、owner 文案在移动端和桌面端不能溢出父容器。

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01, FR-02, FR-06 | 平台管理员全权限短路与普通账号隔离 |
| D-002@v1 | FR-03 | 别名独立于原始名称 |
| D-003@v1 | FR-02, FR-04, FR-05 | 人员筛选只扩展平台管理员视图 |
| D-004@v1 | FR-05 | 服务端分页和统一卡片样式 |
| D-005@v1 | FR-04, FR-06 | daemon 固定分页路径声明顺序 |
| D-006@v1 | FR-03 | owner 使用嵌套 DTO |

