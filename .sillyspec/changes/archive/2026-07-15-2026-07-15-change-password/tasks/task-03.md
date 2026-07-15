---
id: task-03
title: "auth/service.py 新增 AuthService.change_password 方法"
title_zh: 实现修改密码 service 逻辑
author: WhaleFall
created_at: 2026-07-15 11:24:44
priority: P0
depends_on: [task-01]
blocks: [task-04, task-05]
requirement_ids: [FR-02, FR-04, FR-05]
decision_ids: [D-001@v1, D-004@v1, D-005@v1]
allowed_paths:
  - backend/app/modules/auth/service.py
expects_from:
  task-01:
    - contract: PasswordIncorrect
      needs: [code, http_status]
provides:
  - contract: AuthService.change_password
    fields: []
goal: >
  实现 AuthService.change_password：verify 旧密码 → hash 新密码 → execute-only 撤销全部 session →
  写 AuditLog → 末尾统一 commit，四者原子（X-001 修正）。
implementation:
  - 在 AuthService 新增 async change_password(*, user_id, old_password, new_password)
  - password_hasher.verify(old_password, user.password_hash) 失败抛 task-01 的 PasswordIncorrect
  - user.password_hash = password_hasher.hash(new_password)；execute UPDATE session 撤销全部未撤销（不单独 commit）
  - add AuditLog(action="user.password_change", actor_id=user_id)；末尾 await self._db.commit() 统一提交
acceptance:
  - 旧密码 verify 失败抛 PasswordIncorrect
  - 密码更新 + session 撤销 + AuditLog 在同一事务末尾统一 commit（D-004/X-001）
  - 不调用内部 commit 的 revoke_all_user_sessions（会破坏原子性）
verify:
  - cd backend && uv run ruff check app/modules/auth/service.py
  - cd backend && uv run mypy app
constraints:
  - 撤销 session 用 execute-only UPDATE（参考 admin/users_service.py _revoke_sessions），不调 revoke_all_user_sessions
  - 审计 action=user.password_change，actor=自己（D-005）
---
