---
id: task-09
title: SessionListLayout 单测 + logsToTurns 标记过滤单测
title_zh: 公共件单测覆盖列表组件与标记过滤
author: qinyi
created_at: 2026-07-12 00:30:00
priority: P0
depends_on: [task-07, task-08]
blocks: []
requirement_ids: [FR-01, FR-04]
decision_ids: [D-001, D-004]
allowed_paths:
  - frontend/src/components/daemon/__tests__/session-list-layout.test.tsx
  - frontend/src/components/daemon/__tests__/runtime-session-helpers.test.tsx
provides:
  - test: session_list_layout
  - test: logs_to_turns_marker_filter
goal: >
  为 SessionListLayout 写单测（选中高亮/删除回调/空态/error 重试），为 logsToTurns 写标记过滤单测（[SYSTEM:thinking_tokens]/[THINKING]/AskUserQuestion 必须被过滤）。
implementation:
  - 新建 frontend/src/components/daemon/__tests__/session-list-layout.test.tsx：
    - 选中项渲染 border-l-[3px] border-blue-600 bg-blue-50
    - 点击项触发 onSelect(id)
    - 传 onDelete 时点击删除触发 onDelete(id)，不传时无删除按钮
    - items 为空显示「暂无会话，新建一个开始提问」
    - error 非空显示错误文案 + 重试按钮触发 onRetry
    - title 为 null 时渲染 shortId(id)
  - 在 runtime-session-helpers 测试中加 logsToTurns 标记过滤单测：
    - [SYSTEM:thinking_tokens] 48 类标记被过滤不进 turn
    - [THINKING] 前缀被剥离
    - AskUserQuestion / [TOOL_RESULT] User answered 被过滤
    - user_input log 进 prompt，assistant/tool 输出进 output
acceptance:
  - SessionListLayout 单测覆盖选中高亮/删除回调/空态/error 重试/shortId 兜底
  - logsToTurns 标记过滤单测覆盖 [SYSTEM:thinking_tokens]/[THINKING]/AskUserQuestion 必须被过滤
  - user_input/output 分流正确
verify:
  - cd frontend && pnpm test -- session-list-layout
  - cd frontend && pnpm test -- runtime-session-helpers
constraints:
  - 注意 MarkdownText jsdom 渲染 null 坑（记忆 [[frontend-markdown-text-jsdom-null]]）：若 SessionListLayout 内用到 markdown 动态渲染，测试顶部 vi.mock 成纯文本
  - vitest 静默 console.error（记忆 [[react-query-migration-status]] v5 hook 测试坑）
  - 单测覆盖 design §9 C-5 两边 secondaryText 语义由调用方拼的边界
---

## 验收标准
- SessionListLayout 单测覆盖选中高亮/删除回调/空态/error 重试/shortId 兜底
- logsToTurns 标记过滤单测覆盖 [SYSTEM:thinking_tokens]/[THINKING]/AskUserQuestion 必须被过滤
- user_input/output 分流正确

## 验证步骤
- cd frontend && pnpm test -- session-list-layout
- cd frontend && pnpm test -- runtime-session-helpers
