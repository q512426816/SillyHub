---
author: qinyi
created_at: 2026-06-02T09:49:00
---

# Proposal

## 动机

`POST /api/workspaces/{workspace_id}/spec-bootstrap` 是 Workspace 详情页触发平台托管 spec 初始化的入口。当前止血实现直接在后端调用 `sillyspec init --dir <spec_root>`，绕过了 `AgentSpecBundle -> ClaudeCodeAdapter -> AgentRun/SSE` 的既有 Agent 执行边界，无法支撑后续扩展、Agent scan、验证自修复以及执行中用户确认。

本变更要把 spec bootstrap 恢复为 Agent 驱动的异步执行闭环：接口立即返回 `agent_run_id` 和 `stream_url`，后台通过 `ClaudeCodeAdapter` 执行 `sillyspec init`、`sillyspec run scan` 和验证收尾，前端通过同一套 Agent SSE 消息流展示进度，并提供 Workspace 内联交互和 Agent 控制台完整交互。

## 关键问题

1. **同步调用导致页面无输出**：如果 `/spec-bootstrap` 等待 Agent 完整执行结束才响应，前端无法提前拿到 `agent_run_id` 连接 SSE，用户会看到长时间空白。
2. **直接 CLI 破坏扩展边界**：后端直接 `subprocess` 调 `sillyspec` 只能解决 init，无法复用 `AgentSpecBundle`、adapter registry、AgentRunLog、Redis Pub/Sub、kill/resume/approval 等 Agent 能力。
3. **缺少执行中确认通道**：Claude Code 当前禁用了 `AskUserQuestion` 工具，且前端没有针对 bootstrap run 的用户输入入口，Agent 遇到不确定选择时无法把问题显式交给用户。

## 变更范围

- `/spec-bootstrap` 改为创建 `AgentRun` 后立即返回，不同步等待后台 Agent 完成。
- `SpecBootstrapService` 构造 bootstrap 专用 `AgentSpecBundle`，通过 `ClaudeCodeAdapter.run_with_bundle()` 执行。
- Agent prompt 恢复 `sillyspec init --dir <spec_root>`、`sillyspec run scan --dir <spec_root>` 和验证要求。
- 后台任务完成后用 `SpecValidator` 更新 `SpecWorkspace.sync_status`、`last_synced_at` 和 `SpecConflict`。
- Workspace 详情页根据返回的 `agent_run_id` 连接 SSE，展示实时日志、完成状态和待用户输入入口。
- Agent 控制台展示同一 run 的完整日志和用户输入入口。
- 最小交互实现通过 AgentRunLog/事件记录用户指导，后续可升级为真正的进程级暂停/恢复。

## 不在范围内（显式清单）

- 不新增独立 `SillySpecCliAdapter`。
- 不实现完整 Claude 子进程暂停后恢复协议。
- 不重构全局审批中心或 tool gateway 审批模型。
- 不改造所有 Agent run 的交互协议，只覆盖 bootstrap run 的最小用户指导链路。
- 不改变现有 Worktree lease、kill、resume token 的基础语义。

## 成功标准（可验证）

- 点击 Workspace 详情页 Bootstrap 后，接口立即返回 `agent_run_id`，页面能立刻显示日志流。
- 后台执行路径调用 `ClaudeCodeAdapter.run_with_bundle()`，不是直接 `_run_sillyspec_init()`。
- Agent prompt 明确包含 `sillyspec init --dir <spec_root>` 和 `sillyspec run scan --dir <spec_root>`。
- bootstrap run 的 stdout/stderr/tool_call 日志能通过 `/agent/runs/{id}/stream` 实时展示，并可从 DB 历史回放。
- 后台执行结束后，`SpecValidator` 结果能更新 `sync_status` 并创建 `SpecConflict`。
- Workspace 详情页和 Agent 控制台都能看到待用户确认/指导入口。
