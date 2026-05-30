---
author: qinyi
created_at: 2026-05-30T18:51:00
---

# Requirements: Agent Adapter 补全

## 角色

| 角色 | 说明 |
|---|---|
| 平台开发者 | 通过 API 启动和管理 Agent Run |
| 运维人员 | 通过前端监控页面查看 Agent 运行状态 |
| 系统 | 自动收集 diff、记录审计日志、管理进程生命周期 |

## 功能需求

### FR-01: Kill 运行中的 Agent

**Given** 一个 AgentRun 处于 `running` 状态
**When** 开发者调用 `POST /api/workspaces/{ws_id}/agent/runs/{run_id}/kill`
**Then** Agent 子进程收到 SIGTERM 信号，最多等待 5s 后发送 SIGKILL
**And** AgentRun.status 更新为 `killed`
**And** AgentRun.finished_at 更新为当前时间
**And** 审计日志记录 `agent.kill` 事件

**Given** 一个 AgentRun 处于 `completed` 或 `failed` 状态
**When** 开发者调用 kill 端点
**Then** 返回 409 AgentRunNotRunning 错误

**Given** 一个不存在的 run_id
**When** 开发者调用 kill 端点
**Then** 返回 404 AgentRunNotFound 错误

### FR-02: Diff 收集

**Given** 一个 Agent Run 在 lease 目录中执行完成（exit_code=0）
**When** `_execute_run_background` 完成执行
**Then** `collect_diff(lease_path)` 被调用
**And** `AgentRun.diff_summary` 被更新为 git diff --stat 的脱敏输出
**And** diff 结果中的 PAT/secret 被自动脱敏

**Given** lease 目录不是一个 git 仓库（无 .git 目录）
**When** `collect_diff` 被调用
**Then** 返回空的 `DiffResult`（files_changed=0）
**And** 不抛出异常

**Given** Agent 执行被 kill（status=killed）
**When** diff 收集触发
**Then** 仍然收集 diff（Agent 可能已产生部分变更）

### FR-03: 进程注册表

**Given** AgentService 创建一个 Agent 子进程
**When** `_exec_stream` 开始执行
**Then** 进程引用被注册到 `_proc_registry[run_id]`

**Given** Agent 子进程退出（正常完成/失败/超时）
**When** `_exec_stream` 返回
**Then** `_proc_registry[run_id]` 被移除

### FR-04: Stale Run 清理

**Given** 服务重启后存在 status=running 的 AgentRun 记录
**When** AgentService 被初始化（或首次调用时）
**Then** 这些记录的 status 被更新为 `failed`
**And** `output_redacted` 被设置为 "Process lost due to server restart"

### FR-05: Allowed Paths 隔离

**Given** 一个 AgentSpecBundle 中 allowed_paths=["/path/to/lease"]
**When** ClaudeCodeAdapter 构建子进程环境变量
**Then** `CLAUDE_ALLOWED_PATHS` 环境变量被设置为该路径

**Given** 一个 AgentSpecBundle 中 allowed_paths 为空
**When** ClaudeCodeAdapter 构建子进程环境变量
**Then** `CLAUDE_ALLOWED_PATHS` 环境变量不被设置

### FR-06: 输出脱敏

**Given** Agent 输出中包含 PAT 模式（如 `ghp_xxxx`、`glpat-xxxx`）
**When** 输出被收集到 `AgentRun.output_redacted` 或 `AgentRunLog.content_redacted`
**Then** PAT 被替换为 `[REDACTED]`

### FR-07: 前端 Agent Run 列表页

**Given** 用户访问 `/workspaces/{id}/agent` 页面
**When** 页面加载
**Then** 显示该 workspace 下所有 AgentRun 的列表
**And** 每个 run 显示为卡片，包含：任务标题、状态 badge、agent_type、时间、持续时间

### FR-08: 前端 Agent Run 详情页

**Given** 用户点击某个 Agent Run 卡片
**When** 跳转到 `/workspaces/{id}/agent/{runId}`
**Then** 显示运行详情（状态、类型、时间、exit code、spec strategy）
**And** 显示实时 SSE 日志流（running 状态时）
**And** 显示 Kill 按钮（仅 running 状态时可用）
**And** 显示 Diff Summary（completed/failed 状态时）

### FR-09: 前端 SSE 日志流

**Given** Agent Run 处于 running 状态
**When** 用户打开详情页
**Then** 通过 EventSource 连接 `/api/.../stream` 端点
**And** 实时显示日志行（按 channel 着色：stdout/stderr/tool_call）
**And** 收到 `event: done` 时显示 "Agent completed" 并关闭连接

## 非功能需求

- **安全性**：Kill 端点需要 `TASK_RUN_AGENT` 权限，与创建 run 权限一致
- **可靠性**：SIGTERM 后 5s 兜底 SIGKILL，确保进程不泄漏
- **可测试性**：所有外部依赖（子进程、Redis、git 命令）均可 mock
- **兼容性**：不修改现有 API 签名，新增端点独立
- **性能**：diff 收集仅在 run 完成后执行，不阻塞主流程
