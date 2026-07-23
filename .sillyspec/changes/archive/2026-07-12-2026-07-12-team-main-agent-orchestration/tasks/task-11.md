---
id: task-11
title: 三重收敛完整逻辑 + budget_usd 硬截断 + CostBar 聚合
title_zh: 收敛与成本控制
author: qinyi
created_at: 2026-07-12 13:04:06
priority: P0
depends_on: [task-09]
blocks: []
requirement_ids: [FR-5]
decision_ids: [D-006@v2]
allowed_paths:
  - backend/app/modules/agent/orchestrator.py
  - frontend/src/components/team-progress.tsx
expects_from:
  task-03:
    - contract: OrchestratorService
      needs: [converge_skeleton]
  task-04:
    - contract: ConvergeMission
      needs: [force_converge]
goal: >
  三重收敛完整（worker 全完 / 主 agent 判断 / 预算超时）+ budget_usd 硬截断 + CostBar
  实时聚合展示。
implementation:
  - OrchestratorService 三重收敛：所有 worker done/failed / 主 agent tool_call converge_mission / budget_usd 触顶或超时
  - budget_usd 硬截断：mission 级 cost 监控，触顶强制 converge（task-04 force_converge）
  - CostBar 展示：主 agent cost + 各 worker cost 聚合（前端 team-progress 实时）
acceptance:
  - 三重收敛任一触发即收敛（AC-6）
  - budget 触顶强制收敛（不超预算）
  - CostBar 实时展示总 cost + 各 agent 分项
verify:
  - cd backend && uv run pytest app/modules/agent/tests/test_orchestrator -q --no-cov -k converge
  - cd frontend && pnpm test src/components/team-progress
constraints:
  - 收敛逻辑基于 task-03 骨架（不重写）
  - budget 监控不阻塞主 agent（异步检查）
  - 超时硬截断用 mission.budget_usd（P2-1 独立任务深化 kill 全实现）
---
