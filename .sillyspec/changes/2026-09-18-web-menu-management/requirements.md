---
author: WhaleFall
created_at: 2026-09-18 14:35:00
---
# 需求规格（Requirements）

## 角色

| 角色 | 说明 |
|---|---|
| 平台管理员 | `is_platform_admin` 用户，全权限短路 |
| 菜单管理员 | 持 `menu:admin` 权限的用户，可调整菜单覆盖配置 |
| 普通用户 | 按角色权限看到对应菜单的登录用户 |
| 开发者 | 新增菜单/权限时改代码（menu-permissions.ts + permissions.py + 迁移） |

## 功能需求

### FR-01: 全菜单按角色开关（4 个常显菜单补独立权限 key）

覆盖决策：D-001@v1

Given 迁移已执行、未做任何后续配置
When 持任意角色的存量用户登录
Then 技能管理 / MCP 资产库 / 智能体档案 / 智能体会话 4 个菜单可见性与迁移前一致（种子已将 `skill:read`/`mcp:read`/`agent_profile:read`/`agent_session:read` 授给全部现存角色）

#### 场景：角色收回菜单权限

Given 某角色的权限集合不含 `skill:read`
When 该角色用户登录后查看侧边栏
Then 「技能管理」菜单不显示

#### 场景：角色授予菜单权限

Given 管理员在角色管理页为角色勾选 `skill:read`
When 该角色用户重新登录或权限缓存失效后（TTL 300s）
Then 「技能管理」菜单显示

#### 场景：零角色用户（已接受例外 R-07）

Given 用户不持有任何角色
When 登录后查看侧边栏
Then 4 个菜单不可见（现状语义为可见；该人群本无任何权限门控菜单，接受并记录）

### FR-02: 菜单管理页（改名 / 组内排序 / 全局隐藏，行级即时保存）

覆盖决策：D-002@v1

Given 管理员（持 `menu:admin`）打开 `/admin/menus`
When 将某菜单显示名改为新名并确认
Then PUT `/api/menu-overrides/{menu_key}` 保存成功，任意用户（含平台管理员）导航渲染新名；写审计日志

#### 场景：恢复默认显示名

Given 某菜单存在 label_override
When 管理员点「恢复默认」（label 置 null 或整行 DELETE）
Then 导航恢复代码默认名

#### 场景：组内排序

When 管理员对某分组内菜单上移/下移
Then 该菜单 sort_order 更新并持久化，导航同分组内顺序随之变化；分组结构与分组顺序不变（代码定义）

#### 场景：全局隐藏

When 管理员开启某菜单的隐藏开关（hidden=true）
Then 所有用户侧边栏不显示该菜单（含平台管理员）；URL 直达仍可行

#### 场景：菜单管理入口自锁防护（R-03）

When 管理员尝试隐藏 menuKey="menus"（菜单管理自身）
Then 管理页开关为 disabled 不可操作；即使经 API 直接写入 hidden，前端合并层对该 key 豁免恒显（对持 menu:admin 者）

#### 场景：无权限访问

Given 用户不持 `menu:admin` 且非平台管理员
When 打开 `/admin/menus` 或调用 PUT/DELETE `/api/menu-overrides/*`
Then 菜单不显示 / 接口返回 403；GET `/api/menu-overrides`（仅需认证）仍可用于导航渲染

#### 场景：非法参数

When PUT 传入 label 为空串或超 30 字符、sort_order 超出 0–999
Then 返回 422 中文校验错误

### FR-03: 挂载权限与持有角色只读展示

覆盖决策：D-003@v1

Given 管理员展开某菜单的权限明细
When 数据加载完成
Then 显示该菜单挂载的每个权限 key（代码体）、中文名、当前持有角色 chips（数据来自既有 `GET /api/admin/roles` 响应 `permissions` 字段客户端反查）；权限区无任何修改交互，附「分配请前往角色管理」提示

#### 场景：缺 role:read 的优雅降级（R-08）

Given 管理员仅持 `menu:admin` 不持 `role:read`
When 展开权限明细
Then 角色 chips 区显示占位「需 role:read 查看角色分布」，权限 key 与中文名正常显示，改名/排序/隐藏主功能不受阻

### FR-04: 前端权限 key 编译期守卫

Given `menu-permissions.ts` 的 `PermissionItem.key` 类型已收紧为 api-types 生成的 Permission 联合类型
When 开发者引用后端枚举中不存在的权限 key
Then `tsc` 编译报错（不再等到运行时 422）

### FR-05: 覆盖只读下发端点与导航合并

Given 任意已认证用户
When 前端导航加载调用 GET `/api/menu-overrides`
Then 返回全量覆盖列表（无敏感信息，仅显示配置）

#### 场景：未配置覆盖

Given `menu_overrides` 表为空
When 任意用户登录
Then `mergeMenus` 直通注册表，导航渲染与现状逐项一致

#### 场景：拉取失败降级

When GET `/api/menu-overrides` 请求失败
Then 导航按空覆盖直通渲染，不阻塞、不报错弹窗

#### 场景：孤儿覆盖容忍（R-01）

Given 覆盖表中存在注册表已无对应条目的 menu_key
When 导航合并
Then 该覆盖被忽略，无报错

## 非功能需求

- 兼容性：空覆盖 = 现状行为；`is_platform_admin` 短路语义不变；既有 API/表零改动，全部为增量。
- 可回退：DELETE 全部覆盖行即回默认；表与端点为纯增量可整体停用。
- 可测试：`mergeMenus` 为纯函数单测覆盖（覆盖/隐藏/排序/孤儿/豁免）；后端端点测试覆盖 CRUD/403/422/审计/种子。
- 审计：覆盖变更（PUT/DELETE）写审计日志，对齐 roles_service 模式。
- 部署：迁移种子直插绕过权限缓存失效，TTL 300 秒自愈为主（可选手动清 `perm:*` 加速），写入部署说明。

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01 / FR-05 | 注册表留前端代码，后端仅存差异覆盖；新增菜单随版本发布 |
| D-002@v1 | FR-02 | 覆盖全局生效，无 role 维度；按角色差异只有显隐（FR-01 权限体系） |
| D-003@v1 | FR-03 | 权限+持有角色只读展示，复用 roles 接口反查，不新增聚合端点 |
