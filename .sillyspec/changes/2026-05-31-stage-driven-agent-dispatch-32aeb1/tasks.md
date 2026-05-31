---
author: hermes
created_at: "2026-05-31T16:15:00Z"
---

# 任务分解：Stage-Driven Agent Dispatch

## Wave 1: 后端核心 — Dispatch Service + 阶段配置
- task-01: 创建 StageAgentConfig 数据类和阶段配置表
- task-02: 创建 AgentDispatchService（并发检查、lease 创建、dispatch 逻辑）
- task-03: 修改 ChangeService.transition() 集成 dispatch hook

## Wave 2: AgentService 扩展 — Stage Dispatch 模式
- task-04: 新增 AgentService.start_stage_dispatch() 方法（change_id + stage 模式）
- task-05: 创建 6 个阶段的 prompt 模板文件
- task-06: 新增 dispatch 手动触发 API endpoint

## Wave 3: 前端 — Agent 状态展示
- task-07: Change 详情页添加 Agent 运行状态 badge
- task-08: Agent 实时日志面板（复用 EventSource）
- task-09: "重新派发" 按钮
