---
id: task-03
title: AdminRolePermissionPicker 左树右权测试
title_zh: 权限选择器左树右权交互测试
author: WhaleFall
created_at: 2026-07-31T15:05:25
priority: P0
depends_on: [task-02]
blocks: []
requirement_ids: [FR-02, FR-03, FR-04]
decision_ids: [D-002@v1]
allowed_paths:
  - frontend/src/components/__tests__/admin-role-permission-picker.test.tsx
goal: >
  验证左树右权交互:左树切换、全选/indeterminate、选中数 n/m、默认选第一个 menu、disabled。
implementation:
  - 用例 1:左树渲染所有 section/menu + 选中数 n/m
  - 用例 2:点左树节点 → 右面板切该 menu 权限 + 节点高亮
  - 用例 3:右面板全选 → 该 menu 所有权限选中 + 左树选中数更新
  - 用例 4:部分选中 → 全选 checkbox indeterminate
  - 用例 5:默认打开右面板非空(第一个 menu)
  - 用例 6:disabled=true → 全选/单选不可点
acceptance:
  - 左树/右面板/全选/indeterminate/默认/disabled 全覆盖
verify:
  - pnpm test admin-role-permission-picker
constraints:
  - mock MENU_PERMISSION_GROUPS(或用真实数据)
  - 复用既有 picker test 模式(若有)
---

## 实现说明

render AdminRolePermissionPicker with permissions/onChange,断言左树节点/右面板/checkbox 状态。vitest + testing-library。
