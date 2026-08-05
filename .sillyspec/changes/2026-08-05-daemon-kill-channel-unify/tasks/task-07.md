---
id: task-07
title: budget backend 下发 + gen:types（覆盖 FR-05, D-005/D-009）
title_zh: budget_tokens 后端下发与类型生成
author: qinyi
created_at: 2026-08-05 19:24:02
priority: P1
depends_on: []
blocks: [task-08, task-09]
requirement_ids: [FR-05]
decision_ids: [D-005, D-009]
allowed_paths:
  - backend/app/modules/agent/execution.py
  - backend/app/modules/daemon/lease/context.py
  - backend/app/modules/daemon/lease_service.py
  - sillyhub-daemon/src/api-types.ts
  - frontend/src/lib/api-types.ts
  - backend/openapi.json
provides:
  - contract: LeaseCtx.budget_tokens
    fields: [budget_tokens]
goal: >
  backend claim payload（LeaseCtx）下发 budget_tokens（来自 AgentMission.budget_tokens），供 daemon 执行循环检查点使用，并同步 gen:types。
implementation:
  - 找到 claim payload 构造点 build_claim_payload（daemon/lease/context.py），经 lease metadata 或 execution dispatch 注入 budget_tokens
  - execution.py 的 dispatch_worker 和 batch dispatch 从 AgentMission.budget_tokens 填入 claim payload
  - 跑 pnpm gen:types 同步 daemon 和 frontend 的 api-types.ts 加 openapi.json
acceptance:
  - LeaseCtx claim payload 含 budget_tokens 字段
  - gen:types 无漂移（git diff --exit-code 为空）
  - budget_tokens 为 None 时不影响现有 dispatch 行为
verify:
  - cd backend && uv run pytest app/modules/daemon app/modules/agent -q --no-cov
  - 根目录 pnpm gen:types 后 git diff --exit-code 确认无漂移
constraints:
  - gen:types 前先确认 node_modules 健康（pnpm exec tsc --version 能跑，CLAUDE.md 规则20）
  - budget_tokens 为 None 时短路（brownfield 行为不变）
  - 不改 AgentMission.budget_tokens 字段本身（已存在 model.py:595）
---
