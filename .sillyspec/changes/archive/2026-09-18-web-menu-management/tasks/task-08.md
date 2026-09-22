---
id: task-08
title: 'menu-permissions.ts——4 菜单补 permissions 去 pickerHidden、新增 menus 菜单项、key 类型收紧为 Permission 联合类型'
title_zh: 'menu-permissions.ts——4 菜单补 permissions 去 pickerHidden、新增 menus 菜单项、key 类型收紧为 Permission 联合类型'
author: 'WhaleFall'
generated_by: sillyspec-taskcard
created_at: 2026-09-18 14:46:09
priority: P0
depends_on: ['task-07']
blocks: []
requirement_ids: [FR-01, FR-04]
decision_ids: [D-001@v1]
provides:
  - contract: MenuRegistryUpdate
    fields: [menus_entry, four_menu_permissions, typed_permission_key]
allowed_paths:
  - frontend/src/lib/menu-permissions.ts
target_files:
  - frontend/src/lib/menu-permissions.ts
goal: >
  4 个空 permissions 常显菜单（skills/mcp/agent-profiles/sessions）补独立
  read 权限使其可在角色管理页按角色收回（FR-01，后端枚举与保现状种子已由
  task-01/03 就绪），新增「菜单管理」menus 菜单项（menu:admin 门控），并把
  PermissionItem.key 从 string 收紧为 api-types 生成的 Permission 联合类型
  获得编译期守卫（FR-04）；注册表仍是菜单目录单一数据源（D-001）。
implementation:
  - 'import type { components } from "@/lib/api-types"，导出 type PermissionKey = components["schemas"]["Permission"]（api-types.ts:18838，task-07 再生成后已含 skill:read/mcp:read/agent_profile:read/agent_session:read/menu:admin 5 个新值）；PermissionItem.key（menu-permissions.ts:33）由 string 改为 PermissionKey'
  - skills（:182-191）与 mcp（:200-209）permissions 各补单项——skill:read「技能查看」/ mcp:read「MCP 查看」，并删除两处 pickerHidden: true（两菜单进入角色勾选器可勾选）
  - agent-profiles（:223）与 sessions（:237）permissions 各补单项——agent_profile:read「智能体档案查看」/ agent_session:read「智能体会话查看」（补后 4 菜单走 hasAnyPermission 权限判定，存量可见性由种子迁移保现状）
  - system 组新增 menus 菜单项（追加在 settings 之后）——section=system、menuKey=menus、menuLabel=菜单管理、icon 语义 emoji 占位、href=/admin/menus、absolute=true、matchPattern=/admin/menus、permissions 单项 menu:admin「菜单管理」
  - 顶部 docblock 补两条——menuKey 为稳定标识禁止重命名（覆盖表按 menu_key 关联，R-01）；登记本次 4 个 read 权限 + menus 入口的变更依据
acceptance:
  - 4 菜单 permissions 各含且仅含对应新 key；skills/mcp 不再有 pickerHidden 字段（AdminRolePermissionPicker 未改动即自动渲染两张新菜单卡）
  - MENU_PERMISSION_GROUPS 增至 38 条且含 menuKey=menus（system 组、permissions=[menu:admin]）；其余 37 条 menuKey/href/section/matchPattern 与改前逐项一致
  - PermissionItem.key 类型为 PermissionKey，全部权限 key 字面量落在联合类型内——手写漂移项无法通过 tsc
verify:
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 不改任何既有 menuKey/href/section 与 navHidden 标记（D-001 单一数据源；menuKey 重命名会使覆盖行变孤儿，R-01）
  - 不动 permission.ts 的 hasAnyPermission/canSeeMenu/visibleMenusBySection 语义（空 permissions 登录可见语义保留，本卡不触碰）
  - 既有 menu-permissions.test.ts / permission.test.ts 的确定性失效断言同步归 task-12，本卡不改测试文件
  - 类型只用生成物 api-types，禁止手写权限联合字面量；注释与展示名中文
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     target_files 格式（可选，对账用精确文件级意图声明，与 allowed_paths 语义不同）：
                    精确文件路径（仓根相对、正斜杠），当前不存在、将由本 task 新建的文件加
                    NEW: 前缀（如 NEW:src/foo.js）；禁 glob（src/**）、禁目录前缀（src/dir/）、
                    禁绝对路径；无明确文件级意图时保留 [] 占位行不动。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
