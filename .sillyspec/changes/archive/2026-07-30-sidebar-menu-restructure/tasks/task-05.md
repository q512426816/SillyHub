---
id: task-05
title: 更新受影响既有测试 + 核对 picker 新分组渲染
title_zh: 适配权限测试到新分组并核对渲染
author: qinyi
created_at: 2026-07-30 09:06:13
priority: P0
depends_on: [task-02]
blocks: [task-07]
requirement_ids: [FR-01]
decision_ids: [D-001@v1]
allowed_paths:
  - frontend/src/components/__tests__/admin-role-permission-picker.test.tsx
  - frontend/src/lib/__tests__/permission.test.ts
  - frontend/src/components/admin-role-permission-picker.tsx
goal: >
  task-02 将 MenuSection 改为 workspace/agent/config/governance/system/ppm 新六分组后，admin-role-permission-picker.test.tsx 与 permission.test.ts 因旧分组名与旧分组数量断言而失败，需适配新分组结构；同时核对权限选择器组件数据驱动渲染新分组正常（组件代码不改）。
implementation:
  - 修改 admin-role-permission-picker.test.tsx 中 renders 4 sections in fixed order 断言，改为按 MENU_SECTION_ORDER 驱动的新分组顺序（工作区、智能体、配置中心、协作治理、系统管理、项目管理）
  - 将 overview section renders 8 menus 改为 workspace 组渲染 8 个菜单；management 组断言拆到 agent 与 config 组（各 4 项）；admin 组 3 项断言改为 system 组 4 项（用户、组织、角色、设置）；system 组 2 项旧断言删除
  - 更新 MENU_PERMISSION_GROUPS 数据源断言，总长度与 sectionCounts 改为新分组计数（workspace 8、agent 4、config 4、governance 3、system 4、ppm 14）
  - 修改 permission.test.ts 中 visibleMenusBySection 的旧 section 名调用，admin 改 system、management 改 agent、overview 改 workspace；mock group 的 section 字段 admin 改为 system
  - 核对 admin-role-permission-picker.tsx 仅经 MENU_SECTION_ORDER 与 MENU_SECTION_LABEL 数据驱动渲染，新分组与我的供应商权限卡片（供应商管理，权限键 llm_provider:read）在角色管理中可分配显示，组件代码本身无需改动
acceptance:
  - 两个测试文件不再以旧分组名 overview/management/admin 作为 section 值断言，全部断言与 design 五点一节新分组一致
  - 我的供应商权限卡片在 picker 渲染中出现且可勾选分配
  - 两个受影响测试文件全部用例通过
verify:
  - pnpm --dir frontend test src/components/__tests__/admin-role-permission-picker.test.tsx
  - pnpm --dir frontend test src/lib/__tests__/permission.test.ts
constraints:
  - 仅允许修改 allowed_paths 列出的三个文件，picker 组件原则上只核对不改代码
  - 不改动 permission.ts 的 canSeeMenu 与 hasAnyPermission 逻辑
  - 断言尽量由 MENU_SECTION_ORDER、MENU_SECTION_LABEL、MENU_PERMISSION_GROUPS 数据源驱动，避免再次硬编码分组数量
---
