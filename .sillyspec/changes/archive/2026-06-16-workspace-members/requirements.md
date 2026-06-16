---
author: qinyi
created_at: 2026-06-16T09:42:00
---

# Requirements — workspace-members

## 角色

| 角色 | 说明 |
|------|------|
| workspace_owner | ws 的拥有者，可管理成员（含 transfer 所有权）；注册时自动 seed |
| platform_admin | 平台管理员，bypass 所有权限检查，可管理任何 ws 的成员 |
| developer | ws 成员，可读 + 写代码 + run agent，但**不能**管理成员 |
| viewer | ws 成员，只读，**不能**管理成员 |
| 已注册非成员 | 有 SillyHub 账号但不在该 ws 的用户；可被搜索到，可被加入 |

## 功能需求

### FR-01: 列出 workspace 成员

**Given** 一个 workspace `W` 含 3 个成员（owner/dev/viewer）
**When** workspace_owner 或 platform_admin 调 `GET /api/workspaces/{W}/members`
**Then** 返回 200 + `items: WorkspaceMemberView[3]`，每条含 `user_id/email/display_name/role_key/role_name/granted_at/is_current_user`

**Given** developer 或 viewer 调同端点
**When** 调用 `GET /api/workspaces/{W}/members`
**Then** 返回 200（list 操作只需 `WORKSPACE_READ`，任何成员可读）

**Given** 非 ws 成员（无任何 UserWorkspaceRole 行）
**When** 调用 `GET /api/workspaces/{W}/members`
**Then** 返回 403

### FR-02: 模糊搜索用户

**Given** 数据库有 `alice@example.com`、`bob@example.com`、`cathy@x.com`，且 `alice` 已是 W 成员
**When** workspace_owner 调 `GET /api/workspaces/{W}/members/search?q=ali&limit=10`
**Then** 返回 200 + `items` 不含 alice（已成员被排除），可能含 cathy（如 display_name 含 ali）

**Given** q 长度 < 2 字符
**When** 调 search
**Then** 返回 422（Query min_length=2 校验失败）

**Given** q 匹配一个 `status='disabled'` 用户
**When** 调 search
**Then** 返回 items 不含该用户（只搜 active）

**Given** viewer（无 member:manage 权限）调 search
**When** 调用
**Then** 返回 403

### FR-03: 添加成员

**Given** workspace_owner 在 W，user U 不在 W
**When** POST `/api/workspaces/{W}/members` body `{user_id: U, role_key: "developer"}`
**Then** 返回 201，新增 UserWorkspaceRole 行；后续 U 访问 `/api/workspaces/{W}` 不再 403

**Given** user U 已经是 W 的 viewer
**When** POST `{user_id: U, role_key: "developer"}`
**Then** 返回 200（幂等，更新现有 role），不报错；UserWorkspaceRole.role_id 改为 developer

**Given** body role_key = "platform_admin"
**When** POST
**Then** 返回 400 `invalid_role_key`（platform_admin 不在白名单）

**Given** body user_id 不存在
**When** POST
**Then** 返回 404 `user_not_found`

**Given** viewer 调 POST
**When** 调用
**Then** 返回 403

### FR-04: 修改成员角色

**Given** user U 在 W 是 developer
**When** workspace_owner 调 PATCH `/api/workspaces/{W}/members/{U}` body `{role_key: "viewer"}`
**Then** 返回 200，U 的 role 改为 viewer

**Given** U 是 W 的最后一个 workspace_owner
**When** 调 PATCH `{role_key: "developer"}`（降级）
**Then** 返回 400 `cannot_remove_last_owner`

**Given** viewer 调 PATCH
**When** 调用
**Then** 返回 403

### FR-05: 移除成员

**Given** user U 是 W 的 developer（还有另一个 owner）
**When** workspace_owner 调 DELETE `/api/workspaces/{W}/members/{U}`
**Then** 返回 204，UserWorkspaceRole 行删除；U 后续访问 W 的资源 → 403

**Given** U 是 W 的最后一个 workspace_owner
**When** 调 DELETE
**Then** 返回 400 `cannot_remove_last_owner`

**Given** U 不在 W（误删）
**When** 调 DELETE
**Then** 返回 404（或幂等 204，二者择一：本变更取 404 暴露问题）

### FR-06: 传递所有权

**Given** 当前 user C 是 W 的 owner，target user T 是 W 的 developer
**When** C 调 POST `/api/workspaces/{W}/members/{T}/transfer-ownership`
**Then** 返回 200，单事务内：T 的 role → workspace_owner，C 的 role → developer；返回 `{new_owner: T, demoted: C}`

**Given** 并发场景：C 同时调两次 transfer（不同 target）
**When** 两次并发到达
**Then** 最多一次成功；另一次返回 409 或 400（取决于实现，至少不能让两个都降级 C 后 W 无 owner）

**Given** C 不是 W 的 owner（developer 试图 transfer）
**When** 调用
**Then** 返回 403

### FR-07: 前端 Members tab

**Given** workspace `W` 详情页 `/workspaces/{W}`
**When** 加载
**Then** 顶部 tab 栏出现 `Overview / Components / Changes / Members` 4 个 tab；Members 高亮当 URL 为 `/workspaces/{W}/members`

**Given** workspace_owner 打开 Members tab
**When** 页面渲染
**Then** 显示成员表格（含 "+ Add Member" 按钮、role dropdown、Set Owner、Remove 操作）；当前用户行有 "(you)" 标识且 Set Owner/Remove 禁用

**Given** viewer 打开 Members tab（前端无按钮控制时）
**When** 渲染
**Then** 列表只读，无 "+ Add Member"、无 dropdown、无 Remove/Set Owner；或前端隐藏该 tab（择一，本变更取"显示但禁用"以保持一致体验）

### FR-08: 添加成员对话框

**Given** workspace_owner 点 "+ Add Member"
**When** 对话框打开
**Then** 显示搜索 input + 候选区 + 角色下拉（默认 developer）+ Cancel/Add 按钮；Add 在无候选选中时 disabled

**Given** 输入 "ali"（debounce 300ms）
**When** 调用 searchUsersForInvite
**Then** 候选区显示 active 且非成员的用户；点击选中后高亮

**Given** 选中候选 + 选 developer + 点 Add
**When** addMember 成功
**Then** 对话框关闭，列表刷新，新成员出现在表格中

**Given** addMember 失败（如 API 400）
**When** 错误返回
**Then** 对话框保持打开，顶部显示红色错误条

## 非功能需求

### 兼容性
- 现有用户/workspace 不受影响：注册时 seed 的 UserWorkspaceRole 关系保留
- 现有的 `_user_owns_run`（已按 membership 校验）自动受益——用户加进 ws 后，daemon 用 admin API key 访问该 ws 的 run 不再 403
- 新增端点独立挂载，不修改现有 `/api/workspaces/{id}` 路由

### 可回退
- 新增代码全部在新文件（members_router.py / members_service.py / workspace-members.ts / members/page.tsx）
- 回退 = 删除新文件 + 还原 page.tsx tab 化（git revert）
- 不涉及 migration，无数据回退风险

### 可测试
- 后端单测必须（target ≥15 用例，覆盖 FR-01..06 所有 GWT 块）
- 前端依赖 e2e 手动验收（FR-07/08）

### 安全
- 搜索只返回 `status='active'` 用户
- 搜索响应字段最小化（user_id/email/display_name）
- 禁止通过该 API 授予 platform_admin 角色（系统级保留）
- 所有写入端点强制 `WORKSPACE_MEMBER_MANAGE` permission（仅 workspace_owner + platform_admin 满足）
