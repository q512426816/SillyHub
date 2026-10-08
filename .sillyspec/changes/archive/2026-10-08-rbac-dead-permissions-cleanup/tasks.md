---
author: flow-machine-draft
created_at: 2026-10-08T02:31:02.682Z
---
# 任务注册表（Tasks）— 2026-10-08-rbac-dead-permissions-cleanup

- [x] task-01: 后端 Permission 枚举 72→58（permissions.py 删 14 死成员 + AUDIT 组与特判 + docstring；全量扫描脚本核实 backend/app 与 sillyhub-daemon 零非测试引用）——验证：test_permissions.py「count_is_58」「dead_permissions_removed」绿
- [x] task-02: 前端 4 菜单卡同步（components→[workspace:read]、changes 删 change:update 加 task:create/assign、approvals 删 task:approve、audit→[change:read]）+ 角色页标签映射删 3 死键 fallback——验证：menu-permissions.test.ts changes/audit/components 用例绿
- [x] task-03: 种子迁移 202605280900 SYSTEM_ROLES 精简 + 新迁移 20261008100000（16 死字符串 DELETE；downgrade 对称回植 platform_admin，sa.Uuid(as_uuid=False) 兼容 SQLite 回放）——验证：test_drop_dead_rbac_migration_* 回放测试绿
- [x] task-04: pnpm gen:types 重生成（api-types Permission 联合 58、死键零残留、openapi.json 同步刷新）——验证：node 解析联合数 === 58 且 contains 死键 === false
- [x] task-05: 测试同步全绿（后端 permissions 47 + business_member/permission_cache/roles_router/business_member_members 共 92 过；前端 96 过）+ ruff/ruff format/mypy 993 文件 0 issue + tsc 零输出 + eslint 0 error——验证：本行即记录
