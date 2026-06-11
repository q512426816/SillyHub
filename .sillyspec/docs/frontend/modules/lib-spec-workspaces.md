---
schema_version: 1
doc_type: module-card
module_id: lib-spec-workspaces
author: qinyi
created_at: 2026-06-10T16:55:00
---

# lib-spec-workspaces

## 定位
Spec Workspace API 客户端。管理 SillySpec 工作空间的 spec 配置、同步、冲突解决。

## 契约摘要
- `getSpecWorkspace(workspaceId)` — 获取 spec 工作空间配置
- `importSpecWorkspace(workspaceId)` — 导入 spec 工作空间
- `syncSpecWorkspace(workspaceId)` — 同步 spec 工作空间
- `bootstrapSpecWorkspace(workspaceId)` — 引导创建 spec 工作空间（返回 AgentRun）
- `updateSpecWorkspace(workspaceId, input)` — 更新配置（strategy/repo_sillyspec_path/profile_version）
- `listSpecConflicts(workspaceId, params?)` — 列出 spec 冲突
- `resolveSpecConflict(workspaceId, conflictId, input)` — 解决冲突
- 类型：SpecWorkspace、SpecStrategy、SyncStatus、SpecConflictRead

## 关键逻辑
- SpecStrategy: "platform-managed" | "repo-mirrored" | "repo-native"
- bootstrapSpecWorkspace 会触发 AgentRun（返回 agent_run_id 和 stream_url）
- 冲突状态：open / approved / rejected / resolved

## 注意事项
- 此模块依赖 lib/agent 的 AgentRunStatus 类型

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
