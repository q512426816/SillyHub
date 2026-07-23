---
id: task-08
title: stage team 配置 + 会话「用团队分析」+ team 进度组件
title_zh: 三入口 UI（stage / 会话）与进度展示
author: qinyi
created_at: 2026-07-12 13:04:06
priority: P1
depends_on: [task-02, task-07]
blocks: [task-09]
requirement_ids: [FR-8]
decision_ids: []
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx
  - frontend/src/components/daemon/interactive-session-panel.tsx
  - frontend/src/components/team-progress.tsx
expects_from:
  task-02:
    - contract: AgentMission
      needs: [worker_preset]
  task-07:
    - contract: CreateMissionInput
      needs: [worker_preset, main_agent_config]
goal: >
  execute/verify stage 加 team 配置（worker 预设），会话面板加「用团队分析」绑 session，
  新组件 team-progress 展示主 agent 决策日志 + worker 进度 + CostBar。
implementation:
  - changes/[cid]/page.tsx：execute+verify stage 加 team toggle + worker 预设（复用 v1 task-01 toggle）
  - interactive-session-panel.tsx：加「用团队分析」按钮 → create_mission 绑 session_id
  - 新建 team-progress.tsx：主 agent 决策日志 + worker 进度 + CostBar（复用 mission-console 的 WorkerRow/CostBar）
acceptance:
  - execute/verify stage 可配 worker 预设
  - 会话点「用团队分析」建 mission 绑 session
  - team-progress 实时展示主 agent 决策 + worker 进度 + cost
verify:
  - cd frontend && pnpm test src/components/team-progress src/components/daemon/interactive-session-panel
  - cd frontend && pnpm typecheck
constraints:
  - 复用 mission-console 组件（WorkerRow/CostBar）降复杂度
  - stage team 只 execute+verify（v1 D-002，brainstorm/plan 不 team）
  - 中文 UI
---
