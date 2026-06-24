---
author: qinyi
created_at: 2026-06-01T12:00:00
---

# frontend_lib
> 最后更新：2026-06-23
> 最近变更：2026-06-23-codex-interactive-session
> 模块路径：frontend/src/lib/**

## 职责

Frontend Lib 模块是前端的 API 客户端层和工具函数集合。所有与后端通信的逻辑都封装在此模块中，页面组件和业务组件通过导入 lib 函数发起请求。同时包含认证、工具函数等基础能力。

## 当前设计

### 文件清单与职责

| 文件 | 职责 | 主要导出 |
|------|------|----------|
| `api.ts` | HTTP 客户端基础层 | `getApiBaseUrl()`, `ApiError`, `apiFetch<T>()` |
| `auth.ts` | 认证操作 | `login()`, `refreshTokens()`, `logout()` |
| `workspaces.ts` | 工作区 CRUD | `scanWorkspace()`, `listWorkspaces()`, `createWorkspace()`, `rescanWorkspace()`, `reparseWorkspace()`, `deleteWorkspace()`, `getWorkspace()`, `getWorkspaceRelations()`, `createRelation()`, `deleteRelation()`, `getTopology()` |
| `components.ts` | 组件管理 | `listComponents()`, `getComponent()`, `reparseComponents()`, `getTopology()` |
| `changes.ts` | 变更管理 | `listChanges()`, `getChange()`, `getChangeDocuments()`, `getChangeDocumentContent()`, `reparseChanges()`, `getChangeApproval()`, `approveChange()`, `rejectChange()`, `updateChangeProgress()`, `createChange()`, `executeChange()`, `transitionChange()`, `submitFeedback()`, `checkArchiveGate()`, `getAgentStatus()`, `triggerDispatch()` |
| `tasks.ts` | 任务管理 | `listTasks()`, `getTask()`, `getTaskBoard()`, `reparseTasks()` |
| `agent.ts` | Agent 运行 | `createAgentRun()`, `getAgentRun()`, `listAgentRuns()`, `getAgentRunLogs()`, `streamAgentRunLogs()` |
| `workflow.ts` | 工作流操作 | `transitionChange()`, `submitReview()`, `listReviews()`, `transitionTask()` |
| `approvals.ts` | 审批管理 | `listPendingApprovals()`, `listApprovalHistory()`, `approveRequest()`, `rejectRequest()` |
| `audit.ts` | 审计日志 | `listAuditLogs()` |
| `settings.ts` | 系统设置 | `listSettings()`, `updateSettings()`, `listUsers()`, `createUser()`, `updateUser()`, `deleteUser()` |
| `git-identities.ts` | Git 身份管理 | `listGitIdentities()`, `createGitIdentity()`, `getGitIdentity()`, `revokeGitIdentity()`, `checkGitAccess()` |
| `worktree.ts` | Worktree 操作 | `acquireWorktree()`, `listWorktrees()`, `getWorktree()`, `releaseWorktree()`, `extendWorktree()` |
| `runtime.ts` | 运行时状态 | `getRuntimeProgress()`, `getRuntimeUserInputsRaw()`, `getRuntimeArtifacts()`, `getRuntimeArtifactContent()` |
| `scan-docs.ts` | 扫描文档 | `listScanDocs()`, `getScanDoc()`, `reparseScanDocs()` |
| `releases.ts` | 发布管理 | `listReleases()`, `createRelease()`, `approveRelease()`, `listApprovals()`, `deployRelease()`, `promoteRelease()`, `rollbackRelease()` |
| `incidents.ts` | 事件管理 | `listIncidents()`, `createIncident()`, `getIncident()`, `updateIncident()`, `createPostmortem()`, `getPostmortem()` |
| `knowledge.ts` | 知识库 | `listKnowledge()`, `getKnowledge()`, `listQuicklog()`, `getQuicklog()` |
| `change-writer.ts` | 变更文档写入 | `createChange()`, `generateDocs()`, `batchGenerateDocuments()` |
| `spec-workspaces.ts` | Spec 工作区 | `getSpecWorkspace()`, `importSpecWorkspace()`, `syncSpecWorkspace()`, `bootstrapSpecWorkspace()`, `updateSpecWorkspace()`, `listSpecConflicts()`, `resolveSpecConflict()` |
| `archive.ts` | 归档操作 | `archiveChange()`, `distillChange()` |
| `health.ts` | 健康检查 | `getHealth()` |
| `git-gateway.ts` | Git 操作网关 | `executeGitOperation()` |
| `tool-gateway.ts` | 工具调用网关 | `executeTool()` |
| `utils.ts` | 工具函数 | `cn()`（clsx + twMerge） |

### 架构模式

所有 API 函数遵循统一模式：
1. 调用 `apiFetch<T>(path, options)` 发起请求
2. `apiFetch` 自动注入 `Authorization: Bearer {accessToken}` header（从 `useSession` store 读取）
3. 错误时抛出 `ApiError`（包含 status code 和 payload）

## 对外接口

### 基础层

| 导出 | 类型 | 说明 |
|------|------|------|
| `getApiBaseUrl()` | function | 返回后端 API 基础 URL |
| `apiFetch<T>(path, options)` | async function | 通用 HTTP 请求封装，自动处理认证和错误 |
| `ApiError` | class | API 错误类（extends Error） |

### 工具函数

| 导出 | 说明 |
|------|------|
| `cn(...inputs)` | Tailwind class 合并工具 |

## 关键数据流

```
页面/组件调用 lib 函数（如 listWorkspaces()）
  → apiFetch("/workspaces", { method: "GET" })
  → 从 useSession store 读取 accessToken
  → 注入 Authorization header
  → fetch → 后端 API
  → 响应解析 → 返回类型化数据
  → 错误时抛出 ApiError（包含 statusCode + payload）
```

## 设计决策

| 决策 | 原因 |
|------|------|
| 集中式 `apiFetch` 封装 | 统一认证、错误处理、Content-Type |
| `useSession` store 读取 token | 避免在每个函数中传递 token 参数 |
| 每个域一个文件 | 按后端模块对应拆分，职责清晰 |
| `cn()` 工具函数 | shadcn/ui 标准实践，合并 Tailwind class |

## 依赖关系

- **内部依赖**：`@/stores/session`（useSession 读取 token）, `@/lib/utils`（部分模块使用 cn）
- **外部依赖**：无第三方运行时依赖（纯 fetch + 标准 Web API）

## 注意事项

- `apiFetch` 在 `useSession` 未 hydrate 时可能读取到 null token，调用方需确保在认证守卫之后使用
- SSE 流式接口有两个：`streamAgentRunLogs()`（按 workspace 维度订阅 agent run）和 `streamQuickChat()`（订阅 quick-chat 类型的 agent run，无 workspace 关联）；二者均通过 nextjs route handler 透传后端 SSE 避免缓冲。注意：`daemon.ts` 的 `InteractiveProvider="claude" | "codex"`，`createSession` / `injectSession` / `interruptSession` / `endSession` / `reopenSession` 对 Codex 生效（D-003@v1, D-007@v1）；`quickChat` / `streamQuickChat` / `getQuickChatResult` 作为全局能力保留，但**不再作为 /runtimes Codex interactive 主路径**（2026-06-23-codex-interactive-session，D-005@v1）——Codex runtime 会话改走 interactive session SSE（按 session/run 订阅），quick-chat SSE 不再作为 runtime Codex 主入口。
- `auth.ts` 直接导入 `useSession` store 用于 token 管理
- `components.ts` 导入了 `Workspace` 类型 from `./workspaces`

## 变更索引

| 日期 | 变更 | 摘要 |
|------|------|------|
| 2026-06-16 | ql-20260616-002-f4ce | daemon.ts 新增 streamQuickChat + QuickChatStreamMessage/Done 类型，订阅 /api/daemon-chat/{runId}/stream SSE |
| 2026-06-21 | ql-20260621-012-7d4a | daemon.ts 新增 deleteDaemonRuntime（DELETE /runtimes/{id}）+ DaemonRuntimeRead 增 os/arch |
| 2026-06-21 | ql-20260621-004-c4a1 | 新增 lib/ppm/format.ts：fmtDate(YYYY-MM-DD) / fmtDateTime(YYYY-MM-DD HH:mm) 统一日期回显工具，空值与非法值兜底 —；barrel 导出供 ppm 各表格列 render 复用 |
| 2026-06-23 | ql-20260623-002-f3b8 | lib/ppm/types.ts PlanTaskPageReq 扩展 status:string[] + start_time/end_time/work_partner;task.ts queryOf 修嵌套 4 处(listTaskExecutes/listWorkHours/statWorkHoursByUser/statWorkHoursByProject 直接返回 {query:...}\|undefined 而非再包一层) |
| 2026-06-23 | 2026-06-23-codex-interactive-session | daemon.ts `createSession/injectSession/interruptSession/endSession/reopenSession` 对 Codex 生效（InteractiveProvider 路径，D-003@v1/D-007@v1）；`quickChat/streamQuickChat/getQuickChatResult` 标注非 /runtimes Codex interactive 主路径（全局能力保留，D-005@v1），Codex runtime 会话改走 interactive session SSE |
| 2026-06-24 | 2026-06-24-kanban-gantt-ui | 删除 lib/ppm/kanban-grouping.ts（groupByUserAndDate/groupByUserAndExecuteDate/dateRangeKeys/weekdayMeta 仅被已删 KanbanMatrix/KanbanActualMatrix 引用，随 Matrix 删除成死代码清理）。kanban 甘特图改用 kanban/_components/kanban-gantt-helpers.ts（computeBarLayout/assignLanes，归 frontend_app） |
