---
id: task-11
title: ChangeSessionSection 改用 SessionListLayout + ended/failed reopen
title_zh: 变更会话区块改用公共列表组件并支持 ended/failed 续聊
author: qinyi
created_at: 2026-07-12 00:30:00
priority: P0
depends_on: [task-05, task-07]
blocks: [task-13]
requirement_ids: [FR-03]
decision_ids: [D-001, D-002]
allowed_paths:
  - frontend/src/components/changes/change-session-section.tsx
provides:
  - behavior: change_session_section_shared_layout
goal: >
  ChangeSessionSection 左侧内联 aside 替换为 SessionListLayout（不传 onDelete，secondaryText=作者·提供方），右侧 InteractiveSessionPanel 不变，同步加 ended/failed 先 reopen 再 attach。
implementation:
  - frontend/src/components/changes/change-session-section.tsx 左侧内联 <aside> 替换为 <SessionListLayout>
  - 不传 onDelete；secondaryText = `${s.author?.display_name ?? "未知成员"} · ${getProviderLabel(s.provider)}`（design §5 Phase3）
  - 右侧 InteractiveSessionPanel 不变
  - handleSelect 对 ended/failed 先 reopenSession 再 setActiveSessionId（Grill F-1：与 dialog 一致修同样 attach 卡死问题）
  - 复用 task-05 的 list_change_sessions title 字段
acceptance:
  - 左侧渲染 SessionListLayout（无删除按钮，secondaryText=作者·提供方）
  - 点 ended/failed 会话先 reopenSession 再 attach（不卡 panel 轮询超时）
  - 变更会话区块既有行为零回归（除 ended/failed 现支持直接续聊）
verify:
  - cd frontend && pnpm tsc --noEmit
  - cd frontend && pnpm test -- change-session-section
constraints:
  - F-1/C-3（可行性 P0）：ended/failed 必须先 reopenSession 再 attach，panel 轮询仅识别 active/failed
  - R-6：改造引入回归风险，仅改左侧列表与 handleSelect reopen，既有 change-session-section 测试必须回归通过
  - secondaryText 与 runtimes 弹窗语义不同（作者·提供方 vs 提供方·轮数），由调用方拼（design §9 C-5）
  - ChangeSessionSection reopen 依赖后端 list 返回 status（AgentSessionListItem.status 已返回，reopenSession 端点已存在，design §9 C-8，无需后端新增）
---

## 验收标准
- 左侧渲染 SessionListLayout（无删除按钮，secondaryText=作者·提供方）
- 点 ended/failed 会话先 reopenSession 再 attach（不卡 panel 轮询超时）
- 变更会话区块既有行为零回归（除 ended/failed 现支持直接续聊）

## 验证步骤
- cd frontend && pnpm tsc --noEmit
- cd frontend && pnpm test -- change-session-section
