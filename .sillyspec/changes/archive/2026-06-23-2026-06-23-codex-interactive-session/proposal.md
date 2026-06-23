---
author: qinyi
created_at: 2026-06-23 21:40:36
---

# Proposal

## 动机

`/runtimes` 页面中 Claude Code 已经使用完整的 interactive AgentSession 链路，支持多轮对话、流式日志、打断、结束、历史回看、reopen 和 daemon recovery。Codex 当前被临时分流到 quick-chat，无法获得这些能力，也让同一页面下的两个 runtime 行为不一致。

本变更要让 Codex runtime 与 Claude Code 在 `/runtimes` 的会话能力上保持一致，同时把 daemon interactive 架构从 Claude SDK 单 provider 演进为清晰、可扩展、可维护的 provider driver 模型。

## 关键问题

1. `SessionManager` 当前把 interactive 等同于 Claude SDK：`create()` 和 `restoreAndReconnect()` 明确拒绝非 Claude provider，`interrupt()` 也只通过单一 `deps.driver` 调用。
2. `/runtimes` Codex 走 quick-chat 后绕开 `AgentSession`，无法复用多轮、interrupt、end、history、reopen、recovery 和 permission/dialog 流。
3. Codex app-server 的 JSON-RPC 协议与 Claude SDK 不同，如果直接在 `SessionManager` 内写 Codex 分支，会继续扩大 provider 绑定和维护成本。

## 变更范围

- daemon 新增 provider-neutral `InteractiveDriver` 契约和 Codex app-server driver。
- daemon `SessionManager` 改为按 provider 路由 driver，并把 input queue、turn result、message、permission/dialog hook 从 Claude SDK 类型中解耦。
- backend 放开 Codex session reopen，并保持 `AgentSession` / `AgentRun` / `DaemonTaskLease` 控制面不变。
- frontend `/runtimes` Codex runtime 取消 quick-chat 分流，使用与 Claude Code 相同的 interactive session panel。
- 补齐 tests 和模块文档，确保 Claude Code 现有行为不回退。

## 不在范围内（显式清单）

- 不删除 quick-chat 全局能力，只是不再作为 `/runtimes` Codex runtime 的主路径。
- 不新增 Codex 专属 session 表或平行生命周期。
- 不新增 Codex 专属审批 UI；复用现有 permission/dialog 通道。
- 不接入新的 provider。范围仅包含 `claude` 和 `codex`。
- 不重构 batch `TaskRunner`，只抽取/复用必要 JSON-RPC 解析和响应能力。

## 成功标准（可验证）

- Codex runtime 首条消息调用 `createSession(provider="codex")`，不调用 quick-chat。
- Codex 同一 session 第二条消息调用 `injectSession()`，产生新的 `AgentRun`。
- Codex running turn 支持 interrupt，session 仍可继续。
- Codex session 支持 end、history、ended/failed reopen 和 daemon recovery。
- Codex request_user_input 与可支持的 MCP elicitation 能通过现有 dialog 卡片等待用户回答。
- Codex command/file/permission approval 策略与 Claude Code runtime 的 `manual_approval + ask_user_only` 行为一致。
- Claude Code 现有 interactive 测试全部通过。
- backend / frontend / daemon 相关测试和 typecheck/lint 通过。
