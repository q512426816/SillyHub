---
id: task-05
title: add-frontend-workspace-type-vocab-and-client-fields
title_zh: 前端类型词表徽标 helper 与 workspaces client 补字段
author: qinyi
created_at: 2026-08-18 23:11:29
priority: P0
depends_on: [task-04]
blocks: [task-06, task-07]
requirement_ids: [FR-01, FR-04]
decision_ids: [D-002@v1, D-005@v1]
allowed_paths:
  - frontend/src/lib/workspace-types.ts
  - frontend/src/lib/workspaces.ts
  - frontend/src/lib/workspaces.test.ts
  - frontend/src/lib/__tests__/workspace-types.test.ts
provides:
  - contract: WORKSPACE_TYPE_OPTIONS 词表常量（8 值 value+中文 label+badge class+UNCLASSIFIED 展示项）与 workspaceTypeBadge 函数（NULL 灰色未分类、未知非空值原值灰徽标）
    fields: [WORKSPACE_TYPE_OPTIONS, workspaceTypeBadge, type, description, role]
  - contract: workspaces client 输入类型
    fields: [type, description, role]
expects_from:
  task-04:
    - contract: WorkspaceType 8 值字面量联合类型（源自 WorkspaceCreate.type 枚举）
      needs: [type, description, role]
goal: >
  建前端类型词表单一事实源（中文标签+徽标+兜底渲染）并把 workspaces client 的创建/更新输入补齐 type/description/role。
implementation:
  - 新建 workspace-types.ts——WORKSPACE_TYPE_OPTIONS（frontend-code 前端代码/backend-code 后端代码/fullstack 全栈/business-doc 业务文档/submodule 子模块/deploy-ops 部署运维/design-asset 设计资产/other 其它）+ UNCLASSIFIED 展示项 + workspaceTypeBadge(type)；value 类型从 api-types 生成字面量联合派生，禁手抄
  - workspaces.ts——CreateWorkspaceInput 加必填 type 与可选 description；UpdateWorkspaceInput 加 type/role/description（omit 不改/null 清空，D-005）；文件头注释补本 change 追溯
  - 新增 workspace-types.test.ts（8 值标签、NULL→未分类、未知值→原值灰徽标）；workspaces.test.ts 补 Input 字段断言
acceptance:
  - 词表 8 项 key 与后端 constants.py 逐字一致（tsc 由生成类型保证）
  - workspaceTypeBadge 对 null/undefined/未知字符串均返回合理渲染不抛错
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm test --run src/lib/__tests__/workspace-types.test.ts src/lib/workspaces.test.ts
constraints:
  - badge class 复用现有 ui/badge 变体与灰阶 token；词表仅本文件定义，task-06/07 一律从此导入，禁止组件内重复硬编码
---
