---
author: flow-machine-draft
created_at: 2026-10-08T02:31:02.682Z
---
# 需求规格（Requirements）— 2026-10-08-rbac-dead-permissions-cleanup

## 功能需求

### FR-01: 删除 14 个零端点消费的死权限（枚举 72→58）

- backend Permission 枚举必须删除以下 14 个成员（均已核实 backend/app 与 sillyhub-daemon 零非测试引用）：code:read / code:write / code:review / code:merge、tool:shell_exec / tool:network / tool:database / tool:secret:read、task:cancel、task:approve、platform:audit:read、platform:billing、component:read、change:update。PermissionGroup.AUDIT 成员及其特判分支必须随 platform:audit:read 一并删除（组成员 7→6）。设计性纯门控键（llm_provider:read / skill:read / mcp:read / agent_profile:read / agent_session:read）与 PPM 全部 18 键必须保留。

#### 场景：主路径

- Given 变更后枚举
- When len(list(Permission))
- Then === 58

### FR-02: 活权限 task:create / task:assign 挂变更中心卡

- task:create（POST /api/workspaces/{ws}/tasks）与 task:assign（POST .../tasks/{tid}/transition）有真实端点消费，必须挂到 changes 菜单卡使其可配（注释注明 API 面、暂无页面按钮）。

#### 场景：主路径

- Given 角色管理勾选器
- When 打开「变更中心」卡
- Then 可勾选 task:create / task:assign

### FR-03: 存量数据清理迁移（16 死字符串）

- 新增迁移必须从 role_permissions 删除 16 个字符串的全量行（FR-01 的 14 键 + 从未入枚举的 component:write / component:admin 种子残留）；downgrade 必须对称回植 platform_admin（幂等，仿 20260720_drop_ppm_op 先例）；种子迁移 202605280900 的 SYSTEM_ROLES 必须同步精简使新环境不再播种死行。roles 本体与其它权限行禁止变动。

#### 场景：存量收敛

- Given 已部署环境 role_permissions 含 code:read 行
- When 迁移 upgrade
- Then 该行删除、同角色其它权限保留；downgrade 后 platform_admin 持有全部 16 键各 1 行

### FR-04: 前端菜单卡与角色页同步

- menu-permissions.ts 四卡必须同步：components→[workspace:read]、changes→[change:create/read/approve/archive + task:read + task:create + task:assign]（删 change:update）、approvals 删 task:approve、audit→[change:read]（删 platform:audit:read）；admin/roles 页 PERMISSION_NAME_MAP 必须删除 platform:billing / component:admin / component:write 三条 fallback；pnpm gen:types 必须重生成 api-types.ts（Permission 联合 58）并连同 backend/openapi.json 提交。

#### 场景：主路径

- Given 前端构建
- When 编译 menu-permissions.ts
- Then 删除键不再被引用、类型检查通过

### FR-05: 测试同步全绿 + 静态检查零新增

- 后端 test_permissions.py（计数/组成员/参数化/字面量）、test_roles_router.py、test_members_service_business_member.py、test_business_member_role.py、test_permission_cache.py 的死键夹具必须换存活键；前端镜像常量 72→58 与卡片断言必须同步。相关测试必须全绿；ruff / mypy / tsc / eslint（改动文件）零新增报错。禁止跑全量测试。

#### 场景：主路径

- Given 全部修改完成
- When 跑上述前后端测试与静态检查
- Then 全部通过

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: backend/tests/modules/auth/test_permissions.py「test_permission_count_is_58」+「test_permission_group_has_six_members」
FR-02: frontend/src/lib/__tests__/menu-permissions.test.ts「changes = change:create/read/approve/archive + task:read/create/assign（2026-10-08 清理版）」
FR-03: backend/tests/modules/auth/test_permissions.py「test_drop_dead_rbac_migration_upgrade_deletes_and_downgrade_replants」（新迁移 SQLite 回放，仿 knowledge_write 迁移测试范式）
FR-04: frontend/src/lib/__tests__/menu-permissions.test.ts「所有 permission.key 命中 BACKEND_PERMISSION_KEYS，且镜像常量长度 === 58」+ tsc 编译面
FR-05: backend/tests/modules/auth/test_permissions.py 全文件 + frontend/src/lib/__tests__/menu-permissions.test.ts 全文件
