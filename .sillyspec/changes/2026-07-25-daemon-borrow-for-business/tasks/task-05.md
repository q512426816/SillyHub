---
id: task-05
title: 借用查询 resolve_shared_daemon_for_borrow + 共享 helper _resolve_borrowed_or_own_runtime
title_zh: 借用 daemon 解析核心 helper
author: qinyi
created_at: 2026-07-25 21:50:26
priority: P0
depends_on: [task-01, task-03]
blocks: [task-06, task-07, task-08]
requirement_ids: [FR-04]
decision_ids: [D-002@v1, D-008@v1]
allowed_paths:
  - backend/app/modules/agent/borrow_resolver.py
  - backend/app/modules/workspace/member_runtimes/queries.py
provides:
  - contract: BorrowedRuntimeResolution
    fields: [runtime_dict, borrowed, lender_user_id]
expects_from:
  task-01:
    - contract: WorkspaceMemberRuntime
      needs: [shared]
  task-03:
    - contract: DAEMON_BORROW
      needs: [permission_key]
goal: >
  新建借用解析 helper：先查自有 binding（零回归），无则回退解析工作空间共享 daemon，4 路 resolver 统一调用。
implementation:
  - queries.py 加 resolve_shared_daemon_for_borrow(session, workspace_id, actor_user_id, provider)：WHERE workspace_id AND shared=TRUE AND daemon_id IS NOT NULL AND user_id <> actor AND status='online'，叠加 _query_runtime_by_daemon_and_provider 解析成 runtime dict
  - 新建 agent/borrow_resolver.py 加 _resolve_borrowed_or_own_runtime(session, workspace_id, user_id, provider)：第 1 步 MemberBindingResolver.resolve_member_binding 查自有（有在线自有 daemon 就返回，零回归）；第 2 步无则调 resolve_shared_daemon_for_borrow，返回 (runtime_dict, borrowed=True, lender_user_id)
  - 内部三重校验：actor 有 DAEMON_BORROW 权限 + lender binding shared=True + daemon online
acceptance:
  - actor 有自有在线 daemon → 返回自有 runtime，borrowed=False（零回归原路径）
  - actor 无自有 + 有共享在线 daemon + 有 DAEMON_BORROW → 返回借用 runtime，borrowed=True，lender_user_id 正确
  - actor 无 DAEMON_BORROW 或无共享 → 返回 None（让调用方抛原 NoOnlineDaemonError）
verify:
  - cd backend && uv run pytest app/modules/agent app/modules/workspace -q --no-cov
  - cd backend && uv run mypy app/modules/agent
constraints:
  - helper 第 1 步必须先查自有（零回归，自有 daemon 路径完全不变）
  - 三重校验顺序：权限 → shared → online
  - 返回 runtime dict shape 对齐 placement.py:793 现有 shape
  - resolve_shared_daemon_for_borrow 放 queries.py（与 resolve_daemon_instance_for_workspace:115-168 同类内聚），helper 放 agent/borrow_resolver.py
---
