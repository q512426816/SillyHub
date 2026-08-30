---
id: task-10
title: 项目页关联工作区弹窗
title_zh: 项目维护页加关联工作区入口与弹窗
author: qinyi
created_at: 2026-07-28 14:05:41
priority: P0
depends_on: [task-09]
blocks: [task-12]
requirement_ids: [FR-02]
decision_ids: []
allowed_paths:
  - frontend/src/app/(dashboard)/ppm/projects/page.tsx
  - frontend/src/components/workspace/LinkWorkspaceDialog.tsx
goal: >
  在项目维护页列表行加「关联工作区」按钮,点击弹窗可绑定/解绑工作区并查看已关联,中文 UI。
implementation:
  - 新建 LinkWorkspaceDialog 组件:已关联工作区列表(可解绑)+ 可选工作区列表(可绑定)
  - ppm/projects/page.tsx 列表行操作区加「关联工作区」按钮,打开弹窗
  - 调 task-09 的项目侧 API
acceptance:
  - 弹窗能绑定/解绑工作区,列表正确反映关联数
  - 中文 UI,符合前端设计系统
verify:
  - "cd frontend && pnpm exec tsc --noEmit"
constraints:
  - 中文 UI(CLAUDE.md 规则 12)
  - 不影响 ppm/projects 现有增删改查/导出/成员管理
  - 样式参考前端设计系统总纲
---
