---
author: qinyi
created_at: 2026-09-18T09:56:00+08:00
---

# 决策台账 — 2026-09-18-web-menu-management

本变更的需求澄清/方案讨论中产生的、有实现或验收影响的决策。长期术语在 archive/scan 时再提升到 glossary.md。

## D-001@v1: 菜单在线管理采用「前端注册表不动 + 后端覆盖表」架构（方案 A）

- type: architecture
- status: accepted
- source: user（方案选择轮，AskUserQuestion 拍板）
- question: 菜单在线管理的覆盖配置（改名/排序/隐藏）怎么存、菜单目录放在哪？候选：A 前端注册表不动+后端覆盖表；B 若依式菜单全量迁后端 menus 表；C 覆盖配置存 settings 域 JSON。
- answer: 选方案 A。菜单注册表（有哪些菜单/挂什么权限/分组结构）仍以 `frontend/src/lib/menu-permissions.ts` 为单一数据源；后端仅新增 `menu_overrides` 覆盖表（menu_key 主键 + label_override/sort_order/hidden），前端侧边栏与移动导航合并覆盖渲染。理由：与「菜单跟页面走」既有架构一致（新页面本需发版）、菜单-权限映射保留编译期类型检查（api-types.ts 已生成 Permission 联合类型）、行级审计清晰。否决 B：菜单与页面代码分离引入两处同步漂移风险、权限映射失去类型检查；否决 C：整包覆盖无行级审计、并发最后写赢。
- normalized_requirement: 菜单目录/菜单-权限映射/新增菜单条目一律保留在 `frontend/src/lib/menu-permissions.ts` 代码内；后端仅存差异覆盖（label/sort/hidden）；不得引入后端全量菜单表或前端启动拉取菜单目录的机制。
- impacts: [design 总体方案 Phase 1-3、文件变更清单、非目标]
- evidence: `frontend/src/lib/menu-permissions.ts`（注册表自称单一数据源）；`backend/app/modules/auth/permissions.py`（权限目录枚举）；`frontend/src/lib/api-types.ts:18838`（OpenAPI 生成 Permission 联合类型）
- 模块域: auth, admin, frontend_lib, frontend_app
- 故障面: 覆盖端点/拉取故障时导航 fallback——mergeMenus 对拉取失败按空覆盖直通注册表，菜单管理页报错条幅；不影响登录与既有权限显隐
- 退役判据: 若未来出现多客户端共享菜单目录的真实需求（后端全量菜单表），本覆盖表与前端合并层随该迁移一并废弃
- priority: P0

## D-002@v1: 覆盖配置全局生效，按角色差异只保留「显隐」一个维度

- type: requirement
- status: accepted
- source: user（需求澄清轮，AskUserQuestion 拍板）
- question: 菜单改名/排序/隐藏调整后对谁生效？
- answer: 全局生效（对所有用户含平台管理员一致）。按角色区分只保留「谁能看到某菜单」显隐维度，由既有权限体系承担（角色管理页勾选权限），覆盖配置不做角色维度。
- normalized_requirement: menu_overrides 表不得含 role/user 维度字段；改名/排序/隐藏对全部用户一致生效（含平台管理员，menus 自锁豁免除外）；按角色差异仅由权限体系承担。
- impacts: [design 数据模型、接口定义、R-05]
- evidence: 角色管理页既有能力 `backend/app/modules/admin/roles_service.py`（permission_keys 运行时增改 + 缓存失效）
- 模块域: admin, frontend_lib
- priority: P1

## D-003@v1: 菜单管理页权限展示为「权限 + 持有角色」只读

- type: requirement
- status: accepted
- source: user（需求澄清轮，AskUserQuestion 拍板）
- question: 权限只读展示做到什么程度？
- answer: 每个菜单展开显示其挂载权限的标识、中文名、当前授给了哪些角色（如 workspace:read → 管理员、开发者）。权限分配/修改仍只在角色管理页做，菜单管理页不改权限。实现上复用既有角色列表接口（roles 已含 permission_keys）客户端反查，不新增聚合端点。
- normalized_requirement: 菜单管理页权限区为只读组件；不提供任何修改权限的交互；持有角色数据来源限定为既有 GET /api/admin/roles 客户端反查，不新增后端聚合端点。
- impacts: [design Phase 3、接口定义反查段]
- evidence: `backend/app/modules/admin/roles_service.py` _to_read 返回 permissions 列表
- 模块域: admin, frontend_app
- priority: P2
