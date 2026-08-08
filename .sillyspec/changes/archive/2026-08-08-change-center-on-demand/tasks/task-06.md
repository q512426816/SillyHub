---
id: task-06
title: delete auto_dispatch_next_step and sink gate hard-block
title_zh: 删 auto_dispatch_next_step 并下沉 gate 硬阻塞
author: qinyi
created_at: 2026-08-08 22:20:00
priority: P0
depends_on: [task-01, task-02, task-03, task-04, task-05]
blocks: [task-07, task-08, task-09, task-10, task-14, task-17, task-18]
allowed_paths:
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/backend/app/modules/change/dispatch.py
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/backend/app/modules/change/service.py
related_tests:
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/backend/app/modules/change/tests/test_auto_dispatch_gate.py
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/backend/app/modules/change/tests/test_gate_retry.py
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/backend/app/modules/change/tests/test_gate_via_delegate.py
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/backend/app/modules/change/tests/test_dispatch.py
goal: >
  调用方全清零后，删除被调 auto_dispatch_next_step（change/dispatch.py:240 ~330 行），并下沉 _run_gate_via_delegate 硬阻塞逻辑（gate 执行移到 run_verify_gate tool 软调用）；保留 dispatch()/dispatch_next_step/_dispatch_execute_team/complete_stage/transition_with_dispatch 供按需触发。
implementation:
  - 全仓 grep 确认 auto_dispatch_next_step 仅剩定义、无残留调用（task-01~05 已清 6 调用点）
  - 删除 auto_dispatch_next_step 函数体（dispatch.py:240 ~330 行）
  - 下沉 _run_gate_via_delegate 硬阻塞：保留 RPC 骨架（HostFsDelegate.run_command + 白名单 + 12min timeout）供 task-09 tool 复用，去掉自动阻塞推进语义
  - change/service.py 移除 auto_dispatch 调用，保留 complete_stage / transition_with_dispatch / rerun_stage
  - 保留 dispatch()(:819) / dispatch_next_step(:1626) / _dispatch_execute_team(:1130) / _cleanup_before_dispatch(:772)
acceptance:
  - auto_dispatch_next_step 函数已删，全仓 grep 命中 0
  - 无运行时 ImportError / AttributeError（6 调用点改造完整）
  - transition_with_dispatch / dispatch_next_step / _dispatch_execute_team / complete_stage 仍可被 tool 调用
verify:
  - grep -rn "auto_dispatch_next_step" backend/app/modules/（命中 0）
  - python -c "import backend.app.modules.change.dispatch"（无 import 错）
  - task-14 维护的 test_auto_dispatch_gate.py / test_gate_retry.py / test_gate_via_delegate.py 通过
constraints:
  - 必须在 task-01~05 全部完成后执行（调用方清零前置）
  - 不删 dispatch_next_step / _dispatch_execute_team（task-07 按需触发要用）
provides:
  - auto_dispatch_next_step 已删（D-001 收口）
  - _run_gate_via_delegate RPC 骨架可复用（gate cmd 软调用入口）
  - transition_with_dispatch / dispatch_next_step / _dispatch_execute_team / complete_stage 保留可用
expects_from:
  task-01:
    - contract: 调用点① _run_gate_decision_task 已无 auto_dispatch_next_step 引用
      needs: [本函数无残留调用]
  task-02:
    - contract: 调用点③ single callback 已无 auto_dispatch_next_step 引用
      needs: [本分支无残留调用]
  task-03:
    - contract: 调用点④ _advance_team_stage 重写完成且无 auto_dispatch 引用
      needs: [重写后函数，complete_stage 桥保留]
  task-04:
    - contract: 调用点⑤ reconcile_stale_runs 已剥离 :655 auto_dispatch
      needs: [本函数无残留调用]
  task-05:
    - contract: facade/lease callback 不再引用 auto_dispatch_next_step
      needs: [本范围无残留调用]
---

# task-06 实现笔记

D-001/D-003 收口。被调删除是 Wave 1 末的关键路径节点，解锁 Wave 2 全部 tool 任务。删除前务必全仓 grep 复核无残留引用。
