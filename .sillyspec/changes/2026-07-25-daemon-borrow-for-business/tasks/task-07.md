---
id: task-07
title: resolve_runtime_for_writeback 接入借用 helper
title_zh: 写回路径接入借用解析
author: qinyi
created_at: 2026-07-25 21:50:26
priority: P0
depends_on: [task-05]
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-008@v1]
allowed_paths:
  - backend/app/modules/workspace/member_runtimes/resolver.py
expects_from:
  task-05:
    - contract: BorrowedRuntimeResolution
      needs: [runtime_dict, borrowed, lender_user_id]
goal: >
  写回链路 resolve_runtime_for_writeback 同语义接入借用 helper（4 路之一的 writeback 路）。
implementation:
  - resolver.py:59-150 的 resolve_runtime_for_writeback 在 106-109（无 binding）/ 120-125（离线）处调 _resolve_borrowed_or_own_runtime
  - 返回借用 runtime 则写回到 lender daemon 的 runtime，None 则原逻辑抛错
acceptance:
  - 借用 lease 的写回路径解析到 lender runtime，与 dispatch/decide 一致
  - 自有 daemon 写回零回归
verify:
  - cd backend && uv run pytest app/modules/workspace -q --no-cov
  - cd backend && uv run mypy app/modules/workspace
constraints:
  - 与 task-06/08 同语义（4 路一致，D-008）
  - 写回借用时不越权写 lender 私有数据（仅 runtime 解析层面）
---
