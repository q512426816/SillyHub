---
id: task-15
author: qinyi
created_at: 2026-08-27 09:36:00
priority: P1
title: frontend 单测（卡片 / assembler / collectSubagents / 目录）
title_zh: frontend 单测（卡片 / assembler / collectSubagents / 目录）
depends_on: [task-11, task-12, task-13]
blocks: []
allowed_paths:
  - frontend/src/components/daemon/__tests__/agent-task-card-lifecycle.test.tsx
  - frontend/src/components/daemon/__tests__/task-line-assembler.test.ts
  - frontend/src/components/daemon/__tests__/subagent-async-derive.test.tsx
  - frontend/src/components/daemon/__tests__/
provides: []
expects_from:
  - task: task-11
    contract: task_segment_metadata
    fields: [元数据字段]
  - task: task-12
    contract: card_lifecycle_ui
    fields: [状态机与展示]
goal: |
  FR-06/07 的前端验收测试。
implementation: |
  1. agent-task-card-lifecycle.test.tsx：渲染卡片喂事件序列（running→progress→notification completed/failed），断言"正在做什么"行、走秒锚点校准、终态定格（图标/时长文案/summary）、最后活跃警示（fake timers 推进 5min+）。
  2. task-line-assembler.test.ts：日志序列含 [TASK_*] 行 → 段元数据正确；坏 JSON 行降级文本不崩；无前缀序列输出与旧版快照一致（回归）。
  3. subagent-async-derive.test.tsx：collectSubagents 对 async 段返回 running+走秒、终态段返回服务端时长；前台段走原推导；SubagentCatalog 行渲染时长口径。
acceptance: |
  三个新文件用例全绿；既有 turn-status-bar / subagent-catalog / session-log-assembler 相关测试回归绿。
verify: |
  cd frontend && pnpm vitest run src/components/daemon/__tests__/agent-task-card-lifecycle.test.tsx src/components/daemon/__tests__/task-line-assembler.test.ts src/components/daemon/__tests__/subagent-async-derive.test.tsx + 相关既有测试文件。
constraints: |
  vitest + @testing-library/react + fake timers；jsdom 环境；不跑全量（规则 0）；antd 组件断言注意 autoLetterSpacing/getByRole 已知坑（testing-gotchas）。
---
