---
author: hermes
created_at: "2026-05-31T16:00:00Z"
---

# Stage-Driven Agent Dispatch

## 问题

当前 Change 工作流的 10 阶段状态机只更新 DB 状态，不触发 Agent 执行。
用户点击"提交审核"（draft→clarifying）后，只是数据库字段变了，没有 Agent 自动分析需求、生成澄清文档等。

## 目标

每个阶段流转后，根据目标阶段自动派发 Claude Code Agent 执行对应阶段的任务。

### 阶段→Agent 任务映射

| 目标阶段 | Agent 任务 | 输入 | 输出 |
|---------|-----------|------|------|
| clarifying | 分析需求，生成澄清问题和补充说明 | change proposal + spec | clarifying.md 更新 |
| design_review | 生成设计方案评审文档 | proposal + clarifying notes | design.md |
| ready_for_dev | 生成开发计划，拆分 task 列表 | proposal + design + tasks | tasks/task-*.md |
| in_dev | 自动执行 task（逐个） | task 蓝图 + codebase | 代码修改 |
| technical_verification | 自动运行测试，生成验证报告 | codebase + tests | verification report |
| business_review | 生成验收报告 | 全部文档 + 验证结果 | review report |

### 不触发 Agent 的阶段
- `draft`（初始阶段）
- `rework_required`（等待人工处理反馈）
- `accepted`（终态，等待归档）
- `archived`（最终归档）

## 范围

1. **后端**：在 `ChangeService.transition()` 后添加 Agent 调度 hook
2. **配置**：阶段→Agent prompt 映射表（YAML 或 Python dict）
3. **前端**：展示 Agent 运行状态（利用已有 EventSource 基础设施）
4. **已有的基础设施**：
   - `AgentService.start_run()` — 需 task_id + lease_id + worktree
   - `Task` 模型 — 关联 change_id，有 phase/status
   - `EventSource` 流式日志 — 前端已可订阅 agent run
   - `WorktreeLease` — agent 工作目录管理

## 约束

- Agent 派发应为异步（fire-and-forget），不阻塞 transition 响应
- 如果同一 change 已有 agent 正在运行，排队或拒绝新派发
- rework_required→下一阶段 不自动触发 agent（人工处理反馈后手动提交）
- Agent 运行失败不影响 transition 状态（transition 已完成）
