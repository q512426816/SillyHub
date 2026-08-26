---
author: qinyi
created_at: 2026-08-26 19:45:00
id: task-05
title: "Frontend data layer"
title_zh: "前端数据层"
priority: P1
depends_on: [task-04]
allowed_paths:
  - frontend/src/lib/workspace-skills-view.ts
  - frontend/src/lib/query-keys.ts
goal: 5 个 fetch 函数 + hooks + queryKeys 扩展
acceptance: |
  1. createWorkspaceSkill/deleteWorkspaceSkill/readWorkspaceSkillFile/writeWorkspaceSkillFile/deleteWorkspaceSkillFile（apiFetch 收口，类型走 api-types）
  2. queryKeys：既有 workspaceSkillsView（query-keys.ts:39-42）不动 + 新增 workspaceSkillFile.detail(wsId, skill, path)
  3. 写/删成功失效 workspaceSkillsView.detail + workspaceSkillFile.detail 两者
  4. hook 返回完整结果不拆散（mcp-settings 样板）
implementation: workspace-skills-view.ts 扩展 + query-keys.ts 追加键
constraints: ["类型禁手写（已进生成范围）"]
verify: cd frontend && pnpm exec tsc --noEmit -p tsconfig.json
expects_from:
  task-04:
    - contract: "api-types"
      needs: [skills 5 端点类型]
provides:
  - contract: "skills hooks"
    fields: [5 fetch, 5 hooks, workspaceSkillFile key]
---

# task-05: 前端数据层

按 frontmatter acceptance 扩展 lib。
