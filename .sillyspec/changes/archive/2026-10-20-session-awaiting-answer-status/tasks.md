---
author: flow-machine-draft
created_at: 2026-10-22T15:59:16.975Z
---
# 任务注册表（Tasks）— 2026-10-20-session-awaiting-answer-status

- [x] task-01: backend schema.py `AgentSessionRead` 加 `pending_dialog_kind` + session_crud.py 列表端点批查注入（窗口函数取每会话最新 pending 行），新增 test_sessions_list_pending_dialog.py 覆盖注入/answered 不注入/无对话 None/批查；跑绿
- [x] task-02: frontend api-types.ts gen:types 同步（字段经生成版 Omit 自动进入 AgentSessionRead 消费类型，session-lists.ts 零改动）；sessionStatusIndicator 新增 question 形态与判定序（failed/ended → question → run 状态 → 活性），SessionStatusSlot 渲染问号字形，并列导出；新增 session-status-indicator.test.tsx 覆盖问号/优先级；跑绿
- [x] task-03: 零回归用例——指示器 None 时既有五分类断言 + 列表端点无对话为 None；tsc + 触及面测试全绿
- [x] task-04: 全量回归：backend daemon 触及面 + frontend vitest 触及面 + lint，结果记入本变更
