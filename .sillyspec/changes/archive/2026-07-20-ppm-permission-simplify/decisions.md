---
author: qinyi
created_at: 2026-07-20 12:32:27
---

# 决策台账 — 精简 PPM 权限

## D-001@v1: project-members 菜单悬空 ppm:project:write 引用清理

- **type**: 实现决策
- **status**: accepted
- **source**: 需求澄清 Grill（step 7）
- **question**: menu-permissions.ts 的 project-members 菜单 permissions 含要删的 ppm:project:write，删权限后这条变悬空引用，如何处理？
- **answer**: 去除该悬空条目，project-members 菜单显隐改由 ppm:project:read 单独控制。
- **normalized_requirement**: 删除 ppm:project:write 权限后，menu-permissions.ts 中所有引用该权限字符串的菜单条目须同步清理，保证无悬空引用。
- **impacts**: frontend/src/lib/menu-permissions.ts project-members 菜单 permissions 数组删 write 条目；菜单显隐不变（canSeeMenu 任一命中，read 兜底）。
- **evidence**: menu-permissions.ts L362-365；permission.ts canSeeMenu = hasAnyPermission 取并集。
- **priority**: P1

## D-002@v1: 6 ppm router 去校验改用 get_current_principal

- **type**: 实现决策
- **status**: accepted
- **source**: 需求澄清 Grill（step 7）+ 用户决策"完全去掉接口检查"
- **question**: 6 个 ppm router 的 require_permission_any(PPM_*) 如何去除？
- **answer**: 端点 user 依赖改为 Depends(get_current_principal)（仅认证不授权，保留 JWT + API key 双路径）。
- **normalized_requirement**: ppm 接口不再做 ppm 权限校验，仅要求登录认证。
- **impacts**: project/plan/task/problem/kanban/workbench 六个 router 全部端点；集中类型别名统一为 AuthUser。
- **evidence**: auth_deps.py L154 get_current_principal（双路径仅认证）；L124 require_permission_any 内部即 Depends(get_current_principal)。
- **priority**: P1

## D-003@v1: 迁移双轨策略

- **type**: 架构决策
- **status**: accepted
- **source**: 需求澄清 Grill（step 7）
- **question**: 数据库迁移如何处理（改旧 seed vs 新清理迁移）？
- **answer**: 双轨——(a) 改旧种子迁移 202607041000 的 PPM_PERMISSIONS 清单 25→8（新环境干净）；(b) 新增清理迁移 DELETE 已部署 DB 的 17 条 role_permissions 授权。
- **normalized_requirement**: 新环境从头部署只 seed 8 个菜单权限；已部署环境 upgrade 时清理多余操作权限授权。
- **impacts**: 修改 202607041000_seed_ppm_permissions.py；新增 20260720_xxxx_drop_ppm_operation_permissions.py（down_revision 接当前唯一 head）。
- **evidence**: 202607041000 迁移只操作 role_permissions 表（无独立 permissions 表，权限是枚举不入库）；规则 11 未上线允许重置。
- **priority**: P0

## D-004@v1: 测试与生成产物同步

- **type**: 实现决策
- **status**: accepted
- **source**: 需求澄清 Grill（step 7）
- **question**: 删权限后哪些配套需要同步？
- **answer**: (1) test_ppm_permissions.py EXPECTED 25→8 + count 断言；(2) seed_platform_admin_role 遍历枚举自动收敛，无需改；(3) admin-role-permission-picker 按枚举渲染自动适配（D-001 menu 改动同步）；(4) sillyhub-daemon api-types.ts 重新生成；(5) ppm router 测试 403→200。
- **normalized_requirement**: 权限定义变更后，所有依赖该定义的测试、种子、UI picker、生成产物保持一致。
- **impacts**: test_ppm_permissions.py；backend/tests/modules/ppm/ router 测试；sillyhub-daemon/src/api-types.ts。
- **evidence**: service.py seed_platform_admin_role 遍历 Permission 枚举；admin-role-permission-picker 按枚举/菜单渲染；api-types.ts 为 OpenAPI 生成产物。
- **priority**: P1

## 方案决策：彻底删除（方案 A）

- **type**: 方案选择
- **status**: accepted
- **source**: step 8 方案对比 + 用户选择
- **question**: 删 ppm 操作权限的实现路径？
- **answer**: 彻底删除（枚举 + 迁移 + role_permissions + 测试全清），非"只去校验留定义"。
- **normalized_requirement**: 17 个操作权限从系统中完全移除，不留死代码。
- **impacts**: 贯穿 design 全文（Phase 1-5）。
- **evidence**: 用户原话"全部去掉"；摆设权限无负担；规则 11 未上线无兼容问题。
- **priority**: P0
