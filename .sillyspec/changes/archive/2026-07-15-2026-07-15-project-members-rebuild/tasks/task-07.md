---
id: task-07
title: "ppm-project-members-table.tsx export MemberFormDrawer + props 加 onChanged/embedded（紧凑嵌入模式，现状兼容）"
title_zh: 成员表组件共享化 + 紧凑嵌入模式 + 成员数刷新回调
author: WhaleFall
created_at: 2026-07-15 11:05:37
priority: P0
depends_on: [task-06]
blocks: [task-08]
requirement_ids: [FR-04, FR-05, FR-06, FR-07, FR-08]
decision_ids: [D-004@v1, D-006@v1, D-007@v1]
allowed_paths:
  - frontend/src/components/ppm-project-members-table.tsx
goal: 让成员表组件可被两级表展开行复用（导出表单 + 嵌入模式 + 刷新回调），且现状（平铺页/projects 抽屉）零回归。
implementation:
  - 把 MemberFormDrawer 改为 export（逻辑不变，供 GroupTable 全局新增复用）
  - props 加 onChanged?: () => void（handleSubmit / handleConfirmDelete 成功后 onChanged?.()）
  - props 加 embedded?: boolean（body 渲染：embedded=true 跳过 SectionCard 包裹，Table scroll 用 {x:"max-content"} 去掉 calc(100vh-430px) 的 y，保留新增按钮，G1）
  - 成员子表加「账号」列（ProjectMember.username，None 兜底「—」）
acceptance:
  - MemberFormDrawer 可被外部 import
  - embedded 模式无 vh scroll 框（G1）
  - onChanged 在增删改成功后触发
  - 不传新 prop 时行为同现状；projects 抽屉不回归
  - tsc + lint 过
verify:
  - cd frontend && pnpm exec tsc --noEmit && pnpm lint
constraints:
  - 纯增量可选 prop（向后兼容，projects 抽屉零改动）
  - MemberFormDrawer 逻辑不变只改 export
  - username 可选显示，None 兜底
provides:
  - contract: MemberFormDrawer
    fields: [mode, row, lockedProjectId, canWrite, onClose, onSubmit]
  - contract: PpmProjectMembersTable
    fields: [projectId, onChanged, embedded, showToolbar, canWrite]
expects_from:
  task-05:
    - contract: ProjectMember
      needs: [username]
---

# task-07 — 成员表共享化 + 紧凑嵌入模式 + 刷新回调

依据 design.md §7.5、§12.1 Grill G1（embedded 修正）。现有 scroll y: calc(100vh-430px) 在 ppm-project-members-table.tsx:328。
