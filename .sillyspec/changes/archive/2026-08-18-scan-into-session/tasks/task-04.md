---
id: task-04
title: sync-types-and-patch-daemon-session-mode
title_zh: 类型同步——pnpm gen:types 加 daemon.ts 手写 AgentSessionListItem 补 mode
author: qinyi
created_at: 2026-08-17 14:10:00
priority: P0
depends_on: [task-02, task-03]
blocks: [task-05, task-06]
requirement_ids: [FR-02, FR-07]
decision_ids: [D-001@v1]
allowed_paths:
  - frontend/src/lib/api-types.ts
  - backend/openapi.json
  - frontend/src/lib/daemon.ts
provides:
  - contract: ScanGenerateResponse
    fields: [session_id]
  - contract: AgentSessionListItem
    fields: [mode]
expects_from:
  task-02:
    - contract: ScanGenerateResponse
      needs: [session_id]
  task-03:
    - contract: AgentSessionListItem
      needs: [mode]
goal: >
  task-02 的 session_id 与 task-03 的 mode 落库后，在 frontend 目录跑 pnpm gen:types 同步生成并提交 api-types.ts 与 openapi.json，再手改 daemon.ts 的 AgentSessionListItem 补 mode，覆盖 FR-02 与 FR-07，遵守 CLAUDE.md 规则 21 不留类型债。
implementation:
  - 确认 node_modules 健康（pnpm exec tsc --version 可跑，半坏先 pnpm install --force）后 cd frontend 跑 pnpm gen:types，脚本先刷 backend/openapi.json 再生成 frontend/src/lib/api-types.ts，并核对 ScanGenerateResponse 含 session_id、AgentSessionListItem 含 mode
  - 手改 frontend/src/lib/daemon.ts 的 AgentSessionListItem 补 mode（string 或 null）与生成类型对齐，提交 api-types.ts、openapi.json 与 daemon.ts 改动
acceptance:
  - api-types.ts 中 ScanGenerateResponse 含 session_id 且 AgentSessionListItem 含 mode（gen:types 生成，非手写）
  - daemon.ts 手写 AgentSessionListItem 与生成类型同步补了 mode
  - pnpm exec tsc --noEmit 通过，无新增类型错误
verify:
  - cd frontend 后依次执行 pnpm exec tsc --version 验环境、pnpm gen:types 重新生成、pnpm exec tsc --noEmit 校验
constraints:
  - api-types.ts 与 openapi.json 禁止手写，必须由 pnpm gen:types 产出（CLAUDE.md 规则 21）；gen:types 前先确认 node_modules 健康，半坏会报假 CSSProperties 错误需 pnpm install --force 修复
  - daemon.ts 只补 mode 字段不动其他字段语义；本任务不修改任何后端源码
related_tests: 无（类型文件，前端测试 mock 若精确匹配字段由 task-09 处理）
---
