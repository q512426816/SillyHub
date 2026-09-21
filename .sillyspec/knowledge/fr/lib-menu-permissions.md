## FR-lib-menu-permissions-001 数据源单一化
变更：2026-06-18-menu-driven-permissions
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given `frontend/src/lib/menu-permissions.ts` 已定义 19 条 `MENU_PERMISSIONGroup`；When 任意组件需要"列出某 section 下的菜单"或"查询某 menuKey 的权限"；Then 全部从 `MENU_PERMISSION_GROUPS` 读取，不再有第二份数据源
全文：.sillyspec/changes/archive/2026-06-18-menu-driven-permissions/requirements.md#FR-01
最近确认：98d3e56dd

## FR-lib-menu-permissions-002 menuKey 唯一性
变更：2026-06-18-menu-driven-permissions
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given `MENU_PERMISSION_GROUPS` 已就绪；When 测试遍历所有条目；Then 19 个 `menuKey` 互不重复（`workspaces` / `components` / `topology` / `changes` / `scan
全文：.sillyspec/changes/archive/2026-06-18-menu-driven-permissions/requirements.md#FR-02
最近确认：98d3e56dd

## FR-lib-menu-permissions-003 权限 key 合法性
变更：2026-06-18-menu-driven-permissions
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given `MENU_PERMISSION_GROUPS[*].permissions[*].key`；When 测试用 backend `Permission` 枚举值集合校验；Then 所有 key 都在枚举内（无拼写错误、无废弃值）
全文：.sillyspec/changes/archive/2026-06-18-menu-driven-permissions/requirements.md#FR-03
最近确认：98d3e56dd

## FR-lib-menu-permissions-004 hasAnyPermission 语义
变更：2026-06-18-menu-driven-permissions
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户 `permissions = ["user:read"]` 用户 `permissions = ["user:read"]` 用户 `is_platfor；When 调用 `hasAnyPermission(user, ["user:write", "user:login:manage"])` 调用 `hasAnyPermi；Then 返回 `false` 返回 `true` 返回 `true`（短路） 返回 `false`
全文：.sillyspec/changes/archive/2026-06-18-menu-driven-permissions/requirements.md#FR-04
最近确认：98d3e56dd

## FR-lib-menu-permissions-005 canSeeMenu 语义
变更：2026-06-18-menu-driven-permissions
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户 `permissions = ["user:read"]`，菜单 group = `{ menuKey: "users", permissions: [{；When 调用 `canSeeMenu(user, group)` 调用 `canSeeMenu(user, group)` 调用 `canSeeMenu(user, g；Then 返回 `true` 返回 `false` 返回 `true`
全文：.sillyspec/changes/archive/2026-06-18-menu-driven-permissions/requirements.md#FR-05
最近确认：98d3e56dd

## FR-lib-menu-permissions-006 visibleMenusBySection 过滤
变更：2026-06-18-menu-driven-permissions
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户 `permissions = ["user:read"]` 用户 `permissions = ["workspace:read"]` 用户 `is_pl；When 调用 `visibleMenusBySection(user, "admin")` 调用 `visibleMenusBySection(user, "syste；Then 返回仅 1 条（`menuKey: "users"`），不含 `organizations` / `roles` 返回空数组（无 `platform:admin
全文：.sillyspec/changes/archive/2026-06-18-menu-driven-permissions/requirements.md#FR-06
最近确认：98d3e56dd

## FR-lib-menu-permissions-007 AppShell 按 section 渲染
变更：2026-06-18-menu-driven-permissions
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户已登录且 dashboard layout 完成 mount（`fetchMe` 已填充 `permissions`）；When 渲染 `<AppShell>`；Then 侧栏按固定顺序展示 `overview` / `management` / `admin` / `system` 四组
全文：.sillyspec/changes/archive/2026-06-18-menu-driven-permissions/requirements.md#FR-07
最近确认：98d3e56dd

## FR-lib-menu-permissions-008 Picker 三级渲染
变更：2026-06-18-menu-driven-permissions
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given `AdminRolePermissionPicker` 接收 `permissions` prop；When 渲染；Then 顶层显示 4 个 section（固定顺序 overview → management → admin → system）
全文：.sillyspec/changes/archive/2026-06-18-menu-driven-permissions/requirements.md#FR-08
最近确认：98d3e56dd

## FR-lib-menu-permissions-009 Picker 全选交互
变更：2026-06-18-menu-driven-permissions
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given menu `users` 的 3 个 permission 全部已选 menu `users` 的 3 个 permission 部分选中；When 用户点击 `users` 的全选 checkbox 用户点击 `users` 的全选 checkbox；Then `onChange` 被调用，3 个 permission 全部从列表移除 `onChange` 被调用，3 个 permission 全部加入列表（不影响其他
全文：.sillyspec/changes/archive/2026-06-18-menu-driven-permissions/requirements.md#FR-09
最近确认：98d3e56dd

## FR-lib-menu-permissions-010 Picker 折叠状态独立
变更：2026-06-18-menu-driven-permissions
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given menu `users` 折叠，`organizations` 展开；When 用户切换 `users` 折叠状态；Then `organizations` 折叠状态不变
全文：.sillyspec/changes/archive/2026-06-18-menu-driven-permissions/requirements.md#FR-10
最近确认：98d3e56dd

## FR-lib-menu-permissions-011 admin.ts 清理
变更：2026-06-18-menu-driven-permissions
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — When 在仓库中 `grep -r "PERMISSION_GROUPS\|PermissionGroup\|PermissionWithGroup" frontend；Then 无任何匹配（除 `@deprecated` 注释中的引用）
全文：.sillyspec/changes/archive/2026-06-18-menu-driven-permissions/requirements.md#FR-11
最近确认：98d3e56dd

## FR-lib-menu-permissions-012 AppShell 旧常量清理
变更：2026-06-18-menu-driven-permissions
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — When 在仓库中 `grep -rE "OVERVIEW_NAV|MANAGEMENT_NAV|SYSTEM_NAV|ADMIN_NAV" frontend/src/`；Then 无任何匹配
全文：.sillyspec/changes/archive/2026-06-18-menu-driven-permissions/requirements.md#FR-12
最近确认：98d3e56dd

## FR-lib-menu-permissions-013 删除 17 个 ppm 操作权限枚举成员
变更：2026-07-20-ppm-permission-simplify
状态：active
摘要：默认场景
依据决策：D-004@v1
场景正文：
- 场景：默认场景 — Given backend/app/modules/auth/permissions.py 的 Permission 枚举现有 25 个 PPM_* 成员；When 删除 PPM_PROJECT_WRITE/DELETE/EXPORT、PPM_CUSTOMER_WRITE/DELETE/EXPORT、PPM_PLAN_WRI；Then 枚举仅剩 8 个菜单权限成员，PermissionGroup.PPM 分组仍按 ppm: 前缀正确归类
全文：.sillyspec/changes/archive/2026-07-20-ppm-permission-simplify/requirements.md#FR-01
最近确认：632c87add

## FR-lib-menu-permissions-014 保留 8 个 ppm 菜单权限
变更：2026-07-20-ppm-permission-simplify
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 前端 menu-permissions.ts 的 14 个 ppm 菜单条目依赖菜单权限显隐；When 保留 PPM_PROJECT_READ / CUSTOMER_READ / PLAN_READ / PROBLEM_READ / TASK_READ / WOR；Then 前端菜单显隐逻辑不变
全文：.sillyspec/changes/archive/2026-07-20-ppm-permission-simplify/requirements.md#FR-02
最近确认：632c87add

## FR-lib-menu-permissions-015 6 个 ppm router 去权限校验
变更：2026-07-20-ppm-permission-simplify
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given project/plan/task/problem/kanban/workbench 六个 router 端点用 Depends(require_permiss；When 改为 Depends(get_current_principal)（仅认证，保留 JWT + API key 双路径）；Then 登录用户可调用、未登录返回 401；不再查 ppm 权限
全文：.sillyspec/changes/archive/2026-07-20-ppm-permission-simplify/requirements.md#FR-03
最近确认：632c87add

## FR-lib-menu-permissions-016 数据库迁移双轨清理
变更：2026-07-20-ppm-permission-simplify
状态：active
摘要：默认场景
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given 旧种子迁移 202607041000 的 PPM_PERMISSIONS 清单含 25 项，已部署 DB 的 role_permissions 含 17 条操作；When ①改旧迁移清单为 8 项；②新增清理迁移 upgrade = `DELETE FROM role_permissions WHERE permission IN；Then 新环境从头 seed 仅 8 个；已部署环境 upgrade 后 17 条操作权限记录清零（SELECT count == 0）
全文：.sillyspec/changes/archive/2026-07-20-ppm-permission-simplify/requirements.md#FR-04
最近确认：632c87add

## FR-lib-menu-permissions-017 权限枚举测试更新
变更：2026-07-20-ppm-permission-simplify
状态：active
摘要：默认场景
依据决策：D-004@v1
场景正文：
- 场景：默认场景 — Given test_ppm_permissions.py 的 EXPECTED_PPM_PERMISSIONS 断言 25 项、count == 25；When 改 EXPECTED 为 8 项、count == 8、admin 持有权限断言为 8 个菜单权限；Then test_ppm_permissions.py 全绿
全文：.sillyspec/changes/archive/2026-07-20-ppm-permission-simplify/requirements.md#FR-05
最近确认：632c87add

## FR-lib-menu-permissions-018 前端 project-members 菜单清理悬空引用
变更：2026-07-20-ppm-permission-simplify
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given menu-permissions.ts 的 project-members 菜单 permissions = [ppm:project:read, ppm:pr；When 删除 write 条目，只留 read；Then project-members 菜单显隐不变（canSeeMenu 任一命中，read 兜底）
全文：.sillyspec/changes/archive/2026-07-20-ppm-permission-simplify/requirements.md#FR-06
最近确认：632c87add

## FR-lib-menu-permissions-019 admin picker + daemon api-types 同步
变更：2026-07-20-ppm-permission-simplify
状态：active
摘要：默认场景
依据决策：D-004@v1
场景正文：
- 场景：默认场景 — Given admin-role-permission-picker 按枚举渲染、sillyhub-daemon api-types.ts 是 OpenAPI 生成产物；When 删枚举后确认 picker 自动少列、重新生成 api-types；Then picker 不列被删的 17 个权限；api-types 的 ppm 权限类型同步减少
全文：.sillyspec/changes/archive/2026-07-20-ppm-permission-simplify/requirements.md#FR-07
最近确认：632c87add

## FR-lib-menu-permissions-020 ppm 接口最小冒烟测试
变更：2026-07-20-ppm-permission-simplify
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given ppm 模块当前无任何 router 测试，删校验后无自动化回归守护；When 新增 backend/tests/modules/ppm/test_router_smoke.py；Then 覆盖"登录可访问 ppm 接口 200 / 未登录 401"最小断言
全文：.sillyspec/changes/archive/2026-07-20-ppm-permission-simplify/requirements.md#FR-08
最近确认：632c87add

## FR-lib-menu-permissions-021 MCP server 实体 CRUD 与双层可见性
变更：2026-09-10-mcp-central-registry
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 平台共享库（owner_user_id=NULL，仅 admin 写）与用户私有库（owner 归属）并存；When 用户创建/更新/删除 server 或列表查询（scope=platform/mine/visible）；Then 非 admin 写平台库 403；跨用户读私有库 404（防存在性枚举，对齐 skills 先例）；visible scope = 平台共享（脱敏）+ 自己私有
全文：.sillyspec/changes/archive/2026-09-10-mcp-central-registry/requirements.md#FR-01
最近确认：8267d9887

## FR-lib-menu-permissions-022 secret env 加密存储
变更：2026-09-10-mcp-central-registry
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given server_config.env 中含 secret 类键（_SECRET_KEY_MARKERS=token/key/secret/password 子串）；When 创建/更新/导入落库；Then secret 键值逐键加密为 `encrypted_env: {KEY: {"ct": base64, "key_id": 版本标签}}`（Credential
全文：.sillyspec/changes/archive/2026-09-10-mcp-central-registry/requirements.md#FR-02
最近确认：8267d9887

## FR-lib-menu-permissions-023 binding 启用集与授权拉取
变更：2026-09-10-mcp-central-registry
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given McpBinding（scope_type=platform|user，partial unique index 保证唯一）；When admin 加 platform 绑定（进全员默认集）或用户加 user 绑定（校验 scope_ref=owner 或 server 为平台共享） daemo；Then 注入集 = platform binding 全集 ∪ user binding（enabled 过滤）； 双校验（daemon principal + 该 d
全文：.sillyspec/changes/archive/2026-09-10-mcp-central-registry/requirements.md#FR-03
最近确认：8267d9887

## FR-lib-menu-permissions-024 注入链换源与兼容
变更：2026-09-10-mcp-central-registry
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given registry 空库或渲染结果为空；When daemon 拉取；Then 输出 `{"mcpServers": {}}`（对齐 KV 缺失回落）；渲染抛错返回 503（daemon 既有本地回落链保持可达）；响应三键形状 `{plat
全文：.sillyspec/changes/archive/2026-09-10-mcp-central-registry/requirements.md#FR-04
最近确认：8267d9887

## FR-lib-menu-permissions-025 user_id 透传链
变更：2026-09-10-mcp-central-registry
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given claim payload（build_claim_payload）现无 user_id，daemon execPayload 无 user 字段；When backend claim 下发（新增 user_id 字段，旧 daemon 忽略未知字段向后兼容）且 daemon 会话创建拉取带 user_id 查询参数；Then 会话级缓存 `_mcpBundleBySession` 结构不变，per-user 注入集生效
全文：.sillyspec/changes/archive/2026-09-10-mcp-central-registry/requirements.md#FR-05
最近确认：8267d9887

## FR-lib-menu-permissions-026 JSON 粘贴导入
变更：2026-09-10-mcp-central-registry
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 粘贴 mcpServers JSON（兼容 mcpServers/servers/mcp 三种包装）；When 用户（或 admin 选平台库）提交导入；Then 解析建库（source=imported_json）；非法条目逐条报错不整批失败
全文：.sillyspec/changes/archive/2026-09-10-mcp-central-registry/requirements.md#FR-06
最近确认：8267d9887

## FR-lib-menu-permissions-027 workspace 扫描导入与去重
变更：2026-09-10-mcp-central-registry
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 各 workspace specDir/.mcp.json 存在存量配置；When 用户触发扫描（候选列表只读）后勾选应用；Then 同名同配置（cmd 归一化后比对）skip；同名异配置改名 `<name>-<workspace短名>`；dedup_key=ws:<workspace_id>
全文：.sillyspec/changes/archive/2026-09-10-mcp-central-registry/requirements.md#FR-07
最近确认：8267d9887

## FR-lib-menu-permissions-028 注入诊断预检
变更：2026-09-10-mcp-central-registry
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given platform 渲染集与各 workspace .mcp.json；When 诊断端点调用；Then 输出五项：decrypt_failed / bound_but_disabled / platform_name_shadow（platform 名被 work
全文：.sillyspec/changes/archive/2026-09-10-mcp-central-registry/requirements.md#FR-08
最近确认：8267d9887

## FR-lib-menu-permissions-029 收藏模板
变更：2026-09-10-mcp-central-registry
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 模板表（is_preset seed 预置 5-7 个 + 用户自存）；When 用户从模板快速创建或把现有 server 存为模板；Then 模板为明文 server_config（无 secret）；从带 secret 的 server 存模板时 secret 键丢弃并提示
全文：.sillyspec/changes/archive/2026-09-10-mcp-central-registry/requirements.md#FR-09
最近确认：8267d9887
