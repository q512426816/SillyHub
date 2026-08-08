---
id: task-03
title: rewrite _advance_team_stage keep complete_stage drop dispatch
title_zh: 重写 _advance_team_stage 保留 complete_stage 删 dispatch
author: qinyi
created_at: 2026-08-08 22:20:00
priority: P0
depends_on: []
blocks: [task-06, task-16, task-17, task-18]
allowed_paths:
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/backend/app/modules/daemon/run_sync/service.py
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/backend/app/modules/change/service.py
related_tests:
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/backend/app/modules/change/tests/test_dispatch_execute_team_mode.py
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/backend/app/modules/change/tests/test_complete_stage.py
goal: >
  重写 _advance_team_stage（run_sync:1685，调用点④，team mission 收敛→change.current_stage 唯一桥）：保留 merge_gate_results(:1720) + ChangeService.complete_stage（推进 current_stage + 落 pending_review）+ 发 SSE；删 :1752 auto_dispatch_next_step，下一 stage team mission 交 advance_change_stage tool 显式触发。
implementation:
  - 保留 merge_gate_results（合并 worker gate，:1720）
  - 保留调用 ChangeService.complete_stage(team_stage) 推进 current_stage
  - 删除 :1752 处伪造 StageSyncResult + auto_dispatch_next_step 推进 team stage 的整块
  - 发 stage_status_changed SSE 留痕（team stage 已推进，下一 stage 待显式触发）
  - 核对 change/service.py 中 complete_stage 契约（推进 + pending_review）不被破坏
acceptance:
  - team mission 收敛后 current_stage 推进到下一 team stage + 落 pending_review
  - 不再自动 dispatch 下一 stage team mission（auto_dispatch_next_step 引用归零）
verify:
  - grep -n "auto_dispatch_next_step" backend/app/modules/daemon/run_sync/service.py（_advance_team_stage 范围命中 0）
  - task-16 维护的 test_dispatch_execute_team_mode.py / test_complete_stage.py / test_advance_team_stage.py 通过
constraints:
  - complete_stage 桥必须保留（删了 team 推进就断）
  - schedule_loop（orchestrator:263）+ converge_mission_for_completed_run（lease:619）不动
provides:
  - team stage 推进桥：complete_stage 推进 current_stage，不 dispatch 下一 stage
  - 调用点④清零：_advance_team_stage 不再引用 auto_dispatch_next_step
expects_from: {}
---

# task-03 实现笔记

R-04/D-006 核心。task-16 验证 team execute→verify→archive 按需流转；task-07 的 advance_change_stage tool 接 _dispatch_execute_team 建下一 stage mission。
