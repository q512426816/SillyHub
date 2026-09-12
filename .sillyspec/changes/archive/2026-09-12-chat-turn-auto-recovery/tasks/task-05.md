---
id: task-05
title: 'Wave 3 backend：派发链（定时 origin/G10/透传 + inject 加参 + 忙轮 origin）'
title_zh: 'Wave 3 backend：派发链'
author: 'qinyi'
created_at: 2026-09-12 11:12:00
priority: P0
depends_on: ['task-03','task-04']
blocks: ['task-07']
requirement_ids: ['FR-3.7']
decision_ids: ['D-008@v2']
allowed_paths:
  - backend/app/modules/daemon/scheduled_send.py
  - backend/app/modules/daemon/session/service/inject.py
  - backend/app/modules/daemon/session/service/queue.py
  - backend/app/modules/daemon/tests/test_scheduled_send_sweeper.py
target_files:
  - backend/app/modules/daemon/scheduled_send.py
  - backend/app/modules/daemon/session/service/inject.py
  - backend/app/modules/daemon/session/service/queue.py
  - backend/app/modules/daemon/tests/test_scheduled_send_sweeper.py
goal: >
  design §5.4：①scheduled_send._dispatch_scheduled_entry（:86）——origin=auto_resume 条目：
  parse_auto_resume_origin → G10 超越守卫（source run 后有更新 run → 条目置 cancelled/
  error_code='superseded' 跳过 inject）→ inject_session_as_service 传 auto_resume_of；
  ②inject_session_as_service（inject.py:252-297）+auto_resume_of: uuid.UUID | None = None 并
  转发 _inject_into_session（:366，私有参 :391 已有）；忙轮分支把 origin 复合值传
  _handle_busy_turn；③_handle_busy_turn（queue.py:50，INSERT :186-207）+origin 可选参（既有
  调用零传参不变）。排队派发路径（queue.py:648-728）零改动。
implementation: >
  G10 守卫形态照 queue.py:648-685 平移（AgentRun created_at 更晚 + id > source 语义一致）；
  cancelled 置位走 scheduled 既有状态机。测试：sweeper 套件增——origin 条目派发打标
  metadata_.auto_resume_of、G10 命中置 cancelled、忙轮转排队后 queued 行带 origin（R-08）、
  非 origin 条目零回归；queue 套件 _handle_busy_turn origin 透传用例实际落 sweeper 套件（test_scheduled_send_sweeper.py 忙轮转排队保留 origin 用例覆盖同一断言面）；queue.py 派发路径零改动故 test_session_queue.py 未触碰（执行期偏差，review changedFiles 一致）。
acceptance: >
  sweeper+queue+inject 套件全绿；三新用例过；既有定时/排队/inject 用例零回归。
constraints: >
  at-least-once 语义不变（先 inject 后状态翻转两事务）；派发失败仍走既有 failed 收敛；inject
  链中段穿透必须显式传参（不落全局状态）。
verify: '验收标准见 acceptance 字段'
base_commit: '39d13bd4cbd3c9f198b8e24058951cf548dfa3cd'
head_commit: ''
---

## 验收标准

sweeper/queue/inject 套件全绿；origin 派发打标 / G10 cancelled / 忙轮转排队带 origin 三用例过；既有零回归。
