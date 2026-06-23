---
schema_version: 1
doc_type: module-card
module_id: lib-spec-workspaces
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:02:25
---
# lib-spec-workspaces

## 定位
SillySpec 工作空间配置与同步的前端 API 客户端。管理一个工作空间的 spec 存储策略（platform-managed/repo-mirrored/repo-native）、配置读写、同步触发、引导初始化，以及 spec 文件冲突的查阅与解决。是 SillySpec 文档驱动链路的前端入口。

## 契约摘要
| 函数 | 语义 | HTTP |
|---|---|---|
| `getSpecWorkspace(workspaceId)` | 取 spec 工作空间配置 | GET `/api/workspaces/{ws}/spec-workspace` |
| `updateSpecWorkspace(workspaceId, input)` | 更新配置（strategy/repo_sillyspec_path/profile_version） | PATCH `/api/workspaces/{ws}/spec-workspace` |
| `importSpecWorkspace(workspaceId)` | 导入已有 spec（从仓库/镜像） | POST `/api/workspaces/{ws}/spec-workspace/import` |
| `syncSpecWorkspace(workspaceId)` | 触发一次同步 | POST `/api/workspaces/{ws}/spec-workspace/sync` |
| `bootstrapSpecWorkspace(workspaceId)` | 引导初始化（触发 AgentRun） | POST `/api/workspaces/{ws}/spec-bootstrap` |
| `generateProjects(workspaceId)` | 生成项目结构（返回 AgentRun） | POST `/api/workspaces/{ws}/generate-projects` |
| `listSpecConflicts(workspaceId, params?)` | 列出 spec 冲突 | GET `/api/workspaces/{ws}/spec-conflicts` |
| `resolveSpecConflict(workspaceId, conflictId, input)` | 解决单个冲突 | POST `/api/workspaces/{ws}/spec-conflicts/{cid}/resolve` |

类型：
- `SpecStrategy`：`"platform-managed" | "repo-mirrored" | "repo-native"`。
- `SyncStatus`：`"clean" | "dirty" | "conflicted"`。
- `SpecWorkspace`：`id/workspace_id/spec_root/strategy/repo_sillyspec_path/profile_version/sync_status/last_synced_at`。
- `BootstrapResult`/`GenerateProjectsResult`：含 `agent_run_id` + `stream_url`（异步任务句柄）。
- `SpecConflictStatus`：`open/approved/rejected/resolved`；`SpecConflictRead`/`SpecConflictResolveInput`。

## 关键逻辑
```
bootstrap / generate-projects 返回 AgentRun 句柄，前端需配合
  lib-agent-stream 订阅流式进度
sync 后若 sync_status=conflicted，再走 listSpecConflicts → resolveSpecConflict 逐条处理
```

## 注意事项
- 依赖 `lib-api` 与 `lib-agent`（使用 `AgentRunStatus` 等类型）。
- `strategy` 决定 spec 文件存储位置：平台托管 / 仓库镜像 / 仓库原生，切换策略可能引发冲突。
- bootstrap/generate 为长任务，不要同步等待，必须用返回的 run_id 走流式订阅。
- 冲突解决是逐条进行，`resolveSpecConflict` 需传 conflictId 与决策 input。
- `_module-map` 标注 used_by 为空，目前无页面直接消费（多为 Agent 内部链路或后台触发）。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
