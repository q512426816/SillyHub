---
author: WhaleFall
created_at: 2026-09-20 18:00:00
---

# 需求规格（Requirements）

## 角色

| 角色 | 说明 |
|---|---|
| 工作区成员 | 在 `user_workspace_roles` 表中持有该工作区角色绑定的用户 |
| 平台级角色持有者 | 经管理中心「用户-角色」绑定（`user_roles` 表）获得平台级授权的用户（如 developer 系统角色） |
| 平台管理员 | `users.is_platform_admin=True` 的用户，或持有 `platform:admin` 权限角色的用户 |
| 系统开发者 | SillyHub 平台本身的开发/维护者（测试与回归视角） |

## 功能需求

### FR-01: 工作区内容访问回归成员制（判定链收紧）
覆盖决策：D-001@v1, D-002@v1

Given 用户不是工作区 W 的成员，且不是平台管理员（`is_platform_admin=False` 且平台级角色不含 `platform:admin`），但平台级角色携带任意业务权限 P（如 `workspace:read`、`mcp:read`）
When 以工作区 W 为上下文判定权限 P（`has_permission(workspace_id=W)`，即所有 `require_permission` 路由）
Then 判定为 False（403），P 为任意 Permission 枚举值均如此

#### 场景：非成员持平台级 workspace:read 访问工作区详情
Given 180490 绑定 developer 角色（平台级 `workspace:read`），不是工作区 W 成员
When GET /api/workspaces/{W}
Then HTTP 403

#### 场景：非成员持平台级 mcp:read 读工作区 MCP 配置
Given 同上用户，权限为 `mcp:read`
When 访问 W 的 mcp-config 读端点
Then HTTP 403

### FR-02: 平台管理员全量不受影响
覆盖决策：D-001@v1

Given 用户 `is_platform_admin=True`，或平台级角色含 `platform:admin`
When 访问任意工作区（成员或非成员）或列表
Then 行为与改动前完全一致（放行、全量列表）

### FR-03: 工作区列表按成员制返回
覆盖决策：D-001@v1, D-003@v1

Given 用户非平台管理员、平台级角色不含 `platform:admin`，但持平台级 `workspace:read`
When GET /api/workspaces
Then 仅返回该用户为成员的工作区（无成员身份则空列表）；ql-20260917-007 的「平台级 workspace:read → 全量」分支废止

### FR-04: 通知收件人按成员制聚合
覆盖决策：D-003@v1

Given 工作区 W 发生需广播事件（`list_user_ids_with_permission(workspace_id=W, permission=P)` 被调用）
When 查找收件人
Then 收件人 = W 的成员中持 P 者（段 1）+ 平台级 `platform:admin` 持有者（段 2）+ `is_platform_admin` 用户（段 3）；平台级仅持 P 的非成员**不再**收件

### FR-05: 功能入口效力保持不变
覆盖决策：D-001@v1, D-002@v1

Given 用户持平台级权限 P（如 developer 角色的 `workspace:read`）
When 以无工作区上下文判定 P（`require_permission_any`，如创建工作区前的入口校验）或经 `/api/auth/me` 聚合权限驱动菜单显隐
Then 行为与改动前完全一致（菜单仍可见、入口判定仍放行）

### FR-06: 创建者自动成员语义不受影响
覆盖决策：D-001@v1

Given 用户持平台级 `workspace:write` 并创建工作区
When 创建完成（新建/复用/复活任一路径，`backend/app/modules/workspace/service.py` `_ensure_creator_as_owner`）
Then 创建者自动成为该工作区 `workspace_owner` 成员，随后对该工作区的访问走成员判定、正常放行

## 非功能需求

- 兼容性：无 schema/数据迁移；对外 API 签名、响应体、OpenAPI、前端类型零变化（`api-types.ts` 无需再生成）；权限缓存键值结构不变，无需失效存量缓存。
- 可回退：三个触点均为小逻辑改动，revert 即恢复 ql-20260917-007 语义，无回退残留。
- 可测试：三口径一致性有专项断言（列表 ⊆ 可访问 ⊆ 通知收件人同源判定）。

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01, FR-02, FR-03, FR-05, FR-06 | 平台级权限纯入口语义 |
| D-002@v1 | FR-01, FR-05 | 全权限统一收紧，无白名单 |
| D-003@v1 | FR-03, FR-04 | 三触点（判定链/列表/通知收件人）联动方案 |
| D-004@v1 | —（非目标） | 客户端路径显示另开 quick |
