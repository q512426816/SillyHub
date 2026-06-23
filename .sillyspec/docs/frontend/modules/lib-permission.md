---
schema_version: 1
doc_type: module-card
module_id: lib-permission
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:02:04
---
# lib-permission

## 定位
前端 RBAC 权限判定纯函数集合。给定 `SessionUser`（来自 `stores-session`）与权限标识/菜单组，返回布尔判定，用于驱动菜单可见性、按钮禁用、路由守卫等。依赖 `stores-session` 的 `SessionUser` 类型与 `lib-menu-permissions` 的菜单组定义；不发起任何请求，无副作用。

## 契约摘要
全部 `export function`，纯函数：

- `hasAnyPermission(user, perms: string[]): boolean` — 用户是否拥有给定权限列表中的任意一项。核心判定。
- `canSeeMenu(user, group: MenuPermissionGroup): boolean` — 用户是否能看到指定菜单（取 `group.permissions[].key` 调 `hasAnyPermission`）。
- `visibleMenusBySection(user, section): MenuPermissionGroup[]` — 返回某 section 下用户可见的全部菜单（保持声明顺序）。
- `hasAdminPermission(user): boolean` — **@deprecated** 旧 helper，按 `user:/organization:/role:` 前缀判断，已被 `canSeeMenu`/`visibleMenusBySection` 取代，新代码勿用。

## 关键逻辑
统一短路规则（所有判定共享）：
```
hasAnyPermission(user, perms):
  if user == null        → false        // 未登录一律拒绝
  if user.is_platform_admin → true      // 平台超管短路放行
  userPerms = user.permissions ?? []
  if userPerms.length==0 or perms.length==0 → false
  return perms.some(p => Set(userPerms).has(p))

canSeeMenu(user, group):
  return hasAnyPermission(user, group.permissions.map(p => p.key))

visibleMenusBySection(user, section):
  MENU_PERMISSION_GROUPS.filter(g => g.section === section)
    .filter(g => canSeeMenu(user, g))   // 平台超管 → 该 section 全可见
```

## 注意事项
- **平台超管 `is_platform_admin` 一律短路 true**：所有判定都会跳过 perms 检查，UI 无需为超管单独加白名单。
- `hasAdminPermission` 已标 deprecated，迁移目标见文件头注释；后续清理任务会删除其引用。
- 本模块是纯函数，无订阅；权限变化需由调用方在 `useSession` 订阅后重新读取 user 触发重渲染。
- 权限 key 必须命中后端 `Permission` 枚举（参见 `lib-menu-permissions` 注释），未命中的 key 永远判 false。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
