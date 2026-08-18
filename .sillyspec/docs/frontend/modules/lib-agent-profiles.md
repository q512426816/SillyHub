---
schema_version: 1
doc_type: module-card
module_id: lib-agent-profiles
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 智能体档案客户端（lib-agent-profiles）

## 定位
AgentProfile（智能体档案）API 客户端 + React Query hooks（`lib/agent-profiles.ts`，360 行，2026-08-02-agent-profile-layer 变更派生）。覆盖 workspace 级 CRUD+复制、platform 级只读列表与跨级删除、全局聚合（scope=mine）、tool policy 列表，以及配套 useQuery/useMutation hooks。类型一律取自 api-types.ts 的 `components["schemas"]`（规则 20 禁手写）。

## 契约摘要
- 类型（全部 `components["schemas"]` 别名）：
  - `AgentProfileRead` / `AgentProfileCreate` / `AgentProfileUpdate` / `AgentProfileCopyRequest` / `AgentProfileListResponse`。
  - `AgentProfileAggregatedItem` / `AgentProfileAggregatedListResponse`（跨工作区聚合）。
  - `ToolPolicyRead`；`AgentProfileVisibility`（private/workspace/platform 三级）。
- 展示常量：
  - `VISIBILITY_LABEL`：private 个人 / workspace 工作区 / platform 平台。
  - `VISIBILITY_TAG_COLOR`：default / blue / purple（antd Tag color）。
  - `NO_PROFILE_VALUE = ""`：「不指定，用默认」统一占位；Select value="" 映射 null，不发 agent_profile_id 走兜底链（design §8）。
- query keys（模块内聚）：`agentProfileQueryKeys = { workspaceList(workspaceId), platformList, mineList }`；mutation 成功后 invalidate 对应桶触发重拉。
- workspace 级裸函数（`/api/workspaces/{wid}/agent-profiles...`）：
  - `listWorkspaceAgentProfiles(wid)`——含 private/workspace/platform 三级可见全集，管理页用。
  - `createWorkspaceAgentProfile(wid, body)` / `getWorkspaceAgentProfile(wid, pid)`。
  - `updateWorkspaceAgentProfile(wid, pid, body)`——PATCH exclude_unset：省略=不动，显式 null=清空。
  - `deleteWorkspaceAgentProfile(wid, pid)`——204；系统预置档案后端拒删（is_system_default）。
  - `copyWorkspaceAgentProfile(wid, pid, body)`——新档 owner=actor / version=1 / 非系统预置；name 省略取「{原名}（副本）」，visibility 省略 private。
- platform 级（`/api/agent-profiles...`，只读为主）：
  - `listPlatformAgentProfiles()`——含系统预置默认档案，选档案下拉兜底数据源。
  - `deleteAgentProfile(pid)`——删 workspace_id=null 的平台/个人级档案；后端按三级 visibility 鉴权：admin 短路删任意档、private 仅 owner、platform/系统预置仅 admin。
- 聚合与策略：
  - `listMineAgentProfiles()`——当前 actor 跨工作区可见全集（scope=mine），全局卡片墙用。
  - `listWorkspaceToolPolicies(wid)`。
- hooks：
  - 查询：`useWorkspaceAgentProfiles(wid)` / `usePlatformAgentProfiles()` / `useMineAgentProfiles()` / `useWorkspaceToolPolicies(wid)`。
  - 变更：`useCreateAgentProfile(wid)` / `useUpdateAgentProfile(wid)` / `useDeleteAgentProfile(wid)` / `useCopyAgentProfile(wid)`。

## 关键逻辑
```
端点布局:
  workspace 级 CRUD+copy → /api/workspaces/{wid}/agent-profiles[/{pid}[/copy]]
  platform 级只读+跨级删 → /api/agent-profiles[/{pid}]
                           （无 create/copy 入口，建档走 workspace 级）

可见性三级: private(个人) < workspace(工作区) < platform(平台)
  service.list 按 visibility+actor 过滤

query 缓存: mutation ok → invalidate
  ["agentProfiles","workspace",wid] / ["agentProfiles","platform"] / ["agentProfiles","mine"]
```

## 注意事项
- platform 级无 create/copy 入口是刻意设计（跨级移动为 admin 专能不经 API 暴露），勿补端点。
- `deleteAgentProfile` 只用于 workspace_id=null 的档案；普通用户删自己的 private 档依赖后端 owner-gated 端点（未开，页面侧保留友好提示）。
- 系统预置档案（is_system_default）后端拒删，UI 需屏蔽删除入口。
- queryKeys 内聚本模块（当时 allowed_paths 限制），与 custom-skills/mcp-settings 走中央 queryKeys 的做法等价；如迁移到 lib-query-keys 需同步全部 invalidate 调用点。
- `NO_PROFILE_VALUE=""` 与 components-sessions 的 `NO_PROVIDER_VALUE` 是同构约定：空串占位、提交侧转 null/剔除字段。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
