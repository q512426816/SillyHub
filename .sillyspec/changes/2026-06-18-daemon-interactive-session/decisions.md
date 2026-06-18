---
author: qinyi
created_at: 2026-06-18T13:40:53
---

# 决策台账 — daemon-interactive-session

本变更的需求澄清/方案讨论中产生的、有实现或验收影响的决策。长期术语在 archive/scan 时再提升到 glossary.md。

## D-001@v1: 交互式会话实体命名 AgentSession

- type: term
- status: accepted
- source: code（术语碰撞识别）
- question: 代码现有 claude `session_id`（agent 内部）、`AgentRun.session_id`（quick-chat resume 用），新引入的"交互式会话"实体如何命名以避免碰撞？
- answer: 新实体命名 `AgentSession`（表 `agent_sessions`）；agent 内部会话 id（claude session_id / codex thread_id）存 `AgentSession.agent_session_id`；AgentRun 新增 FK 字段命名 `agent_session_id`，**不改动**现有 `AgentRun.session_id`（保留 claude resume 语义）。
- normalized_requirement: 新表名 `agent_sessions`；AgentRun→agent_sessions 的 FK 字段名必须为 `agent_session_id`，不得复用 `session_id`。
- impacts: [design §8.1, §8.3, R-05, task数据模型迁移]
- evidence: `backend/app/modules/agent/model.py` AgentRun.session_id 现有字段；`backend/app/main.py:141-158` quick-chat 用 session_id 做 resume
- priority: P2

## D-002@v1: 1 AgentSession = 1 长生命周期 lease，多 turn 复用 spawn 进程

- type: architecture
- status: accepted
- source: user（Q2 选择"session 作为 lease 上层"）+ explore（"agent 子进程即会话载体"）
- question: 交互式 session 与现有批处理 lease 怎么共存？session 的执行模型形态？
- answer: 1 AgentSession 对应 1 长生命周期 DaemonTaskLease（`kind=interactive`），多 turn 复用同一 spawn 进程（task-runner result 不 end stdin）；每 turn 一个 AgentRun（复用 AgentRunLog/SSE/resume_token 链路）。批处理 lease（`kind=batch`）保持原生命周期不变，用 kind 字段隔离两条路径。
- normalized_requirement: daemon_task_leases 增加 `kind` 字段（batch/interactive，默认 batch）；interactive lease 不进现有 `handle_lease_expiry` expire 回收；task-runner 按 kind 分流。
- impacts: [design §5, §8.2, R-04, R-06, task Wave1核心]
- evidence: `backend/app/modules/daemon/model.py` DaemonTaskLease（agent_run_id 1:1）；`sillyhub-daemon/src/task-runner.ts:721-751` stdin 写入点
- priority: P0

## D-003@v1: Wave1/2 不做崩溃恢复，Wave3 做 resume 持久化

- type: boundary
- status: accepted
- source: user（范围控制 YAGNI）+ happy 参考（resume 是独立健壮性层）
- question: 会话进程崩溃后是否立即支持恢复？resume 放在哪个 Wave？
- answer: Wave1/2 阶段 session 进程崩溃 = 会话结束（agent_sessions.status=failed），提示用户重新开始；resume 持久化（daemon 磁盘 + `--resume`/`thread/resume` 重 spawn）作为 Wave3 独立交付。
- normalized_requirement: Wave1/2 的 SessionStore 仅内存态；崩溃检测标 failed；Wave3 新增 persist/restore + agent_sessions.status 的 reconnecting 态。
- impacts: [design §3 非目标, §5 Wave3, R-03, task Wave3]
- evidence: explore 阶段 happy `daemon/run.ts:661 resumeSession` 参考
- priority: P1

## D-004@v1: session 空闲 30min 自动结束

- type: boundary
- status: accepted
- source: ai（默认值，平衡资源与体验）
- question: 长驻会话何时自动结束？避免 daemon 资源被无限占用。
- answer: session 空闲 30min（无 inject / 无活动）自动结束（daemon 侧 keep-alive 检测 last_active_at），可配置。用户也可随时手动结束。
- normalized_requirement: SessionStore 记录 last_active_at；daemon 定时扫描，空闲超 30min（配置项 session_idle_timeout_sec）的 active session 自动 end；agent_sessions.status=ended。
- impacts: [design §5 Wave1 SessionStore, 验收, task Wave1]
- evidence: explore happy keep-alive 2s 参考；本变更放宽到 30min 会话级
- priority: P1

## D-005@v1: session/lease/run 三元关系 + session 级 SSE 聚合（Design Grill 修正）

- type: consistency（一致性 + 可行性 + 定义，三条结构性问题的合并修正）
- status: accepted
- source: ai（Step12 Design Grill 交叉审查）
- question: design.md 初稿三处结构性矛盾——(a) DaemonTaskLease.agent_run_id 现有 1:1 约束与"每 turn 一个 AgentRun"冲突；(b) stream_run_logs 是 run 级订阅，跨 turn SSE 聚合未定义；(c) interactive lease 的 lease_expires_at/expire 回收语义未定义。
- answer: (a) interactive lease.agent_run_id=NULL，session↔lease 1:1（session.lease_id），session↔runs 1:N（run.agent_session_id）；(b) 新增 session 级 Redis channel `agent_session:{session_id}`，submit_messages 双 publish（run 级 + session 级），新增 stream_session_logs；(c) interactive lease.lease_expires_at=NULL 不进 handle_lease_expiry，结集中在 service.end_session。
- normalized_requirement: interactive lease.agent_run_id 必须为 NULL；必须存在 agent_sessions.lease_id（1:1）与 agent_runs.agent_session_id（N:1）；必须新增 session 级 Redis channel 与 stream_session_logs；interactive lease 不得设置 lease_expires_at。
- impacts: [design §8.4, §8.5, §7.2, R-04, R-08, task 数据模型迁移 + Wave1 SSE]
- evidence: `backend/app/modules/daemon/model.py:125`（lease.agent_run_id FK）；`backend/app/modules/agent/service.py:541` stream_run_logs（run 级）
- priority: P0
