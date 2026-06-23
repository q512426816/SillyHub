---
author: qinyi
created_at: 2026-06-23 21:40:36
---

# Requirements

## 角色

| 角色 | 说明 |
| --- | --- |
| 开发者 | 在 `/runtimes` 页面选择本机 runtime，并与 Claude Code 或 Codex 进行 interactive 会话 |
| daemon | 本机 `sillyhub-daemon`，负责接收 backend session 控制消息并驱动 provider CLI |
| backend | FastAPI 服务，负责 `AgentSession`、`AgentRun`、lease、日志、permission/dialog 生命周期 |
| frontend | Next.js 页面与组件，负责 runtime 会话 UI、SSE 日志、interrupt/end/reopen 和 dialog 卡片 |

## 功能需求

### FR-01: Codex runtime 创建 interactive session

覆盖决策：D-001@v1, D-002@v1, D-003@v1, D-005@v1, D-009@v1

Given `/runtimes` 中存在在线 Codex runtime
When 用户在 Codex runtime 会话弹窗中发送首条消息
Then frontend 调用 `createSession({provider:"codex"})`
And backend 创建 `AgentSession`、首个 `AgentRun` 和 interactive `DaemonTaskLease`
And daemon 使用 Codex provider driver 启动 `codex app-server --listen stdio://`
And 不调用 quick-chat API

### FR-02: Codex 支持同一 session 多轮对话

覆盖决策：D-001@v1, D-002@v1, D-003@v1, D-009@v1

Given Codex `AgentSession` 已 active
When 用户发送第二条消息
Then frontend 调用 `injectSession(sessionId,prompt)`
And backend 在同一 `AgentSession` 下创建新的 `AgentRun`
And daemon 将 prompt 放入 provider-neutral input queue
And Codex driver 在前一 turn 完成后发送下一次 `turn/start`

### FR-03: Codex 支持运行中 interrupt

覆盖决策：D-001@v1, D-002@v1

Given Codex turn 正在运行且 driver 已收到 `turn/started`
When 用户点击打断
Then backend 下发 `SESSION_INTERRUPT`
And daemon 调用 Codex driver `turn/interrupt(threadId,turnId)`
And 当前 run 收敛为终态
And session 保持可继续 inject

### FR-04: Codex 输出进入现有日志与 SSE

覆盖决策：D-003@v1, D-004@v1

Given Codex app-server 输出 agent message、tool use、tool result 或 error
When daemon 收到 JSON-RPC notification
Then Codex driver 将其归一化为 flat message
And backend `submit_messages` 写入 `AgentRunLog`
And frontend session SSE 展示日志，不需要 Codex 专属日志 API

### FR-05: Codex session 支持 end 与历史回看

覆盖决策：D-003@v1

Given Codex `AgentSession` 处于 active 或 running
When 用户点击结束会话
Then backend 下发 `SESSION_END`
And daemon 关闭 input queue 与 Codex app-server child
And `AgentSession.status` 变为 `ended`
And 历史列表仍能显示该 session 的 turns 和 logs

### FR-06: Codex 支持 reopen 与 daemon recovery

覆盖决策：D-001@v1, D-002@v1, D-003@v1, D-007@v1

Given Codex ended/failed session 有 `agent_session_id` thread id
When 用户点击继续对话或 daemon 启动恢复
Then backend 允许 provider `codex` reopen
And daemon 使用 `thread/resume(threadId)` 恢复 Codex thread
And 恢复成功后 session 进入 active

Given Codex session 缺少 thread id
When 尝试 reopen/recovery
Then 系统不得伪造新 thread
And 应明确失败并保留历史可查看

### FR-07: frontend Codex runtime 不走 quick-chat

覆盖决策：D-005@v1

Given runtime provider 为 `codex`
When `/runtimes` 弹窗渲染右侧会话区
Then 使用 `InteractiveSessionChatSection`
And 不渲染 `QuickChatSessionSection`
And ended/failed Codex session 的继续对话按钮可用

### FR-08: Codex 普通 approval 策略与 Claude Code 一致

覆盖决策：D-006@v1, D-008@v1

Given Codex session 配置为 `manual_approval=true` 且 `ask_user_only=true`
When app-server 发出 command/file/permission approval request
Then daemon 按 ask-only 策略 allow-through 并记录 metadata
And 不弹普通审批卡

Given Codex session 配置为 `manual_approval=true` 且 `ask_user_only=false`
When app-server 发出 command/file/permission approval request
Then daemon 发送 backend `PERMISSION_REQUEST`
And 用户响应后 daemon 写回 Codex schema 要求的 response

### FR-09: Codex 用户输入请求复用现有 dialog 卡片

覆盖决策：D-006@v1, D-008@v1, D-010@v1

Given Codex app-server 发出 `item/tool/requestUserInput`
When daemon 收到 server request
Then daemon 归一化为现有 `AskUserDialogCard` 可渲染的 `questions/options`
And backend 持久化 pending dialog
And frontend 展示 dialog 卡片
And 用户回答后 daemon 还原为 Codex `{answers:{[questionId]:{answers:string[]}}}` response

Given Codex app-server 发出复杂 MCP elicitation 且无法归一化
When daemon 处理该 request
Then request fail-closed
And 日志中记录不支持原因

### FR-10: Claude Code interactive 行为不回退

覆盖决策：D-001@v1, D-006@v1, D-008@v1, D-009@v1

Given provider 为 `claude`
When 用户创建、inject、interrupt、end、reopen、触发 AskUserQuestion
Then 现有 Claude Code 行为保持一致
And 现有 Claude interactive 测试通过

## 非功能需求

- 架构清晰：`SessionManager` 不依赖 Claude SDK 类型，provider 差异封装在 driver 内。
- 易扩展：新增 provider 只需实现 `InteractiveDriver` 并注册，不修改 session 生命周期主体。
- 可维护：Codex JSON-RPC parsing、server request response mapping 有单元测试覆盖。
- 安全一致：Codex approval/dialog 策略不得比 Claude Code 更宽松或更重。
- 可测试：daemon、backend、frontend 均有针对 Codex parity 的测试。
- 兼容性：Claude Code 现有 interactive 功能、quick-chat 全局能力不被删除。

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
| --- | --- | --- |
| D-001@v1 | FR-01, FR-02, FR-03, FR-06, FR-10 | provider driver registry |
| D-002@v1 | FR-01, FR-02, FR-03, FR-06 | Codex app-server protocol |
| D-003@v1 | FR-01, FR-02, FR-04, FR-05, FR-06 | 复用 backend session 控制面 |
| D-004@v1 | FR-04 | flat message 日志契约 |
| D-005@v1 | FR-01, FR-07 | `/runtimes` Codex interactive 主路径 |
| D-006@v1 | FR-08, FR-09, FR-10 | permission/dialog 策略一致性 |
| D-007@v1 | FR-06 | Codex reopen/recovery thread id |
| D-008@v1 | FR-08, FR-09, FR-10 | provider-neutral permission/dialog hook |
| D-009@v1 | FR-01, FR-02, FR-10 | provider-neutral input queue |
| D-010@v1 | FR-09 | Codex dialog payload 双向归一化 |
