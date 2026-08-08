---
id: task-14
title: rewrite auto_dispatch regression tests
title_zh: 砍 auto_dispatch 回归测试改写
author: qinyi
created_at: 2026-08-08 22:20:00
priority: P0
depends_on: [task-06]
blocks: []
allowed_paths:
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/backend/app/modules/change/tests/test_auto_dispatch_gate.py
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/backend/app/modules/change/tests/test_gate_retry.py
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/backend/app/modules/change/tests/test_reconcile_gate.py
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/backend/app/modules/change/tests/test_dispatch.py
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/backend/app/modules/change/tests/test_gate_via_delegate.py
goal: >
  改写砍 auto_dispatch 后断言失效的 change 子域回归测试（test_auto_dispatch_gate / test_gate_retry / test_reconcile_gate / test_dispatch / test_gate_via_delegate）：把“自动连轴”断言改为“停在待触发态 + 显式 advance 推进”（FR-01/R-05）。
implementation:
  - test_auto_dispatch_gate：删 auto_dispatch 自动推进断言，改断言 stage 停待触发 + 调 transition_with_dispatch 后才推进
  - test_gate_retry：gate 重试仍跑，但结果只落 gate_result 不自动推进
  - test_reconcile_gate：断言 stale run 清理保留、不再恢复推进（task-04）
  - test_dispatch / test_gate_via_delegate：移除 auto_dispatch_next_step / 硬阻塞相关断言
  - 不为“通过”而弱化断言——保留核验纪律（CLAUDE.md 第 9 条）
acceptance:
  - 五个测试文件全部通过，断言反映新“按需触发”语义
  - 无测试仍引用已删的 auto_dispatch_next_step
verify:
  - pytest backend/app/modules/change/tests/test_auto_dispatch_gate.py test_gate_retry.py test_reconcile_gate.py test_dispatch.py test_gate_via_delegate.py
constraints:
  - 测试逻辑本身有误才改；非误不弱化断言（CLAUDE.md 第 9 条）
  - 仅改 change/tests 这 5 个文件，daemon/tests 归 task-17
provides:
  - 砍 auto_dispatch 后的 change 子域回归测试通过
expects_from:
  task-06:
    - contract: auto_dispatch_next_step 已删，6 调用点改造完成，新语义为“按需触发”
      needs: [无 auto_dispatch_next_step 残留, transition_with_dispatch/complete_stage 可用]
---

# task-14 实现笔记

FR-01/R-05。改写范围严格限定 change/tests 的 5 个 auto_dispatch 相关文件；daemon/tests 回归归 task-17。
