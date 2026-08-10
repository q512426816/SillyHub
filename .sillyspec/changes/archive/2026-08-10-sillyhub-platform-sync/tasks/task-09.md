---
id: task-09
title: gen:types sync openapi and module doc update
title_zh: gen:types 同步 openapi.json 与 backend 模块文档更新
author: qinyi
created_at: 2026-08-10 23:45:00
priority: P1
depends_on: [task-06]
blocks: []
requirement_ids: [NFR-04]
decision_ids: []
allowed_paths:
  - backend/openapi.json
  - .sillyspec/docs/multi-agent-platform/modules/backend.md
goal: >
  gen:types 同步 backend/openapi.json（platform_sync 3 端点 OpenAPI 完整，CLAUDE.md 规则 20）
  + backend 模块文档补 platform_sync 子模块说明。
implementation:
  - 先确认前端 node_modules 健康（CLAUDE.md 规则 20：pnpm exec tsc --version 能跑、.bin 有 shim；不健康先 pnpm install --force）
  - cd frontend && pnpm gen:types（从 backend openapi 生成 api-types.ts + 更新 backend/openapi.json）
  - 验证 backend/openapi.json 含 /api/changes/{name}/progress (POST)、/api/changes (GET)、/api/changes/{name}/progress (GET) 三个路径
  - api-types.ts 若生成 platform_sync 相关类型，确认无残留旧债（CLAUDE.md 规则 20：无关旧测试债顺手补）
  - 编辑 .sillyspec/docs/multi-agent-platform/modules/backend.md 补 platform_sync 子模块说明（3 端点 + platform_change_progress 表 + 鉴权复用 API Key）
acceptance:
  - backend/openapi.json 含 platform_sync 3 端点路径定义
  - gen:types 无报错（或只有无关旧债按惯例顺手补）
  - backend.md 模块文档含 platform_sync 说明
verify:
  - grep -c "/api/changes" backend/openapi.json（确认新端点入 OpenAPI）
  - cd frontend && pnpm exec tsc --version（node_modules 健康确认）
constraints:
  - gen:types 前先确认前端 node_modules 健康（CLAUDE.md 规则 20，避免假 CSSProperties 报错）
  - platform_sync 端点无前端消费，api-types.ts 可能不生成新类型——OpenAPI 完整即可
  - 无关旧测试债按惯例顺手补字段，不为躲报错改回手写（CLAUDE.md 规则 20）
  - 模块文档 backend.md 同步是 archive 前置（模块影响分析）
---
