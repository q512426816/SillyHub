---
author: qinyi
created_at: 2026-06-20T00:45:00
---

# requirements: 交互式会话历史回看体验增强

引用 decisions.md 全部当前版本决策 D-001@v1 ~ D-005@v1，无未覆盖项。

## FR-1 历史回看含用户消息（D-001@v1 / D-005@v1）
- create_session 与 inject_session 在建对应 AgentRun 后，必须各持久化一条 `AgentRunLog(channel="user", content_redacted=脱敏prompt, run_id=该turn的run)`
- `GET /api/daemon/sessions/{id}/logs` 返回须包含上述 user log，按 run 分组、turn 顺序保留
- 前端 `SessionHistoryView` 须按 `channel` 区分渲染：user → 右对齐 primary 气泡；其余 → 左对齐 agent 气泡
- 存量历史会话（本变更上线前）inject prompt 从未落库，无法补（D-005）；回看旧会话仅显 agent 产出，UI 不报错

## FR-2 任意会话续聊（D-002@v1 / D-004@v1）
- 新增 `POST /api/daemon/sessions/{id}/reopen`：将 `status∈{ended,failed}` 且 `agent_session_id` 非空的 **claude** 会话重开
  - provider≠claude → 409 `DAEMON_SESSION_RESUME_UNSUPPORTED`
  - agent_session_id IS NULL → 409 `DAEMON_SESSION_NO_AGENT_SESSION`（D-004）
  - status∈{active,pending,reconnecting} → 409（仍活跃，引导 inject）
  - 目标 runtime 离线 → 409 `DAEMON_OFFLINE`
- reopen 须新建 interactive lease（不复活 completed lease），更新 session.lease_id/runtime_id，rotate claim_token；status→reconnecting；发 WS `daemon:session_resume`；同步返回 `{session_id, status:"reconnecting"}` 不阻塞
- daemon 收 `daemon:session_resume` → 调既有 `restoreAndReconnect(record)` + `markReconnected`（SDK options.resume 复用 agent_session_id），resume 成功后 status→active
- 前端 attach 已有 session 模式：建 SSE + 预填历史 turn；轮询 `GET /sessions/{id}` 到 active 才启用输入框（inject 要求 active），reconnecting 期间禁用提示「恢复会话中…」，~15s 超时或 failed 回退只读
- 续聊按钮可用性 = provider==claude && agent_session_id 非空 && status∈{ended,failed}（D-004）；不满足置灰 + title 提示
- resume 成功后，inject 续聊须基于之前上下文（SDK resume 生效）

## FR-3 任意状态删除（D-003@v1）
- `DELETE /api/daemon/sessions/{id}` 对任意 status 均可执行
- active/pending/reconnecting 删除时：后端先内部 end（发 `daemon:session_end` WS 关 daemon session + 当前 run 标 killed + lease 置 completed，best-effort daemon 离线不阻断），再硬删
- ended/failed 直接硬删
- 保留现有「UPDATE agent_runs SET agent_session_id=NULL + 保留 run/logs 历史」语义
- 前端 `SessionsSidebar` 任意状态均渲染删除按钮

## 决策覆盖矩阵
| 决策 | 覆盖于 | 状态 |
|---|---|---|
| D-001@v1 prompt 落 AgentRunLog channel=user | FR-1 | 已覆盖 |
| D-002@v1 续聊范围/resume 机制 | FR-2 | 已覆盖 |
| D-003@v1 任意状态删除+active先end | FR-3 | 已覆盖 |
| D-004@v1 failed 重开前提=agent_session_id 存在 | FR-2 | 已覆盖 |
| D-005@v1 历史数据不补 | FR-1 | 已覆盖 |

无未覆盖决策，无剩余风险。
