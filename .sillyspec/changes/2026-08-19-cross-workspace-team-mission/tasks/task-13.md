---
id: task-13
title: regenerate-api-types-after-backend-changes
title_zh: 后端OpenAPI变更后重新生成前端类型
author: qinyi
created_at: 2026-08-19 10:50:00
priority: P1
depends_on: [task-07]
blocks: [task-14, task-15]
requirement_ids: [FR-04, FR-07]
decision_ids: [D-005@v1]
allowed_paths:
  - backend/openapi.json
  - frontend/src/lib/api-types.ts
  - sillyhub-daemon/src/api-types.ts
  - frontend/scripts/gen-api-types.mjs
  - backend/scripts/dump_openapi.py
provides:
  - contract: openapi-types
    fields: [MissionCreateRequest_project_scope, MissionResponse_project_scope, MissionWorkerRun_target_workspace]
expects_from:
  task-07:
    - contract: project-mission-endpoints
      needs: [POST_projects_pid_missions, GET_projects_pid_missions]
goal: >
  后端新增 /projects/{pid}/missions 端点与 mission schema 扩展后，重新生成 OpenAPI 规范与前端 TypeScript 类型定义，确保前后端契约同步（design §7.1 / 验收 10）。
implementation:
  - cd backend，确认后端服务已启动且 OpenAPI 端点可访问（或直接调用内部生成）
  - 运行 pnpm gen:types（该命令调用 dump_openapi.py + openapi-typescript，按 project 约定需在主仓根目录执行）
  - 检查 backend/openapi.json 是否包含新增的 /api/projects/{project_id}/missions 端点定义
  - 检查 frontend/src/lib/api-types.ts 是否新增 CreateProjectMissionInput / ProjectMissionResponse 等类型
  - 检查 sillyhub-daemon/src/api-types.ts 是否同步更新（daemon 共享类型）
  - 如发现类型不完整或格式错误，手动修正 dump_openapi.py 或 openapi-typescript 配置后重跑
acceptance:
  - openapi.json 包含 POST /api/projects/{project_id}/missions 与 GET /api/projects/{project_id}/missions 完整 schema（含 scope_workspace_ids / project_id / anchor_workspace_id）
  - api-types.ts（两份）新增 MissionCreateRequest 扩展字段与 ProjectMission 相关类型
  - pnpm exec tsc --noEmit 在 frontend/ 与 sillyhub-daemon/ 均无类型错误（排除无关预存债）
verify:
  - pnpm gen:types（确认命令执行成功）
  - git diff backend/openapi.json frontend/src/lib/api-types.ts sillyhub-daemon/src/api-types.ts | head -50（预览变更）
constraints:
  - 必须在 task-07 完成后执行，否则类型定义不完整
  - 前端 node_modules 须健康（pnpm exec tsc --version 能跑），否则 gen:types 报假错
  - 如 gen:types 暴露本次改动无关的旧测试债（mock 缺字段），按惯例顺手补字段修复而非改回手写
---
