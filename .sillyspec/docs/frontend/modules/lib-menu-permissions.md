---
schema_version: 1
doc_type: module-card
module_id: lib-menu-permissions
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:02:04
---
# lib-menu-permissions

## 定位
菜单与权限的声明式数据源（静态常量）。集中定义平台侧边栏/导航的菜单分组、每个菜单命中需要的后端权限 key、所属 section 与展示顺序，作为 `lib-permission` 判定可见性、`app-layouts` 渲染菜单、`components-permissions` 角色权限选择器的唯一真相来源。无运行时逻辑，纯数据导出。

## 契约摘要
- `MENU_PERMISSION_GROUPS: MenuPermissionGroup[]` — 全部菜单分组（约 20 项），每项含 `section` / `label` / `href` / `permissions: PermissionItem[]`（每项 `{key, name}`）。任一权限命中即菜单可见。
- `MENU_SECTION_ORDER: MenuSection[]` — section 渲染顺序（overview / management / admin / system / ppm 等）。
- `MENU_SECTION_LABEL: Record<MenuSection, string>` — section 中文展示名。
- 类型：`PermissionItem`（`key` 必须命中后端 Permission 枚举）、`MenuPermissionGroup`（含可选 `hiddenInPicker` 等控制 AdminRolePermissionPicker 是否渲染该卡片，`canSeeMenu` 仍按 permissions 判断）。

覆盖的 section 与典型菜单：overview（工作区/组件/拓扑/变更/扫描文档/运行时/知识/发布）、management（Git 身份/API 密钥/Agent/Missions/审批/审计/事件）、admin（用户/组织/角色）、system（运行时管理/平台设置）、ppm（项目/客户/… 对接 `ppm:*` 权限）。

## 关键逻辑
```
// 单条声明样例
{
  section: "admin",
  label: "用户管理",
  href: "/admin/users",
  permissions: [
    { key: "user:read", name: "用户查看" },
    { key: "user:write", name: "用户编辑" },
    { key: "user:login:manage", name: "登录权限管理" },
  ],
}
// 消费方：lib-permission.canSeeMenu(user, group)
//        → 任一 permissions[].key 命中 user.permissions 即可见
```

## 注意事项
- `PermissionItem.key` 必须严格对齐后端 `Permission` 枚举（`backend/app/modules/auth/permissions.py`，约 46 个值）；写错 key 会导致该菜单永远不可见。
- 部分管理类菜单（Git 身份/API 密钥/运行时管理/平台设置）要求单一 admin 权限（`git_identity:admin` / `api_key:admin` / `runtime:admin` / `settings:admin`），平台超管自动通过。
- 改菜单结构（新增/移 section、调 href）需同步检查：`lib-permission` 判定、`app-layouts` 渲染、相关页面路由是否存在。
- PPM section 的 `ppm:*` 权限由后端 task 产出，命中即整组可见，前端不做子菜单细粒度控制。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
