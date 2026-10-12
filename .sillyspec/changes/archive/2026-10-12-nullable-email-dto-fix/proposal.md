---
author: flow-machine-draft
created_at: 2026-10-12T05:44:39.274Z
---
# 提案书（Proposal）— 2026-10-12-nullable-email-dto-fix

## 动机

任务原话转写：线上 GET /api/admin/roles/{id}/users 返回 500:User.email 自 2026-06-24-username-login 起可空(D-001 纯用户名账号),但 RoleUserRead / WorkspaceMemberView / UserSearchHit 三个响应 DTO 仍声明 email 必填,库中 email 为 NULL 的绑定用户触发 pydantic ValidationError(生产日志 request_id f9c93f39 实证)。
成功标准：
 - 后端三处响应 DTO 的 email 改为可空并补充 username 字段,对应 service 查询补 select/构造
 - GET /api/admin/roles/{role_id}/users 对 email 为 NULL 的绑定用户返回 200(email=null 且 username 有值),不再 500
 - 工作区成员列表与邀请搜索接口对 email 为 NULL 的用户同样返回 200
 - 前端 pnpm gen:types 重生成并提交,角色用户表/工作区成员行/邀请搜索弹窗对 email=null 有回退展示,排序不再对 null 调 localeCompare
 - 后端仅跑本次相关 pytest 全绿,前端 tsc --noEmit 通过,提交 api-types.ts 与 backend/openapi.json

## 变更范围

按成功标准机械推导，共 5 条验收面：
1. 后端三处响应 DTO 的 email 改为可空并补充 username 字段,对应 service 查询补 select/构造
2. GET /api/admin/roles/{role_id}/users 对 email 为 NULL 的绑定用户返回 200(email=null 且 username 有值),不再 500
3. 工作区成员列表与邀请搜索接口对 email 为 NULL 的用户同样返回 200
4. 前端 pnpm gen:types 重生成并提交,角色用户表/工作区成员行/邀请搜索弹窗对 email=null 有回退展示,排序不再对 null 调 localeCompare
5. 后端仅跑本次相关 pytest 全绿,前端 tsc --noEmit 通过,提交 api-types.ts 与 backend/openapi.json

## 成功标准（可验证）

1. 后端三处响应 DTO 的 email 改为可空并补充 username 字段,对应 service 查询补 select/构造
2. GET /api/admin/roles/{role_id}/users 对 email 为 NULL 的绑定用户返回 200(email=null 且 username 有值),不再 500
3. 工作区成员列表与邀请搜索接口对 email 为 NULL 的用户同样返回 200
4. 前端 pnpm gen:types 重生成并提交,角色用户表/工作区成员行/邀请搜索弹窗对 email=null 有回退展示,排序不再对 null 调 localeCompare
5. 后端仅跑本次相关 pytest 全绿,前端 tsc --noEmit 通过,提交 api-types.ts 与 backend/openapi.json
