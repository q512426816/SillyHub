---
id: task-07
title: 'frontend-sessionization'
title_zh: '前端会话化：sessionId 驱动 + 主体渲染 + 徽标 + 旧挂载移除'
author: qinyi
created_at: 2026-08-23 14:12:00
priority: P0
depends_on: [task-06]
blocks: []
requirement_ids: [FR-07, FR-08]
decision_ids: [D-004]
allowed_paths:
  - frontend/src/lib/agent-logs.ts
  - frontend/src/lib/query-keys.ts
  - frontend/src/components/daemon/agent-log-card.tsx
  - frontend/src/components/daemon/session-panel.tsx
  - frontend/src/components/sessions/session-list-panel.tsx
  - frontend/src/components/daemon/__tests__/agent-log-card.test.tsx
goal: >
  前端会话化三形态（design §3.4）：①普通会话尾部仅关联本会话的折叠条目；
  ②tool_report 会话（turn_count===0）主体=日志条目流+继续输入；③列表 🧾 徽标；
  并移除 workspace 级旧挂载（D-004）。原型 prototype-agent-activity-sessions.html。
implementation:
  - agent-logs.ts：listAgentLogs(sessionId)（query session_id）+ readAgentLogContent(entryId)；query-keys agentLogs 键改 sessionId 入参
  - agent-log-card.tsx：AgentLogCard 改 sessionId 驱动（折叠条目，形态沿用）；新增 AgentLogSessionBody（主体：全量 entries 气泡流 + 「查看内容」调内容端点内联展开 + 截断提示 + 二进制 409 文案展示）
  - session-panel.tsx：移除 workspace 级 streamFooter 挂载；session.turn_count===0 && origin==='tool_report' → 主体 AgentLogSessionBody（输入区保留，placeholder 引导）；否则对话流 + streamFooter 传关联条目
  - session-list-panel.tsx：origin=tool_report → 🧾「本地 Agent」徽标（brand 阶）+ harness chip；title 直接用后端 title
  - vitest：折叠条目 sessionId 驱动、主体渲染、徽标、旧挂载移除零残留、内容查看交互（mock）
acceptance:
  - 新旧用例全绿、daemon 目录零回归、tsc/lint 过；双主题正常
verify:
  - cd frontend && pnpm vitest run src/components/daemon && pnpm typecheck && pnpm lint
constraints:
  - 类型全走 api-types 生成物；移除挂载不留死代码（listAgentLogs workspace 语义清干净）
---

# task-07 补充说明
无。
