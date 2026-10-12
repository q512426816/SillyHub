---
author: flow-machine-draft
created_at: 2026-10-12T05:44:39.274Z
---
# 设计记录（Design Record）— 2026-10-12-nullable-email-dto-fix

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

线上 500 的直接原因是 pydantic 校验：`RoleUserRead.email` 声明为必填 `str`，
而库中存在 `email=NULL` 的纯用户名账号（D-001，2026-06-24-username-login 起合法）
绑定在该角色上。方案与 `UserRead` 的既有修法保持同构（admin/schema.py:245
`email: str | None`）：三处响应 DTO 的 `email` 改可空，同时新增
`username: str | None`——只把 email 放空会让纯用户名账号在列表里变成"无任何
可识别标识的空行"，username 是这类账号唯一的天然标识，顺带补上才可审计。

改动面：admin 的 `RoleUserRead` + `roles_service.list_users`（两处构造，
User 是整实体查询直接取 `user.username`）；workspace 的 `WorkspaceMemberView` /
`UserSearchHit` + `members_service`（列表与搜索的 select 元组补 `User.username`）
+ `members_router._row_to_view`（`session.get(User,…)` 整实体，直接取）。
前端三处手写/生成类型同步（`workspace-members.ts` 与 `lib/admin.ts` 是手写 DTO，
必须手动对齐；`api-types.ts` 走 `pnpm gen:types` 重生成），渲染点做空值回退，
角色页聚合排序的 `a.email.localeCompare(b.email)` 改为 null 安全键
（`email ?? username ?? ""`）。测试先行：先写 email=None 的失败用例再改实现。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

对外可见变化（均为向后兼容的响应放宽/扩展，无破坏性变更；函数签名无变化，
均为 DTO 字段级改动）：

- `GET /api/admin/roles/{role_id}/users`：items 项 `email` 由必填变为可空
  （可为 `null`），新增 `username: string | null`。
- `GET /api/workspaces/{id}/members`、`POST …/members`、`PATCH …/members/{uid}`：
  `WorkspaceMemberView` 同上。
- `GET /api/workspaces/{id}/members/search`：`UserSearchHit` 同上。
- OpenAPI（backend/openapi.json）随上述 DTO 变化重生成；
  frontend `src/lib/api-types.ts`、sillyhub-daemon `src/api-types.ts` 由脚本重生成；
  `frontend/src/lib/workspace-members.ts`、`frontend/src/lib/admin.ts` 手写接口同步。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

答：不涉及事件流；HTTP 请求无状态。搜索排序 `ORDER BY email ASC` 在 PG 下
NULL 排最后（ASC 默认 NULLS LAST），响应顺序稳定，不受本改动影响。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

答：本变更是只读查询的 DTO 投影放宽，不新增写入路径；成员绑定行的并发增删
与现状一致（事务内一致快照读），无新竞态。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

答：DTO 字段放宽对在途旧客户端向后兼容（新增字段、必填变可空均不破坏旧
消费者解析）；前端 build 时固化的是类型而非数据，运行时对 `null` 已有
回退分支，无需灰度。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

答：admin 与 workspace 两个模块的 DTO 均从同一 `User.email` 取值，不存在
跨工作区串台；`username` 全局唯一（建表唯一约束），作为回退展示标识不会
撞名。daemon 侧 api-types.ts 仅类型消费，运行时不解析这三个端点的响应
（daemon 走 lease/heartbeat 等端点），重新生成即可，无行为影响。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：前端既有代码把 `email` 当非空用的隐藏点位漏改，tsc 抓不全的
（如模板里直接插值）运行时渲染出空白。缓解：渲染点逐一回退处理 +
workspace-member-row 补 null 用例 + tsc --noEmit 全量类型检查；
`localeCompare` 调用点仅角色页聚合排序一处（已全局搜索确认）。
实际执行中 tsc 全量扫出 3 处（members/page 两处 + shared-daemon-manager 一处），
另在 task-05 人工排查出 lib/admin.ts 手写 DTO 漏同步（tsc 因本地类型未改而放行）。

试过/考虑过但放弃的方案：
- service 层兜底 `email=user.email or ""`：契约撒谎（空串≠无邮箱），且
  前端无法区分"无邮箱"与"空邮箱"，弃。
- 只改 RoleUserRead 不动 workspace 两处：同类 500 隐患原地保留
  （成员列表/搜索遇纯用户名账号必炸），修一半等于没修，弃。
- 邀请搜索补 `username ILIKE` 匹配：属于搜索行为增强，与本 500 无关，
  留作后续独立小变更，避免本次 diff 膨胀。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 改 | backend/app/modules/admin/schema.py | RoleUserRead.email 可空 + username 字段 |
| 改 | backend/app/modules/admin/roles_service.py | list_users 两处构造补 username |
| 改 | backend/app/modules/workspace/schema.py | WorkspaceMemberView/UserSearchHit email 可空 + username |
| 改 | backend/app/modules/workspace/members_service.py | 成员列表/搜索 select 补 username、构造补参 |
| 改 | backend/app/modules/workspace/members_router.py | _row_to_view 补 username |
| 改 | backend/tests/modules/admin/test_roles_router.py | 新增 email=None 绑定用例（platform+workspace） |
| 改 | backend/tests/modules/workspace/test_members_router.py | 新增 email=None 列表+搜索用例 |
| 改 | backend/openapi.json | pnpm gen:types 重生成 |
| 改 | frontend/src/lib/api-types.ts | pnpm gen:types 重生成 |
| 改 | sillyhub-daemon/src/api-types.ts | daemon pnpm gen:types 重生成 |
| 改 | frontend/src/lib/workspace-members.ts | 手写 DTO 同步（email 可空 + username） |
| 改 | frontend/src/lib/admin.ts | 手写 RoleUserRead 同步（email 可空 + username） |
| 改 | frontend/src/app/(dashboard)/admin/roles/page.tsx | 聚合类型/排序 null 安全/单元格回退 |
| 改 | frontend/src/components/workspace-member-row.tsx | displayName 回退链 + email 空展示 |
| 改 | frontend/src/components/workspace-member-add-dialog.tsx | 候选项 email 空时回退 username |
| 改 | frontend/src/app/(dashboard)/workspaces/[id]/members/page.tsx | 操作确认标签回退链补 username |
| 改 | frontend/src/components/workspace/shared-daemon-manager.tsx | 出借人标签回退链补 username |
| 改 | frontend/src/components/workspace-member-row.test.tsx | 新增 email null 回退用例 |
| 改 | frontend/src/components/workspace/shared-daemon-manager.test.tsx | 夹具补 username 字段 |
