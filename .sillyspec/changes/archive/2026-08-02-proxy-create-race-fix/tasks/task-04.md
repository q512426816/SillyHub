---
id: task-04
title: _reparse created 分支加 IntegrityError 防御撞键转 update
title_zh: _reparse created 撞键兜底
author: qinyi
created_at: 2026-08-02 00:34:30
priority: P1
depends_on: []
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-004@v1]
allowed_paths:
  - backend/app/modules/change/service.py
provides: []
expect_from: []
related_tests: []
goal: >
  _reparse created 分支加 IntegrityError 防御，极端并发撞 changes 唯一键时回滚该 add 重查转 update 不抛 500。
implementation:
  - service.py 顶部加 from sqlalchemy.exc import IntegrityError，当前第17行仅 import func 或 select 未 import exc
  - created 分支的 session add row 外包 try except IntegrityError，落点 service.py 第1064到1067行，与 apply_sync 阶段级 try except 正交
  - 因 session.add 本身不立即抛约束违反 execute 定具体触发方式 用 flush 触发检测 或 savepoint begin_nested 配合
  - 撞 ux_changes_workspace_key 时回滚该 add 重查 existing_by_key 改走 _apply_parsed 的 update 分支 stats 计数修正为 updated
acceptance:
  - AC-07 撞 ux_changes_workspace_key 时 catch IntegrityError 重查转 update 不抛 500
  - 兜底成功后 sync_status 不永久 dirty 状态收敛
verify:
  - cd backend 然后 uv run pytest app/modules/change/tests -q --no-cov
constraints:
  - 落点只在 _reparse created 分支不动 apply_sync 阶段级 try except
  - 不改 _build_change 签名语义 不加 migration 不动 schema
  - 属 belt and suspenders 兜底物理上几乎不触发 task-01 占坑已让 reparse 走 update 而非 created 但必须实现
---
