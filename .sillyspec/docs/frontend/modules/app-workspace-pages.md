---
schema_version: 1
doc_type: module-card
module_id: app-workspace-pages
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 工作区页面（app-workspace-pages）

## 定位
工作区作用域页面集合，挂在 `/workspaces/[id]/` 下，是产品功能最密集的路由组：根概览页 + 18 个子域目录（agent、agent-profiles、approvals、audit、changes、components、files、incidents、knowledge、mcp、mcp-tokens、members、missions、releases、runtime、scan-docs、sessions、skills，topology 嵌套在 components 下），共 24 个 page.tsx（含 `[cid]` / `[tid]` / `[iid]` 动态详情段）。页面取 `[id]` 动态段组合同名 lib-* 客户端拉数据；布局层（WorkspaceDetailLayout）对本域 changes / components 路由做 standalone 放行（不裹 WorkspaceTabs）。

## 契约摘要
- `WorkspaceDetailPage`（根，375 行）：`Promise.all` 七路并行——`getWorkspace` / switcher / components / active + archive 两份 `listChanges`（各自 `.catch` 降级空）/ runtime / binding。
- `ChangesPage`（`changes`，672 行）：三 Tab（进行中 active / 已归档 archive / 快速修复 quicklog），react-query（`keepPreviousData`）；查询条件垂直 Field + 筛选（Checkbox/Input/Select）；待办徽标数据源 = `ChangeSummary.pending_review`（PG 镜像投影）+ status=blocked；`reparseChanges` 重扫入口；QUICKLOG Tab 走 lib-quicklog（`QuicklogTable` + `QuicklogDrawer`）。
- `ChangeDetailPage`（`changes/[cid]`，366 行）：左主右辅布局（会话驱动化重做后），聚合文档 / 审批 / 进度 / 阶段操作（components-changes 组件群承载）。
- `TaskBoardPage` / `TaskDetailPage`（`[cid]/tasks`、`[tid]`）：任务看板与流转（`getTaskBoard` / `transitionTask`）。
- `AgentPage`（`agent`）：历史列表 `useAgentRuns` 轮询；活跃 run 日志流 + input + 权限卡片全在 `<AgentRunPanel>`（内含 `useAgentRunStream` 连 SSE 中继）闭环，页面只切 `activeRunId`。
- `WorkspaceAgentProfilesPage`（`agent-profiles`）：workspace 作用域档案卡片墙（`AgentProfileCardGrid` + 表单，components-agent-profile）。
- `WorkspaceSessionsPage`（`sessions`）：workspace 作用域会话列表。
- `WorkspaceMcpTokensPage`（`mcp-tokens`）：MCP 令牌签发/吊销（`McpTokenCreateDialog`，lib-mcp-tokens）。
- `WorkspaceSkillsPage`（`skills`）：技能管理（lib-mcp-skills 视图）。
- `WorkspaceFilesPage`（`files`，50 行薄壳）：`<BorrowedSolutionFilesPanel>` 拉 owner_type=workspace 的借用方案文件（共享 daemon 产出）。
- `ComponentsPage` / `TopologyPage`：`listComponents` / `getTopology`，拓扑 @xyflow/react。
- `RuntimePage`（`runtime`）：`getRuntimeProgress` + `getRuntimeUserInputsRaw` + `getRuntimeArtifacts` 运行时进度三路。2026-08-19-runtime-live-daemon-read：数据源为绑定 daemon 实时读取，徽标「守护进程运行态」+ 副标题「经绑定守护进程实时读取 .sillyspec/.runtime/」；错误按 ApiError.status 分级行动指引（502 离线/504 超时/422 版本过旧），产物读取失败接红条不静默。
- 其余：`ScanDocsPage`（+ lib-scan-docs-tree 文档树；树节点徽标 `👤 来源成员` / `🕘 历史N版`=conflict_count 覆盖存档计数，中性 outline 非告警，ql-20260819-003）、`KnowledgePage`、`ReleasesPage`、`ApprovalsPage`、`AuditPage`、`IncidentsPage` / `IncidentDetailPage`（`[iid]`）、`MissionsPage`、`MembersPage`（成员管理 + `WorkspaceMemberAddDialog`/`Row`）、`WorkspaceMcpPage`（MCP 设置）。

## 关键逻辑
```
并行加载兜底: Promise.all([getWorkspace(id), …,
  listChanges(id,{location:'active'}).catch(()=>({items:[],total:0})), …])
AgentPage 分层: 页面仅持 activeRunId
  → AgentRunPanel → useAgentRunStream
  → /api/workspaces/[id]/agent/runs/[runId]/stream 中继（app-api-routes）
布局: changes|components 路径 standalone（不裹 WorkspaceTabs，宽表独占）
```

## 注意事项
- 大量 UI 内联在页面组件、单文件偏长；改 Agent / Runtime / Change 详情先确认逻辑是否已下沉 panel / hook / components-changes，避免重复实现 SSE 与流转。
- `location: active|archive` 是变更分区核心参数，漏传拿混合列表；quicklog Tab 走独立端点不经 listChanges。
- 创建变更的独立页已移除（会话驱动化翻转）：创建入口并入 changes 列表 / 会话驱动流程，勿恢复旧 create-change 路由。
- 动态段在 Next 14 为对象（非 Promise），直接解构 `params.id`；升级 Next 需关注 params 异步化。
- 流转操作（任务/发布/审批/阶段推进）成功后需手动 invalidate / 重拉列表（react-query 局部使用，无全局缓存自动失效）。
- `files` 页守卫依赖 dashboard layout 的 `/^\/workspaces\/[^/]+/` 放行规则（有 wsId 一律放行），无需加白名单。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
