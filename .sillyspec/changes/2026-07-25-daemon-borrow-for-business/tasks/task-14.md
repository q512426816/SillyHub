---
id: task-14
title: 单测（4 路 resolver 一致性 / 借用三重校验 / 写边界 / 审计）+ 跨变更对齐核查
title_zh: 验证与跨变更对齐
author: qinyi
created_at: 2026-07-25 21:50:26
priority: P0
depends_on: [task-06, task-07, task-08, task-09, task-10, task-11]
blocks: []
requirement_ids: [FR-05, FR-07]
decision_ids: [D-008@v1]
allowed_paths:
  - backend/tests/
  - backend/app/modules/agent/placement.py
goal: >
  单测覆盖 4 路 resolver 一致性、借用查询三重校验、写边界（borrow agent 不能写 lender 代码区）、审计；并核查跨变更无冲突。
implementation:
  - 单测：4 路 resolver（dispatch/decide/writeback/interactive）同语义借用回退一致性
  - 单测：resolve_shared_daemon_for_borrow 三重校验（DAEMON_BORROW 权限 / shared / online）
  - 写边界测试：borrow lease 的 agent 尝试写 lender allowed_roots 应被 PolicyEngine 拒
  - 审计测试：每次借用写 daemon_borrow_audit
  - 跨变更对齐核查：rbac-permission-cache 缓存失效对齐 / llm-provider-management provider 额度 / platform-file-center file 落点无冲突
acceptance:
  - 全部单测通过
  - 写边界测试验证借用 agent 不能写 lender 代码区
  - 4 路 resolver 借用回退语义完全一致
  - 跨变更无冲突
verify:
  - cd backend && uv run pytest app/modules/agent app/modules/workspace app/modules/auth -q --no-cov
  - cd sillyhub-daemon && pnpm test
  - cd frontend && pnpm test
constraints:
  - test_strategy=module 按命中的子模块跑（不全量，避免 backend 预存 errors）
  - backend 用 backend/.venv/Scripts/python.exe 跑 pytest
  - 改 router 必跑对应 test_router
  - brownfield 零回归：shared 默认 false / DAEMON_BORROW 默认不授 / helper 第 1 步原路径
---
