---
author: WhaleFall
created_at: 2026-08-05 09:40:00
---

# 决策台账 — daemon 启动时间字段

## D-001@v1 — 方案 A：register + heartbeat 幂等上报 started_at

- type: design
- status: accepted
- source: brainstorm step 4 三方案对比
- question: started_at 上报方式（register+heartbeat 幂等 / 只 register / uptime 推算）？
- answer: register + heartbeat 都带 started_at（恒定值），daemon_instances.started_at register 写 + heartbeat 幂等覆盖。否决只 register（漏则永久 None）与 uptime 推算（daemon+backend 双时钟误差累积）。
- normalized_requirement: started_at 防漏（heartbeat 兜底），恒定值（进程启动时间）幂等覆盖无副作用。
- impacts: FR-01, FR-02, design §5.A, §5.B
- evidence: brainstorm step 4；进程入口 cli.ts:757 new Daemon()，startTime 在 cli.ts:513 附近 Date.now() 新取（Design Grill 修正：daemon.ts:1808 是 _fire() circuit-breaker 局部，非进程启动，弃用）
- priority: P0

## D-002@v1 — started_at 存 daemon_instances（instance 级），非 runtime

- type: design
- status: accepted
- source: 需求"daemon 进程启动时间"
- question: started_at 存哪张表？
- answer: daemon_instances.started_at（instance 级，per-daemon）。runtime 从属 instance，machines/runtimes 端点经 instance JOIN 带出，runtime 表不加冗余列。
- normalized_requirement: started_at 单一存储（instance），端点 JOIN 复用现有 _runtime_read/_build_machine_read 模式。
- impacts: FR-02, design §5.B, §8
- evidence: model.py:92-105 DaemonInstance；router.py:442-502 _runtime_read/_build_machine_read instance JOIN 模式
- priority: P0
