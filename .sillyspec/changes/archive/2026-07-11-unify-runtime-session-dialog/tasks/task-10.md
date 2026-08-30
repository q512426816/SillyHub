---
id: task-10
title: RuntimeSessionDialog 重构（SessionListLayout + 二态化 + ended/failed reopen）
title_zh: runtimes 弹窗重构对齐变更会话样式并直接续聊
author: qinyi
created_at: 2026-07-12 00:30:00
priority: P0
depends_on: [task-05, task-07, task-08]
blocks: [task-13]
requirement_ids: [FR-02]
decision_ids: [D-001, D-002, D-005]
allowed_paths:
  - frontend/src/components/daemon/runtime-session-dialog.tsx
provides:
  - behavior: runtime_session_dialog_two_state_attach
  - behavior: ended_failed_reopen_before_attach
goal: >
  RuntimeSessionDialog 左侧换 SessionListLayout（带删除按钮），右侧三态简化为二态（selected→panel attach / 无 selected→idle），删只读回看分支，ended/failed 先 reopenSession 再 attach。
implementation:
  - frontend/src/components/daemon/runtime-session-dialog.tsx 左侧用 <SessionListLayout> 替换 SessionsSidebar
  - items = visibleSessions.map(s => ({ id, title: s.title ?? null, statusBadge: s.status, secondaryText: `${getProviderLabel(s.provider)} · ${s.turnCount} 轮`, lastActiveAt: s.last_active_at }))（D-005）
  - 传 onDelete={handleDelete}
  - 右侧简化为二态：selected（任意状态）→ <InteractiveSessionPanel key={selected.id} attachSessionId={selected.id} initialTurns={logsToTurns(logs)} focusProvider... />；无 selected → idle 新建态 panel
  - 删除 SessionHistoryView 分支与「返回历史」按钮栏
  - handleSelect 统一：点任意会话 → setSelected(session) + 拉 logs 预填；active/pending/reconnecting 直接 attach；ended/failed 先调 reopenSession(session.id) 转 reconnecting/active 再 attach（合并原 handleContinue 的 reopen 逻辑）
  - header 保留「会话 · {runtime 名}」+「刷新会话」
acceptance:
  - 左侧渲染 SessionListLayout（带删除按钮，secondaryText=提供方·轮数）
  - 右侧无「返回历史」栏，selected 时直接挂 InteractiveSessionPanel attach
  - 点 active/pending/reconnecting 会话直接 attach 续聊
  - 点 ended/failed 会话先 reopenSession 再 attach（不卡 panel 轮询超时）
  - 点新建会话进 idle 新建态（focusProvider 锁定本 runtime 的 provider）
  - 删除按钮触发 onDelete，会话从列表消失，selected 若为该项则清空
verify:
  - cd frontend && pnpm tsc --noEmit
  - cd frontend && pnpm test -- runtime-session-dialog
constraints:
  - F-1/C-3（可行性 P0）：panel attach 轮询仅识别 active/failed（interactive-session-panel.tsx:314-324），ended 必须 reopenSession 转 reconnecting/active 再 attach，否则卡超时回退 failed
  - R-5：reopen 失败（SDK 上下文失效）时 panel 转 failed + errorMsg「会话恢复失败，可能上下文已失效」（可接受，与现状 reopen 失败一致）
  - 不删 SessionHistoryView / SessionsSidebar helper 文件（design §3 非目标，保留潜在引用，仅弹窗内不再用）
  - URL ?session= 恢复点机制不变（design §3 非目标）
---

## 验收标准
- 左侧渲染 SessionListLayout（带删除按钮，secondaryText=提供方·轮数）
- 右侧无「返回历史」栏，selected 时直接挂 InteractiveSessionPanel attach
- 点 active/pending/reconnecting 会话直接 attach 续聊
- 点 ended/failed 会话先 reopenSession 再 attach（不卡 panel 轮询超时）
- 点新建会话进 idle 新建态（focusProvider 锁定本 runtime 的 provider）
- 删除按钮触发 onDelete，会话从列表消失，selected 若为该项则清空

## 验证步骤
- cd frontend && pnpm tsc --noEmit
- cd frontend && pnpm test -- runtime-session-dialog
