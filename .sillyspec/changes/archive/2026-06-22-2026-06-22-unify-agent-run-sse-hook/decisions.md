---
author: qinyi
created_at: 2026-06-22T11:06:00+08:00
---

# Decisions — 2026-06-22-unify-agent-run-sse-hook

本台账只记录有实现/验收影响的决策。

## D-001@v1: hook 对非活跃 run 的处理边界

- type: boundary
- status: accepted
- source: code
- priority: P1
- question: useAgentRunStream 收到的 runId 对应非活跃 run（completed/failed/killed）时如何处理？
- answer: 三页面现有模式一致 —— 仅活跃（pending/running）连 SSE，非活跃只一次性拉取历史。
- normalized_requirement: `useAgentRunStream(workspaceId, runId, { isActive })` —— runId 变化时先 prefetch 历史日志（AgentRunStreamClient.connect 内已做 getAgentRunLogs 预取）；仅当 `isActive`（status∈{pending,running}）才建立 SSE 连接，否则仅保留历史日志、不连流、不注册 permission/input 事件回调。
- impacts: design §5/§7（hook 接口 isActive 语义）, task（hook 实现）, verify（非活跃 run 场景：不连 SSE、历史日志仍展示）
- evidence: agent/page.tsx:394-395（status!==running 不 stream）、changes/[cid]/page.tsx:590-594（!isRunActive→loadHistoryLogs+return）、page.tsx:206-215（仅 pending/running 才 connectBootstrapStream）

## D-002@v1: 抽象层次

- type: architecture
- status: accepted
- source: user
- priority: P1
- question: 合并到哪一层？纯 hook（方案A）/ hook + 面板组件（方案B）/ 仅 class（方案C）
- answer: 方案 B —— `useAgentRunStream` hook（状态 + SSE 生命周期 + permission + pending_input）+ `AgentRunPanel` 组件（封装 AgentLogViewer + 审批卡片 + input 控件组装）。调用点渲染 `<AgentRunPanel .../>` 一行 JSX。
- normalized_requirement: AgentRunPanel 显式列出 AgentLogViewer 可定制 prop（title/actions/summary/emptyText/compact/variant/maxHeightClass/isLive）+ `...rest` 兜底，内部注入 logs/perms/input/inputControls；4 调用点不再手搓 AgentLogViewer props 拼装。决策 API（respondSessionPermission）维持卡片自洽，hook 不封装。
- impacts: design §5/§6/§7（组件树 + 文件清单 + 接口）, task（新增 hook + panel，4 调用点替换）, verify（调用点渲染一致性）
- evidence: 用户在 brainstorm Step8 选定方案B；agent-log-viewer.tsx:403-409 卡片自调 respondSessionPermission + onResolved 的现有自洽模式

## D-003@v1: 决策 API 调用归属（不归 hook）

- type: architecture
- status: accepted
- source: code
- priority: P2
- question: AskUserQuestion/permission 的 allow/deny 决策由谁调 respondSessionPermission？
- answer: 维持现状 —— 由 AgentLogViewer 内渲染的 PermissionApprovalCard / AskUserDialogCard 自调 respondSessionPermission API，成功后经 onResolved 回 AgentRunPanel。hook 只暴露 `dismissPerm(requestId)` 做本地 perms 移除（卡片 onResolved 与 SSE permission_resolved 两条路径都调它）。hook 不重复封装决策 API。
- normalized_requirement: hook 返回 `dismissPerm(requestId)`（仅本地状态移除），不返回调 API 的 resolvePermission。AgentRunPanel 把 AgentLogViewer.onPermissionResolved 接到 dismissPerm。
- impacts: design §7（hook 接口）, task（hook 实现）, verify（卡片决策后 perms 移除）
- evidence: daemon.ts:398 respondSessionPermission；agent-log-viewer.tsx:404/551 卡片自洽；components/permission-approval-card.tsx:64
