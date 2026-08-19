---
id: task-06
title: 会话列表扩展：runtime_id/machine_id/provider/q 过滤 + 分页验证（覆盖 FR-02, D-003@v1）
title_zh: 会话列表过滤参数
author: WhaleFall
created_at: 2026-08-15 09:55:21
priority: P1
depends_on: [task-02]
blocks: [task-11]
requirement_ids: [FR-02]
decision_ids: [D-003@v1]
allowed_paths:
  - backend/app/modules/daemon/router.py
  - backend/app/modules/daemon/tests/test_sessions_list_filters.py
provides:
  - contract: SessionListFilter
    fields: [runtime_id, machine_id, provider, q]
expects_from:
  task-02:
    - contract: AgentSessionRead
      needs: [config_snapshot]
goal: >
  会话列表 API 支持按机器/智能体/引擎/标题过滤，支撑总入口页面的筛选与虚拟滚动分页。
implementation:
  - router.py GET /sessions（:1739-1811）加查询参数 runtime_id/machine_id/provider/q
  - machine_id 经 join daemon_runtimes 过滤；q 对 title 做 ilike
  - 响应含 config_snapshot（task-02 已加 Read 字段，本 task 确认序列化含 machine_name/agent_name 供 chips 直显）
  - 过滤与既有 limit/offset/status 组合正确
acceptance:
  - 四个过滤参数单独与组合均生效
  - 分页在过滤后正确计算 total
verify:
  - cd backend && uv run pytest app/modules/daemon/tests -x -q -k "sessions or list"
constraints:
  - 不过度 join（chips 数据从 config_snapshot 直显免逐会话查询）
  - 过滤参数全部可选，不传时结果与现状一致
related_tests: []
---
