---
author: qinyi
created_at: 2026-06-24T01:47:08
source_commit: 744e3de4
updated_at: 2026-08-17T17:06:26Z
---

# 交互式会话流程（Interactive Session / 快捷聊天）

## 目标
同一 daemon 进程内多轮对话（多 turn）由 daemon 侧 agent 驱动（claude-agent-sdk 与 codex 双驱动），backend 桥接转发流式消息、权限审批与问答对话框，前端实时渲染并支持注入/打断/供应商热切换/重启恢复；会话首尾拉推 spec 文档保持两端同步。

## 参与模块
- daemon：backend 侧 session 端点族（create / inject / interrupt / end / reopen / recover / confirm-reconnected / mark-recovery-failed / ready 上报 + SSE stream + logs）、permission_service（权限请求与对话框落 dialog 行）、SessionReadiness 握手单例；Node 侧 interactive/（claude-sdk-driver + codex-app-server-driver、session-manager 含 allowed_roots 写白名单与热切换、input-queue、permission-resolver、jsonl 会话持久化）、adapters/ 多协议输出适配、policy/ 文件系统策略、resilience/ 消息韧性
- agent：RunPlacementService 派发、apply_session_profile_to_lease 档案透传、close_interactive_run 收口
- spec_workspace：会话开始 pull bundle（tar 解包拉最新 spec）
- platform_sync / spec_workspace：会话结束 postSpecSync 推增量（FileOp ops）
- llm_provider：会话供应商解析与默认供应商热切换推送
- frontend_app：Next.js BFF 中继（app/api/daemon/sessions/[id]/stream）+ main.py 内联注册的快捷聊天 /api/daemon-chat（POST 创建 → RunPlacementService 派发；GET /{id}/stream SSE、kill、logs）
- frontend_lib / frontend_components：lib/daemon.ts（createDaemonSession/openSessionStream/inject）、runtime-session 组件族

## 流程摘要

```text
=== 建会话 ===
(frontend)  工作区 sessions 页 / 跨工作空间 (dashboard)/sessions 页
     │      → POST /api/daemon/sessions {runtime_id}
     │      快捷聊天：POST /api/daemon-chat → RunPlacementService 派发（同链路）
(backend)   DaemonSessionService.create_session（active/pending）
     ▼
(daemon)    _startInteractiveSession：
     │  ├─ pullSpecBundle 拉最新 spec（tar 解包到本地缓存）
     │  ├─ session-manager 起 claude-sdk-driver / codex-app-server-driver
     │  │    （会话 jsonl 持久化，CLAUDE_CONFIG_DIR 指向 daemon 隔离目录保证 resume 可达）
     │  └─ POST /sessions/{id}/ready → backend SessionReadiness.mark_ready
     ▼
=== 对话循环 ===
(用户)      POST /sessions/{id}/inject {prompt}
(backend)   await SessionReadiness.wait(30s) → WS SESSION_INJECT
     │      （防 inject 早到 daemon 丢消息；超时 fallback 仍发兼容旧 daemon）
(daemon)    input-queue 单订阅入队 → driver 同 session 多 turn
     │      （resume agentSessionId 保留历史；turn 冲突返回错误）
     │      allowed_roots 写白名单 write-guard：显式写 + Bash 间接写
     │      （重定向/cp/mv/tee 等）都限根内
     ▼
(daemon)    流式输出经 resilience.submitWithRetry 上行（message 先于 result）
(backend)   run_sync.submit_messages（segmentId 去重）→ SSE /sessions/{id}/stream
     ▼
(前端)      渲染消息流 + dialog 卡片
     ├─ 工具权限请求（canUseTool）→ permission_service 落 dialog 行
     │    → 前端弹卡 → POST .../permissions/{rid}/response（超时收敛）
     ├─ AskUserQuestion（dialog_kind 非空，非工具审批）→ 无自动超时、可无限期等待，
     │    长存 session_dialog_requests 跨前端刷新；dialog_payload 转发问题+选项
     ├─ 打断 → POST /sessions/{id}/interrupt
     ├─ 供应商热切换 → backend 推 DAEMON_MSG_PROVIDER_CONFIG_CHANGED
     │    → daemon turn 边界 reload（close 旧 query + resume 保历史；markPendingSwitch 防孤儿 consume）
     └─ 结束 → POST /sessions/{id}/end
          → daemon postSpecSync 推增量回传 spec → close_interactive_run
```

daemon 重启恢复（三方配合，勿单侧改握手顺序）：
backend `recover_session_after_daemon_restart` → Node 侧 restoreAndReconnect（从 jsonl 恢复会话）→ `confirm_session_reconnected`（reconnecting→active + mark_ready 双保险）；失败走 `mark_session_recovery_failed` 隔离，单条 reject 不影响其他 session。
空闲回收默认已禁用（D-001@v1）——会话结束由完成驱动 end（D-002@v1），不再依赖 idle 回收。

## 失败回滚

| 失败点 | 处理 |
|--------|------|
| inject 早到 daemon 未就绪 | SessionReadiness wait(30s)，超时 fallback 仍发兼容旧 daemon |
| 网络抖动消息丢失/重复 | submitWithRetry 退避重试→用尽入 FileOutbox→心跳健康 drainOutbox 补发；segmentId 去重 |
| 会话已 ended | inject 拒绝，前端走 reopen 续聊 |
| daemon 崩溃重启 | recover 三步收敛（见上）；ResilienceService 保证暂存消息补发 |
| 恢复失败 | mark_session_recovery_failed 隔离，不影响其他 session |
| 供应商热切换 | turn 边界 reload；无默认供应商时回退本机凭证管理 |
| turn 冲突（并发 inject） | current_run 冲突错误返回前端 |
| interactive lease 被取消 | cancel_lease 走 SESSION_END 下发（见 agent-run 流程 kill 通道）；interactive lease 永不过期是不变量 |
| EventSource 断连 | 前端自动重连 + logs 接口补历史 |
