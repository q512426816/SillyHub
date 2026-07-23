---
author: qinyi
created_at: 2026-07-20 12:32:27
---

# 需求规格（Requirements）— 精简 PPM 权限

## 角色

| 角色 | 说明 |
|---|---|
| 平台管理员（platform_admin） | 唯一默认持有 ppm 权限的角色；删权限后其 ppm 操作授权被清理，但因 is_platform_admin 短路，实际访问能力不变 |
| 普通登录用户 | 删校验后理论上可调 ppm 接口；但前端菜单靠 8 个菜单权限控制，普通用户无 read 看不到 ppm 菜单 |
| 开发者 | 维护 permissions.py / 迁移 / 测试三处同步 |

## 功能需求

### FR-01: 删除 17 个 ppm 操作权限枚举成员
覆盖决策：D-004@v1
Given backend/app/modules/auth/permissions.py 的 Permission 枚举现有 25 个 PPM_* 成员
When 删除 PPM_PROJECT_WRITE/DELETE/EXPORT、PPM_CUSTOMER_WRITE/DELETE/EXPORT、PPM_PLAN_WRITE/DELETE/EXPORT、PPM_PROBLEM_WRITE/DELETE/EXPORT、PPM_TASK_WRITE/DELETE/EXPORT、PPM_WORKHOUR_WRITE、PPM_KANBAN_ASSIGN（共 17 个）
Then 枚举仅剩 8 个菜单权限成员，PermissionGroup.PPM 分组仍按 ppm: 前缀正确归类

### FR-02: 保留 8 个 ppm 菜单权限
覆盖决策：方案 A
Given 前端 menu-permissions.ts 的 14 个 ppm 菜单条目依赖菜单权限显隐
When 保留 PPM_PROJECT_READ / CUSTOMER_READ / PLAN_READ / PROBLEM_READ / TASK_READ / WORKHOUR_READ / WORKHOUR_STAT / KANBAN_VIEW
Then 前端菜单显隐逻辑不变

### FR-03: 6 个 ppm router 去权限校验
覆盖决策：D-002@v1
Given project/plan/task/problem/kanban/workbench 六个 router 端点用 Depends(require_permission_any(Permission.PPM_*))
When 改为 Depends(get_current_principal)（仅认证，保留 JWT + API key 双路径）
Then 登录用户可调用、未登录返回 401；不再查 ppm 权限

### FR-04: 数据库迁移双轨清理
覆盖决策：D-003@v1
Given 旧种子迁移 202607041000 的 PPM_PERMISSIONS 清单含 25 项，已部署 DB 的 role_permissions 含 17 条操作权限授权
When ①改旧迁移清单为 8 项；②新增清理迁移 upgrade = `DELETE FROM role_permissions WHERE permission IN (17 个)`
Then 新环境从头 seed 仅 8 个；已部署环境 upgrade 后 17 条操作权限记录清零（SELECT count == 0）

### FR-05: 权限枚举测试更新
覆盖决策：D-004@v1
Given test_ppm_permissions.py 的 EXPECTED_PPM_PERMISSIONS 断言 25 项、count == 25
When 改 EXPECTED 为 8 项、count == 8、admin 持有权限断言为 8 个菜单权限
Then test_ppm_permissions.py 全绿

### FR-06: 前端 project-members 菜单清理悬空引用
覆盖决策：D-001@v1
Given menu-permissions.ts 的 project-members 菜单 permissions = [ppm:project:read, ppm:project:write]，删 write 后悬空
When 删除 write 条目，只留 read
Then project-members 菜单显隐不变（canSeeMenu 任一命中，read 兜底）

### FR-07: admin picker + daemon api-types 同步
覆盖决策：D-004@v1
Given admin-role-permission-picker 按枚举渲染、sillyhub-daemon api-types.ts 是 OpenAPI 生成产物
When 删枚举后确认 picker 自动少列、重新生成 api-types
Then picker 不列被删的 17 个权限；api-types 的 ppm 权限类型同步减少

### FR-08: ppm 接口最小冒烟测试
覆盖决策：R-04
Given ppm 模块当前无任何 router 测试，删校验后无自动化回归守护
When 新增 backend/tests/modules/ppm/test_router_smoke.py
Then 覆盖"登录可访问 ppm 接口 200 / 未登录 401"最小断言

## 非功能需求

- **兼容性**：项目未上线（规则 11），允许重置开发/测试数据。API 行为向后不兼容（ppm 接口从需权限改为登录即可），内部系统可接受。
- **可回退**：downgrade 新清理迁移回植 17 权限 + revert router / 枚举 / 前端改动。
- **可测试**：AC-1 ~ AC-8 均可自动化或手动验证。
- **跨平台**：迁移避开 PG/SQLite 方言差异（沿用旧迁移幂等 + op.execute 方言无关写法）。

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-06 | project-members 悬空 write 清理 |
| D-002@v1 | FR-03 | 6 router 改 get_current_principal |
| D-003@v1 | FR-04 | 迁移双轨 |
| D-004@v1 | FR-01, FR-05, FR-07 | 枚举删 / 测试改 / picker+daemon 同步 |
| 方案 A（彻底删） | FR-01, FR-04, FR-05 | 决定枚举/迁移/测试三处全清 |
