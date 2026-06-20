---
schema_version: 1
doc_type: module-card
module_id: frontend
author: qinyi
created_at: 2026-06-04T09:01:45+08:00
---

# frontend

## 定位

Next.js 14 前端应用，负责 Web 用户界面和交互体验。提供工作区管理、变更生命周期、任务看板、Agent 运行时监控、知识库查询等功能的页面组件。不负责业务逻辑和数据持久化，所有数据操作通过调用后端 RESTful API 完成。

## 契约摘要

### 核心能力

- **页面路由**：Next.js App Router，包含 `(dashboard)`、`(auth)` 两个路由组，约 20 个页面组件
- **API 客户端层**：统一的 fetch 封装，自动认证、错误处理、token 刷新
- **状态管理**：Zustand + persist 实现的客户端会话存储
- **实时通信**：SSE 流客户端用于 Agent 运行日志实时推送
- **UI 组件**：基于 Tailwind CSS + shadcn/ui 的组件库

### 主要导出符号（按分类）

#### API 客户端 (src/lib/*.ts)

- `apiFetch<T>(path, options)`：统一请求封装，自动注入 Bearer Token，401 自动刷新重试
- `getApiBaseUrl()` / `getDirectApiBaseUrl()`：获取后端 URL（后者用于 SSE 直连）
- `ApiError`：标准错误类，包含 code/message/details

**认证** (auth.ts)：
- `login(email, password) -> TokenPair`
- `refreshTokens() -> SessionTokens`
- `logout() -> void`

**工作区** (workspaces.ts)：
- `listWorkspaces() -> WorkspaceListResponse`
- `createWorkspace(input) -> Workspace`
- `getWorkspace(id) -> Workspace`
- `scanWorkspace(rootPath) -> ScanResult`
- `rescanWorkspace(id) -> ScanResult`
- `activateWorkspace(id) -> Workspace`
- `deleteWorkspace(id) -> Workspace`
- `getWorkspaceRelations(id) -> RelationListResponse`
- `createRelation(data) -> WorkspaceRelation`
- `deleteRelation(id) -> void`
- `getTopology() -> TopologyResponse`

**变更** (changes.ts)：
- `listChanges(workspaceId, params) -> ChangeList`
- `getChange(workspaceId, changeId) -> ChangeRead`
- `getChangeDocMatrix(workspaceId, changeId) -> ChangeDocMatrix`
- `getChangeDocContent(workspaceId, changeId, docType) -> ChangeDocContent`
- `transitionChange(workspaceId, changeId, request) -> TransitionResponse`
- `submitReview(workspaceId, changeId, data) -> TransitionResponse`

**任务** (tasks.ts)：
- `listTasks(workspaceId, changeId) -> TaskList`
- `getTask(workspaceId, taskId) -> TaskRead`
- `getTaskBoard(workspaceId, changeId) -> TaskBoard`
- `transitionTask(workspaceId, taskId, request) -> TransitionResponse`
- `reparseTasks(workspaceId, changeId) -> TaskReparseResponse`

**Agent** (agent.ts)：
- `createAgentRun(workspaceId, input) -> AgentRun`
- `getAgentRun(workspaceId, runId) -> AgentRun`
- `listAgentRuns(workspaceId, taskId?) -> AgentRun[]`
- `getAgentRunLogs(workspaceId, runId, after?) -> AgentRunLogEntry[]`
- `killAgentRun(workspaceId, runId) -> AgentRun`
- `submitAgentRunInput(workspaceId, runId, input) -> AgentRunInputResponse`

**Agent 流客户端** (agent-stream.ts)：
- `AgentRunStreamClient` 类：SSE 连接管理，自动重连、日志补齐
- `streamAgentRunLogs(..., onMessage, onError)`：原始流式订阅

**组件** (components.ts)：
- `listComponents(workspaceId) -> Component[]`
- `getComponent(workspaceId, componentKey) -> Component`
- `reparseComponents(workspaceId) -> ReparseResponse`
- `getTopology(workspaceId) -> TopologyResponse`

**扫描文档** (scan-docs.ts)：
- `listScanDocs(workspaceId) -> ScanDocList`
- `getScanDoc(workspaceId, docId) -> ScanDocRead`
- `reparseScanDocs(workspaceId) -> ScanDocReparseResponse`

**SillySpec 工作区** (spec-workspaces.ts)：
- `getSpecWorkspace(workspaceId) -> SpecWorkspace`
- `importSpecWorkspace(workspaceId) -> SpecWorkspace`
- `syncSpecWorkspace(workspaceId) -> SpecWorkspace`
- `bootstrapSpecWorkspace(workspaceId) -> BootstrapResult`
- `updateSpecWorkspace(workspaceId, input) -> SpecWorkspace`
- `listSpecConflicts(workspaceId) -> SpecConflictListResponse`
- `resolveSpecConflict(workspaceId, conflictId, input) -> SpecConflictRead`

**运行时** (runtime.ts)：
- `getRuntimeProgress(workspaceId, changeId) -> RuntimeProgress`
- `getRuntimeUserInputsRaw(workspaceId, changeId) -> ArtifactEntry[]`
- `getRuntimeArtifacts(workspaceId, changeId) -> ArtifactEntry[]`
- `getRuntimeArtifactContent(workspaceId, changeId, path) -> string`

**Daemon** (daemon.ts)：
- `listDaemonRuntimes() -> DaemonRuntimeRead[]`
- `disableDaemonRuntime(runtimeId) -> DaemonRuntimeRead`
- `enableDaemonRuntime(runtimeId) -> DaemonRuntimeRead`
- `quickChat(prompt, provider, prevRunId?, model?) -> QuickChatResponse`
- `streamQuickChat(runId, onMessage, onDone, onError?) -> EventSource`

**发布** (releases.ts)：
- `listReleases(workspaceId, status?) -> Release[]`
- `createRelease(workspaceId, input) -> Release`
- `approveRelease(releaseId, input) -> Release`
- `deployRelease(releaseId) -> Release`
- `promoteRelease(releaseId) -> Release`
- `rollbackRelease(releaseId) -> Release`

**Git 网关** (git-gateway.ts)：
- `executeGitOperation(request) -> GitOperationResponse`

**Worktree** (worktree.ts)：
- `acquireWorktree(workspaceId, request) -> WorktreeLeaseRead`
- `listWorktrees(workspaceId) -> WorktreeLeaseList`
- `getWorktree(leaseId) -> WorktreeLeaseRead`
- `releaseWorktree(leaseId) -> WorktreeLeaseRead`
- `extendWorktree(leaseId, request) -> WorktreeLeaseRead`

**归档** (archive.ts)：
- `archiveChange(workspaceId, changeId) -> ArchivedChange`
- `distillChange(workspaceId, changeId) -> ArchivedChange`

**知识库** (knowledge.ts)：
- `listKnowledge(workspaceId, query?) -> KnowledgeList`
- `getKnowledge(workspaceId, entryId) -> KnowledgeEntry`
- `listQuicklog(workspaceId) -> QuicklogList`
- `getQuicklog(workspaceId, entryId) -> QuicklogEntry`

**审批** (approvals.ts)：
- `listPendingApprovals(workspaceId) -> ApprovalRequest[]`
- `listApprovalHistory(workspaceId) -> ApprovalHistoryEntry[]`
- `approveRequest(workspaceId, requestId) -> ApprovalRequest`
- `rejectRequest(workspaceId, requestId) -> ApprovalRequest`

**事件** (incidents.ts)：
- `listIncidents(workspaceId, status?) -> Incident[]`
- `createIncident(workspaceId, input) -> Incident`
- `getIncident(incidentId) -> Incident`
- `updateIncident(incidentId, input) -> Incident`
- `createPostmortem(incidentId, input) -> Postmortem`
- `getPostmortem(incidentId) -> Postmortem`

**审计** (audit.ts)：
- `listAuditLogs(workspaceId, params) -> AuditLogEntry[]`

**设置** (settings.ts)：
- `listSettings() -> SettingsBulkRead`
- `updateSettings(updates) -> SettingsUpdateResponse`
- `listUsers(params?) -> UserListResponse`
- `createUser(data) -> UserRead`
- `updateUser(userId, data) -> UserRead`
- `deleteUser(userId) -> void`

**Git 身份** (git-identities.ts)：
- `listGitIdentities() -> GitIdentityList`
- `createGitIdentity(data) -> GitIdentityRead`
- `getGitIdentity(identityId) -> GitIdentityRead`
- `revokeGitIdentity(identityId) -> void`
- `checkGitAccess(data) -> AccessCheckResult`

**变更创建** (change-writer.ts)：
- `createChange(workspaceId, input) -> CreateChangeResponse`
- `generateDocs(workspaceId, changeId, input) -> GenerateDocsInput`
- `batchGenerateDocuments(workspaceId, changeId) -> BatchGenerateResponse`

**健康检查** (health.ts)：
- `getHealth() -> HealthResponse`

**工具网关** (tool-gateway.ts)：
- `executeTool(workspaceId, request) -> ToolExecuteResponse`

#### 状态管理 (src/stores/session.ts)

- `useSession`：Zustand store，包含 user/accessToken/refreshToken/hydrated
- 方法：setUser/setTokens/clear/markHydrated

#### React 组件 (src/components/*)

- `AppShell`：主布局，侧边栏导航、认证检查
- `HealthCard`：健康状态卡片
- `WorkspaceCard`：工作区卡片
- `ComponentDetailDrawer`：组件详情抽屉
- `SillySpecStepProgress`：SillySpec 步骤进度条
- `WorkspaceScanDialog`：工作区扫描对话框

## 关键逻辑

### 请求流程

```
页面组件 -> lib/*.ts -> apiFetch() -> 后端 API
   - resolveUrl() 根据环境决定 URL（浏览器用相对路径走 Next.js rewrite，SSR 用绝对 URL）
   - 自动注入 Authorization: Bearer <token>
   - 401 响应：自动刷新 token 并重试（带 x-auth-retry 标记防重入）
   - 失败抛 ApiError(code/message/details)
```

### SSE 实时流

```
AgentRunStreamClient.connect()
   -> 使用 getDirectApiBaseUrl() 绕过 Next.js rewrite 避免缓冲
   -> 建立 EventSource 连接 /api/.../stream
   -> onMessage 回调处理 StreamLogEvent / DoneEventData
   -> 断线：指数退避重连（最多 5 次）
   -> 重连前：用 getAgentRunLogs(after=<lastLogId>) 补齐缺失日志
```

### 路由守卫

```
dashboard/layout.tsx
   - 检查 useSession().accessToken，未登录重定向到 /login
   - 等待 hydrated === true 再渲染，避免 Zustand persist 导致的闪屏
```

### 会话管理

```
login() -> 存储到 useSession + localStorage (persist 中间件)
refreshTokens() -> 401 时自动调用
logout() -> 清空 useSession + 跳转 /login
```

## 注意事项

1. **API 代理策略**：普通 HTTP 请求走 Next.js rewrite (`/api/* -> backend`)，SSE 流直连后端（需设置 `NEXT_PUBLIC_API_BASE_URL` 环境变量）

2. **Token 刷新机制**：`apiFetch` 内置 401 自动刷新，非 auth 端点失败后会尝试刷新一次；刷新失败则清除会话并跳转登录页

3. **测试覆盖**：当前测试覆盖极低（仅 `api.test.ts`、`agent.test.ts`、`spec-workspaces.test.ts`），新增 API 客户端时应补充 vitest 用例

4. **依赖关系**：frontend -> backend（通过 HTTP API），不直接依赖其他模块

5. **修改影响面**：
   - 修改 API 客户端签名会影响所有调用页面
   - 修改 session store 结构会影响认证流程和路由守卫
   - 修改 `apiFetch` 错误处理逻辑会影响全局请求行为

6. **TypeScript 严格模式**：项目启用了严格类型检查，新增 API 客户端时应正确定义请求/响应类型

7. **环境变量**：
   - `NEXT_PUBLIC_API_BASE_URL`：后端 API 地址（生产环境必填）
   - `INTERNAL_API_BASE_URL`：SSR 时使用的后端地址

## 人工备注

<!-- MANUAL_NOTES_START -->

- 2026-06-19: `/runtimes` 的运行时列表和会话列表使用固定最大高度与内部滚动；终态会话支持确认后删除。
- 2026-06-17: Agent launch controls expose a free-form per-run model override.
  Workspace defaults, scan-generate, change dispatch, task run creation, and runtime quick chat
  now send `model` alongside `provider`; empty model input means the workspace/provider default.
- 2026-06-17: Runtime quick chat keeps the Agent model override visible even when no daemon is online.
  Provider selection and send remain disabled until an online daemon is available, but users can still see
  and prefill the model override on the Daemon runtime page.
- 2026-06-18: `/runtimes` treats `disabled` as a first-class daemon runtime state.
  Runtime cards expose disable/enable actions, summary stats include disabled count, and quick chat
  continues to offer only `online` providers.
- 2026-06-19: `/runtimes` preserves usable runtime-card and interactive-session widths on desktop layouts.
  The page uses a wider content shell, renders runtime cards in two columns when space allows, and stacks
  the compound session workspace below the runtime list so its sidebar and detail panel remain readable.

<!-- MANUAL_NOTES_END -->

## Change Index

| Date | Change | Summary |
|---|---|---|
| 2026-06-19 | 2026-06-19-runtimes-layout | `/runtimes` 运行时与会话列表增加最大高度和内部滚动，终态会话增加确认删除入口。 |
| 2026-06-03 | fix-sse-nextjs-rewrite-buffering | 创建 `app/api/.../stream/route.ts` Route Handler 透传后端 SSE 流，修复 Next.js rewrites 缓冲导致 EventSource 5 秒断开重连 |
| 2026-06-04 | update-module-card | 基于代码库最新状态更新模块卡片，补充完整 API 客户端导出符号列表 |
| 2026-06-15 | ql-20260615-002-9b4f | 修复 `/runtimes` 空状态 EmptyState 错误的 `pip install -e .` 提示（daemon 已重写为 TS），改为 cd / pnpm install+build / npm link / 复制命令 4 步，加 Python 旧版残留卸载提示，末尾引导用户去 workspace 详情页配置默认 agent |
| 2026-06-16 | ql-20260616-001-7f3a | 修复 AgentLogViewer/normalize/changes/tasks 页 5 处直接读 `log.content_redacted`（后端可为 null）导致的 Bootstrap 点击崩溃。`agent.ts` 类型改 `string \| null`，5 个使用点统一 `?? ""` 兜底；parseToolCallContent / toolCallDescription 签名扩展接受 null\|undefined。tsc 零错误 |
| 2026-06-18 | ql-20260618-007-d9c0 | `/runtimes` runtime 卡片新增禁用/启用操作，状态元数据支持 `disabled`，统计区增加禁用数；`daemon.ts` API client 新增 disable/enable 调用。 |
| 2026-06-18 | ql-20260618-009-f3a2 | `lib/changes.ts` transitionChange 的 provider/model 判断从 `!== undefined` 改为 truthy，与 executeChange 风格统一（后端 schema default=None，行为等价）。 |
| 2026-06-19 | 2026-06-19-runtimes-layout | 放宽 `/runtimes` 页面容器，将复合会话工作区移到运行时列表下方全宽展示，避免卡片、会话表单和说明文字被多层分栏挤压。 |
| 2026-06-19 | ql-20260619-007-7b2e | 修复 `/runtimes` 选中 active 会话右侧无回显：`handleSelect` 移除 active 空白 live 分支，所有会话（含 active）统一调 `getAgentSessionLogs` 只读回看；渲染条件改 `selected`；删除无用 `liveViewOpen` 状态。 |
| 2026-06-20 | ql-20260620-001-7b2e | 前端 UI 文案中文化：新增 `lib/status-labels.ts`（枚举状态中文映射 + labelOf 兜底）；改约35个前端文件，品牌 Multi-Agent Platform→SillyHub、Daemon→守护进程、Agent→智能体、Workspaces→工作区、Overview→概览/Management→管理/System→系统 等；技术标识符（日志频道/Claude 工具名/数据字段名/Bootstrap/Git/commit/PAT）保留英文；后端枚举状态值走 status-labels 映射。tsc/lint exit0，vitest 213/213 通过。 |
| 2026-06-20 | 2026-06-20-session-history-enhance | 交互式会话历史回看：用户消息落库回看 + 任意会话 reopen 续聊(仅claude) + 任意状态删除 |
