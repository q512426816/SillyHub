---
id: task-07
title: mission-console team 配置面板（主 agent 类型/模型 + worker 列表）+ lib/agent.ts 透传
title_zh: 团队配置 UI 与类型透传
author: qinyi
created_at: 2026-07-12 13:04:06
priority: P0
depends_on: [task-02]
blocks: [task-09]
requirement_ids: [FR-2, FR-6]
decision_ids: [D-002@v2, D-003@v2]
allowed_paths:
  - frontend/src/components/mission-console.tsx
  - frontend/src/lib/agent.ts
provides:
  - contract: CreateMissionInput
    fields: [worker_preset, main_agent_config]
expects_from:
  task-02:
    - contract: AgentMission
      needs: [worker_preset, main_agent_config]
goal: >
  mission-console 加 team 配置面板（主 agent 类型/模型 + worker 列表编辑），lib/agent.ts
  CreateMissionInput 透传 worker_preset/main_agent_config。
implementation:
  - mission-console.tsx 加 team 配置面板（主 agent 类型/模型选择 + worker 列表[类型/模型/任务/role]，照前端样式系统原型）
  - lib/agent.ts CreateMissionInput 加 worker_preset + main_agent_config 字段
  - 复用 v1 Wave1 mode 双卡片（task-01 apply），team 选中时展开配置面板
acceptance:
  - team 面板可配主 agent 类型/模型 + 增删 worker 行
  - CreateMissionInput 携带 worker_preset/main_agent_config 调 create_mission
  - 样式照原型（CLAUDE.md 规则 17）
verify:
  - cd frontend && pnpm test src/components/mission-console
  - cd frontend && pnpm typecheck
constraints:
  - 复用 v1 mode 双卡片（不重写 mode 选择）
  - worker_preset/main_agent_config schema 对齐 task-02
  - 中文 UI（CLAUDE.md 规则 12）
---
