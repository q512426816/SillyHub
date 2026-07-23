---
author: qinyi
created_at: 2026-07-12 12:38:20
---

# 需求（Requirements）— team 主 agent 动态编排（v2）

## 功能需求

### FR-1 主 agent（真 agent）
主 agent 是真 agent（claude code/codex/cursor 任选），走 daemon interactive lease，长生命周期（跨多 worker 周期），有工具（读码/看文件/MCP tool 派 worker），能读 worker 实际产出动态决策。`AgentRun(role='orchestrator')`。

### FR-2 用户预设 worker 列表
UI 配 worker 列表，每条指定：agent 类型 + 模型 + 任务/objective + role（impl/verify/test）。主 agent 按列表派发 + 动态调度（补/调整/收敛）。

### FR-3 per-worker 独立 worktree
每个写代码 worker 独立 git worktree（临时分支），互不覆盖。主 agent converge 时合并 patch（冲突人审 apply-back）。

### FR-4 MCP tool 反向调用
主 agent 通过 MCP tool 调 backend：`dispatch_worker` / `get_worker_result` / `list_workers` / `converge_mission` / `report_progress`。daemon→backend 用 auth token + WORKSPACE_WRITE 权限校验 + 限流。

### FR-5 三重收敛
team 在以下任一条件收敛：(1) 所有预设 worker 完成；(2) 主 agent 判断目标达成；(3) 预算/超时硬截断。

### FR-6 自由组合 agent 类型/模型
主 agent + 每个 worker 都可独立选 agent 类型（claude code/codex/cursor）+ 模型（glm/gpt/claude/deepseek）。GLM 不再特殊。

### FR-7 v1 演进（GLM fallback）
mode=single 走 v1 原路径；mode=team 走 v2 主 agent；主 agent 不可用 / 用户选 GLM 时退化 v1 GLM 链路。

### FR-8 三入口
mission 页 / execute·verify stage / 会话 三入口都支持主 agent team。

### FR-9 single 零回归
mode=single 行为完全不变（v1 原路径，单测守护）。

## 非功能需求
- **NFR-1 安全**：MCP 反向调用鉴权（daemon auth token）+ 权限校验 + 限流
- **NFR-2 成本**：budget_usd 硬截断 + 前端 CostBar 实时展示
- **NFR-3 可观测**：主 agent 决策日志 + worker 进度 + cost 实时可见
- **NFR-4 健壮**：主 agent lease 心跳续期 + 崩溃恢复（复用 daemon session 恢复）
