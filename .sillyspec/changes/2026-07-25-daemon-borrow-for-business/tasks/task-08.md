---
id: task-08
title: prepare_interactive_dispatch._get_online_runtime 借用接入
title_zh: 业务 quick-chat 交互式派发路接入借用
author: qinyi
created_at: 2026-07-25 21:50:26
priority: P0
depends_on: [task-05]
blocks: [task-09]
requirement_ids: [FR-04]
decision_ids: [D-008@v1]
allowed_paths:
  - backend/app/modules/agent/placement.py
expects_from:
  task-05:
    - contract: BorrowedRuntimeResolution
      needs: [runtime_dict, borrowed, lender_user_id]
goal: >
  让业务人员 quick-chat 走的 interactive 派发路（user 级 _get_online_runtime，不看 workspace binding）也能借用。
implementation:
  - spike-01 定接入方式：倾向「调用方前置解析」——prepare_interactive_dispatch(363-496) 在调 _get_online_runtime(946，调用点 408) 前，若 actor 无自有 daemon 则先调 _resolve_borrowed_or_own_runtime 拿借用 runtime 再传入，避免改 _get_online_runtime 的 user 级签名（侵入小）
  - 备选：改造 _get_online_runtime 接受 workspace_id（侵入大，若前置解析不可行再用）
  - 把 spike-01 结论记入 task 卡 constraints
acceptance:
  - 业务人员 quick-chat（interactive）借用走通，跑在共享 daemon
  - 开发人员自有 daemon 的 interactive 派发零回归（_get_online_runtime 原路径）
verify:
  - cd backend && uv run pytest app/modules/agent -q --no-cov
  - cd backend && uv run mypy app/modules/agent
constraints:
  - spike-01 前置验证接入方式（R-07），结论写入本卡
  - 不破坏 _get_online_runtime 现有 user 级查询语义（开发人员自有 daemon）
  - 与 task-06/07 同语义（4 路一致，D-008）
---
