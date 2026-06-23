---
author: qinyi
created_at: 2026-06-24T01:50:01
source_commit: ba87eec
---

# Agent 运行流程

## 目标
安全可控地执行 Agent（claude-agent-sdk），实时流式输出日志并持久化，结果回传 Hub。

## 参与模块
- **backend/agent**：AgentRun 生命周期、`execution-context` 派发、placement（server/daemon）
- **backend/worktree**：`acquire`/`release` 工作树租约（`WorktreeLease`，status: pending/claimed/completed）
- **backend/runtime**：SSE 进度、user-inputs、artifacts 端点（`/workspaces/{id}/runtime*`）
- **sillyhub-daemon**：`SessionManager` + `@anthropic-ai/claude-agent-sdk` 实际执行；`ws-client` 实时通道、`hub-client` REST 回传
- **frontend**：`use-agent-run-stream` / `agent-stream`（EventSource 重连去重）、`runtime.ts`
- **backend/tool_gateway**：工具调用策略与审计

## 流程摘要
```text
[backend/agent] 创建 AgentRun (status=pending)
   │ render_bundle_to_claude_md 生成 claude_md
   ▼
[backend/worktree] acquire WorktreeLease (pending→claimed)  ← 隔离工作空间
   ▼
[backend/agent] GET /agent-runs/{id}/execution-context  ← daemon 拉取上下文
   │ 含 lease.metadata (stage/step_prompt/spec_root) + claim_token
   ▼
[sillyhub-daemon] SessionManager.create (claude-agent-sdk)
   │ SDK 执行 prompt，产出 turn result / 日志
   ├─[ws-client] WebSocket 实时推日志/tool_call → backend runtime
   └─[backend] SSE /workspaces/{id}/runtime → frontend EventSource 渲染
   ▼
[sillyhub-daemon] SessionManager.end/fail
   └─[hub-client] POST notifyRunResult → backend 关闭 run
   ▼
[backend/agent] AgentRun status=completed/failed
[backend/worktree] release WorktreeLease (释放租约)
```
> 注：interactive session 走 lease.metadata + claim_token；非交互（scan 等）走同条 execution-context 链路。

## 失败回滚
| 失败点 | 处理 |
|--------|------|
| execution-context 缺 lease.metadata | backend 记 warning，daemon 用默认参数 |
| claude-agent-sdk 启动失败 | SessionManager.fail → notifyRunResult，run=failed |
| 工作树冲突 | acquire 返回错误，人工解决 |
| SDK 执行崩溃 | 标 failed，保留已收集日志/产物 |
| WebSocket 断连 | daemon reconnecting→restoreAndReconnect；frontend EventSource 自动重连去重 |
| 超时无响应 | missions/{id}/cancel 强制终止 |

## 关键术语
- **AgentRun**：运行实例（spec bundle + 状态）
- **DaemonTaskLease**：daemon 拉取上下文的租约（pending/claimed），携带 metadata + claim_token
- **execution-context**：`GET /agent-runs/{id}/execution-context`，daemon 启动所需全部参数
- **SessionManager**：daemon 侧 claude-agent-sdk 会话管理器（create/restore/end/fail）
- **RuntimeProgress**：SSE 推送的进度对象（current_stage / stages / version）
