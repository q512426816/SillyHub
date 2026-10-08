---
author: flow-machine-draft
created_at: 2026-10-08T02:31:02.682Z
---
# 设计记录（Design Record）— 2026-10-08-rbac-dead-permissions-cleanup

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

问题：全站菜单权限对账（2026-10-08 前两变更）后，后端 Permission 目录仍有 14 个零端点消费的死权限——code:*×4 与 tool:*×4 是 2026-05-25 bootstrap 参考设计的代码评审/工具门控残留（平台演进为 git 网关与会话 canUseTool 审批，从未接线）；task:cancel / task:approve / platform:audit:read / platform:billing / component:read / change:update 属意图未接线或功能从未建。其中 4 个挂在菜单卡上误导配置（task:approve / platform:audit:read / component:read / change:update），其余不在任何卡上配不了也无处可用。另有 task:create / task:assign 两个活权限（POST /tasks 与 transition 端点消费）不挂卡配不了。

方案：枚举删 14 键（72→58）+ 前端 4 菜单卡同步（删死键；changes 卡补 task:create/task:assign 使活权限可配）+ 种子迁移 SYSTEM_ROLES 精简（新环境不再播种死行）+ 新增存量清理迁移（删 role_permissions 死行，含从未入枚举的 component:write/admin 共 16 字符串；downgrade 对称回植 platform_admin，仿 20260720_drop_ppm_op 先例）+ pnpm gen:types 重生成契约。保留设计性纯门控键（llm_provider:read / skill:read / mcp:read / agent_profile:read / agent_session:read）与 PPM 全部键（已上线，D-002 悬空决策）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- 无端点增删、无鉴权行为变化（删除的键本就零消费，端点鉴权矩阵不动）。
- OpenAPI 契约：Permission 联合 72→58（RoleCreate/RoleUpdate.permission_keys 校验域缩），api-types.ts 随 gen:types 重生成并连同 backend/openapi.json 提交。
- 角色读写：写路径 list[Permission] 校验照旧（删键后旧客户端发死键 422，未上线可接受）；读路径 raw 字符串照旧，存量死行由迁移清除。
- 前端菜单卡：components→[workspace:read]；changes→[change:create/read/approve/archive + task:read/create/assign]；approvals→[change:approve, task:read, task:run_agent]；audit→[change:read]。可见性随卡片收窄（死键持有者本就打不开页面）。
- DB：role_permissions 删 16 个死字符串的全部行；roles 本体不动。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   不适用——静态枚举 + 一次性迁移，无事件/流输入。权限缓存（permission_cache）在部署重启后重建，迁移先于流量。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   迁移 DELETE 为幂等单语句，多实例部署按 alembic 单写者惯例串行；运行期无并发写面。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   安全——删除的键零消费，进行中请求不依赖；迁移中断可重跑（DELETE 幂等）。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   不会——role_permissions 为平台级表，删除按 permission 字符串全局收敛，无工作区分叉；sillyhub-daemon 零引用（已核）。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：线上（crrcdt）存量角色持有死键的行被删——零功能影响（无端点消费），角色列表显示权限数变少属预期收敛；PPM 角色不涉任何删除键（PPM 18 键全保留）。次要风险：种子迁移编辑只影响新环境（已应用环境不重跑），存量靠清理迁移收敛，两路径已在 ppm-permission-simplify 先例验证。

试过但放弃的方案：① 给 code:* / tool:* 接消费端点（代码评审流 / 工具 RBAC 门控）——放弃：属新功能立项不是清理，且会话 canUseTool 审批已是现行机制；② 只隐藏不删（卡片摘掉、枚举保留）——放弃：枚举残留仍进 OpenAPI 契约与角色校验域，"配了没用"的混乱只是换个形态；③ 顺带删 PermissionGroup（后端零消费）——放弃：与权限键删除耦合扩散测试面，留待独立清理。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | backend/app/modules/auth/permissions.py | 删 14 成员 + AUDIT 组成员与特判 + 注释 |
| 修改 | backend/migrations/versions/202605280900_create_auth_and_rbac.py | SYSTEM_ROLES 播种清单精简 |
| 新增 | backend/migrations/versions/202610081000_drop_dead_rbac_permissions.py | 存量死行清理（16 字符串），downgrade 回植 |
| 修改 | backend/tests/modules/auth/test_permissions.py | 计数 58、组成员 6、参数化与字面量用例删项 |
| 修改 | backend/tests/modules/admin/test_roles_router.py | CODE_REVIEW/CODE_WRITE 夹具换存活键 |
| 修改 | backend/tests/modules/workspace/test_members_service_business_member.py | CODE_WRITE 负断言换存活键 |
| 修改 | backend/tests/modules/auth/test_business_member_role.py | "code:write" not in 断言换存活键 |
| 修改 | backend/tests/modules/test_permission_cache.py | 假数据 code:read 换存活键 |
| 修改 | frontend/src/lib/menu-permissions.ts | 4 菜单卡同步 |
| 修改 | frontend/src/lib/__tests__/menu-permissions.test.ts | 镜像 58 + 卡片断言 + 6→5 子菜单 |
| 修改 | frontend/src/app/(dashboard)/admin/roles/page.tsx | 标签映射删 3 死键 fallback |
| 生成 | frontend/src/lib/api-types.ts + backend/openapi.json | pnpm gen:types |
| 修改 | .sillyspec/docs/frontend/modules/lib-menu-permissions.md | 模块卡同步 |
