---
id: task-09
title: end_session/failed readiness.clear
title_zh: session 结束清理 ready 状态
author: WhaleFall
created_at: 2026-08-07 14:32:00
priority: P0
depends_on: [task-05]
blocks: [task-12]
requirement_ids: [FR-04]
decision_ids: []
allowed_paths:
  - backend/app/modules/daemon/session/service.py
expects_from:
  task-05:
    - contract: SessionReadiness
      needs:
        - clear
goal: >
  session 进入终态（ended 或 failed）时清理 ready set 与 per-session event，避免残留
  event 让后续 inject 误判已结束 session 为 ready。
implementation:
  - end_session（service.py 820）ended 收口单事务 commit（937）后调 readiness.clear，already-ended 幂等早退分支（857-859）也调 clear 防前次未清残留
  - _converge_failed_dispatch（service.py 552，create_session 离线 fallback，failed 569）commit（580）后调 readiness.clear
  - mark_session_recovery_failed（service.py 1263，daemon resume 失败，failed 1293）commit（1297）后调 readiness.clear
  - 三处复用 task-05 的 SessionReadiness.clear，在 commit 后事务外调用，包 try except（best-effort，异常仅 warning 不阻塞结束流程）
acceptance:
  - end_session ended 收口与幂等早退分支均调 clear，两 failed 路径（dispatch 离线与 resume 失败）收口后均调 clear
  - clear 在 commit 后事务外，不影响原 commit 与 WS SESSION_END 与 SSE 流程
  - clear 幂等（set discard 加新建 event），多次调不报错，对应单测过
verify:
  - cd backend && ruff check
  - cd backend && python -m pytest
constraints:
  - 仅终态（ended 或 failed）清理，active reconnecting pending 不动，不阻塞结束流程
  - clear 必须在 DB commit 后调用，避免事务回滚后 ready 状态与 DB 不一致
---
