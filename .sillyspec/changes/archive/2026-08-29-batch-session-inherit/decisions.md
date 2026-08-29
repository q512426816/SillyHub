---
author: qinyi
created_at: 2026-08-29 19:57:30
---

# 决策记录（Decisions）

## D-001@v1: 会话继承触发范围
- type: boundary
- priority: P0
- status: accepted
- source: user
- question: 哪些场景的 batch 重试继承原会话？
- answer: 仅 infra 中断继承——lease 过期自动重派（daemon 掉线/断连）attempt+1 继承原会话继续；lease 内 spawn 重试维持现状清空 resume（R-10 防副作用）；手动重跑走 dispatch_to_daemon 全新 lease 天然新会话
- normalized_requirement: 继承仅发生在 handle_lease_expiry 重派路径；spawn 级重试不注入 resume；dispatch_to_daemon 创建的 lease 不带 resume_session_id（分流自动达成，需用例锁定防回归）
- impacts: [FR-01, FR-03]
- evidence: 用户 AskUserQuestion 第 1 轮（2026-08-29）；multica 原则「自动重试继承（infra 故障）/手动重跑开新（输出被判坏）」

## D-002@v1: resume 失败自动降级
- type: term
- priority: P0
- status: accepted
- source: user
- question: 带 --resume spawn 后 CLI 报 session 不存在/损坏怎么办？
- answer: 自动降级——去掉 resume 用 fresh session 重跑一次（同 attempt 内），终态上报携带披露字段（resume_downgraded），任务不因会话丢失而失败但降级可见
- normalized_requirement: daemon 检测 resume 型启动失败（session not found/损坏类错误）→ 清 resume 重 spawn 一次 → 终态 metadata 带 resume_downgraded 标志（backend 落 run 行，前端可选展示）
- impacts: [FR-02]
- evidence: 用户 AskUserQuestion 第 1 轮（2026-08-29）
## D-003@v1: 方案选型 A 最小闭环
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: 方案 A（最小闭环 backend 重派链+daemon 守卫）还是 B（+poison 门控体系+前端展示）？
- answer: A——backend handle_lease_expiry 继承原 lease metadata+注入 resume_session_id/work_dir；daemon work_dir 同一性守卫+resume 失败降级。零迁移零新端点零前端，全消费既有链路
- normalized_requirement: 不做 poison 黑名单体系（infra 中断场景 businessError 终态本就不重派，能走到重派的必是被中断的 infra 场景——场景过滤即门控）；不做前端继承标识展示（resume_downgraded 落 run 行 metadata 备查）
- impacts: [全部 FR]
- evidence: 用户 AskUserQuestion 第 2 轮（2026-08-29）
## D-004@v1: 设计整体确认
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: 五段设计（S1 重派继承/S2 claim 白名单/S3 work_dir 守卫/S4 resume 降级/S5 分流锁定）是否确认？
- answer: 确认。变更名 2026-08-29-batch-session-inherit；无 UI 变化不产出 HTML 原型
- normalized_requirement: 按 S1-S5 实施；关键语义：metadata 全继承（修 prompt 丢失缺口）、resume_session_id 仅 run.session_id 非空时注入、work_dir 同一性不一致降级 fresh+披露、resume 失败同 attempt 内降级重跑一次+resume_downgraded 字段
- impacts: [design.md 全文]
- evidence: 用户 AskUserQuestion 第 3 轮（2026-08-29）
## D-005@v1: P0 方向重定位——worker 重派继承（Grill C-01 裁定）
- type: architecture
- priority: P0
- status: accepted
- source: design-grill
- question: Grill P0：生产无 batch lease（全部 interactive），原设计触发路径不可达
- answer: 转向 worker 重派继承——interactive worker 会话（AgentSession.role 含 worker 或 parent_session_id 非空）daemon 掉线后不 suspended 而是 failed+自动重派继承原会话（worker 是临时会话无人手恢复，挂起无意义）；主会话（orchestrator/用户 chat）保持挂起语义不变
- normalized_requirement: suspend_sessions_for_daemon 与 offline sweep 均按 role/parent 分流：worker 子会话→failed(daemon_interrupted)+中断 run failed+lease cancelled+自动重派（新 lease 带 resume_session_id=agent_session_id）；主会话→suspended（现状不变）。识别口径=AgentSession.parent_session_id IS NOT NULL（子会话即 worker，比 role 词表更稳——orchestrator 主会话无 parent）
- impacts: [全部 FR，design.md 全文重写]
- evidence: Grill C-01/C-06 + 用户方向裁决（2026-08-29）
