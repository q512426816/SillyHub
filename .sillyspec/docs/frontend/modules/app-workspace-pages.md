---
schema_version: 1
doc_type: module-card
module_id: app-workspace-pages
author: qinyi
created_at: 2026-06-10T16:55:00
---

# app-workspace-pages

## 定位
`/workspaces/[id]/*` 路径下的所有子页面。这些页面共享工作空间上下文，通过 URL 参数获取 workspaceId。是 app-pages 的子集，但因为共享工作空间上下文而独立归类。

## 契约摘要
- 工作空间详情、变更管理、Agent 控制、组件拓扑、知识库、发布、审批、审计、事件、运行时、扫描文档、创建变更
- 所有页面通过 `useParams()` 获取 `id`（workspaceId）参数
- 共享 AppShell 侧边栏导航中的工作空间相关链接

## 关键逻辑
- 页面加载时通过 `getWorkspace(id)` 获取工作空间元数据
- 子资源操作（变更、任务、Agent Run）均以 workspaceId 作为路径前缀
- 侧边栏导航由 AppShell 根据当前 workspaceId 动态生成链接
- 默认 Agent 下拉（2026-06-14）：设置页 `workspaces/[id]/page.tsx` 用 `AgentProviderSelect` 设 workspace.default_agent（PATCH 保存）；三处触发面板（`tasks/[tid]` task 触发 / `changes/[cid]` stage 手动 dispatch+scan / `workspace-scan-dialog`）接入同组件选 provider，默认跟随 workspace.default_agent

## 注意事项
- workspaceId 为空或不存在时，侧边栏中的工作空间相对链接会显示为禁用状态
- 新增工作空间子页面需要在 AppShell 的 OVERVIEW_NAV 或 MANAGEMENT_NAV 中添加导航项

## 人工备注

<!-- MANUAL_NOTES_START -->
- 2026-06-14-agent-runtime-selection：设置页接入默认 agent 下拉（PATCH workspace.default_agent）；task 触发 / stage 手动 dispatch / scan-generate 三处触发面板接入 provider 下拉；均使用共享组件 `AgentProviderSelect`（components-shared）。
<!-- MANUAL_NOTES_END -->
