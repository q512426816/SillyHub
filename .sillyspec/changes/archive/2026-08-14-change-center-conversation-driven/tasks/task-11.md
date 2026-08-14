---
id: task-11
title: gen:types + full-stack test consolidation
title_zh: gen:types + 全端测试验收收口
author: qinyi
created_at: 2026-08-14 15:46:49
priority: P0
depends_on: [task-01, task-02, task-03, task-04, task-05, task-06, task-07, task-08, task-09, task-10]
blocks: [task-12]
requirement_ids: [FR-06a]
decision_ids: [D-001@v1, D-005@v1]
allowed_paths:
  - frontend/src/lib/api-types.ts
  - backend/openapi.json
goal: >
  收口：backend schema 改动后跑 pnpm gen:types 同步 api-types.ts + openapi.json；全端测试跑绿
  （pytest 重点用例：scoped 零删除/双兜底路径/绑定 SQL/审批不派发/投影收敛/注入三类降级/端点删除
  回归；vitest：会话页/空态/详情页/审批卡）。TDD 用例随各 task 先行，此处收口验证。
implementation:
  - 确认 frontend node_modules 健康（pnpm exec tsc --version 能跑、.bin 有 shim；半坏会报假的
    CSSProperties/Cannot find module，修复用 pnpm install --force）
  - 跑 pnpm gen:types（backend schema 已改：SpecIncrementalSyncRequest.change_dirs、审批请求
    notify_session、响应 notified_session/notify_error、AgentSessionListItem 等），提交 api-types.ts +
    backend/openapi.json
  - 若 gen:types 暴露与本变更无关的旧测试债（如 mock 缺字段），按惯例顺手补字段修好，不改为手写
  - 全量跑后端 pytest（重点模块：change/spec_workspace/agent/mcp_gateway/change_writer）+ 前端
    vitest + typecheck + lint；修复各 task 遗留的测试债
  - 核对各 task review.json 已就位（plan 全勾）+ 代码证据非零变更
acceptance:
  - api-types.ts 含本次新增字段（change_dirs/notify_session/notified_session/notify_error/
    include_ended），openapi.json 同步
  - 后端重点模块 pytest 全绿；前端 vitest 全绿；typecheck/lint 通过
  - 无手写 api-types（gen:types 生成）
verify:
  - cd frontend && pnpm exec tsc --version （先验 node_modules 健康）
  - pnpm gen:types && cd frontend && pnpm test && pnpm typecheck && pnpm lint
  - cd backend && uv run pytest app/modules/change app/modules/spec_workspace app/modules/agent app/modules/mcp_gateway app/modules/change_writer -q --no-cov
constraints:
  - 禁止手写 api-types.ts（CLAUDE.md 规则 20）；gen:types 必须跑
  - node_modules 半坏先 pnpm install --force，勿误判代码问题
  - 与 spec-sync-visibility 的 gen:types 冲突（若其改 schema）按合并协调
---
