---
id: task-07
title: 'docs and regression wrap up'
title_zh: '模块文档增量+回归+原型对照'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-20 22:20:00
priority: P1
depends_on: [task-06]
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05, FR-06]
decision_ids: [D-004@v2, D-009]
allowed_paths:
  - .sillyspec/docs/backend/modules/knowledge.md
  - .sillyspec/docs/sillyhub-daemon/modules/
  - .sillyspec/docs/SillyHub/modules/frontend_components.md
  - .sillyspec/changes/2026-09-20-knowledge-effect-panel/module-impact.md
target_files:
  - .sillyspec/docs/backend/modules/knowledge.md
  - .sillyspec/docs/SillyHub/modules/frontend_components.md
goal: >
  收尾：模块文档增量（knowledge hits 面、daemon 上报钩子、前端两新组件）+ 回归 + 原型对照复核。
implementation:
  - knowledge 卡补 hits 表两端点 stats 口径（五型、次任务、%格式、slug 归一）
  - daemon 侧模块卡补 hits 上报 best-effort 语义
  - frontend_components 卡补 ops-dashboard 与 entry-card-list 增量
  - daemon 与 knowledge 面回归；module-impact 更新结果回填；原型逐项对照
acceptance:
  - 卡片与实现对齐且回归全绿且 module-impact 回填 done
verify:
  - cd backend && uv run pytest app/modules/knowledge -q
  - cd sillyhub-daemon && pnpm test
constraints:
  - 只改文档不改代码
---
