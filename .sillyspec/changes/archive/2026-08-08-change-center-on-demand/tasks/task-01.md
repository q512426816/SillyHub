---
id: task-01
title: gate decision task store result only
title_zh: gate 决策任务只存结果不推进
author: qinyi
created_at: 2026-08-08 22:20:00
priority: P0
depends_on: []
blocks: [task-06, task-17, task-18]
allowed_paths:
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/backend/app/modules/daemon/run_sync/service.py
related_tests:
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/backend/app/modules/daemon/tests/test_run_sync_gate_decision_task.py
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/backend/app/modules/change/tests/test_auto_dispatch_gate.py
goal: >
  改造 _run_gate_decision_task（run_sync/service.py:1266，调用点①）：gate 跑完后只落 AgentRun.gate_result + 置 gate_status=decided + 发 gate_status_changed SSE，删除 :1387 处 sync_stage_status + auto_dispatch_next_step 自动推进块。
implementation:
  - 保留 _run_gate_via_delegate 跑 gate 与 gate_result 落库（run_sync:1364 附近）
  - 置 gate_status=decided，发 gate_status_changed SSE（前端/agent 据此显式 advance）
  - 删除 :1387 处 verify 完成后 sync_stage_status + auto_dispatch_next_step 推进 verify 的整块
  - 移除本函数对 auto_dispatch_next_step / sync_stage_status 自动推进的引用与 import
acceptance:
  - _run_gate_decision_task 执行后仅落 gate_result + gate_status=decided + 发 SSE，current_stage 不变
  - 本函数体内不再出现 auto_dispatch_next_step 调用
verify:
  - grep -n "auto_dispatch_next_step" backend/app/modules/daemon/run_sync/service.py（本函数范围命中 0）
  - 改写后由 task-14/17 维护的 test_run_sync_gate_decision_task.py / test_auto_dispatch_gate.py 通过
constraints:
  - 仅改 _run_gate_decision_task 一个函数，不动 close_interactive_run spawn 链路与 mission finalize
  - SSE 事件名沿用既有 gate_status_changed，不新增协议
provides:
  - 调用点①清零：_run_gate_decision_task 不再引用 auto_dispatch_next_step
  - gate_result 落库 + gate_status=decided + gate_status_changed SSE（按需触发信号源）
expects_from: {}
---

# task-01 实现笔记

调用点①（design §4.1）。改完此函数对 auto_dispatch_next_step 的引用归零后，task-06 才能安全删除被调函数。
