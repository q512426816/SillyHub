---
id: task-17
title: single and team zero regression
title_zh: single/team 零回归
author: qinyi
created_at: 2026-08-08 22:20:00
priority: P0
depends_on: [task-01, task-02, task-03, task-04, task-05, task-06]
blocks: []
allowed_paths:
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/backend/app/modules/daemon/tests/test_run_sync_gate_decision_task.py
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/backend/app/modules/daemon/tests/test_lease_service.py
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/backend/app/modules/daemon/tests/test_close_interactive_run_session_status.py
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/backend/app/modules/change/tests/
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/backend/app/modules/daemon/tests/
goal: >
  保证砍 auto_dispatch 后 single/team 既有 change/daemon 测试套件零回归（除 stage 推进改按需）：跑全量 change/daemon 套件，修掉因 6 调用点改造导致的断言失效（task-01~06 非功能面）。
implementation:
  - 跑 backend/app/modules/change/tests/ + backend/app/modules/daemon/tests/ 全量
  - 修 test_run_sync_gate_decision_task.py（task-01 改 gate task 后断言失效）
  - 修 test_lease_service.py / test_close_interactive_run_session_status.py（task-05 facade/lease 改轻后）
  - 其余失败用例按新“按需触发”语义修正（非误不弱化，CLAUDE.md 第 9 条）
  - 确认 dispatch-worker 链路相关测试零影响
acceptance:
  - change/tests + daemon/tests 全量通过（auto_dispatch 相关已由 task-14/16 改写）
  - dispatch-worker / mission finalize 测试零变化
verify:
  - pytest backend/app/modules/change/tests/ backend/app/modules/daemon/tests/
constraints:
  - 逻辑上应最后跑（实际建议在 task-14/15/16 后），plan 依赖按 plan.md 记为 task-01~06
  - 只修断言失效，不弱化核验纪律
provides:
  - single/team 零回归保证（全量 change/daemon 套件通过）
expects_from:
  task-01:
    - contract: _run_gate_decision_task 只存结果不推进，gate_status=decided + SSE
      needs: [新行为契约，供 test_run_sync_gate_decision_task.py 改写]
  task-02:
    - contract: single callback 停待触发 + SSE，不自动连轴
      needs: [新行为契约]
  task-03:
    - contract: _advance_team_stage complete_stage 推进不 dispatch
      needs: [新行为契约]
  task-04:
    - contract: reconcile_stale_runs 保留清理不推进
      needs: [新行为契约]
  task-05:
    - contract: facade/lease callback 改轻（留痕 + SSE），converge_mission_for_completed_run 不变
      needs: [新行为契约，供 lease/close_interactive 测试改写]
  task-06:
    - contract: auto_dispatch_next_step 已删，全仓无残留
      needs: [无残留引用确认]
---

# task-17 实现笔记

零回归收口。allowed_paths 用 change/tests/ + daemon/tests/ 目录形式（catch-all 回归），加 3 个 task-01/05 直接触发的 daemon 测试文件显式列出。
