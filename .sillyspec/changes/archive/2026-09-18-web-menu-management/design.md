---
author: WhaleFall
created_at: 2026-09-18 14:16:19
generated_by: sillyspec-design-init
scale: large
---

# 设计文档（Design）— 2026-09-18-web-menu-management

## 背景

当前菜单与权限体系为「代码定义 + 数据库分配」混合制：菜单目录及菜单↔权限映射以前端 `frontend/src/lib/menu-permissions.ts` 的 `MENU_PERMISSION_GROUPS`（37 条 / 6 分组，其中 35 条非 `navHidden`）为单一数据源；权限目录为后端 `backend/app/modules/auth/permissions.py` 的 `Permission` 枚举（67 项）；角色↔权限、用户↔角色存 DB（`roles` / `role_permissions` / `user_workspace_roles` / `user_roles`），可在 `/admin/roles` 页运行时调整。

四个实际痛点：

1. **4 个常显菜单无法按角色关闭**：技能管理（skills）、MCP 资产库（mcp）、智能体档案（agent-profiles）、智能体会话（sessions）`permissions: []`，对所有登录用户恒显（`hasAnyPermission` 对空列表 return true），角色管理页无从收回。
2. **菜单显示名 / 排序 / 全局隐藏只能改代码发版**：无任何运行时调整通道。
3. **影响面不可见**：管理员调整菜单相关权限时看不到「菜单→挂载权限→持有角色」的关联视图，需自行到角色页逐个对查。
4. **前端权限 key 手写字符串无编译期守卫**：`menu-permissions.ts` 的 key 是 `string` 类型，后端枚举变动只能运行时（保存角色时 422）才暴露漂移；而 OpenAPI 生成的 `api-types.ts:18838` 已包含完整 Permission 联合类型，未被利用。

用户需求（2026-09-18 对话确认）：按角色开关菜单显隐（含 4 个常显菜单）+ 菜单名/排序在线可调 + 菜单下挂权限可见（只读）。

## 设计目标

- **FR-01 全菜单按角色开关**：为 4 个常显菜单补独立权限 key（`skill:read` / `mcp:read` / `agent_profile:read` / `agent_session:read`），种子迁移授给全部现存角色保现状可见；此后管理员可在角色管理页按角色收回。
- **FR-02 菜单管理页**（`/admin/menus`，`menu:admin` 门控）：分组表格内改显示名（行内编辑 + 恢复默认）、组内上移/下移排序、全局隐藏开关；**行级即时保存**（每项一次 PUT），**全局生效**（D-002）。
- **FR-03 权限只读展示**：每菜单展开显示挂载权限的标识、中文名、当前持有角色 chips；数据复用既有角色列表接口客户端反查（D-003），不在本页修改权限分配。
- **FR-04 前端权限 key 编译期守卫**：`PermissionItem.key` 类型从 `string` 收紧为 `api-types.ts` 生成的 Permission 联合类型。
- **NFR-01** 覆盖变更写审计日志（对齐 roles_service 模式）；**NFR-02** 未配置覆盖时导航行为与现状逐项一致；**NFR-03** 部署说明覆盖权限缓存失效顺序。

## 非目标

- 在线**新增/删除菜单条目**：菜单是页面路由的入口，页面是代码交付物，新增菜单天然随版本发布（D-001 的架构推论）。
- **按角色**改名/排序：D-002 定案全局生效，按角色维度只有显隐（既有权限体系承担）。
- 权限目录在线增删、后端接口鉴权点在线调整（171 处 `require_permission` 保持代码绑定）。
- 路由级访问控制变化：URL 直达仍可行（现状语义，菜单只是入口显隐）。
- 移动端 `m/` 导航纳管：`frontend/src/components/mobile/mobile-app-shell.tsx` 不消费 `MENU_PERMISSION_GROUPS`（实测无引用），本次不纳入。
- 主题/图标在线调整。

## 拆分判断

单一内聚功能（一张覆盖表 + 一个管理页 + 导航合并层），前后端两段但共享同一变更语义，不拆分。非批量模式：35 个菜单是管理页的**展示数据**，不是 35 个独立任务；实现是「注册表 × 覆盖合并」的通用机制。

## 总体方案

三层管线：**导航渲染 = 菜单注册表（代码，不变） × 权限过滤（既有 `visibleMenusBySection`，不变） × 覆盖合并（新增，全局）**。

### Phase 1 — 后端

1. `Permission` 枚举新增 5 项：`SKILL_READ`/`MCP_READ`/`AGENT_PROFILE_READ`/`AGENT_SESSION_READ`/`MENU_ADMIN`；`group` 映射补 `skill`/`mcp`/`agent_profile`/`agent_session` 前缀 → AGENT 组、`menu` 前缀走默认 PLATFORM 组（注：`PermissionGroup` 仅维护后端目录归类一致性，角色勾选器的折叠分组由前端注册表 `section` 字段驱动——picker 实测按 section 折叠，后端 group 无消费者）。
2. 新表 `menu_overrides`（见数据模型）+ 迁移：建表 + 种子（4 个新权限 key 插入 `role_permissions`，覆盖全部现存 `roles.id`，保现状可见）。
3. admin 模块新增 `menu_overrides_service.py`（list/upsert/delete + 审计）与**子路由** `menu_overrides_router.py`（`APIRouter(prefix="/menu-overrides")`；模块内子路由文件先例见 `agent/profile/router.py`，自带 prefix 的挂载先例见 main.py 的 platform_sync workspace 子路由），在 `backend/app/main.py` 以 `include_router(..., prefix="/api")` 挂载——admin 主 router 带 `/admin` 前缀，无法承载公开只读路径（审查 B-01）。写端点 `require_permission(Permission.MENU_ADMIN)`；读端点仅需认证（R-06）；写审计日志（复用 roles_service 的 `_audit` 模式）；`label_override` 长度 1–30 字符校验、`sort_order` 0–999 整数校验。后端**不校验** menu_key 是否存在于注册表（注册表在前端），任意稳定字符串均可存，孤儿行由前端合并层忽略（R-01）。

### Phase 2 — 前端基础

1. `pnpm gen:types` 重跑：Permission 联合类型增 5 值 + 新端点类型进 `api-types.ts`（同时提交 `backend/openapi.json`）。
2. `menu-permissions.ts`：4 个菜单补 `permissions`（skills/mcp 去掉 `pickerHidden`，进入角色勾选器）；新增「菜单管理」菜单项（section=system，menuKey=`menus`，href=`/admin/menus`，permissions=[menu:admin]）；`PermissionItem.key` 类型收紧为生成的联合类型（FR-04）。
3. 新增 `lib/menu-overrides.ts`：导航侧 `useMenuOverrides()`（拉只读公开端点 `GET /api/menu-overrides`）+ 纯函数 `mergeMenus(registry, overrides)`；拉取失败按空覆盖直通（fallback，不阻塞导航渲染）。
4. **覆盖下发通道**：普通用户导航也需要覆盖数据（改名/排序/隐藏全局生效），但写端点有 menu:admin 门槛——故读/写分流：`GET /api/menu-overrides` 仅需认证（返回全量覆盖，内容为菜单显示配置，无敏感信息，风险见 R-06），`PUT`/`DELETE /api/menu-overrides/{menu_key}` 保持 menu:admin 门控；三个端点同挂子路由 `menu_overrides_router.py`（见 Phase 1.3，审查 B-01 修正：不入 admin 主 router）。
5. `app-shell.tsx`：渲染前经 `mergeMenus`；豁免规则——`menuKey === "menus"` 的行忽略 hidden（防自锁 R-03）；侧边栏图标映射补 `/admin/menus`。

### Phase 3 — 菜单管理页 + 测试

`/admin/menus` 页面（对照原型 `prototype-menu-admin.html`）：antd Table 按 `MENU_SECTION_ORDER` 分组渲染；列 = 排序（组内上移/下移）/ 菜单（默认名 + 路由小字）/ 显示名（行内编辑 + 「已改名」标记 + 恢复默认）/ 全局隐藏（Switch，menus 行 disabled + 🔒 提示）/ 挂载权限（前 2 个 key 摘要 + 展开明细：key + 中文名 + 持有角色 chips + 「分配请前往角色管理」提示）。持有角色由既有 `GET /api/admin/roles`（响应字段 `permissions`，请求侧才叫 `permission_keys`）客户端反查；该接口挂 `role:read` 门控——仅持 `menu:admin` 的非平台管理员打开页面时角色 chips 区**优雅降级**为「需 role:read 查看角色分布」占位（平台管理员经 is_platform_admin 短路无碍），不阻塞改名/排序/隐藏主功能。每项修改即时 PUT，行内 toast 反馈，无整页保存按钮。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/auth/permissions.py | Permission 枚举 +5 项、group 前缀映射补 skill/mcp/agent_profile/agent_session→AGENT |
| 修改 | backend/app/modules/admin/model.py | 新增 MenuOverride 表模型（menu_overrides） |
| 修改 | backend/app/modules/admin/schema.py | MenuOverrideRead / MenuOverrideUpsert schema |
| 修改 | backend/app/main.py | include_router 挂载子路由 menu_overrides_router（prefix="/api"） |
| 新增 | NEW:backend/app/modules/admin/menu_overrides_router.py | 子路由 APIRouter(prefix="/menu-overrides")，三端点：GET（认证）+ PUT/DELETE（menu:admin）（审查 B-01：admin 主 router 带 /admin 前缀承载不了公开路径） |
| 新增 | NEW:backend/app/modules/admin/menu_overrides_service.py | upsert/list/delete + 审计；读路径供 GET 共用 |
| 新增 | NEW:backend/migrations/versions/<rev>_create_menu_overrides.py | 建 menu_overrides 表 + 种子：4 新权限 key 授全部现存角色 |
| 新增 | NEW:backend/tests/modules/admin/test_menu_overrides.py | 端点 CRUD / 403 门控 / 审计 / 孤儿 key 容忍 / 种子迁移断言 |
| 修改 | backend/openapi.json | gen:types 副产物 |
| 修改 | frontend/src/lib/api-types.ts | gen:types 再生成（枚举 +5、新端点类型） |
| 修改 | frontend/src/lib/menu-permissions.ts | 4 菜单补 permissions、去 pickerHidden；新增 menus 菜单项；key 类型收紧 |
| 新增 | NEW:frontend/src/lib/menu-overrides.ts | useMenuOverrides（GET /api/menu-overrides，导航与管理页共用，拉取失败按空覆盖直通）+ mergeMenus 纯函数 |
| 修改 | frontend/src/components/app-shell.tsx | 渲染经 mergeMenus + menus 豁免 + 图标映射 |
| 新增 | NEW:frontend/src/app/(dashboard)/admin/menus/page.tsx | 菜单管理页（对照原型） |
| 新增 | NEW:frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx | 管理页交互测试 |
| 新增 | NEW:frontend/src/lib/__tests__/menu-overrides.test.ts | merge 纯函数单测（覆盖/隐藏/排序/孤儿/豁免） |
| 修改 | frontend/src/lib/__tests__/permission.test.ts | 4 菜单不再空 permissions 的相关断言同步（如有） |
| 修改 | frontend/src/lib/__tests__/menu-permissions.test.ts | 确定性失效断言同步：menuKey 严格清单（+menus 项）、4 菜单 permissions:[] 例外块、skills/mcp pickerHidden===true 断言（审查实测 :105/:164-165/:196-220/:235-248/:351-373 四类断言必随注册表更新失效） |
| 修改 | frontend/src/components/__tests__/app-shell.test.tsx | task-10 接入 useMenuOverrides（useQuery）后裸渲染抛 No QueryClient set——renderShell 包 QueryClientProvider（retry:false），execute 期补记 |

## 接口定义

```
# 同挂子路由 menu_overrides_router.py（APIRouter(prefix="/menu-overrides")，main.py 以 /api 前缀挂载）
GET    /api/menu-overrides                 # 仅需认证；导航侧消费；返回全量覆盖
       → 200 { items: MenuOverrideRead[] }
PUT    /api/menu-overrides/{menu_key}      # require_permission(Permission.MENU_ADMIN)，写审计
       body MenuOverrideUpsert { label?: string|null, sort_order?: int|null, hidden?: bool }
       （upsert；null = 清除该项覆盖回默认；label 1–30 字符；sort_order 0–999）
       → 200 MenuOverrideRead
DELETE /api/menu-overrides/{menu_key}      # require_permission(Permission.MENU_ADMIN)，写审计
       → 204（整行删除 = 该菜单全部恢复默认）
```

```ts
// frontend/src/lib/menu-overrides.ts（核心纯函数）
mergeMenus(registry: MenuPermissionGroup[], overrides: MenuOverrideRead[]): MenuPermissionGroup[]
// 1. label = overrides[menuKey].label ?? menuLabel
// 2. hidden=true 的行剔除（menuKey==="menus" 豁免，恒不剔除）
// 3. 组内排序：sort_order ?? 声明序索引，稳定排序
// 4. 孤儿 override（registry 无此 menuKey）自然忽略
// 显隐权限过滤沿用既有 visibleMenusBySection（与覆盖合并两维度独立）
```

```ts
// 持有角色反查（FR-03，无新后端聚合端点）
GET /api/admin/roles → roles[].permissions（RoleRead 响应字段；请求侧 schema 才叫 permission_keys）
  → 客户端 invert: permissionKey → roleNames[]
```

## 生命周期契约表

本变更无生命周期契约（menu_overrides 为静态显示配置覆盖，不涉及 session/lease/agent_run/daemon/lifecycle/state transition/claim/heartbeat 任何一方）。

## 数据模型

新表 `menu_overrides`（SQLModel，挂 `backend/app/modules/admin/model.py`，BaseModel 时间戳约定同既有表）：

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | UUID | PK | BaseModel 约定 |
| menu_key | String(64) | UNIQUE, NOT NULL | 对齐前端 `MenuPermissionGroup.menuKey`；后端不校验注册表存在性（注册表在前端） |
| label_override | String(30) | NULL | NULL = 使用代码默认名 |
| sort_order | Integer | NULL | NULL = 组内声明序 |
| hidden | Boolean | default false | 全局隐藏（对含平台管理员的所有用户生效，menus 豁免在前端合并层） |
| created_at / updated_at | DateTime | BaseModel | — |

迁移种子：`INSERT INTO role_permissions(role_id, permission)` —— 4 个新 key × 全部现存 `roles` 行（含 disabled 角色，无害），保证上线后 4 菜单可见性与现状一致。**无既有表结构变更**。

## 兼容策略（brownfield 必填）

- **未配置覆盖 = 行为不变**：`menu_overrides` 为空时 `mergeMenus` 直通，导航渲染与现状逐项一致（既有 `permission.test.ts` / app-shell 快照语义不变）。
- **存量用户可见性不变（有一个已接受的窄例外，见 R-07）**：种子迁移把 4 个新 key 授给全部现存角色，持任意角色的用户可见性与现状一致；`is_platform_admin` 短路语义不变。未上线模块（非 PPM）允许重置数据，但保现状迁移成本极低且避免「上线后菜单消失」错觉。
- **权限缓存（R-02）**：种子直插 `role_permissions` 绕过 `invalidate_all_permissions()`；`perm:*` 缓存 TTL 300 秒为主自愈机制（外部 Redis 不随后端重启清空，重启后端仅为加速收敛的可选项），部署说明如实表述。管理页后续修改走 roles_service 既有 invalidate 路径，不受影响。
- **API 增量**：全部为新增端点/新增枚举值，无既有 API/表结构改动；`pnpm gen:types` 前端类型同步（CLAUDE.md 规则 21）。
- **角色勾选器**：新增 5 个可勾选项为纯增量（4 个归 AGENT 组、menu:admin 归 PLATFORM 组），不改变既有分组折叠。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | menu_key 漂移：前端重构改 menuKey → 覆盖行变孤儿静默失效 | P2 | menu-permissions.ts 顶部注释立规「不改既有 menuKey」+ 评审守卫；孤儿行前端忽略不报错 |
| R-02 | 种子迁移直插绕过权限缓存失效 → 上线初期菜单显隐陈旧 | P2 | TTL 300 秒自愈为主；可选迁移后清 `perm:*` 键加速收敛（外部 Redis 不随后端重启清空） |
| R-03 | 管理员全局隐藏「菜单管理」入口自锁 | P1 | 合并层豁免：menuKey="menus" 恒显（对持 menu:admin 者）；管理页该行开关 disabled + 🔒 提示 |
| R-04 | 两管理员并发改同一菜单，行级最后写赢 | P3 | 行级即时保存已缩小冲突面；管理场景单人操作为主，接受（不加乐观锁） |
| R-05 | 「全局隐藏」被误解为「按角色隐藏」 | P3 | 管理页说明条文案明示两者边界（隐藏=全局下架；按角色=角色管理页收权限） |
| R-06 | 只读公开端点 GET /api/menu-overrides 暴露菜单结构 | P3 | 内容仅为显示名/排序/隐藏布尔，登录后可见，无敏感信息；与前端代码内嵌的注册表同级别公开度 |
| R-07 | 无任何角色的存量用户：现状下因空 permissions 语义可见 4 个菜单，补 key 后翻转为不可见 | P3 | 该人群本就无任何权限门控菜单（其余菜单全不可见）；未上线模块允许重置数据，接受并记录；如需保留可为该人群补默认角色（运营动作，非代码） |
| R-08 | 仅持 menu:admin（无 role:read）的管理员在管理页看不到角色分布 | P3 | 角色 chips 区优雅降级为占位提示「需 role:read 查看角色分布」，不阻塞改名/排序/隐藏主功能 |

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v1 | 总体方案三层管线（注册表不动）；文件清单（仅新增覆盖表与合并层）；非目标「在线新增/删除菜单」 | 已覆盖 |
| D-002@v1 | 数据模型（menu_overrides 无 role 维度）；接口定义（PUT 单项全局 upsert）；R-05 文案边界 | 已覆盖 |
| D-003@v1 | Phase 3 持有角色反查（GET /api/admin/roles 客户端 invert）；接口定义反查段 | 已覆盖 |

## 自审

- [x] 章节齐全（背景/设计目标/非目标/总体方案/文件变更清单/接口定义/风险登记）
- [x] frontmatter 字段齐全（author/created_at/scale=large）
- [x] 引用所有当前版本 D-001@v1 / D-002@v1 / D-003@v1（决策追踪表）
- [x] 生命周期关键词豁免短语紧邻「生命周期契约」（本变更无生命周期契约）
- [x] UI 原型已生成：`prototype-menu-admin.html`（新增页面分级=必须；三主题、改名/排序/隐藏/权限展开可交互）
- [x] 无「⚠️ 自审存疑」项；骨架填写期新增的「只读公开端点 GET /api/menu-overrides」细节已在总体方案 Phase 2.4 定案并列入 R-06
- [x] Design Grill（独立子代理）阻断项 B-01 已修正：公开端点改挂子路由 menu_overrides_router.py（main.py 入清单）；gap 级修正——保现状种子例外升 R-07、role:read 耦合降级升 R-08、roles 响应字段名 permission→permissions、计数 67/37 校正、R-02 TTL 表述、mobile 路径补前缀、picker 分组归因（前端 section 驱动）
