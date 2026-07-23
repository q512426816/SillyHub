---
author: qinyi
created_at: 2026-07-20 12:32:27
---

# 提案书（Proposal）— 精简 PPM 权限

## 动机

PPM 模块当前定义了 25 个 `ppm:*` 权限，其中 17 个操作类权限（write/delete/export/assign）实际是摆设——仅平台管理员持有、前端按钮不依赖它们、无实际访问控制价值，却带来枚举/迁移/测试三处同步负担和 admin 权限选择器列表冗长。用户要求移除这些操作权限，只保留控制菜单显隐的 8 个查看类权限，并去掉后端接口的权限校验。

## 关键问题

1. **摆设权限增加维护负担**：17 个操作权限要在 permissions.py 枚举、alembic 种子迁移、test_ppm_permissions.py 断言三处保持一致，任何一处遗漏都致守护测试红或迁移断裂。
2. **前端与后端权限模型不对称**：后端有 25 个细粒度权限做 endpoint 校验，前端 ppm 页面按钮却完全不用它们（靠 is_platform_admin + 所有权），两套模型并存造成认知负担。
3. **admin 权限选择器冗长**：admin-role-permission-picker 列出 25 个 ppm 权限供分配，其中 17 个分配了也无业务效果（前端不消费），误导管理员。

## 变更范围

- 删除 17 个 ppm 操作权限（project/customer/plan/problem/task 各 write/delete/export + work-hour:write + kanban:assign）的枚举定义、数据库授权、测试断言。
- 保留 8 个 ppm 菜单权限（project/customer/plan/problem/task 各 read + work-hour:read + work-hour:stat + kanban:view）。
- 6 个 ppm router（project/plan/task/problem/kanban/workbench）去掉 require_permission_any 校验，改为仅认证（get_current_principal）。
- 双轨数据库迁移：改旧种子迁移清单 + 新增清理迁移。
- 前端清理 project-members 菜单的悬空 ppm:project:write 引用。
- daemon api-types.ts 重新生成。
- 补 ppm 接口最小冒烟测试（弥补无回归守护）。

## 不在范围内（显式清单）

- 不新增任何 ppm 权限。
- 不改变前端 ppm 页面按钮控制逻辑（is_platform_admin + 所有权保持）。
- 不改变菜单粒度（不合并总开关、不增减菜单条目）。
- 不做历史兼容（项目未上线，允许重置数据）。
- 不动 ppm 业务逻辑（数据范围查询、CRUD 行为）。

## 成功标准（可验证）

- Permission 枚举 PPM_* 成员 25→8，test_ppm_permissions.py 通过（AC-1）。
- 6 个 ppm router 无 require_permission_any 引用（AC-2）。
- 数据库 role_permissions 中 17 个被删权限记录清零（AC-3）。
- ppm 接口登录返回 200、未登录返回 401（AC-4）。
- 前端 project-members 菜单对有 ppm:project:read 的用户可见（AC-5）。
- admin 权限选择器不再列被删权限（AC-6）。
- backend lint + frontend typecheck 通过（AC-7）。
- 权限测试 + 冒烟测试全绿（AC-8）。
