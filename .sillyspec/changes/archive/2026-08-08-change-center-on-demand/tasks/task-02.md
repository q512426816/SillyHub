---
id: task-02
title: single stage callback drop auto_dispatch
title_zh: single 阶段回调删 auto_dispatch 停待触发
author: qinyi
created_at: 2026-08-08 22:20:00
priority: P0
depends_on: []
blocks: [task-06, task-17, task-18]
allowed_paths:
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/backend/app/modules/daemon/run_sync/service.py
related_tests:
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/backend/app/modules/change/tests/test_auto_dispatch_gate.py
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/backend/app/modules/change/tests/test_dispatch.py
goal: >
  改造 _trigger_stage_completion_callback 的 single 分支（run_sync:1550 入口 / :1617 single 分支，调用点③）：删 auto_dispatch_next_step，single stage 完成后停在“阶段完成待触发”并发 SSE，不再自动连轴下一 stage。
implementation:
  - single 分支保留 stage 完成留痕（标记 stage_completed 待触发 / 可选 sync_stage_status 只更新视图）
  - 删除 :1617 处 single 分支对 auto_dispatch_next_step 的调用
  - 发 stage_status_changed SSE 提示前端/agent 显式推进
  - 不再引用 auto_dispatch_next_step
acceptance:
  - single stage 完成后 current_stage 不自动推进，停在待触发态并发 SSE
  - single 分支函数体内不再出现 auto_dispatch_next_step
verify:
  - grep -n "auto_dispatch_next_step" backend/app/modules/daemon/run_sync/service.py（single 分支范围命中 0）
  - task-14/17 维护的 test_auto_dispatch_gate.py / test_dispatch.py 通过
constraints:
  - 仅改 single 分支，不动 team 分支（:1630 _handle_team_run_completion → task-03）
  - team 分流由 task-03 重写，不在本 task 范围
provides:
  - 调用点③清零：single callback 不再引用 auto_dispatch_next_step
  - single stage “完成待触发”语义 + SSE
expects_from: {}
---

# task-02 实现笔记

调用点③。与 task-01/task-03 同改 run_sync/service.py，但函数不同（:1266 / :1550-1617 / :1685），并行改不同函数，无行级冲突。
