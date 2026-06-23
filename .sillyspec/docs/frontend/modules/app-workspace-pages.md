---
schema_version: 1
doc_type: module-card
module_id: app-workspace-pages
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:02:00
---
# app-workspace-pages

## 定位
工作区作用域页面集合，挂在 `/workspaces/[id]/**` 下，是产品功能最密集的路由组：涵盖变更(SillySpec)、任务看板、Agent 运行、组件拓扑、扫描文档、知识库、运行时进度、发布、审批、审计、故障、任务、成员等近 20 个页面。页面以 `[id]` / `[cid]` / `[tid]` / `[iid]` 等动态段取参，组合对应 lib-* 客户端拉数据，复杂交互（流式日志、权限卡片）下沉到 components-agent-log / components-daemon / components-shared。

## 契约摘要
- `WorkspaceDetailPage`（`/workspaces/[id]`）：并行 `getWorkspace` + active/archive 两份 `listChanges`（各自 `.catch` 兜底空），渲染工作区概览与变更分区。
- `ChangesPage` / `ChangeDetailPage`：`listChanges(location:active|archive)` + `reparseChanges`；详情页聚合文档/审批/进度。
- `TaskBoardPage` / `TaskDetailPage`：`getTaskBoard` + `transitionTask`，任务流转。
- `CreateChangePage`：表单 → `createChange(workspaceId, input)`，可续调 `generateDocs` / `batchGenerateDocuments`。
- `AgentPage`：活跃 run 日志流 + 历史 prefetch + input + 权限卡片统一由 `<AgentRunPanel>`（内含 `useAgentRunStream` 连 SSE）承担，页面只切 `activeRunId`。
- `ComponentsPage` / `TopologyPage`：`listComponents` / `getTopology`，拓扑用 @xyflow/react。
- `RuntimePage`：`getRuntimeProgress` + `getRuntimeUserInputsRaw` + `getRuntimeArtifacts` 三路并行拉运行时进度。
- 其余：`ScanDocsPage`、`KnowledgePage`、`ReleasesPage`、`ApprovalsPage`、`AuditPage`、`IncidentsPage`/`IncidentDetailPage`、`MissionsPage`、`MembersPage`，各自对接同名 lib-* 客户端。

## 关键逻辑
- 动态段取参：`export default function XPage({ params }: { params: { id: string; cid?: string } })`，页面内 `const workspaceId = params.id`。
- 并行加载兜底模式：
  ```
  const [ws, active, archive] = await Promise.all([
    getWorkspace(id),
    listChanges(id, {location:'active'}).catch(() => ({items:[],total:0})),
    listChanges(id, {location:'archive'}).catch(() => ({items:[],total:0})),
  ])
  ```
- AgentPage 分层：页面只持有 `activeRunId`，SSE 连接/历史 prefetch/input 提交/权限响应全部在 `AgentRunPanel` → `useAgentRunStream` 内闭环。

## 注意事项
- 大量 UI 内联在页面组件中，单文件普遍偏长；改 Agent/Runtime/Change 详情时优先确认逻辑是否已下沉到 panel/hook，避免重复实现 SSE。
- `location: active|archive` 是变更分区的核心参数，漏传会拿到混合列表。
- 动态段在 Next 14 仍为对象（非 Promise），直接解构即可；升级 Next 版本时需关注 params 异步化变更。
- 任务/发布/审批等流转操作成功后需手动触发对应列表刷新（无全局缓存自动失效）。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
