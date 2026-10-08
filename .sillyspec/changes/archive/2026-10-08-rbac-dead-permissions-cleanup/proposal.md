---
author: flow-machine-draft
created_at: 2026-10-08T02:31:02.682Z
---
# 提案书（Proposal）— 2026-10-08-rbac-dead-permissions-cleanup

## 动机

任务原话转写：RBAC 目录清理：14 个零端点消费的死权限（code:*×4、tool:*×4、task:cancel、task:approve、platform:audit:read、platform:billing、component:read、change:update）从枚举/菜单卡/种子删除，task:create 与 task:assign（有真实端点）挂到变更中心卡使其可配；新增迁移清理存量 role_permissions 死行（含从未入枚举的 component:write/admin）。

成功标准：
- 后端 Permission 枚举 72→58，删除的 14 键在 backend/app 与 sillyhub-daemon 零非测试引用（已核）
- 前端 4 菜单卡同步（components→仅 workspace:read、changes 删 change:update 加 task:create/assign、approvals 删 task:approve、audit→仅 change:read），角色页标签映射同步
- 种子迁移 SYSTEM_ROLES 精简 + 新增存量清理迁移（downgrade 对称回植 platform_admin，仿 20260720_drop_ppm_op 先例）
- pnpm gen:types 重生成 api-types（Permission 联合 58）并与 openapi.json 一并提交
- 后端 auth/roles 相关测试与前端 menu-permissions 测试同步更新全绿，ruff/mypy/tsc/eslint 零新增报错

## 变更范围

按成功标准机械推导，共 5 条验收面：
1. 后端 Permission 枚举 72→58，删除的 14 键在 backend/app 与 sillyhub-daemon 零非测试引用（已核）
2. 前端 4 菜单卡同步（components→仅 workspace:read、changes 删 change:update 加 task:create/assign、approvals 删 task:approve、audit→仅 change:read），角色页标签映射同步
3. 种子迁移 SYSTEM_ROLES 精简 + 新增存量清理迁移（downgrade 对称回植 platform_admin，仿 20260720_drop_ppm_op 先例）
4. pnpm gen:types 重生成 api-types（Permission 联合 58）并与 openapi.json 一并提交
5. 后端 auth/roles 相关测试与前端 menu-permissions 测试同步更新全绿，ruff/mypy/tsc/eslint 零新增报错

## 成功标准（可验证）

1. 后端 Permission 枚举 72→58，删除的 14 键在 backend/app 与 sillyhub-daemon 零非测试引用（已核）
2. 前端 4 菜单卡同步（components→仅 workspace:read、changes 删 change:update 加 task:create/assign、approvals 删 task:approve、audit→仅 change:read），角色页标签映射同步
3. 种子迁移 SYSTEM_ROLES 精简 + 新增存量清理迁移（downgrade 对称回植 platform_admin，仿 20260720_drop_ppm_op 先例）
4. pnpm gen:types 重生成 api-types（Permission 联合 58）并与 openapi.json 一并提交
5. 后端 auth/roles 相关测试与前端 menu-permissions 测试同步更新全绿，ruff/mypy/tsc/eslint 零新增报错
