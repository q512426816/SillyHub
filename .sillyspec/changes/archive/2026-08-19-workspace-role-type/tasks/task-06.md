---
id: task-06
title: workspace-create-dialog-type-and-list-badges
title_zh: 添加工作区弹窗类型必选下拉与列表页徽标筛选
author: qinyi
created_at: 2026-08-18 23:11:29
priority: P0
depends_on: [task-05]
blocks: [task-08]
requirement_ids: [FR-02, FR-04, FR-05]
decision_ids: [D-002@v1, D-005@v1]
allowed_paths:
  - frontend/src/components/workspace-scan-dialog.tsx
  - frontend/src/app/(dashboard)/workspaces/page.tsx
  - frontend/src/components/workspace-card.tsx
  - frontend/src/components/__tests__/workspace-card.test.tsx
provides:
  - contract: 创建弹窗提交体含必选 type 与可选 description
    files:
      - frontend/src/components/workspace-scan-dialog.tsx
  - contract: 列表页筛选换新词表 8 值加未分类选项（unclassified 参数）且卡片渲染类型徽标
    files:
      - frontend/src/app/(dashboard)/workspaces/page.tsx
      - frontend/src/components/workspace-card.tsx
expects_from:
  task-05:
    - contract: WORKSPACE_TYPE_OPTIONS 词表常量（8 值 value+中文 label+badge class+UNCLASSIFIED 展示项）与 workspaceTypeBadge 函数（NULL 灰色未分类、未知非空值原值灰徽标）
      needs: [WORKSPACE_TYPE_OPTIONS, workspaceTypeBadge, type, description]
goal: >
  创建工作区时必选类型并可选填描述；列表页筛选换新词表加未分类项、卡片显示类型徽标、删废弃 daemon-client 旧值。
implementation:
  - workspace-scan-dialog.tsx——创建路径加「工作区类型」必选下拉（默认空、未选禁提交）+「描述」textarea 选填；createWorkspace 提交体带 type/description
  - workspaces/page.tsx——筛选下拉换 WORKSPACE_TYPE_OPTIONS + 全部 + 未分类（走 ?unclassified=true，与 type 互斥由后端保证）；删 daemon-client 选项
  - workspace-card.tsx——卡片名区加 workspaceTypeBadge(workspace.type) 徽标（文件在 components 根目录非 workspace 子目录）；对应测试补 NULL→未分类、已知值→中文标签断言
acceptance:
  - 弹窗未选类型时创建不可触发，提交体 JSON 含 type
  - 未分类选项走 unclassified 参数；daemon-client 不再出现；卡片对 NULL 与未知 type 均渲染兜底徽标不崩
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm test --run src/components/__tests__/workspace-card.test.tsx
constraints:
  - 不动移动端 m/workspaces（task-08 收口）与 LinkedProjectsSection；描述只显截断单行（line-clamp），全文留详情页（R-06）
---
