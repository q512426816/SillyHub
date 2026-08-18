---
schema_version: 1
doc_type: module-card
module_id: lib-menu-permissions
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 菜单权限数据源（lib-menu-permissions）

## 定位
菜单按权限驱动显隐的**单一声明式数据源**（`frontend/src/lib/menu-permissions.ts`，静态常量，无运行时逻辑）。定义侧边栏菜单分组（section → 菜单项）、每项可见所需的后端权限 key、路由与高亮匹配，作为 `lib-permission` 判定、app-shell 渲染、AdminRolePermissionPicker 配置的唯一真相来源。sidebar-menu-restructure 变更后为 6 section 新结构（约 29 个菜单项）。

## 契约摘要
- `MENU_PERMISSION_GROUPS: MenuPermissionGroup[]` — 全部菜单项，每项字段：
  - `section`（六值之一）/ `menuKey`（唯一 key，关联 nav 折叠与 picker）/ `menuLabel`（中文）/ `href` + `absolute`（relative 时拼 workspace 前缀）/ `matchPattern?`（active 高亮，沿用 NavItem 语义）/ `icon`（emoji，**无渲染消费者**，历史遗留）/ `permissions: PermissionItem[]`（任一命中即可见；**空数组 = 登录即可见**）。
  - `pickerHidden?` — 与其他菜单共享权限时 Picker 不渲染该卡片（canSeeMenu 仍判断）。
  - `navHidden?` — 二级页面不在侧边栏渲染（路由仍可达、active 匹配保留），如 ppm 项目成员/里程碑明细。
- `MENU_SECTION_ORDER` — 渲染顺序：workspace → agent → config → governance → ppm → system。
- `MENU_SECTION_LABEL` — section 中文标题（工作区/智能体/配置中心/协作治理/系统管理/项目管理）。
- 类型 `PermissionItem`（key/name/description?）：key 必须命中后端 Permission 枚举（`backend/app/modules/auth/permissions.py`）。

各 section 构成：
- **workspace**（8 项）：工作区首页（/workspaces，absolute）、组件、拓扑、变更中心、扫描文档、运行时、知识&日志、发布。
  - 子菜单均有独立 read 权限（component:read / topology:read / scan-docs:read / knowledge:read 等），不共用 workspace:read。
- **agent**（6 项）：智能体控制台、Agent 团队（missions）、技能管理、MCP 管理、智能体档案、智能体会话。
  - 技能管理 / 智能体档案 / 智能体会话为 `permissions: []`（登录即可见）——分别来自 custom-skill-per-user D-003、agent-profile-ui-redesign、sessions-portal 变更。
  - 技能管理另带 pickerHidden（无独立权限可配）；MCP 管理要求 settings:admin。
- **config**（4 项）：我的供应商（llm_provider:read，sidebar-menu-restructure 新增）、API 密钥（api_key:admin）、Git 身份（git_identity:admin）、守护进程运行时（runtime:admin，自 system 移入，D-006）。
- **governance**（3 项）：审批中心（task:approve / change:approve）、审计中心（platform:audit:read）、事件（incident:read）。
- **system**（4 项）：用户、组织、角色（/admin/*）、设置（settings:admin）。
- **ppm**（14 项）：全部 absolute 指向 /ppm/*，每菜单独立专属 key（ppm:workbench:view / ppm:project:read / ppm:kanban:view / ppm:weekly-plan:view 等）。
  - 项目成员、里程碑明细带 navHidden（二级页面，由父页跳转进入）。
  - 菜单权限为前端可见性语义；后端 plan 域仅认证不授权（get_current_principal + DataScope）。

## 关键逻辑
```
声明样例（登录即可见型）:
{ section: "agent", menuKey: "skills", href: "/settings/skills", absolute: true,
  permissions: [], pickerHidden: true }
→ canSeeMenu 经 hasAnyPermission(空 perms, user 非 null) = true
```

## 注意事项
- `icon` 字段经排查（sidebar-menu-restructure task-04）在 app-shell/picker/permission 均无消费者，新增菜单可填占位 emoji。
- 写错权限 key = 该菜单永远不可见；改菜单结构需同步 `lib-permission` 判定、app-shell 渲染（MENU_ICON_MAP 按 href）、页面路由三处。
- 空权限菜单（skills/agent-profiles/sessions）语义依赖 `lib-permission.hasAnyPermission` 的「空 = 登录即可见」分支，两文件耦合改动须一起评审。
- 管理类菜单多为单一 admin 权限（api_key:admin / git_identity:admin / runtime:admin / settings:admin），平台超管自动通过。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
