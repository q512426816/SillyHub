---
author: qinyi
created_at: 2026-06-24T01:50:01
source_commit: ba87eec
---

# agent-execution

## 目标
通过 Agent（claude-agent-sdk）执行自动化任务（扫描、代码生成、验证、交互式会话等）。

## 参与模块
- **backend/agent**：管理 AgentRun 生命周期、`execution-context` 派发
- **backend/worktree**：`acquire`/`release` Git 工作树租约隔离
- **backend/tool_gateway**：工具调用策略和审计
- **backend/runtime**：SSE 流推送进度到前端
- **sillyhub-daemon**：`SessionManager` 调用 `@anthropic-ai/claude-agent-sdk` 实际执行，`ws-client`/`hub-client` 回传

## 流程摘要
```text
[backend/agent]   创建 AgentRun (pending) + WorktreeLease
      │ GET /agent-runs/{id}/execution-context
      ▼
[sillyhub-daemon] claude-agent-sdk 执行
      ├─→ [ws-client] 实时 stdout/tool_call → [backend/runtime] SSE → [frontend]
      └─→ [hub-client] notifyRunResult → AgentRun completed/failed
[backend/worktree] release 租约
```

## 失败回滚
| 失败点 | 处理 |
|--------|------|
| claude-agent-sdk 启动失败 | SessionManager.fail，AgentRun=failed |
| 工作树冲突 | acquire 报错，人工解决 |
| 执行崩溃 | 标 failed，保留已收集日志/产物 |
| 超时 | missions/{id}/cancel 强制终止 |
