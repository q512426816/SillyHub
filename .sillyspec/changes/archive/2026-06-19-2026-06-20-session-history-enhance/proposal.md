---
author: qinyi
created_at: 2026-06-20T00:45:00
---

# proposal: 交互式会话历史回看体验增强

## 动机
`/runtimes` 交互式会话（task-11 面板 + task-12 会话列表/历史回看）已上线，但历史回看体验存在三个用户可感知的缺口：
1. 回看只有 agent 一侧的输出，看不到用户自己发过的消息
2. 历史会话（尤其已 ended/failed）是只读的，不能接着对话
3. 只有 ended/failed 能删，active 会话删不掉

本变更一次性补齐。续聊方案经用户确认为 **方案 A（reopen + SDK resume）**，范围 = 任意会话（含 ended/failed）都可续聊，仅 claude（codex 无 resume driver）。

## 方案概要
- **W1 · 问题①③（独立可先行）**
  - 回看含用户消息：create/inject 建对应 run 后各插一条 `AgentRunLog(channel="user")`；`get_agent_session_logs` SQL 不改；前端 `SessionHistoryView` 按 channel 渲染用户气泡(右、primary)/agent 气泡(左)
  - 任意状态删除：`delete_agent_session` 去 active 拒绝，active 先内部 end（关 daemon session + lease completed）再硬删；前端去 `{!active}` 限制
- **W2 · 问题②续聊（方案 A）**
  - 后端新增 `reopen_session` + `POST /sessions/{id}/reopen`（ended/failed→reconnecting+新lease+复用agent_session_id+rotate claim_token）+ WS `daemon:session_resume` + `GET /sessions/{id}` 单查（轮询用）
  - daemon `protocol.ts` 加 `SESSION_RESUME`；`_routeSessionControl` 加分支调既有 `restoreAndReconnect`+`markReconnected`（不改 SDK/driver/SessionManager 核心）
  - 前端 `InteractiveSessionPanel` attach 已有 session 模式（建 SSE + 预填历史 turn + 轮询到 active 启用输入）；选中会话「继续对话」按钮（claude+有agent_session_id+ended/failed 可用，否则置灰）

## 范围
**做**：三问题（回看含用户消息 / 任意会话续聊 / 任意状态删除），跨 backend + sillyhub-daemon + frontend 三端。
**不做**（非目标，见 design §9）：
- codex 续聊（无 resume driver，仅只读回看）
- 回填存量历史会话的 prompt（D-005）
- 改 SDK / driver / SessionManager 核心（restoreAndReconnect 复用）
- 会话列表分页/排序、lease 治理增强

## 关键依据
- design.md（含生命周期契约表 §6、风险对策 §11、Wave 分解 §12）
- decisions.md（D-001@v1 ~ D-005@v1）
- prototype-session-history.html（线框原型）
- 技术可行性已两轮调研验证：SDK resume 不依赖进程存活（task-10 崩溃恢复证明）、agent_session_id 在 end 后保留 DB、restoreAndReconnect 原生支持
