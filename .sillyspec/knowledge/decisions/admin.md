# 决策知识 — admin

> decision-distill 从变更 decisions.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为 docs-check 机械解析契约，勿手改。

## D-001@v1 菜单在线管理采用「前端注册表不动 + 后端覆盖表」架构（方案 A）
状态：implemented
变更：2026-09-18-web-menu-management
锚点：frontend/src/lib/menu-permissions.ts
最近确认：d2b380ae2
理由：选方案 A。菜单注册表（有哪些菜单/挂什么权限/分组结构）仍以 `frontend/src/lib/menu-permissions.ts` 为单一数据源；后端仅新增 `menu_overrides` 覆盖表（menu_key 主键 + label_override/sort_order/hidden），前端侧边栏与移动导航合并覆盖渲染。理由：与「菜单跟页面走」既有架构一致（新页面本需发版）、菜单-权限映射保留编译期类型检查（api-types.ts 已生成 Permission 联合类型）、行级审计清晰。否决 B：菜单与页面代码分离引入两处同步漂移风险、权限映射失去类型检查；否决 C：整包覆盖无行级审计、并发最后写赢。
故障面：覆盖端点/拉取故障时导航 fallback——mergeMenus 对拉取失败按空覆盖直通注册表，菜单管理页报错条幅；不影响登录与既有权限显隐
退役判据：若未来出现多客户端共享菜单目录的真实需求（后端全量菜单表），本覆盖表与前端合并层随该迁移一并废弃

## D-admin-001@v1 2026-10-12-nullable-email-dto-fix——线上 500 的直接原因是 pydantic 校验：`RoleUserRead.email` 声明为必填 `str`， 而库中存在 `email=NULL` 的
状态：implemented
变更：2026-10-12-nullable-email-dto-fix
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-12-nullable-email-dto-fix/design.md
文件：backend/app/modules/admin/roles_service.py, backend/app/modules/admin/schema.py, backend/app/modules/workspace/members_router.py, backend/app/modules/workspace/members_service.py, backend/app/modules/workspace/schema.py, backend/openapi.json, backend/tests/modules/admin/test_roles_router.py, backend/tests/modules/workspace/test_members_router.py, frontend/src/app/(dashboard)/admin/roles/page.tsx, frontend/src/app/(dashboard)/workspaces/[id]/members/page.tsx, frontend/src/components/workspace-member-add-dialog.tsx, frontend/src/components/workspace-member-row.test.tsx, frontend/src/components/workspace-member-row.tsx, frontend/src/components/workspace/shared-daemon-manager.test.tsx, frontend/src/components/workspace/shared-daemon-manager.tsx, frontend/src/lib/admin.ts, frontend/src/lib/api-types.ts, frontend/src/lib/workspace-members.ts, sillyhub-daemon/src/api-types.ts
最近确认：未记录
理由：线上 500 的直接原因是 pydantic 校验：`RoleUserRead.email` 声明为必填 `str`， 而库中存在 `email=NULL` 的纯用户名账号（D-001，2026-06-24-username-login 起合法） 绑定在该角色上。方案与 `UserRead` 的既有修法保持同构（admin/schema.py:245 `email: str | None`）：三处响应 DTO 的 `email` 改可空，同时新增 `username: str | None`——只把 email 放空会让纯用户名账号在列表里变成"无任何 可识别标识的空行"，username 是这类账号唯一的天然标识，顺带补上才可审计。 改动面：admin 的 `RoleUserRead` + `roles_service.list_users`（两处构造， User 是整实体查询直接取 `user.username`）；workspace 的 `WorkspaceMemberView` / `UserSearchHit` + `members_service`（列表与搜索的 select 元组补 `User.username`） + `members_router._row_to_view`（`session.get(User,…)` 整实体，直接取）。 前端三处手写/生成类型同步（`workspace-members.ts` 与 `lib/admin.ts` 是手写 DTO， 必须手动对齐；`api-types.ts` 走 `pnpm gen:types` 重生成），渲染点做空值回退， 角色页聚合排序的 `a.email.localeCompare(b.email)` 改为 null 安全键 （`email ?? username ?? ""`）。测试先行：先写 email=None 的失败用例再改实现。
