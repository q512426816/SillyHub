---
id: task-07
title: 新增通用件 mobile-card-list + mobile-filter-drawer + mobile-detail-sheet + mobile-action-menu + mobile-batch-bar + mobile-export-button + 单测
title_zh: 通用移动组件库
author: qinyi
created_at: 2026-07-22 23:47:21
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-05, FR-06]
decision_ids: [D-007, D-008]
allowed_paths:
  - frontend/src/components/mobile/mobile-card-list.tsx
  - frontend/src/components/mobile/mobile-filter-drawer.tsx
  - frontend/src/components/mobile/mobile-detail-sheet.tsx
  - frontend/src/components/mobile/mobile-action-menu.tsx
  - frontend/src/components/mobile/mobile-batch-bar.tsx
  - frontend/src/components/mobile/mobile-export-button.tsx
  - frontend/src/components/mobile/mobile-card-list.test.tsx
provides: [{contract: MobileComponents, fields: [MobileCardList, MobileFilterDrawer, MobileDetailSheet, MobileActionMenu, MobileBatchBar, MobileExportButton]}]
expects_from: []
goal: >
  新增 6 个通用移动组件 + 1 单测，构成 contract MobileComponents 供 task-08~11 消费。MobileCardList 全功能替代表格（D-007），
  MobileDetailSheet 承载新建/编辑/别名/绑定全屏表单（D-008）。
implementation:
  - 'mobile-card-list.tsx 导出 MobileCardList：泛型<T>，props 按 design §7（items/renderCard/onItemPress/actions/selectable/selectedKeys/onSelectedKeysChange/pagination/headerActions），MobileAction{key,label,danger?,onPress}'
  - 'mobile-action-menu.tsx 导出 MobileActionMenu：底部 ActionSheet 渲染 MobileAction[]'
  - 'mobile-batch-bar.tsx 导出 MobileBatchBar：selectable 模式底部批量栏（选中数+批量删除）'
  - 'mobile-filter-drawer.tsx 导出 MobileFilterDrawer：props {open,onOpenChange,children,onApply,onReset}'
  - 'mobile-detail-sheet.tsx 导出 MobileDetailSheet：props {open,title,onClose,children,onSubmit,loading}'
  - 'mobile-export-button.tsx 导出 MobileExportButton：导出 Excel 入口（进 headerActions）'
  - 'mobile-card-list.test.tsx：Vitest 单测渲染卡片/actions 触发/selectable/pagination.onChange/headerActions'
  - 'antd Drawer/Modal/Button + Tailwind；触摸≥44×44px、正文≥14px；分页 page/page_size 不用无限滚动（D-008）'
acceptance:
  - MobileCardList 渲染 items 每条卡片；actions 经 MobileActionMenu 点击触发 onPress
  - selectable 选中/取消→onSelectedKeysChange 正确，MobileBatchBar 显示选中数
  - pagination.onChange 传新页码对接 page/page_size（非无限滚动）
  - headerActions 渲染（如 MobileExportButton）
  - MobileDetailSheet/MobileFilterDrawer 的 open/close/onSubmit/onApply/onReset 均工作
  - 单测 mobile-card-list.test.tsx 全绿
verify:
  - cd frontend && pnpm test -- src/components/mobile/mobile-card-list
  - cd frontend && pnpm typecheck && pnpm lint
constraints:
  - 仅新增 components/mobile/，不改桌面组件（app-shell/桌面 Table 零回归）
  - 组件纯 UI，数据由各页传入，不自写请求（D-003）
  - 分页用 page/page_size，不用无限滚动（D-008）；触摸≥44×44px、正文≥14px
---

# task-07 · 通用移动组件库

依据 design §5.5/§7。6 个通用移动组件（MobileCardList 全功能替代表格 + 配套），供各移动页消费。
