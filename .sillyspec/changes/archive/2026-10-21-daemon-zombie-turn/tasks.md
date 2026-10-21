---
author: flow-machine-draft
created_at: 2026-10-21T07:19:34.302Z
---
# 任务注册表（Tasks）— 2026-10-21-daemon-zombie-turn

- [x] task-01: daemon 轮启动看门狗：SessionManagerDeps 增 onTurnStartTimeout + inject 布防/事件与终态撤防 + 到点重置会话态并回报（含 tests/interactive/turn-start-watchdog.test.ts 绿）
- [x] task-02: interrupt no-op 回传：backend payload 增 run_id + daemon 消费 interrupt() 布尔结果并对 false 回报 notifyRunResult（含 daemon-interrupt-noop-report.test.ts 与 test_interrupt_payload_run_id.py 绿）
- [x] task-03: backend pending run 启动超时清扫：Settings 可配 N + pending_run_start_sweep_once 挂 sweeper 轮 + SSE 终态发布（含 test_pending_run_start_sweep.py 绿）
- [x] task-04: 前端打断 15s 超时回退：handleInterrupt 布防/清除定时器 + 到点回退 running + 提示（含 interrupt-timeout.test.ts 绿）
