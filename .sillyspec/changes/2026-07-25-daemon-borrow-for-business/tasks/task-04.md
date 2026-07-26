---
id: task-04
title: lender 标记/撤销 shared 端点 + owner 查询/撤销端点
title_zh: daemon 共享标记与管理端点
author: qinyi
created_at: 2026-07-25 21:50:26
priority: P0
depends_on: [task-01]
blocks: [task-12]
requirement_ids: [FR-01, FR-02]
decision_ids: [D-003@v1]
allowed_paths:
  - backend/app/modules/workspace/member_runtimes/service.py
  - backend/app/modules/workspace/member_runtimes/router.py
expects_from:
  task-01:
    - contract: WorkspaceMemberRuntime
      needs: [shared]
goal: >
  提供 lender 标记/撤销自己 daemon 共享、owner 查询/撤销工作空间共享 daemon 的端点。
implementation:
  - service.py 加 set_my_binding_shared(user_id, workspace_id, shared)（校验 binding 归属本人）+ list_shared_daemons(workspace_id)（owner 查所有 shared binding JOIN daemon 在线状态）+ revoke_shared(owner, workspace_id, target_user_id)
  - router.py 加 PUT /workspaces/{ws}/my-binding/shared（lender）+ GET /workspaces/{ws}/shared-daemons（owner）+ DELETE/PUT 撤销
  - 鉴权：lender 只能改自己的 binding（user_id 匹配）；owner 需 workspace_owner 角色
acceptance:
  - lender 能标记/撤销自己 binding 的 shared
  - owner 能列出工作空间所有 shared daemon（含 lender、在线状态、可撤销）
  - owner 撤销设 shared=false（不删 binding 行）
  - 非成员/非 owner 403
verify:
  - cd backend && uv run pytest app/modules/workspace -q --no-cov
  - 改 router 必跑对应 test_router（重建容器 import 才暴露参数顺序错误）
constraints:
  - lender 只能标自己的 binding（user_id 校验，复用现有 daemon_not_owned 之外加 shared 字段更新）
  - owner 撤销 = shared=false 不删行（保留 binding）
  - shared 默认 false，未调用端点行为不变
---
