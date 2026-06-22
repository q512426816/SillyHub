---
author: qinyi
created_at: 2026-06-22T11:16:01+08:00
---

# Requirements — 统一 Agent Run SSE 客户端

变更：`2026-06-22-unify-agent-run-sse-hook`

## 角色

| 角色 | 说明 |
|---|---|
| 工作区用户 | 在 `/agent`、`/changes/[cid]`、工作区首页查看活跃 run 实时日志，对 AskUserQuestion 审批卡片做决策，对 pending_input 提交人工指导 |
| 前端开发者 | 维护 run 实时流相关页面，使用统一的 `useAgentRunStream` hook 与 `AgentRunPanel` 组件 |

## 功能需求

### FR-01: 单一 SSE 客户端（合并）
覆盖决策：D-002@v1
Given 前端存在 `streamAgentRunLogs`（函数）与 `AgentRunStreamClient`（class）两套 SSE 客户端
When 本次变更完成
Then `AgentRunStreamClient` 是唯一底层 SSE 客户端；`streamAgentRunLogs` 从 `agent.ts` 删除；4 个调用点不再直接使用任何 SSE 客户端，统一经由 `useAgentRunStream` → `AgentRunStreamClient`。

### FR-02: useAgentRunStream hook 封装实时流状态
覆盖决策：D-001@v1, D-002@v1
Given 一个活跃 agent run（workspaceId + runId，status∈{pending,running}）
When 调用 `useAgentRunStream(workspaceId, runId, { isActive: true })`
Then hook 内部 `new AgentRunStreamClient` 并连接，返回 `{ logs, status, streaming, loading, error, perms, dismissPerm, input, clear }`；runId/isActive 变化时旧连接 disconnect、新连接建立（useEffect cleanup）。

### FR-03: AgentRunPanel 面板组件
覆盖决策：D-002@v1
Given 调用点需要展示一个 run 的实时日志 + 审批 + input
When 渲染 `<AgentRunPanel workspaceId runId isActive title ... />`
Then 内部调 `useAgentRunStream`，把 logs/perms/input（适配后）/loading 注入 `<AgentLogViewer>`，调用点无需手搓任何 SSE/状态胶水；定制 prop（title/actions/summary/emptyText/compact/variant/maxHeightClass/isLive）透传。

### FR-04: AskUserQuestion 审批卡片在 /agent 与 changes/[cid] 渲染（bug 修复）
覆盖决策：D-003@v1
Given `/agent` 或 `changes/[cid]` 页的活跃 run 中 Claude Code 触发 AskUserQuestion（daemon 发 permission_request，backend 透传 SSE）
When 事件到达 `AgentRunStreamClient`
Then hook 的 `perms` 增加该 request（按 request_id 去重），`AgentRunPanel`→`AgentLogViewer` 渲染审批卡片（`PermissionApprovalCard` 或 `AskUserDialogCard`），用户可决策；**不再 5min 兜底超时**。

Given 用户在卡片做 allow/deny 决策（或 daemon 5min 超时 / 另一端决策）
When 卡片自调 `respondSessionPermission` 成功后 onResolved，或 SSE 收到 permission_resolved
Then hook 经 `dismissPerm(requestId)` 从 `perms` 移除该卡片（两条路径收敛）。

### FR-05: pending_input 回复纳入 hook + UI 统一
覆盖决策：D-002@v1
Given 活跃 run 输出 pending_input 日志（人工指导请求）
When 用户在 input 控件填写并提交
Then hook 的 `input.submit(logId)` 调 `submitAgentRunInput`，成功后标记 `replied`；三处调用点（根/agent/changes）的 input UI 经 `AgentRunPanel` 适配为同一 `AgentLogInputControls` 契约，命名/样式/行为一致。

### FR-06: 非活跃 run 仅 prefetch 历史（isActive 语义）
覆盖决策：D-001@v1
Given runId 对应非活跃 run（completed/failed/killed），`isActive=false`
When 调用 `useAgentRunStream(workspaceId, runId, { isActive: false })`
Then hook 仅 prefetch 历史日志（`AgentRunStreamClient.connect` 内 `getAgentRunLogs`），**不建立 SSE 连接**，不注册 permission/input 实时回调；历史日志正常展示。

### FR-07: dialog 恢复（刷新前未答的 AskUserQuestion）
Given 页面刷新前已有 pending 的 AskUserQuestion 对话（dialog_kind 待答）
When hook 连接一个 isActive run（runId 变化）
Then hook 内部 `getAgentRun` 取 `session_id` → `fetchPendingDialogs(session_id)` 恢复未答 dialog，合并进 `perms`（按 request_id 去重）。

## 非功能需求

- **兼容性**：未使用 `AgentRunPanel` 的页面行为完全不变；所有后端 REST/SSE 契约、SQLModel 表零改动。
- **可回退**：纯前端重构，无 DB 迁移，`git revert` 即可回退。
- **可测试**：hook 单测（mock AgentRunStreamClient）+ panel 集成测试（端到端覆盖 FR-04 bug）；`pnpm lint/typecheck/test` 全过。
- **性能**：复用 AgentRunStreamClient 现有重连退避与日志去重，无新增性能开销；`fetchPendingDialogs` 仅在 isActive run 连接时调用一次。
- **类型安全**：TS strict；接口签名固化（design §7）。

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-02, FR-06 | isActive 语义：非活跃 run 仅 prefetch 历史、不连 SSE |
| D-002@v1 | FR-01, FR-02, FR-03, FR-05 | 抽象层次 = hook + 面板组件 |
| D-003@v1 | FR-04 | 决策 API（respondSessionPermission）维持卡片自调，hook 只暴露 dismissPerm 本地移除 |
