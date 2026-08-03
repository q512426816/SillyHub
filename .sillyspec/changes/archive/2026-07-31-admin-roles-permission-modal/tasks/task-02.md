---
id: task-02
title: AdminRolePermissionPicker 重写为左树右权
title_zh: 权限选择改左菜单树右权限面板transfer风格
author: WhaleFall
created_at: 2026-07-31T15:05:25
priority: P0
depends_on: []
blocks: [task-03]
requirement_ids: [FR-02, FR-03, FR-04]
decision_ids: [D-002@v1, D-003@v1]
allowed_paths:
  - frontend/src/components/admin-role-permission-picker.tsx
goal: >
  AdminRolePermissionPicker 从"38 menu 默认全展开卡片"重写为"左 section/menu 树 + 右当前
  menu 权限面板"(transfer 风格),高度固定(h-420)不拉长,左树带选中数,默认选第一个 menu。
  props 契约不变(仅 /admin/roles 用)。
implementation:
  - 左树(200px overflow-y-auto):按 MENU_SECTION_ORDER 分组(MENU_SECTION_LABEL 标题)+ menu 节点(menuLabel + 选中数 n/m);当前选中 menu 高亮;跳过 pickerHidden(:162-164 现有规则)
  - 右面板(1fr overflow-y-auto):顶部 menu 名 + "全选 (n/m)" checkbox(indeterminate,:76-78 setIndeterminateRef 复用);下方权限 checkbox 列表(name + key,:118-150 现有渲染)
  - 复用 togglePermission(:42)/toggleMenuAll(:51)逻辑(选中态不变)
  - 新增 selectedMenu state(默认第一个非 pickerHidden menu),点击左树节点切换右面板
  - 外层 div 高度固定 h-[420px] + grid grid-cols-[200px_1fr] + 左右各自 overflow-y-auto
  - props(permissions/onChange/disabled/className)签名不变
acceptance:
  - 左树总览所有 menu(按 section 分组)+ 每节点选中数 n/m
  - 点左树节点 → 右面板切该 menu 权限 + 高亮
  - 右面板全选/单选/indeterminate 正确
  - 高度固定 h-420,左右内部滚动,不随 menu 数拉长
  - 默认选第一个非 pickerHidden menu(右面板非空)
  - props 契约不变(disabled 生效)
verify:
  - pnpm typecheck + task-03 picker 测试
constraints:
  - props 契约不变(D-003,permissions/onChange/disabled/className)
  - 复用 MENU_SECTION_ORDER/MENU_SECTION_LABEL/MENU_PERMISSION_GROUPS + togglePermission/toggleMenuAll
  - 不改 pickerHidden 规则 / 权限 key 集合
---

## 实现说明

现 picker 默认全展开所有 menu 卡片(:29-31)。重写:左树(分 section)节点点击 → 右面板显该 menu 权限。selectedMenu state 管当前 menu(默认第一个非 pickerHidden)。高度固定解决"太长"。toggle 逻辑复用(选中态不变)。
