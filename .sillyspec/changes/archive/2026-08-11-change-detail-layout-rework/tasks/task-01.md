---
id: task-01
title: Secondary-line card container and collapsible primitives
title_zh: 次线卡片容器与折叠基件（CollapsibleCard + 变更文件卡 + 会话调试卡）
author: qinyi
created_at: 2026-08-11 11:36:04
priority: P0
depends_on: []
blocks:
  - task-06
allowed_paths:
  - frontend/src/components/changes/detail/collapsible-card.tsx
  - frontend/src/components/changes/detail/change-files-card.tsx
  - frontend/src/components/changes/detail/change-sessions-card.tsx
  - frontend/src/components/changes/detail/__tests__/collapsible-card.test.tsx
  - frontend/src/components/changes/detail/__tests__/change-files-card.test.tsx
  - frontend/src/components/changes/detail/__tests__/change-sessions-card.test.tsx
provides:
  - contract: CollapsibleCard
    fields:
      - title
      - defaultOpen
      - children
  - contract: ChangeFilesCard
    fields:
      - workspaceId
      - changeId
  - contract: ChangeSessionsCard
    fields:
      - workspaceId
      - changeId
goal: >
  搭建变更详情页次线侧栏的折叠基件与两张次线卡片：CollapsibleCard 受控折叠容器（标题 + 可展开 body，支持 defaultOpen 默认值，<lg 移动端默认收起省纵向空间）；ChangeFilesCard 黑盒包 ChangeFileTree 渲染变更文件；ChangeSessionsCard 黑盒包 ChangeSessionSection 渲染会话调试。仅做展示层封装，不改被包组件内部实现。
implementation:
  - 新建 collapsible-card.tsx 导出 CollapsibleCard 受控折叠容器，Props 含 title 与可选 defaultOpen 与 children；内部 useState 管理开合，点击标题栏切换，展开时渲染 children，配展开/收起箭头与 aria-expanded。
  - 新建 change-files-card.tsx 导出 ChangeFilesCard，Props 透传 workspaceId 与 changeId；用 CollapsibleCard 包 ChangeFileTree（workspaceId 与 changeId 原样透传），defaultOpen=true（变更文件常用，execute 验收时确认默认值表）。
  - 新建 change-sessions-card.tsx 导出 ChangeSessionsCard，Props 透传 workspaceId 与 changeId；用 CollapsibleCard 包 ChangeSessionSection（包内附带「在该变更上下文中提问/调试」副标题文案），defaultOpen=false（会话调试默认收起，对应移动端折叠形态）。
  - 三组件均 "use client"，复用现有 @/components/ui 风格（rounded-md border bg-card），沿用 shadcn 体系不换组件库（D-005）。
  - 被包组件 ChangeFileTree 与 ChangeSessionSection 作为黑盒引用，不改其内部实现与 Props。
acceptance:
  - CollapsibleCard 点击标题栏可展开/收起，defaultOpen 控制初始开合，收起时 children 不渲染或折叠。
  - ChangeFilesCard 内正确渲染 ChangeFileTree 并收到透传的 workspaceId 与 changeId，默认展开。
  - ChangeSessionsCard 内正确渲染 ChangeSessionSection 并收到透传的 workspaceId 与 changeId，默认收起，点击可展开。
  - 三张卡视觉与现有 page.tsx 会话/变更文件区块一致（边框/标题栏/内边距）。
verify: cd frontend && pnpm exec tsc --noEmit && pnpm test -- collapsible-card change-files-card change-sessions-card
constraints:
  - 零后端改动，不新增/修改任何 API、DTO、响应体或配置键，纯前端展示层封装。
  - 不改 ChangeFileTree 与 ChangeSessionSection 内部实现，仅黑盒包一层。
  - 不引入新组件库，沿用 @/components/ui（D-005）。
  - 移动端 <lg 形态由折叠默认值承载，不另写媒体查询分支逻辑。
---

# 说明

次线侧栏的容器基件与两张展示卡。CollapsibleCard 是全部次线卡（含 task-02 审核历史卡、task-07 任务看板卡）的统一折叠形态，本任务先落地基件与文件/会话两卡。defaultOpen 默认值表（R-05）：变更文件 true，会话 false；审核历史/任务看板由各自 task 决定。
