---
id: task-09
title: 三入口接通 + mode 分流（single→v1 / team→v2）+ verify gate 策略 A
title_zh: 三入口打通与 mode 分流
author: qinyi
created_at: 2026-07-12 13:04:06
priority: P0
depends_on: [task-03, task-06, task-07, task-08]
blocks: [task-10, task-11]
requirement_ids: [FR-7, FR-8, FR-9]
decision_ids: [D-004@v2]
allowed_paths:
  - backend/app/modules/agent/router.py
  - backend/app/modules/change/dispatch.py
  - backend/app/modules/agent/mcp_tools.py
  - frontend/src/components/mission-console.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx
provides:
  - contract: ModeDispatch
    fields: [single_to_v1, team_to_v2, fallback_hook]
  - contract: GateMerge
    fields: [strategy_A]
expects_from:
  task-03:
    - contract: OrchestratorService
      needs: [team_mission_entry]
  task-07:
    - contract: CreateMissionInput
      needs: [worker_preset, main_agent_config]
goal: >
  mission 页 / execute·verify stage / 会话 三入口接通 mode 分流，verify gate 复用
  v1 D-005 策略 A 合并。
implementation:
  - backend mode 分流：single → v1 原路径（CoordinatorPlanner），team → v2 OrchestratorService
  - 前端三入口都透传 mode + worker_preset（mission 页 / stage toggle / 会话按钮）
  - verify stage gate：merge_gate_results（策略 A：全 exit=0 才过，任一非 0 取最严重，exit 2 优先 exit 1）
  - session 入口：主 agent 绑 session_id（task-08）
acceptance:
  - 三入口 mode=team 都走 OrchestratorService
  - mode=single 三入口都走 v1 原路径（零回归）
  - verify team gate 按策略 A 合并（全过推进 archive，任一失败打回 execute）
verify:
  - cd backend && uv run pytest app/modules/agent/tests/ app/modules/change/tests/ -q --no-cov -k "team or gate"
  - cd frontend && pnpm test
constraints:
  - mode=single 零回归（FR-9 守护）
  - verify gate 策略 A 复用 v1 D-005（merge_gate_results helper）
  - brainstorm/plan stage 不 team（v1 D-002 沿用）
---
