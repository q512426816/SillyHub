---
id: task-05
title: facade and lease stage callback lighten
title_zh: facade/lease 阶段回调改轻
author: qinyi
created_at: 2026-08-08 22:20:00
priority: P0
depends_on: []
blocks: [task-06, task-17, task-18]
allowed_paths:
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/backend/app/modules/daemon/service.py
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/backend/app/modules/daemon/lease/service.py
related_tests:
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/backend/app/modules/daemon/tests/test_lease_service.py
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/backend/app/modules/daemon/tests/test_close_interactive_run_session_status.py
goal: >
  改轻 daemon facade（daemon/service.py:458）+ lease（lease/service.py:542 _trigger_stage_completion_callback）的 stage callback 行为：只留痕/发 SSE，不推进；lease:619 converge_mission_for_completed_run 完全保留（调用点② facade）。
implementation:
  - daemon/service.py:458 facade 保留委托骨架，被委托的 callback 行为变轻（留痕 + SSE，不推进）
  - lease/service.py:542 _trigger_stage_completion_callback 保留调用入口，行为改轻
  - lease/service.py:619 converge_mission_for_completed_run 完全不动（mission finalize 与 auto_dispatch 无关）
  - 移除本范围内对 auto_dispatch_next_step 的引用
acceptance:
  - facade/lease callback 执行后只留痕 + 发 SSE，不触发 stage 推进
  - converge_mission_for_completed_run 行为零变化
  - 本范围不再引用 auto_dispatch_next_step
verify:
  - grep -rn "auto_dispatch_next_step" backend/app/modules/daemon/service.py backend/app/modules/daemon/lease/service.py（命中 0）
  - task-17 维护的 test_lease_service.py / test_close_interactive_run_session_status.py 通过
constraints:
  - converge_mission_for_completed_run 必须零改动（非目标 §3）
  - complete_lease → facade → callback 委托链不断
provides:
  - 调用点② facade 清零：daemon facade/lease callback 不再引用 auto_dispatch_next_step
  - callback 改轻（留痕 + SSE）
expects_from: {}
---

# task-05 实现笔记

调用点② facade（design §4.1）。这是第二个独立 stage 完成触发源（complete_lease → facade），与 gate task 触发源并行存在。
