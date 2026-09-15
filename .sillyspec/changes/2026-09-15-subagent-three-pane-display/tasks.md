---
author: qinyi
created_at: 2026-09-15 17:22:00
---

# 任务清单（Tasks）— 会话子代理三分栏展示

> brainstorm 阶段粗拆；细化拆分以 plan.md 的 Wave/Task 为准。

- [x] task-01: SubagentPanelContext 新建（NEW:frontend/src/components/daemon/subagent-panel-context.ts）+ SubagentBlockView 紧凑卡片模式（turn-segment-views.tsx：有 context 渲染紧凑卡片无内联 children/点击上抛 toggle/无 context 旧内联回退）+ turn-segment-views.test.tsx 新用例
- [x] task-02: 对话视图过滤放宽（turn-timeline.tsx：子代理容器段进入对话流）+ turn-timeline-conversation-file-card.test.tsx 新用例
- [x] task-03: SubagentDetailPanel 新建（NEW:frontend/src/components/daemon/subagent-detail-panel.tsx：头部/正文 SegmentView 递归/嵌套切换/段失效自动关闭）+ SessionPanel 新可选 props（session-panel/index.tsx + session-panel-page.tsx：context 提供/根 flex 行/PanelResizer 宽度/handleJumpToSubagent 双路径）+ subagent-catalog.tsx activeId 高亮 (depends_on: task-01)
- [x] task-04: sessions-portal.tsx 槽位互斥接线（subagentView 状态/点文件清子代理/点子代理清文件/会话切换清零/SessionPanel props 装配）+ sessions-portal.test.tsx 新用例 (depends_on: task-03)
- [x] 验收返工 #1（design §13.1）: SubagentDetailPanel 任务指令块——装配器导出 dispatchPromptOfRaw（args.prompt 全文）+ 面板正文首块「📋 任务指令」+ detail-panel 2 用例
- [x] 验收返工 #2（design §13.2）: 父归属优先跨轮路由修「结束后仍显示运行中」——upsertTurn（实时）父段 DFS 路由 + logsToTurns（历史）regroupSubagentLogsByParent 重挂 + turn-state-subagent-routing 4 用例/runtime-session-helpers 3 用例
