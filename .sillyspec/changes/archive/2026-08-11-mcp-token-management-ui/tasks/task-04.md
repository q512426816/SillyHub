---
id: task-04
title: Add MCP tokens tab to workspace-tabs
title_zh: workspace-tabs 加 MCP 令牌 tab（紧邻 MCP，全可见不隐藏）
author: qinyi
created_at: 2026-08-11 15:08:00
priority: P0
depends_on: []
blocks: [task-08]
allowed_paths:
  - frontend/src/components/workspace-tabs.tsx
goal: >
  在 workspace-tabs.tsx 的静态 as const TABS 数组里加「MCP 令牌」tab 项，紧邻现有「MCP」tab，
  对所有 bound 成员可见不按权限隐藏，落地决策 D-001@v1，覆盖 FR-04。
implementation:
  - 在 TABS as const 数组的 mcp 项后插入新项，key 用 mcp-tokens、label 用 MCP 令牌、path 指向 mcp-tokens 子路径
  - 不加任何权限字段，保持数组静态全可见特性
  - isActive 逻辑沿用现有 startsWith 匹配无需改（mcp-tokens 路径与 mcp 正交互不误命中）
acceptance:
  - workspace 子导航出现「MCP 令牌」tab，紧邻「MCP」
  - tab 对所有 bound 成员可见，无权限字段
  - 进入 mcp-tokens 页时该 tab 高亮，进入 mcp 页时不误高亮新 tab
verify:
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 边界 D-001@v1：tab 全可见，viewer 可见性靠服务端 403 兜底，前端不做权限隐藏
  - 仅加一项，不改 isActive 匹配与其他 tab
  - mobile-tab-bar 组件正交无专属测试，related_tests 留空
related_tests: []
---
