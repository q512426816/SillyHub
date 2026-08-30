---
id: task-13
title: runtime-session-dialog 交互测试 + change-session-section 回归
title_zh: 弹窗交互测试与变更会话区块回归
author: qinyi
created_at: 2026-07-12 00:30:00
priority: P0
depends_on: [task-10, task-11]
blocks: []
requirement_ids: [FR-02, FR-03]
decision_ids: [D-002, D-005]
allowed_paths:
  - frontend/src/components/daemon/__tests__/runtime-session-dialog.test.tsx
  - frontend/src/components/changes/__tests__/change-session-section.test.tsx
provides:
  - test: runtime_session_dialog_interactions
  - test: change_session_section_regression
goal: >
  新增 runtime-session-dialog 交互测试（点 ended 会话直接进 panel 续聊/删除触发 onDelete/新建切 idle），跑 change-session-section 既有测试确保零回归。
implementation:
  - 新建 frontend/src/components/daemon/__tests__/runtime-session-dialog.test.tsx：
    - 点 ended 会话：先调 reopenSession 再 attach（断言 reopenSession 被调用），进 InteractiveSessionPanel 续聊
    - 点 active 会话：直接 attach，不调 reopenSession
    - 点删除按钮：触发 onDelete，会话从列表消失，selected 若为该项则清空
    - 点新建会话：进 idle 新建态（focusProvider 锁定）
    - 无 selected：渲染 idle panel，不渲染「返回历史」栏
  - change-session-section 既有测试回归：除 ended/failed 现支持直接续聊外，其余行为零回归
  - 若 SessionListLayout 内用 markdown 动态渲染，测试顶部 vi.mock 成纯文本（jsdom 坑）
acceptance:
  - runtime-session-dialog 测试覆盖：ended 会话先 reopen 再 attach、active 直接 attach、删除回调、新建切 idle、无返回栏
  - change-session-section 既有测试全绿（零回归，除 ended/failed 续聊新行为）
verify:
  - cd frontend && pnpm test -- runtime-session-dialog
  - cd frontend && pnpm test -- change-session-section
constraints:
  - F-1/C-3：dialog 测试必须断言 ended/failed 会话点开时 reopenSession 被调用（对应 R-2，验证 D-002）
  - jsdom 下 MarkdownText 动态渲染 null 坑（记忆 [[frontend-markdown-text-jsdom-null]]），vi.mock 成纯文本
  - 不修改被测组件（task-10/11 产物）来迁就测试
---

## 验收标准
- runtime-session-dialog 测试覆盖：ended 会话先 reopen 再 attach、active 直接 attach、删除回调、新建切 idle、无返回栏
- change-session-section 既有测试全绿（零回归，除 ended/failed 续聊新行为）

## 验证步骤
- cd frontend && pnpm test -- runtime-session-dialog
- cd frontend && pnpm test -- change-session-section
