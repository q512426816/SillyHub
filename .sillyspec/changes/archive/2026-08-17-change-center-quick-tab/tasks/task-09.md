---
id: task-09
title: quicklog-drawer.tsx 抽屉详情 + vitest（覆盖 FR-06, D-006）
title_zh: quicklog 条目抽屉
author: qinyi
created_at: 2026-08-17 00:40:00
priority: P0
depends_on: [task-08]
blocks: []
requirement_ids: [FR-06]
decision_ids: [D-006]
allowed_paths:
  - frontend/src/components/changes/quicklog-drawer.tsx
  - frontend/src/components/changes/__tests__/quicklog-drawer.test.tsx
provides: {}
expects_from:
  task-07: [quicklog_frontend_client]
  task-08: [quicklog_table_ui]
goal: >
  点快速修复列表行开 Drawer（D-006 不建独立页）：四段正文（需求/根因/方案/结果）+ 文件带括注清单 +
  关联变更链接 + 「原始 md」切换视图。内容用详情 API（getQuicklogDetail）拉取。
implementation:
  - quicklog-drawer.tsx：Drawer 组件，props 收 entry(列表项)+onClose；挂载时拉详情
  - 四段正文渲染（缺失段省略）；文件清单逐行 path+括注；关联变更 Link 跳 /changes/[cid]
  - 「原始 md」切换：raw_block <pre> 直出（antd Switch 或按钮 toggle）
  - 加载态/错误态（404/网络失败）
acceptance:
  - 详情加载渲染四段+文件括注+关联变更链接；原始 md 切换正确
  - 无 body 段/无文件/无关联变更时优雅降级（不空白不报错）
  - vitest 组件测试通过
verify:
  - cd frontend && pnpm vitest run src/components/changes/__tests__/quicklog-drawer.test.tsx
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 不新建独立路由页面（D-006）
  - 复用 antd Drawer；样式对齐 FRONTEND_PAGE_STYLE
  - locale 日期显式 zh-CN
related_tests: []
---
