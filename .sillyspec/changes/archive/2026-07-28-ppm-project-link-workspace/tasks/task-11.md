---
id: task-11
title: 工作区页关联项目区块
title_zh: 工作区详情页加关联项目区块
author: qinyi
created_at: 2026-07-28 14:05:41
priority: P0
depends_on: [task-09]
blocks: [task-12]
requirement_ids: [FR-03]
decision_ids: []
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/page.tsx
  - frontend/src/components/workspace/LinkedProjectsSection.tsx
goal: >
  在工作区详情页加「关联项目」区块,对称操作(绑定/解绑 PPM 项目),中文 UI。
implementation:
  - 新建 LinkedProjectsSection 组件:已关联项目列表(可解绑)+ 绑定项目入口(搜索项目)
  - workspaces/[id]/page.tsx 嵌入该区块
  - 调 task-09 的工作区侧 API
acceptance:
  - 区块能绑定/解绑项目,与项目页数据一致(同一张表)
  - 中文 UI,符合前端设计系统
verify:
  - "cd frontend && pnpm exec tsc --noEmit"
constraints:
  - 中文 UI(CLAUDE.md 规则 12)
  - 与项目页操作同一张表,数据自动一致
  - 样式参考前端设计系统总纲
---
