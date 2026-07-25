---
id: task-11
title: 借用 lease 创建/完成时写 daemon_borrow_audit 审计记录
title_zh: 借用审计写入
author: qinyi
created_at: 2026-07-25 21:50:26
priority: P1
depends_on: [task-02]
blocks: []
requirement_ids: [FR-07]
decision_ids: [D-004@v1]
allowed_paths:
  - backend/app/modules/agent/service.py
  - backend/app/modules/agent/placement.py
expects_from:
  task-02:
    - contract: DaemonBorrowAudit
      needs: [borrower_user_id, lender_user_id, daemon_instance_id, workspace_id, agent_run_id]
goal: >
  借用 lease 创建/完成时写 daemon_borrow_audit 记录，满足 D-004 审计不限额。
implementation:
  - 借用 lease 创建时（placement 建 borrowed lease 处）写 daemon_borrow_audit：borrower/lender/daemon/workspace/agent_run/borrowed_at
  - 完成（complete_lease）时补 usage_summary（基础字段：turn 数/token 若可得）
acceptance:
  - 每次借用生成一条审计记录，字段完整
  - 普通非借用 lease 不写审计（零回归）
verify:
  - cd backend && uv run pytest app/modules/agent -q --no-cov
constraints:
  - D-004 仅审计不限额，不实现额度拦截
  - usage_summary 基础字段先行，明细后续
---
