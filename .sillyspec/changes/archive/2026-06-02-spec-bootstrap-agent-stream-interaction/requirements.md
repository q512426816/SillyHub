---
author: qinyi
created_at: 2026-06-02T09:49:00
---

# Requirements

## 角色

| 角色 | 说明 |
|---|---|
| Workspace 用户 | 点击 Bootstrap，观察初始化、scan、验证进度，并在需要时提供指导 |
| Agent 执行器 | 通过 ClaudeCodeAdapter 消费 AgentSpecBundle，执行 SillySpec CLI 和验证修复 |
| 平台后端 | 管理 AgentRun 生命周期、日志流、验证结果和冲突记录 |
| 平台前端 | 在 Workspace 详情页和 Agent 控制台展示日志与交互入口 |

## 功能需求

### FR-01: spec-bootstrap 创建异步 AgentRun

Given 用户拥有 `WORKSPACE_WRITE` 权限且 workspace 存在对应 SpecWorkspace  
When 用户调用 `POST /api/workspaces/{workspace_id}/spec-bootstrap`  
Then 后端创建 `AgentRun(status=pending)` 和 `AgentRunWorkspace` 关联，并立即返回 `agent_run_id`、`stream_url`、`status`

Given 后台任务已启动  
When Agent run 状态变为 `running`  
Then 前端可通过 `/api/workspaces/{workspace_id}/agent/runs/{agent_run_id}/stream` 获取实时日志

### FR-02: bootstrap 通过 ClaudeCodeAdapter 执行

Given `SpecBootstrapService` 已加载 `SpecWorkspace` 和 `Workspace`  
When 后台执行 bootstrap run  
Then 后端构造 `AgentSpecBundle` 并调用 `ClaudeCodeAdapter.run_with_bundle()`  
And 不直接通过 `_run_sillyspec_init()` 或裸 `asyncio.create_subprocess_exec()` 执行 `sillyspec`

### FR-03: Agent 执行 init + scan + 验证

Given Agent 收到 bootstrap bundle  
When `ClaudeCodeAdapter` 启动 Claude CLI  
Then prompt 必须包含 `sillyspec init --dir <spec_root>`  
And prompt 必须包含 `sillyspec run scan --dir <spec_root>`  
And prompt 必须要求验证 `.sillyspec/projects` 结构和 YAML 结果

Given Agent 执行结束  
When 后端运行 `SpecValidator.validate(spec_root)`  
Then 验证通过时 `SpecWorkspace.sync_status=clean` 且更新 `last_synced_at`  
And 验证失败时 `SpecWorkspace.sync_status=dirty` 并创建 `SpecConflict`

### FR-04: Workspace 页面实时展示消息流

Given `/spec-bootstrap` 返回 `agent_run_id`  
When Workspace 详情页收到响应  
Then 页面立即连接该 run 的 SSE stream  
And 展示 stdout/stderr/tool_call 日志  
And run 完成后显示最终状态和验证结果

### FR-05: 双入口用户确认/指导

Given Agent 输出需要用户确认或指导的事件  
When 前端解析到 pending input 状态  
Then Workspace 详情页展示轻量输入框  
And Agent 控制台展示同一 run 的完整交互面板

Given 用户提交指导文本  
When 后端收到用户输入  
Then 用户输入记录到 `AgentRunLog`  
And SSE 向当前 run 推送用户指导事件  
And 后续 Agent 引导或重试能读取该输入

## 非功能需求

- 兼容性：保留现有 AgentRun、AgentRunLog、AgentRunWorkspace、SpecWorkspace、SpecConflict 模型，不新增数据库表作为第一步。
- 可回退：如果后台任务启动失败，AgentRun 必须进入 `failed`，并写入 stderr 日志。
- 可测试：单测必须覆盖立即返回、调用 `ClaudeCodeAdapter.run_with_bundle()`、验证收尾、命令失败/验证失败冲突记录。
- 可观察性：所有 bootstrap run 都可在 Agent 控制台按 `agent_run_id` 查看。
- 安全性：用户输入接口必须要求 `WORKSPACE_WRITE`，并校验 run 属于当前 workspace。
