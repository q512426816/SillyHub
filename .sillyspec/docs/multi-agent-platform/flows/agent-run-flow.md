---
author: qinyi
created_at: 2026-06-04T10:00:00+08:00
---

# Agent 运行流程

## 目标
安全可控地执行 Claude Code CLI Agent，实时流式输出并持久化日志。

## 参与模块
- **backend/agent**：Agent 管理、适配器抽象、进程协调
- **backend/runtime**：运行时上下文、工具调用网关
- **backend/worktree**：Git 工作树租约管理
- **backend/redis**：SSE 流发布、进程信号传递
- **frontend**：EventSource 连接、流式 UI 渲染
- **claude-code**：外部 CLI 子进程

## 流程摘要

```text
┌──────────────────┐
│ 创建 AgentRun    │
│ (spec + context) │
└───────┬──────────┘
        │
        ▼
┌──────────────────────┐
│  启动 Claude 适配器  │
│  (Docker subprocess)│
└───────┬──────────────┘
        │
        ▼
┌──────────────────────┐
│  工作树租约 (可选)   │
│  (git worktree add)  │
└───────┬──────────────┘
        │
        ▼
┌──────────────────────┐
│  执行 claude CLI     │
│  (guarded command)   │
└───────┬──────────────┘
        │
        ▼
┌─────────────────────┐
│  stdout → AgentLog  │
│  (实时 DB 写入)      │
└───────┬──────────────┘
        │
        ├──────────────────────┐
        ▼                      ▼
┌──────────────────┐  ┌─────────────────┐
│  SSE 流发布       │  │  tool_call 事件 │
│  (Redis channel)  │  │  (Redis pub)    │
└───────┬──────────┘  └─────────────────┘
        │
        ▼
┌─────────────────────┐
│  前端 EventSource   │
│  (重连 + 去重)      │
└─────────────────────┘
        │
        ▼
┌──────────────────┐
│  Agent 完成/失败 │
│  (状态更新)      │
└───────┬──────────┘
        │
        ▼
┌─────────────────────┐
│  清理工作树 (可选)  │
│  (释放租约)         │
└─────────────────────┘
```

## 失败回滚

| 失败点 | 处理 |
|--------|------|
| Docker 启动失败 | 发布 stderr 事件 + done 状态 |
| 工作树冲突 | 返回冲突错误，手动解决 |
| Agent 崩溃 | 标记 failed，保留已收集日志 |
| SSE 断连 | 前端自动重连（指数退避，最多 5 次） |
| 超时无响应 | 可通过 kill API 强制终止 |

## 关键术语
- **AgentSpecBundle**：Agent 规范包（指令、工具权限、工作目录）
- **AgentAdapter**：适配器抽象（ClaudeCodeAdapter 实现）
- **AgentRunLog**：日志条目（stdout/stderr/tool_call/done）
- **WorktreeLease**：工作树租约，防止并发冲突
- **Cursor**：SSE 重连游标（after log_id）
