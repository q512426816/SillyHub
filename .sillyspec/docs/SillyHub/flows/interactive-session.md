---
author: qinyi
created_at: 2026-06-24T01:47:08
source_commit: ba87eec
---

# 交互式会话流程（Interactive Session）

## 目标
在同一会话内支持同进程多轮对话（多 turn），由 daemon 侧 Claude Agent SDK 驱动，backend 桥接转发流式消息与权限审批，前端实时渲染并支持注入/打断/恢复。

## 参与模块
- **backend/daemon**：session 端点（`/sessions`、`/sessions/{id}/{inject,reopen,interrupt,end,stream,logs}`、`/sessions/{id}/dialogs`、`/sessions/{id}/permissions/{rid}/response`）、恢复端点（`recover/confirm-reconnected/mark-recovery-failed`）
- **backend/agent**：interactive 路径复用 `report_agent_message` + `close_interactive_run` + `end_session`
- **backend/runtime**：runtime 进度与 session 关联
- **daemon/interactive**：`SessionManager`（start/inject/end）、`ClaudeSdkDriver`（SDK query 封装）、`session-store-persistence`、`permission-resolver`
- **daemon/daemon.ts**：`RecoveryCoordinator` 三步恢复（recover→confirm→mark_failed）
- **frontend**：`runtime-session-dialog` + `runtime-session-helpers`、`lib/daemon.ts`（createDaemonSession/openSessionStream/inject）
- **daemon/spec-sync**：session 开始 pull bundle / 结束 postSpecSync

## 流程摘要

```text
(frontend)  runtime-session-dialog 默认态：有活跃 session → attach；无 → idle
     │
(frontend)  开新会话 → POST /daemon/sessions {runtime_id}
     │
(backend)   DaemonSessionService 建 AgentSession（active/pending）
     ▼
(daemon)    收到 session 任务 → SessionManager.start：
     │        ├─ pullSpecBundle（拉最新 spec）
     │        └─ ClaudeSdkDriver.start → SDK query({prompt, options})（异步可迭代 prompt）
     ▼
(daemon)    SDK 流式输出 → 经 daemon 桥接转发：
     │        ├─ 消息 → backend report_agent_message（interactive+batch 共用）
     │        ├─ permission_request → backend 挂起 + 前端弹卡
     │        └─ 终态 → end_session（end/idle/fail）
     ▼
(backend)   WSHub → SSE /sessions/{id}/stream 转发到前端
     ▼
(frontend)  EventSource（token 走 query）渲染消息流 + dialog 卡片
     │
     ├─ 用户续聊 → POST /sessions/{id}/inject {prompt}（同 session 下新 turn / 新 AgentRun）
     ├─ 用户打断 → POST /sessions/{id}/interrupt
     ├─ 权限答复 → POST /sessions/{id}/permissions/{rid}/response
     └─ 关闭 → POST /sessions/{id}/end（daemon postSpecSync 回写 spec）
```

daemon 重启恢复：`RecoveryCoordinator` 依次对每个 active session 调 `recover_session_after_daemon_restart` → `confirm_session_reconnected`（成功）/ `mark_session_recovery_failed`（失败隔离，单条 reject 不影响其他 session）。

## 失败回滚

| 失败点 | 处理 |
|--------|------|
| claude 可执行未找到 | ClaudeSdkDriver 抛 CLAUDE_EXECUTABLE_NOT_FOUND，session failed |
| cmd-shim wrapper 路径 | driver 解析到底层 @anthropic-ai/claude-code/bin/claude.exe |
| query 网络异常 | session failed，保留已收消息 |
| daemon 崩溃重启 | RecoveryCoordinator 三步恢复，session=reconnecting → confirmed |
| 恢复失败 | mark_session_recovery_failed，隔离不影响其他 session |
| EventSource 断连 | 前端自动重连，logs 接口补历史 |
| 会话已 ended | inject 拒绝，前端走 reopen 续聊 |

## 关键术语
- **AgentSession**：同进程多轮会话载体，含 runtime_id
- **ClaudeSdkDriver**：`@anthropic-ai/claude-agent-sdk` 的 query/interrupt/consume 封装
- **turn**：一个 prompt 一轮，同 session 多 turn 复用 query（不结束可续）
- **RecoveryCoordinator**：daemon 重启后向 backend 收敛 session 状态的三步编排
