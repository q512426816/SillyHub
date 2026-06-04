---
author: WhaleFall
created_at: 2026-06-03 15:17:41
---

# Requirements

## 角色

| 角色 | 说明 |
|---|---|
| 平台用户 | 在「添加 Workspace」中点击「生成项目规范」，期望进入详情页观察 Bootstrap 进度并自动获得子组件 |

## 功能需求

### FR-01: 生成项目规范统一为 Bootstrap 流程并跳转详情页

Given 用户在「添加 Workspace」弹窗已完成扫描，处于 ready 阶段
When 用户点击「生成项目规范」按钮
Then 前端调用 `scanGenerate(rootPath)` 创建（或幂等复用）workspace 与 scan run
And 立即 `router.push('/workspaces/{workspace_id}')` 跳转详情页并关闭弹窗
And 弹窗内不再展示 SSE 日志

### FR-02: 进入详情页自动检测并恢复进行中的 Bootstrap 回显

Given 某 workspace 存在一个 `change_id` 为空、status 为 pending 或 running 的 scan run
When 用户进入 `/workspaces/{id}` 详情页（首次进入或刷新）
Then `load()` 通过 `listWorkspaceAgentRuns` 查到该进行中 run
And 自动用 `AgentRunStreamClient` 连接其 SSE 流，实时回显 agent 日志
And Bootstrap 按钮处于禁用态

### FR-03: Bootstrap 执行期间防止重复触发

Given 某 workspace 已有进行中（pending/running）的 scan run
When 用户（在详情页或另一标签页弹窗）再次发起 `scan-generate`
Then 后端不创建新 run，幂等返回现有进行中 run 的 id
And 前端 Bootstrap 按钮在 `activeBootstrapRunId` 存在时保持禁用

### FR-04: Bootstrap 成功后自动创建子组件

Given scan agent 执行成功（exit_code == 0）
And `spec_root/projects/*.yaml` 中声明了子组件
When 后端 `_execute_scan_run` 进入成功收尾分支
Then 自动执行 reparse 逻辑，创建对应子 workspace 与 relations
And reparse 若失败仅记录 warning 日志，不将该 run 标记为 failed

### FR-05: 完成后详情页刷新子组件计数

Given 详情页已连接的 Bootstrap SSE 流收到 done 事件
When `onDone` 回调触发
Then 调用 `load()` 重新拉取数据
And 「项目组组件」计数反映后端自动 reparse 后的最新子组件数量

## 非功能需求

- 兼容性：复用现有 `spec-bootstrap` / scan agent SSE 管线与 `reparse` API，不新增表/字段；「直接创建」行为不变。
- 可回退：改动集中在 `scan_generate`、`_execute_scan_run`、`workspace-scan-dialog.tsx`、`workspaces/[id]/page.tsx`，可独立回退。
- 可测试：后端幂等返回与收尾 reparse 可通过 service 层单测覆盖；前端跳转与恢复回显可手动验证。
- 健壮性：reparse 作为收尾增强，失败不阻断主 run；SSE 恢复失败有错误提示但不阻塞页面其他信息加载。
