---
id: task-11
title: gen:types 同步 api-types.ts + openapi.json（覆盖：FR-07）
title_zh: 前端类型再生成 — 同步 platform_sync 两新端点 + 3 新 Pydantic 模型
author: qinyi
created_at: 2026-08-11 20:27:34
priority: P0
depends_on: [task-07]
blocks: []
requirement_ids: [FR-07]
allowed_paths:
  - frontend/src/lib/api-types.ts
  - backend/openapi.json
goal: >
  跑 pnpm gen:types 把 task-07 新增的两端点与 3 个 Pydantic 模型同步进 api-types.ts 与 openapi.json，禁止手写。
expects_from:
  task-07:
    - contract: PlatformSyncTokenCreateResponse
      needs: [token, workspace_id]
    - contract: ResolveByRootPathRequest
      needs: [root_path]
    - contract: ResolveByRootPathResponse
      needs: [workspace_id, token]
implementation:
  - 在主仓库根目录跑 pnpm gen:types（后端 dump_openapi 写 openapi.json + openapi-typescript 生成 api-types.ts）
  - 人工核对 api-types.ts 含两新端点路径类型与 3 个新模型字段齐全
  - 一同提交 api-types.ts + openapi.json，类型不落后后端
acceptance:
  - api-types.ts 出现 /workspaces/{workspace_id}/platform-sync-tokens 与 /workspaces/resolve-by-root-path 两端点类型
  - api-types.ts 含 PlatformSyncTokenCreateResponse / ResolveByRootPathRequest / ResolveByRootPathResponse 三模型且字段齐全
  - openapi.json 的 paths 与 components 同步包含上述端点与 schema
verify:
  - 主仓库根目录 pnpm gen:types 退出码 0 无报错
  - cd frontend && pnpm exec tsc --noEmit 通过
constraints:
  - 禁手写 api-types.ts，全量由 gen:types 产出
  - gen:types 前确认 node_modules 健康（pnpm exec tsc --version 能跑且 .bin 有 shim；半坏会报假 CSSProperties 错，用 pnpm install --force 修复）
  - 类型与后端 schema 同 change 内同步提交，不让类型落后后端形成债
  - 不改后端 schema（本任务只消费 task-07 产出）
---
