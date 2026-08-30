---
id: task-08
title: 抽 sanitizeSessionLogContent 共享纯函数 + renderLogContent/logsToTurns 改调
title_zh: 抽共享消息过滤纯函数并改调
author: qinyi
created_at: 2026-07-12 00:30:00
priority: P0
depends_on: []
blocks: [task-09, task-12, task-13]
requirement_ids: [FR-04]
decision_ids: [D-004]
allowed_paths:
  - frontend/src/components/daemon/runtime-session-helpers.tsx
  - frontend/src/components/daemon/interactive-session-panel.tsx
provides:
  - function: sanitizeSessionLogContent(content, channel)
goal: >
  把 renderLogContent 的过滤逻辑抽成共享纯函数 sanitizeSessionLogContent(content, channel)，renderLogContent 与 logsToTurns 共用（D-004）。
implementation:
  - 在 frontend/src/components/daemon/runtime-session-helpers.tsx 新增 export function sanitizeSessionLogContent(content: string, channel?: string): string
  - 从 frontend/src/components/daemon/interactive-session-panel.tsx:894 renderLogContent 抽出现有过滤逻辑：过滤 [SYSTEM…]/[RESULT…]/AskUserQuestion/[TOOL_RESULT] User answered、stderr→⚠️、tool_call→🔧、剥 [ASSISTANT|THINKING|LOG:\w+] 前缀
  - renderLogContent 改调 sanitizeSessionLogContent，行为与现状完全一致（零回归）
  - logsToTurns（runtime-session-helpers.tsx:587）对每条 content_redacted 先调 sanitizeSessionLogContent(entry.content_redacted ?? "", entry.channel) 再按 channel 分流并入 prompt（user_input）或 output
acceptance:
  - sanitizeSessionLogContent 纯函数存在且导出
  - renderLogContent 改调共享函数，实时 SSE 渲染行为零回归
  - logsToTurns 对每条 log 先 sanitize 再分流
verify:
  - cd frontend && pnpm tsc --noEmit
  - cd frontend && pnpm test -- interactive-session-panel
constraints:
  - renderLogContent 行为零回归（design §4.5 D-004：仅 logsToTurns 内联过滤会重复易分叉，故抽共享）
  - sanitize 是纯函数（无副作用、无 state）
  - logsToTurns 的内容重复修复在 task-12 单独处理，本任务只做过滤抽离
---

## 验收标准
- sanitizeSessionLogContent 纯函数存在且导出
- renderLogContent 改调共享函数，实时 SSE 渲染行为零回归
- logsToTurns 对每条 log 先 sanitize 再分流

## 验证步骤
- cd frontend && pnpm tsc --noEmit
- cd frontend && pnpm test -- interactive-session-panel
