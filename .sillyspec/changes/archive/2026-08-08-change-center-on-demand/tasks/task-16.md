---
id: task-16
title: team advance rewrite tests
title_zh: team 推进重写测试
author: qinyi
created_at: 2026-08-08 22:20:00
priority: P0
depends_on: [task-03, task-07]
blocks: []
allowed_paths:
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/backend/app/modules/daemon/tests/test_advance_team_stage.py
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/backend/app/modules/change/tests/test_dispatch_execute_team_mode.py
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/backend/app/modules/change/tests/test_complete_stage.py
goal: >
  验证 team 推进重写闭环：_advance_team_stage 收敛后 complete_stage 推进 current_stage 但不 dispatch 下一 stage；advance_change_stage tool 能触发 _dispatch_execute_team 建 verify/archive team mission。execute→verify→archive 按需流转（FR-05/R-04）。
implementation:
  - 新建 daemon/tests/test_advance_team_stage.py：
    - team mission 收敛 → merge_gate_results + complete_stage 推进 current_stage + pending_review
    - 断言不调 auto_dispatch_next_step / 不自动建下一 stage mission
  - 扩展 change/tests/test_dispatch_execute_team_mode.py：
    - advance_change_stage → dispatch_next_step team 分流 → _dispatch_execute_team 建下一 stage mission
  - 维护 change/tests/test_complete_stage.py：complete_stage 推进 + pending_review 契约
acceptance:
  - team execute→verify→archive 三步均经显式 advance 触发，按需流转通
  - 无自动连轴（auto_dispatch_next_step 引用 0）
verify:
  - pytest backend/app/modules/daemon/tests/test_advance_team_stage.py backend/app/modules/change/tests/test_dispatch_execute_team_mode.py backend/app/modules/change/tests/test_complete_stage.py
constraints:
  - team 桥（complete_stage）必须保留（task-03 契约）
  - 不重复 task-15 的 tool 层用例（本 task 跨 daemon team 桥 + change team dispatch）
provides:
  - team 推进重写闭环验证（R-04 关键）
expects_from:
  task-03:
    - contract: _advance_team_stage 重写完成——merge_gate_results + complete_stage 推进 current_stage，删 auto_dispatch
      needs: [重写后函数签名/行为，complete_stage 桥]
  task-07:
    - contract: advance_change_stage tool 能触发 team 分流 _dispatch_execute_team 建 verify/archive mission
      needs: [tool 入参/返回，team 分流路径]
---

# task-16 实现笔记

R-04/FR-05 关键验证。team 推进闭环三节点（task-03 桥 + task-07 tool + task-16 测试）的最后一环。daemon/tests 新增 test_advance_team_stage.py。
