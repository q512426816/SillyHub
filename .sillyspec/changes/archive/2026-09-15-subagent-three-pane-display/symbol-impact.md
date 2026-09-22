# 符号影响面报告 — 2026-09-15-subagent-three-pane-display

> execute 前缀步「加载上下文」产物；逐 task 一行结论（签名级变更 + 受影响调用点 + 是否在任务范围内）。仓库源码以 worktree（base 2bd40f60）为准 grep 实测。

## 各任务结论

- **task-01**：无对外签名级变更——新增导出（subagent-panel-context.ts 的 SubagentPanelContext/useSubagentPanel；turn-segment-views.tsx 新导出 subagentHeaderOf 纯函数）；SubagentBlockView 组件签名（{ segment }）不变，行为双模式由 context 注入决定。消费点：turn-segment-views.tsx 自身（SegmentView 分发，task-01 范围内）+ session-panel-page.tsx（subagentBlockNameOf 已有引用，行为不受影响，task-03 范围内）+ team-task-block.tsx（仅 import 类型/无 SubagentBlockView 直接渲染，grep 实测该文件引用的是 TeamWorkerBlockView 相关类型——不受影响，不在范围且无需改）。
- **task-02**：无签名级变更——TurnTimeline 内部 textSegments 过滤条件放宽；TurnTimelineProps 未动。消费点：session-panel-page.tsx（唯一渲染方，行为变化=设计目标本身，task-03 范围内）。
- **task-03**：两处签名级变更——①SessionPanelProps 增 3 个**可选** props（openSubagentId/onOpenSubagent/onSubagentPanelClose），受影响调用点：sessions-portal.tsx（task-04 范围内，将传新 props）、app/m/workspaces/[id]/sessions/page.tsx、app/m/workspaces/[id]/sessions/[sid]/page.tsx、runtime-session-helpers.tsx、floating/floating-session-host.tsx、group-chat/member-panel.tsx（五处不传新 props=零变化，向后兼容无需改，不在 allowed_paths 合理）；②SubagentCatalogProps 增可选 activeId，受影响调用点：session-panel-page.tsx 三处 <SubagentCatalog>（task-03 范围内）、activity-catalog.tsx/agent-task-card.tsx（grep 实测为注释/其它符号引用，非 SubagentCatalog 组件渲染——不受影响）。新增导出 SubagentDetailPanel（新文件，无既有调用点）。
- **task-04**：无签名级变更——sessions-portal.tsx 内部新增 subagentView state 与 handleOpenSubagent 回调；SessionPanel 调用点本文件（新 props 装配）；filePreview 状态语义不变。

## 汇总

签名级变更共 2 处（SessionPanelProps/SubagentCatalogProps 各加可选 props），全部向后兼容（可选 props 不传=现状零变化），受影响调用点要么在对应 task allowed_paths 内、要么因可选兼容无需修改。无阻断项。
