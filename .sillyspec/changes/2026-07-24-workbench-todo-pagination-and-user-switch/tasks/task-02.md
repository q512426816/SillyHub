---
id: task-02
title: workbench service 权限与可见用户算法（覆盖：FR-03, FR-04, D-002@v1）
title_zh: service — _resolve_target_user/_visible_user_ids/_can_view_others/_load_user
author: qinyi
created_at: 2026-07-24 09:07:27
priority: P0
depends_on: []
blocks: [task-03, task-04, task-05]
requirement_ids: [FR-03, FR-04]
decision_ids: [D-002@v1]
allowed_paths:
  - backend/app/modules/ppm/workbench/service.py
provides:
  - contract: _resolve_target_user
    fields: [user, target_user_id, resolved_user]
  - contract: _visible_user_ids
    fields: [user_id_set]
  - contract: _can_view_others
    fields: [bool]
goal: >
  实现 workbench 切换用户的权限收口：解析目标用户（越权 403/不存在 404）+ 按经理角色分口径计算可见用户集 + 登录人能否切换。
implementation:
  - _load_user(user_id)：查 User，None→404
  - _resolve_target_user(user, target_user_id)：空/自己→user；超管→_load_user；否则 target∈_visible_user_ids 否则 403
  - _visible_user_ids：查 me 的 PpmProjectMember 拆 role_name；部门经理→所属 org 的 {oid}|_descendant_ids 子树成员；项目/开发/业务经理→这些项目 PpmProjectMember.user_id；并集 ∪ {me}
  - _can_view_others：超管 OR me 任一成员角色命中 MANAGER_ROLE_NAMES
  - 复用 data_scope.MANAGER_ROLE_NAMES / is_super_admin / admin._descendant_ids 常量与函数
acceptance:
  - 部门经理可见本部门及下属部门成员（{oid}|_descendant_ids 并回根）
  - 项目/开发/业务经理可见其经理项目成员，多项目去重并集
  - 越权传他人 target→403；超管任意目标存在→返回，不存在→404
  - 非经理非超管 _can_view_others=False
verify:
  - cd backend && uv run pytest app/modules/ppm/workbench -q --no-cov -k "visible or resolve_target or can_view"
constraints:
  - 仅权限/可见集计算，不改 getter 取数（task-03 做）
  - _descendant_ids 排除根，须 {oid} 并回（design §7.3 C3）
---
