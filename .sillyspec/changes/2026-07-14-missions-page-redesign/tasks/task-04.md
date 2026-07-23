---
id: task-04
title: Wrap TeamConfigPanel in collapsed details, default empty workers
title_zh: 高级配置折叠，分身默认自动拆
author: qinyi
created_at: 2026-07-14 10:34:25
priority: P1
depends_on: [task-01]
blocks: []
requirement_ids: [FR-3]
decision_ids: [D-002@v1]
allowed_paths:
  - frontend/src/components/mission-console.tsx
goal: |
  将 TeamConfigPanel 包进 `<details>` 默认 close（summary「高级：手动配分身（默认不用动）」），workers state 初始改为空数组，默认由主 agent 自动拆分身，展开后用户才手动预设。
implementation:
  - workers state 初始值从 `[makeEmptyWorker()]`（mission-console.tsx:606-608）改为空数组 `[]`。
  - 将 TeamConfigPanel 渲染处（mission-console.tsx:776-789，task-01 删 mode 分支后）改为始终渲染，但外层包 `<details>`（默认 close）。
  - summary 文案改为「高级：手动配分身（默认不用动）」。
  - 删除 mode 删除后遗留的「⚠️ team 模式将拆分 N 个 worker…」amber 警告条（mission-console.tsx:784-788）或调整为通用提示（默认空数组 → 主 agent 自动拆）。
  - onCreate 成功后 workers 重置为空数组 []（配合 task-01）。
  - mainAgentConfig 仍始终随 onCreate 传递（DEFAULT_MAIN_AGENT_CONFIG 默认值，即使高级折叠不展开也传，design §7 G2）。
acceptance:
  - TeamConfigPanel 默认折叠，进页面不展开（用户需点 summary 才展开）。
  - workers state 初始为空数组（不预填 makeEmptyWorker）。
  - 不展开高级折叠时，onCreate 仍传 main_agent_config（默认值）+ worker_preset（[]）。
  - 展开高级折叠后可手动添加 worker（TeamConfigPanel 内部增删逻辑不变）。
  - summary 文案为「高级：手动配分身（默认不用动）」中文。
verify:
  - cd frontend && pnpm typecheck
  - cd frontend && pnpm test
constraints:
  - 后端零改动（worker_preset 空数组 → 主 agent 自动拆，后端 OrchestratorService 已支持）。
  - main_agent_config 始终传递（即使高级折叠不展开，design §7 G2）。
  - TeamConfigPanel 内部增删 worker / 编辑字段逻辑不变。
  - 文案中文，summary 不出现 "Worker"/"team"/"agent" 英文黑话。
  - 不破坏现有 mainAgentConfig / workers state 类型与更新回调。
---
