---
id: task-09
title: "project-members/page.tsx 改渲染 <PpmProjectMembersGroupTable />"
title_zh: 项目成员页切换为两级表组件
author: WhaleFall
created_at: 2026-07-15 11:05:37
priority: P0
depends_on: [task-08]
blocks: [task-10]
requirement_ids: [FR-01]
decision_ids: [D-006@v1]
allowed_paths:
  - frontend/src/app/(dashboard)/ppm/project-members/page.tsx
goal: 项目成员页改用两级表组件，保留 PageContainer/PageHeader 外壳。
implementation:
  - project-members/page.tsx import PpmProjectMembersGroupTable
  - 替换 <PpmProjectMembersTable /> 为 <PpmProjectMembersGroupTable />
  - 保留 PageContainer/PageHeader + subtitle
acceptance:
  - 页面渲染两级表组件
  - PageContainer/PageHeader 保留
  - tsc 通过
verify:
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 仅换组件引用，外壳不变
expects_from:
  task-08:
    - contract: PpmProjectMembersGroupTable
      needs: [component]
---

# task-09 — 项目成员页切换为两级表组件

依据 design.md §7.5。极薄页面，仅切换渲染组件。
