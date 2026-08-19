---
schema_version: 1
doc_type: task
id: task-13
title: Update RuntimePage copy and errors
title_zh: 更新 RuntimePage 文案与错误提示
author: qinyi
created_at: 2026-08-19T06:45:00+00:00
change_name: 2026-08-19-runtime-live-daemon-read
wave: 13
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/runtime/page.tsx
goal: 页面文案反映实时 daemon 数据源
implementation: 标题改为「守护进程运行态」；副标题改为读取当前绑定守护进程 .sillyspec/；错误提示按 404/502/504/422 等 code 区分
acceptance: 页面不再显示「本地运行态 / 不作为长期事实源」
verify: frontend vitest 页面测试通过
constraints: 保留现有数据展示逻辑，只改文案与错误渲染
---

# task-13：更新 RuntimePage 文案与错误提示
