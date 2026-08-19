---
id: task-07
title: workspace-detail-edit-and-link-dialog-badges
title_zh: 详情页基本信息编辑与项目关联弹窗类型徽标
author: qinyi
created_at: 2026-08-18 23:11:29
priority: P0
depends_on: [task-05]
blocks: [task-08]
requirement_ids: [FR-05, FR-06]
decision_ids: [D-002@v1, D-005@v1]
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/page.tsx
  - frontend/src/components/workspace/LinkWorkspaceDialog.tsx
  - frontend/src/components/workspace/__tests__/LinkWorkspaceDialog.test.tsx
provides:
  - contract: 详情页基本信息编辑区支持 type 下拉/role 输入/description textarea 并 PATCH 保存
    files:
      - "frontend/src/app/(dashboard)/workspaces/[id]/page.tsx"
  - contract: LinkWorkspaceDialog 已关联与可选列表均渲染类型徽标并透出 role/description 摘要
    files:
      - frontend/src/components/workspace/LinkWorkspaceDialog.tsx
expects_from:
  task-05:
    - contract: WORKSPACE_TYPE_OPTIONS 词表常量（8 值 value+中文 label+badge class+UNCLASSIFIED 展示项）与 workspaceTypeBadge 函数（NULL 灰色未分类、未知非空值原值灰徽标）
      needs: [WORKSPACE_TYPE_OPTIONS, workspaceTypeBadge, type, role, description]
goal: >
  工作区详情页可编辑类型/角色/描述并 PATCH 保存；项目关联弹窗两侧列表按新词表渲染徽标并以 title 带摘要。
implementation:
  - workspaces/[id]/page.tsx——现有「基本信息」SectionCard 内加编辑区——类型下拉（WORKSPACE_TYPE_OPTIONS，NULL 显示未分类项）、role 文本输入（≤100）、description textarea（≤2000）；保存走 updateWorkspace PATCH，成功后 setWorkspace(updated) 刷新；复用现有 default_agent 保存的 busy/error 模式
  - LinkWorkspaceDialog.tsx——已关联列表 w.type 由原始字符串改为 workspaceTypeBadge 徽标 + title 属性带 role/description 摘要（Brief 已补字段）；可选列表项同样补类型徽标；对应测试文件补断言
acceptance:
  - 详情页修改三字段保存后刷新仍显示新值；role/description 清空走显式 null 语义（D-005）
  - 弹窗已关联与可选列表徽标渲染正确，未知 type 原值灰徽标不崩
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm test --run src/components/workspace/__tests__/LinkWorkspaceDialog.test.tsx
constraints:
  - 编辑区只放桌面详情页，不加移动端页面（§3 非目标）；LinkedProjectsSection 不动
  - 详情页测试若因页面级体积跑 vitest 慢，按仓库惯例抽组件化测（参考 page-team-toggle 先例），不在本卡强求整页快照
---
