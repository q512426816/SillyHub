---
author: qinyi
created_at: 2026-06-03T09:50:00
---

# agent-execution

## 目标
通过 Claude Code CLI 执行自动化任务（扫描、代码生成、验证等）。

## 参与模块
- **agent**: 管理 AgentRun 生命周期，调用 Claude Code CLI
- **tool_gateway**: 工具调用策略和审计
- **worktree**: Git worktree 隔离管理
- **git_gateway**: Git 操作（commit、push 等）

## 流程摘要
```text
创建 AgentRun (status=pending)
  → 分配 worktree（隔离工作空间）
  → 调用 Claude Code CLI（subprocess）
  → 实时捕获 stdout/stderr
  → SSE 流推送日志到前端
  → AgentRun 完成 (status=completed/failed)
  → 审计日志记录到 tool_gateway
```

## 失败回滚
| 失败点 | 处理 |
|--------|------|
| Claude Code CLI 崩溃 | AgentRun 标记 failed，记录错误日志 |
| worktree 冲突 | 自动清理后重试 |
| 超时 | 标记 timeout，允许用户取消 |
