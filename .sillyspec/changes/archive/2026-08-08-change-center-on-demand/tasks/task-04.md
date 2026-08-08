---
id: task-04
title: strip auto_dispatch from reconcile_stale_runs
title_zh: 剥离 reconcile_stale_runs 的 auto_dispatch
author: qinyi
created_at: 2026-08-08 22:20:00
priority: P0
depends_on: []
blocks: [task-06, task-17, task-18]
allowed_paths:
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/backend/app/modules/change/dispatch.py
related_tests:
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/backend/app/modules/change/tests/test_reconcile_gate.py
goal: >
  剥离 reconcile_stale_runs（change/dispatch.py:589，调用点⑤）:655 处对 auto_dispatch_next_step 的调用，保留 stale run 清理（释放 has_active_run），不再恢复自动推进。
implementation:
  - 保留 :619-634 stale run 清理逻辑（释放 has_active_run 标记）
  - 删除 :655 处恢复推进的 auto_dispatch_next_step 调用
  - 清理后只发 SSE/留痕，推进交 advance_change_stage 显式触发
  - 不再引用 auto_dispatch_next_step
acceptance:
  - stale run 仍被清理（has_active_run 释放）
  - reconcile 不再自动恢复 stage 推进（auto_dispatch_next_step 引用归零）
verify:
  - grep -n "auto_dispatch_next_step" backend/app/modules/change/dispatch.py（reconcile_stale_runs 范围命中 0）
  - task-14 维护的 test_reconcile_gate.py 通过
constraints:
  - stale 清理必须保留（R-07），否则 has_active_run 卡死
  - 不动 dispatch()(:819) / dispatch_next_step(:1626) / _dispatch_execute_team(:1130) / _cleanup_before_dispatch(:772)
provides:
  - 调用点⑤清零：reconcile_stale_runs 不再引用 auto_dispatch_next_step
  - stale run 清理保留（无推进）
expects_from: {}
---

# task-04 实现笔记

D-007/R-07。dispatch.py 同时被 task-06（删 auto_dispatch_next_step）改，但 task-04 是调用方剥离（Wave 1），task-06 是删被调（Wave 1 末，依赖 task-04），顺序执行。
