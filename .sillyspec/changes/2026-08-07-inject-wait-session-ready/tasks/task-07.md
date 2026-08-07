---
id: task-07
title: openapi.json gen:types dump
title_zh: 重新导出 openapi 含 ready 端点
author: WhaleFall
created_at: 2026-08-07 14:32:00
priority: P1
depends_on:
  - task-06
blocks:
  - task-04
requirement_ids:
  - FR-02
decision_ids: []
allowed_paths:
  - backend/openapi.json
  - frontend/src/lib/api-types.ts
expects_from: {}
goal: >
  把 task-06 新增的 POST /ready 端点重新导出到 backend/openapi.json，避免前端 api-types.ts 落后后端 schema 形成类型债（CLAUDE.md 规则 20）。
implementation:
  - 确认 task-06 已落地 router.py POST /api/daemon/sessions/{session_id}/ready 端点（路由能被 FastAPI app.openapi() 收集）
  - 在 frontend 目录跑 pnpm gen:types（脚本会先在 backend 跑 uv run python scripts/dump_openapi.py 刷新 openapi.json，再用 openapi-typescript 生成 api-types.ts，一条命令完成 dump + 生成）
  - 确认 backend/openapi.json 含新路径（grep /ready），并确认 frontend/src/lib/api-types.ts 同步生成（task-04 范畴，本任务只保证 openapi.json 已 dump）
  - 提交产物 backend/openapi.json（如 task-04 在同 PR 也一并提交 api-types.ts）
acceptance:
  - backend/openapi.json 含 POST /api/daemon/sessions/{session_id}/ready 路径
  - openapi.json 与 api-types.ts 生成产物已纳入提交（不手写）
  - 不手改 openapi.json（必须由 dump_openapi.py 生成）
verify:
  - 跑 pnpm gen:types 后 grep -n "/ready" backend/openapi.json 命中新路径
  - 对比 git diff 确认 openapi.json 仅新增 /ready 相关 paths/schemas，无意外回归
constraints:
  - 禁止手写或手改 openapi.json（必须 dump_openapi.py 生成）
  - gen:types 前确认前端 node_modules 健康（pnpm exec tsc --version 能跑、.bin/openapi-typescript shim 在）；半坏时 pnpm install --force 重建 shim，不误判成包坏了
  - 本任务纯 schema 同步，不改任何后端 / daemon 源码
  - gen:types 在 frontend 目录跑（脚本内已解析 backend 兄弟路径），不在 worktree 跑
---
