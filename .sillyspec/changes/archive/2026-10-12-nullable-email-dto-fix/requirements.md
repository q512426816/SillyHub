---
author: flow-machine-draft
created_at: 2026-10-12T05:44:39.274Z
---
# 需求规格（Requirements）— 2026-10-12-nullable-email-dto-fix

背景：生产环境（crrcdt.ppdmq.top）`GET /api/admin/roles/62f2f23f-…/users` 返回 500。
后端日志（request_id f9c93f39-7702-4d22-aa60-b38101c05b5b）实证为
`pydantic ValidationError for RoleUserRead: email Input should be a valid string,
input_value=None`。根因：`User.email` 自 2026-06-24-username-login（D-001）起可空
（`backend/app/modules/auth/model.py:40-44`），而 admin/workspace 模块三处响应 DTO
仍把 `email` 声明为必填 `str`。

## 功能需求

### FR-01: 后端三处响应 DTO 的 email 改为可空并补充 username 字段,对应 service 查询补 select/构造

`RoleUserRead`（admin/schema.py）、`WorkspaceMemberView` 与 `UserSearchHit`
（workspace/schema.py）的 `email` 字段必须声明为可空（`str | None`），禁止再以必填
`str` 承接可能为 NULL 的 `User.email`；三者必须同时新增 `username: str | None`
字段，`RoleService.list_users`、`members_service`（成员列表 / 邀请搜索）与
`members_router._row_to_view` 必须在查询与 DTO 构造处填充 `username`，
保证 email 为空的纯用户名账号在响应里可识别。

#### 场景：DTO 契约与取数补齐

- Given 2026-06-24-username-login 之后 `User.email` 允许 NULL
- When 三个响应 DTO 任一被构造或序列化
- Then `email=None` 不再触发 pydantic ValidationError，且响应项带 `username` 字段

### FR-02: GET /api/admin/roles/{role_id}/users 对 email 为 NULL 的绑定用户返回 200(email=null 且 username 有值),不再 500

该端点对绑定了 `email=None` 用户的角色必须返回 200，响应项中该用户
`email` 为 `null` 且 `username` 有值；禁止再抛未处理异常导致 500。
platform 与 workspace 两种绑定形态都必须满足。

#### 场景：平台级绑定的纯用户名账号

- Given 角色通过 `user_roles` 绑定了一个 `email=None, username="xxx"` 的用户
- When GET /api/admin/roles/{role_id}/users
- Then 200，items 含该用户且 `email=null`、`username="xxx"`、`binding_type="platform"`

#### 场景：工作区级绑定的纯用户名账号

- Given 角色通过 `user_workspace_roles` 绑定了一个 `email=None` 用户
- When GET /api/admin/roles/{role_id}/users
- Then 200，对应项 `email=null` 且带 workspace_id/workspace_name

### FR-03: 工作区成员列表与邀请搜索接口对 email 为 NULL 的用户同样返回 200

`GET /api/workspaces/{id}/members`（列表）与
`GET /api/workspaces/{id}/members/search`（邀请搜索）在成员/候选为
`email=None` 用户时必须返回 200 且该项 `email=null`、`username` 有值；
禁止因此 500。邀请搜索按 display_name 命中的纯用户名账号必须正常出现在候选中。

#### 场景：成员列表含纯用户名账号

- Given 工作区成员中有 `email=None` 用户
- When GET /api/workspaces/{id}/members
- Then 200，该项 `email=null` 且 `username` 有值

#### 场景：邀请搜索命中纯用户名账号

- Given 存在 `email=None` 且 display_name 含关键字的工作区外用户
- When GET /api/workspaces/{id}/members/search?q=<关键字>
- Then 200，候选含该用户且 `email=null`、`username` 有值

### FR-04: 前端类型同步与空值回退展示,排序不再对 null 调 localeCompare

`pnpm gen:types`（frontend，刷新 backend/openapi.json）与
sillyhub-daemon `pnpm gen:types` 必须重跑并提交产物；
`frontend/src/lib/workspace-members.ts` 手写 DTO 必须同步为 email 可空 + username。
角色用户表（admin/roles/page.tsx）、工作区成员行（workspace-member-row.tsx）、
邀请搜索弹窗（workspace-member-add-dialog.tsx）、成员页（members/page.tsx）
对 `email=null` 必须有回退展示（依次回退 username / 占位符），
禁止对 null 值直接调用 `localeCompare` 或渲染空行。

#### 场景：角色用户表渲染纯用户名账号

- Given 接口返回 `email=null, username="xxx"` 的角色用户项
- When 角色用户表渲染
- Then 邮箱列显示占位符不报错，显示名列回退展示 username，排序稳定不抛错

### FR-05: 相关测试全绿与产物提交

后端必须仅跑本次相关 pytest（admin roles + workspace members）全绿；
前端必须 `tsc --noEmit` 通过；`backend/openapi.json`、
`frontend/src/lib/api-types.ts`、`sillyhub-daemon/src/api-types.ts`
必须与后端 DTO 同步提交，禁止手写类型落后于后端契约。

#### 场景：回归验证

- When 跑 backend/tests/modules/admin/test_roles_router.py 与
  tests/modules/workspace/test_members_router.py 全部用例
- Then 全绿；前端 tsc --noEmit 0 错

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: backend/tests/modules/admin/test_roles_router.py「test_list_role_users_email_null_username_present」
FR-02: backend/tests/modules/admin/test_roles_router.py「test_list_role_users_email_null_username_present」
FR-03: backend/tests/modules/workspace/test_members_router.py「test_list_and_search_return_200_for_email_null_user」
FR-04: frontend/src/components/workspace-member-row.test.tsx「email null 时回退展示 username 且不崩」
FR-05: backend/tests/modules/admin/test_roles_router.py「全文件回归」；frontend tsc --noEmit（无单测面，验证命令见 FR-05 正文）
