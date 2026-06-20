---
author: qinyi
created_at: 2026-06-20T00:35:00
---

# decisions: 交互式会话历史回看体验增强

本次变更的决策台账。每条含稳定版本 ID，design.md 引用当前版本。

## D-001@v1: 用户 prompt 落库位置
- type: architecture
- status: accepted
- source: code
- question: 用户发送的消息如何持久化以便历史回看展示？
- answer: 复用 AgentRunLog 表，新增 channel="user" 值（channel 为 String 无枚举约束，无需 migration）；create_session/inject_session 建对应 run 后显式插一条 AgentRunLog(channel="user", content_redacted=脱敏 prompt, run_id=对应 turn 的 run)。get_agent_session_logs SQL 不改，user log 天然按 run 分组返回。
- normalized_requirement: 每个 interactive turn 的用户 prompt 必须作为 AgentRunLog(channel="user") 持久化，且经 GET /sessions/{id}/logs 返回。
- impacts: [FR-1, task-create-userlog, task-inject-userlog, task-history-view-render]
- evidence: backend/app/modules/agent/model.py:237-264（AgentRunLog 现仅 stdout/stderr/tool_call）；service.py:1587 create_session / 1770 inject_session（prompt 现仅 WS 透传）；placement.py:375-385（首条 prompt 进 lease.metadata）；service.py:2511-2579 get_agent_session_logs
- priority: P0

## D-002@v1: 续聊范围与 resume 机制
- type: architecture
- status: accepted
- source: user+code
- question: 哪些会话可续聊，机制是什么？
- answer: 任意状态（ended/failed）的 claude 会话可续聊；复用 AgentSession.agent_session_id 走 Claude Agent SDK options.resume（task-10 崩溃恢复已证明 resume 不依赖进程内 session 存活）。后端新增 reopen 端点 ended/failed→reconnecting→active + 新建 interactive lease（不复活 completed lease）+ rotate claim_token；daemon 新增 SESSION_RESUME 分支调既有 restoreAndReconnect + markReconnected。codex 无 driver 不支持，仅只读回看。
- normalized_requirement: POST /sessions/{id}/reopen 将 ended/failed 且有 agent_session_id 的 claude 会话重开，daemon 经 SDK resume 恢复上下文后可继续 inject 续聊。
- impacts: [FR-2, task-reopen-backend, task-session-resume-msg, task-reopen-daemon, task-reopen-frontend, task-panel-attach]
- evidence: sillyhub-daemon/src/interactive/claude-sdk-driver.ts:197-220（options.resume 透传）；session-manager.ts:744-811 restoreAndReconnect；service.py:1961-2067 end_session（agent_session_id 不清）；service.py:2130-2141 recover no-resurrect（仅重启路径）；model.py:319-322
- priority: P0

## D-003@v1: 任意状态删除
- type: boundary
- status: accepted
- source: user
- question: 哪些状态的会话可删除？active 怎么处理？
- answer: 任意状态可删。active/pending/reconnecting 删除时后端先内部走 end_session（发 SESSION_END WS 关 daemon session + lease 置 completed），再硬删 session；保留现有"UPDATE agent_runs SET agent_session_id=NULL + 保留 run/logs 历史"语义。ended/failed 直接硬删。
- normalized_requirement: DELETE /sessions/{id} 对任意 status 均可执行；active 删除后 daemon 侧 session 已关闭、lease 已释放，run/logs 历史保留。
- impacts: [FR-3, task-delete-backend, task-delete-frontend]
- evidence: service.py:2473-2509 delete_agent_session（现 status∈ACTIVE 抛 409 在 :2494-2501）；:2503-2507 断外键保历史；router.py:765-775
- priority: P0

## D-004@v1: failed 重开前提
- type: boundary
- status: accepted
- source: code
- question: failed 状态会话能否续聊？
- answer: 仅当 failed 会话存在 agent_session_id（SDK 曾成功建立 session）时允许 reopen；无 agent_session_id 的 failed（create 阶段就失败、SDK session 未建立）不可续聊，前端不显示续聊入口。
- normalized_requirement: reopen 端点对 agent_session_id IS NULL 的会话返回 409 DAEMON_SESSION_NO_AGENT_SESSION；前端续聊按钮可用性 = provider==claude && agent_session_id 非空 && status∈{ended,failed}。
- impacts: [FR-2, task-reopen-backend, task-reopen-frontend]
- evidence: model.py:319-322 agent_session_id nullable
- priority: P1

## D-005@v1: 历史数据不补
- type: compatibility
- status: accepted
- source: code
- question: 存量历史会话没有用户 prompt 怎么办？
- answer: 无法补录（inject 的 prompt 从未落库），只对新 turn 生效。回看旧会话时仅显示 agent 产出（无用户气泡），UI 不报错。
- normalized_requirement: 本变更上线前的历史会话回看不报错，prompt 气泡可能缺失；上线后新建 turn 必含 user log。
- impacts: [FR-1, verify]
- evidence: service.py:1770-1896 inject prompt 从不落库
- priority: P1
