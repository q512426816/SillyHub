---
schema_version: 1
doc_type: module-card
module_id: lib-menu-permissions
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 菜单权限数据源（lib-menu-permissions）

## 定位
菜单按权限驱动显隐的**单一声明式数据源**（`frontend/src/lib/menu-permissions.ts`，静态常量，无运行时逻辑）。定义侧边栏菜单分组（section → 菜单项）、每项可见所需的后端权限 key、路由与高亮匹配，作为 `lib-permission` 判定、app-shell 渲染、AdminRolePermissionPicker 配置的唯一真相来源。sidebar-menu-restructure 变更后为 6 section 新结构（现 38 个菜单项，2026-09-18-web-menu-management 新增菜单管理后）。

## 契约摘要
- `MENU_PERMISSION_GROUPS: MenuPermissionGroup[]` — 全部菜单项，每项字段：
  - `section`（六值之一）/ `menuKey`（唯一 key，关联 nav 折叠与 picker）/ `menuLabel`（中文）/ `href` + `absolute`（relative 时拼 workspace 前缀）/ `matchPattern?`（active 高亮，沿用 NavItem 语义）/ `icon`（emoji，**无渲染消费者**，历史遗留）/ `permissions: PermissionItem[]`（任一命中即可见；**空数组 = 登录即可见**——2026-09-18 起全表已无空权限菜单）。
  - `pickerHidden?` — 与其他菜单共享权限时 Picker 不渲染该卡片（canSeeMenu 仍判断）。2026-09-18 起全表无 pickerHidden 残留。
  - `navHidden?` — 二级页面不在侧边栏渲染（路由仍可达、active 匹配保留），如 ppm 项目成员/里程碑明细。
- `MENU_SECTION_ORDER` — 渲染顺序：workspace → agent → config → governance → ppm → system。
- `MENU_SECTION_LABEL` — section 中文标题（工作区/智能体/配置中心/协作治理/系统管理/项目管理）。
- 类型 `PermissionItem`（key/name/description?）：key 必须命中后端 Permission 枚举（`backend/app/modules/auth/permissions.py`，经 OpenAPI 生成联合类型，漂移编译期暴露）。

各 section 构成：
- **workspace**（8 项）：工作区首页（/workspaces，absolute）、组件、拓扑、变更中心、扫描文档、运行时、知识库、发布。
  - 子菜单均有独立 read 权限（component:read / topology:read / scan-docs:read / knowledge:read 等），不共用 workspace:read 作兜底；但卡片可含页面实际所需的其他 key（2026-10-08-page-audit：components 卡含 workspace:read——列表端点鉴权所需；changes 卡含 task:read——变更任务子页所需；knowledge 卡含 knowledge:write——写按钮所需）。
- **agent**（4 项）：技能管理（/settings/skills）、MCP 资产库（/settings/mcp）、智能体档案（/agent-profiles）、智能体会话（/sessions），全 absolute。
  - 四菜单 2026-09-18-web-menu-management 起各挂独立 read 权限（skill:read / mcp:read / agent_profile:read / agent_session:read），进角色勾选器。
  - 智能体会话 2026-10-08-sessions-menu-permissions 起补齐会话页实际权限共 4 项：agent_session:read（门控主 key）+ task:run_agent（全部 /api/daemon/sessions* 端点）+ daemon:borrow（借用会话）+ runtime:admin（机器下拉 /api/daemon/machines）——多权限菜单任一命中即可见，跨菜单重复挂载（runtime:admin 同挂 config 守护进程运行时）有 change:approve 双卡先例。
  - MCP 资产库 2026-10-08-page-audit 起补 settings:admin（平台库写端点 mcp_registry settings_admin_check；读与我的库任意登录用户可用）。
- **config**（4 项）：我的供应商（llm_provider:read，sidebar-menu-restructure 新增）、API 密钥（api_key:admin）、Git 身份（git_identity:admin）、守护进程运行时（runtime:admin，自 system 移入，D-006）。
- **governance**（3 项）：审批中心（task:approve / change:approve / task:read / task:run_agent）、审计中心（platform:audit:read / change:read）、事件（incident:read / deploy:staging）。
  - 2026-10-08-page-audit：审批中心补 task:read（agent-sessions / dialogs 列表端点）+ task:run_agent（会话权限面板 daemon 端点族）；审计中心补 change:read（工作区审计日志端点 CHANGE_READ；platform:audit:read 零端点消费保留存量）；事件补 deploy:staging（上报端点鉴权）。
- **system**（5 项）：用户、组织、角色（/admin/*）、设置（settings:admin）、菜单管理（/admin/menus，menu:admin，2026-09-18 新增）。
- **ppm**（14 项）：全部 absolute 指向 /ppm/*，每菜单独立专属 key（ppm:workbench:view / ppm:project:read / ppm:kanban:view / ppm:weekly-plan:view 等）。
  - 项目成员、里程碑明细带 navHidden（二级页面，由父页跳转进入）。
  - 菜单权限为前端可见性语义；后端 plan 域仅认证不授权（get_current_principal + DataScope）。

## 关键逻辑
```
声明样例（多权限任一命中型，sessions 2026-10-08 起）:
{ section: "agent", menuKey: "sessions", href: "/sessions", absolute: true,
  permissions: [
    { key: "agent_session:read", name: "智能体会话查看" },   // 门控主 key 首位
    { key: "task:run_agent", name: "会话运行" },              // 页面核心接口权限
    { key: "daemon:borrow", name: "借用守护进程" },
    { key: "runtime:admin", name: "守护进程机器查看" } ] }
→ canSeeMenu = hasAnyPermission(4 keys, user.permissions) 任一交集即 true
→ AdminRolePermissionPicker「智能体会话」卡按同数组渲染 4 个 checkbox
```

## 注意事项
- `icon` 字段经排查（sidebar-menu-restructure task-04）在 app-shell/picker/permission 均无消费者，新增菜单可填占位 emoji。
- 写错权限 key = 该菜单永远不可见；改菜单结构需同步 `lib-permission` 判定、app-shell 渲染（MENU_ICON_MAP 按 href）、页面路由三处。
- 菜单 permissions 数组同时服务两个消费面：canSeeMenu 可见性（任一命中）与 AdminRolePermissionPicker 可配面——往菜单补权限会同步放宽可见性，页面实际依赖的权限应挂全（否则勾选器配不了，如 sessions 补齐前的 task:run_agent；2026-10-08-page-audit 批量修了 components/changes/knowledge/mcp/approvals/audit/incidents 七处同类缺口）。
- 测试镜像常量 `BACKEND_PERMISSION_KEYS`（menu-permissions.test.ts）须与后端枚举逐项同步（现 72 项），后端扩删权限时两处一起改。
- 管理类菜单多为单一 admin 权限（api_key:admin / git_identity:admin / runtime:admin / settings:admin），平台超管自动通过。
- 零端点消费的悬空 key（component:read / platform:audit:read / task:approve、code:* / tool:* / task:cancel 等）保留在卡上或目录中属已知债——清理需独立变更评审（涉及存量角色可见性与可配性）；PPM 的 ppm:plan:read / ppm:problem:read / ppm:task:read / ppm:problem-change:read 为 D-002 决策故意悬空。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
