---
schema_version: 1
doc_type: module-card
module_id: lib-permission
author: qinyi
created_at: 2026-08-18 01:45:00
---

# RBAC 权限判定（lib-permission）

## 定位
前端 RBAC 权限判定纯函数集合（`frontend/src/lib/permission.ts`）。给定 `SessionUser`（来自 `stores-session`）与权限标识/菜单组返回布尔，驱动菜单可见性、按钮禁用、路由守卫。依赖 `stores-session` 的类型与 `lib-menu-permissions` 的分组定义；不发请求、无副作用、无订阅。

## 契约摘要
全部 `export function` 纯函数：
- `hasAnyPermission(user, perms: string[]): boolean` — 核心判定，语义见下。
- `canSeeMenu(user, group: MenuPermissionGroup): boolean` — 取 `group.permissions[].key` 调 `hasAnyPermission`。
- `visibleMenusBySection(user, section): MenuPermissionGroup[]` — 该 section 下可见菜单（保持声明顺序）。
- `hasAdminPermission(user): boolean` — **@deprecated**（按 user:/organization:/role: 前缀判断），已被上面三者取代，新代码勿用，待清理任务移除引用。

## 关键逻辑
```
hasAnyPermission(user, perms):
  user == null            → false          // 未登录一律拒绝
  user.is_platform_admin  → true           // 平台超管短路放行
  perms.length == 0       → true           // 空权限 = 登录即可见（D-003，skills 菜单放开）
  userPerms 为空           → false
  return perms.some(p => Set(userPerms).has(p))

canSeeMenu = hasAnyPermission(user, group.permissions.map(p => p.key))
```

## 注意事项
- **「空 perms → true」是 2026-07-31-custom-skill-per-user D-003 引入的语义翻转**（旧版空 perms 返 false）；menu-permissions 中 `permissions: []` 的菜单（skills/智能体档案/智能体会话）依赖此分支，改动两文件任一侧须联动评审与补测。
- 平台超管 `is_platform_admin` 一律短路 true，UI 无需为超管单独加白名单。
- 纯函数无订阅：权限变化由调用方经 `useSession` 重读 user 触发重渲染。
- 权限 key 未命中后端 `Permission` 枚举时永远判 false（枚举见 `backend/app/modules/auth/permissions.py`）。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
