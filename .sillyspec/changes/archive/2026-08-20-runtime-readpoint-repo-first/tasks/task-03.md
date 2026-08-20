---
schema_version: 1
doc_type: task
id: task-03
title: Frontend user-inputs truncation and subtitle
title_zh: 前端 user-inputs 截断与副标题文案
author: qinyi
created_at: 2026-08-20T11:05:00+08:00
change_name: 2026-08-20-runtime-readpoint-repo-first
wave: 1
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/runtime/page.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/runtime/page.test.tsx
provides: []
expects_from: []
goal: user-inputs 超 50000 字符仅渲染末段并提示；副标题反映「优先本机仓库，回退同步缓存」
implementation: 渲染前 const display = ui.length > 50000 ? ui.slice(-50000) : ui，截断时上方加提示行（含完整文件路径 .sillyspec/.runtime/user-inputs.md）；副标题字符串更新
acceptance: page.test.tsx 新增超长输入截断用例（渲染末段+提示出现）；既有文案断言若因副标题变更失效则同步更新（连带测试归属）
verify: cd frontend && pnpm test -- runtime/page && pnpm exec tsc --noEmit
constraints: 只动渲染层，不动 lib/runtime.ts 接口客户端；截断阈值 50000 字符为常量
---

# task-03：前端截断与文案

依据：design.md §5.3；requirements FR-05；AC-04。
