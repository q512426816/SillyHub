---
id: task-12
author: qinyi
created_at: 2026-08-27 09:36:00
priority: P1
title: 后台卡片全生命周期 + agentTasks state 扩展
title_zh: 后台卡片全生命周期 + agentTasks state 扩展
depends_on: [task-10]
blocks: [task-14, task-15]
allowed_paths:
  - frontend/src/components/daemon/agent-task-card.tsx
  - frontend/src/components/daemon/session-panel.tsx
provides:
  - contract: card_lifecycle_ui
    fields: [running(正在做什么行/走秒/tokens/最后活跃), terminal(定格+服务端时长+summary), 状态机 running→completed/failed/stopped]
expects_from:
  - task: task-10
    contract: frontend_dispatch
    fields: [onAgentTaskStatus 扩展字段]
goal: |
  头部"后台"卡片从"永远转圈无进度"变为全生命周期展示（FR-06 / D-005@v1，视觉基准 prototype-background-subagent-progress.html 右列）。
implementation: |
  1. session-panel.tsx agentTasks state（:766）与 handler（:1160）扩展存储 last_tool_name/summary/elapsed_ms/total_tokens/tool_uses/async/terminalAt；终态事件到达后卡片定格（保留最近 6 条的既有清理语义）。
  2. agent-task-card.tsx：running 态显示"正在做什么"行（last_tool_name + summary 截断）、走秒（本地 tick + elapsed_ms 到达校准锚点）、tokens/工具次数；>5 分钟无 task_progress 更新显示橙色"最后活跃 X 分钟前"；百分比进度条仅在存在可信基准时显示（无则隐藏，不伪造）；终态定格（✓/✕/■ + 服务端 elapsed_ms 格式化 mm:ss + summary 首行）。
  3. 取色走 brand-*/success/error 语义阶（三主题适配，D-005@v1；对齐原型 token）。
acceptance: |
  模拟事件序列（running→progress×2→notification）驱动下卡片呈现原型右列形态；终态后不再转圈；旧事件（仅 running）不崩、退化为现状显示。
verify: |
  单测在 task-15；本任务 pnpm exec tsc --noEmit + eslint 该两文件。
constraints: |
  不动 session-panel 发送按钮（那是 task-14，避免同 Wave 冲突已隔 Wave）；每秒 tick 局部 state（FR-06 经济性，对齐 SubagentCatalog 先例）。
---
