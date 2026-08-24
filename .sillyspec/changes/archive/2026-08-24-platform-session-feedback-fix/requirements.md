---
author: qinyi
created_at: 2026-08-24 10:45:00
---

# 需求规格（Requirements）— 平台会话实时反馈修复

## 角色

| 角色 | 说明 |
|---|---|
| 终端用户 | 在 Web 平台会话中与 Agent 交互的人类用户 |
| Agent | 通过 sillyhub-daemon 运行的 Claude / Codex 等智能体 |
| 平台后端 | FastAPI backend，负责事件持久化与转发 |
| 平台前端 | Next.js Web UI，负责事件消费与渲染 |

## 功能需求

### FR-01: Bash 命令实时反馈

覆盖决策：D-002@v1

**Given** Agent 在会话中开始执行 Bash 工具  
**When** daemon 检测到 Bash tool_use 开始、输出 chunk、命令结束  
**Then** 后端向 `agent_session:{id}` 频道依次发布 `bash_status(running)`、`bash_chunk`、`bash_status(completed/failed)` 事件，前端渲染 BashProgressCard 显示命令、spinner、实时输出和退出码

边界：
- `bash_chunk` 应按 100ms 节流，单条 content 不超过 8KB。
- 命令结束后卡片状态更新为 completed/failed，保留最终输出。

### FR-02: Plan 模式强确认

覆盖决策：D-001@v1, D-002@v1

**Given** Agent 通过 `EnterPlanMode` 进入计划阶段  
**When** daemon 上报 `plan_mode_entered` 事件  
**Then** 前端弹出 PlanApprovalCard，展示计划目标与任务列表；用户选择 confirm/revise/cancel 后，前端调用 `POST /api/daemon/sessions/{session_id}/plan-response`，后端通过 WebSocket Hub 通知 daemon，Agent 收到后才继续执行

边界：
- 用户在 30 分钟内未响应，视为 revise 并提示 Agent。
- revise/cancel 必须填写 feedback。

### FR-03: 后台 Agent 任务进度可见

覆盖决策：D-002@v1

**Given** 当前会话启动了后台 Agent 任务（如 Design Grill 子代理、workflow 子任务）  
**When** 任务开始、进展、完成  
**Then** 后端/平台向同一会话发布 `agent_task_status` 事件，前端显示任务卡片；任务未结束时，会话不提前标记为「已完成」

边界：
- 仅展示任务级状态（running/completed/failed），不展示任务内部细节。
- 任务失败时显示简短原因与重试入口。

### FR-04: AskUser 弹窗可最小化

覆盖决策：D-003@v1

**Given** 前端弹出 askuser / permission 弹窗  
**When** 用户点击最小化按钮  
**Then** 弹窗收缩为右下角浮动胶囊，显示未决角标；点击胶囊可还原弹窗；用户仍可正常提交决策

边界：
- 最小化状态在当前会话内保持，刷新页面后默认展开。
- 多个未决弹窗时胶囊显示累计数量。

## 非功能需求

- **兼容性**：新增 SSE 事件对旧前端/daemon 向后兼容；旧前端忽略不认识的事件。
- **可回退**：新功能默认开启，无配置开关；若出现严重问题，可通过前端 feature flag 临时隐藏新卡片。
- **可测试**：每个新增事件类型、每个新增组件、每个新增端点都有对应单测。
- **跨平台**：daemon 上报逻辑兼容 Windows / Linux / macOS。

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-02 | plan 模式采用强确认交互 |
| D-002@v1 | FR-01, FR-02, FR-03 | 复用现有 SSE 事件通道，新增事件类型 |
| D-003@v1 | FR-04 | askuser 弹窗支持最小化 |
