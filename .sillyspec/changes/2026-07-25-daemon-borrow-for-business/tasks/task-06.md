---
id: task-06
title: placement._resolve_dispatch_runtime + _resolve_decide_runtime 接入借用 helper
title_zh: 主派发与决策预检两路接入借用解析
author: qinyi
created_at: 2026-07-25 21:50:26
priority: P0
depends_on: [task-05]
blocks: [task-09]
requirement_ids: [FR-04]
decision_ids: [D-008@v1]
allowed_paths:
  - backend/app/modules/agent/placement.py
provides:
  - contract: BorrowedLeaseFlag
    fields: [borrowed, lender_user_id]
expects_from:
  task-05:
    - contract: BorrowedRuntimeResolution
      needs: [runtime_dict, borrowed, lender_user_id]
goal: >
  主派发 _resolve_dispatch_runtime 与决策预检 _resolve_decide_runtime 两路同语义接入借用 helper。
implementation:
  - _resolve_dispatch_runtime(690-807) 在 749-754（无 binding）/ 771-775（离线）raise NoOnlineDaemonError 前，先调 _resolve_borrowed_or_own_runtime；返回借用 runtime 则用，None 才 raise 原错误
  - _resolve_decide_runtime(855-944) 在 900-905 / 921-926 同样接入
  - 建借用 lease 时把 borrowed 标记 + lender_user_id 写入 lease metadata（供 task-09 沙箱 + task-10 落 file 判别）
acceptance:
  - actor 有自有在线 daemon → 走原路径（零回归）
  - actor 无自有 + 借用条件满足 → 两路都走借用，语义一致
  - 借用条件不满足 → 两路都抛原 NoOnlineDaemonError（文案不变）
verify:
  - cd backend && uv run pytest app/modules/agent -q --no-cov
  - cd backend && uv run mypy app/modules/agent
constraints:
  - 两路必须同语义（避免 D-007 式"decide 通过但 dispatch 报错"割裂）
  - 不改原错误文案（helper 返回 None 时 raise 原 NoOnlineDaemonError）
  - 不改 _resolve_dispatch_runtime / _resolve_decide_runtime 函数签名
---
