---
schema_version: 1
doc_type: task
id: task-14
title: Update frontend runtime tests
title_zh: 更新前端 runtime 测试
author: qinyi
created_at: 2026-08-19T06:45:00+00:00
change_name: 2026-08-19-runtime-live-daemon-read
wave: 14
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/runtime/page.test.tsx
goal: 前端测试与新文案/错误码对齐
implementation: 新增或更新 page.test.tsx，mock API 返回各种 Runtime 错误
acceptance: vitest 页面测试全绿；snapshot 更新
verify: cd frontend && pnpm exec vitest run src/app/(dashboard)/workspaces/[id]/runtime
constraints: 非测试逻辑有误时不改测试断言来通过
---

# task-14：更新前端 runtime 测试
