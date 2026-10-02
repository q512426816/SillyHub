---
author: qinyi
created_at: 2026-09-21 09:32:00
---
# 任务清单（Tasks）

> 任务注册表唯一真相（plan.md Wave 纯 ID 引用分组；TaskCard 细节 execute 阶段生成）。

- [x] task-01: backend stats 数据底座（schema DTO 族含 injection + service.stats() 单表轻列内存聚合含 map yaml 解析 + docs-inject 行聚合 + GET /scan-docs/stats 端点声明序在 {doc_id} 之前 + test_stats.py 口径用例含知识 stats 不受污染断言） (depends_on: )
  - target_files: backend/app/modules/scan_docs/schema.py, backend/app/modules/scan_docs/service.py, backend/app/modules/scan_docs/router.py, NEW:backend/app/modules/scan_docs/tests/test_stats.py
- [x] task-02: 类型链同步（pnpm gen:types 再生成 api-types.ts + openapi.json 提交 + lib/scan-docs.ts getScanDocsStats/查询键） (depends_on: task-01)
  - target_files: backend/openapi.json, frontend/src/lib/api-types.ts, frontend/src/lib/scan-docs.ts
- [x] task-03: frontend 运营面板（ScanDocsStatsPanel 组件：四子卡+陈旧清单开合+8 周趋势折线+注入/更新双榜 tab+三态 + 组件用例 + page.tsx 挂载冒烟） (depends_on: task-02)
  - target_files: NEW:frontend/src/components/scan-docs-stats-panel.tsx, NEW:frontend/src/components/__tests__/scan-docs-stats-panel.test.tsx, frontend/src/app/(dashboard)/workspaces/[id]/scan-docs/page.tsx, frontend/src/app/(dashboard)/workspaces/[id]/__tests__/scan-docs-page.test.tsx
- [x] task-04: CLI docs-inject 埋点（sillyspec 仓 prompt.js buildModuleContextInjection 注入点（实名 buildModuleContextInjection:168）+ execute.js 注入孪生处（grep 实定位，现为 knowledge-inject 型:23/:85）append 遥测行，fail-soft + test/docs-inject-telemetry.test.mjs 双点用例） (depends_on: )
  - target_files: src/run/prompt.js, src/stages/execute.js, NEW:test/docs-inject-telemetry.test.mjs（本行三项属 sillyspec 仓，路径相对该仓根）
- [x] task-05: 模块文档增量 + 回归验证（backend/scan_docs、app-workspace-pages、新组件卡 + 既有 scan-docs 页面测试零回归 + 原型对照） (depends_on: task-03, task-04)
  - target_files: .sillyspec/docs/backend/modules/scan_docs.md, .sillyspec/docs/frontend/modules/app-workspace-pages.md, NEW:.sillyspec/docs/frontend/modules/scan-docs-stats-panel.md
