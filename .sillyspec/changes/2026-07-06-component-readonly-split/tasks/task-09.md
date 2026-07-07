---
id: task-09
title: components/page.tsx 改名"项目组件" + 只读 + 删出入边 + 删重新扫描按钮
author: qinyi
created_at: 2026-07-06 11:29:29
priority: P0
depends_on: [task-08]
blocks: []
requirement_ids: [FR-06]
decision_ids: [D-007@V1]
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/components/page.tsx
goal: >
  改造 components 页为只读"项目组件"（D-007）：标题改名；load() 改调 getWorkspaceComponents；删出/入边两个 SectionCard；删"重新扫描"按钮及 handleRescan。
implementation:
  - 页面标题"工作区关系" → "项目组件"
  - `load()` 改调 `getWorkspaceComponents(id)`（来自 task-08），渲染 Component 列表（只读）
  - 删除"出边"/"入边"两个 SectionCard 及其取数（不再调 getWorkspaceRelations）
  - 删除"重新扫描"按钮 + `handleRescan`（不再调 POST /reparse）
  - 沿用现有样式系统（参考 archive/2026-06-21-frontend-style-system），不做新视觉
acceptance:
  - 页面标题为"项目组件"
  - 列表显示 5 个一级子项目（依赖后端 generate_projects 已重生）
  - 无出入边卡片、无重新扫描按钮
  - 控制台无 404（relations/reparse 端点已删）
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm vitest run src/app/\(dashboard\)/workspaces/\[id\]/components
constraints:
  - 不引入新视觉/新组件库（design §3 非目标）
  - 不删 component_key 相关类型字段（保留 null，R-06）
  - 样式参考前端统一风格系统文档
---

