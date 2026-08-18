---
id: task-03
title: add-mode-to-agent-session-list-items
title_zh: 会话列表项补 mode 并填充两处组装点
author: qinyi
created_at: 2026-08-17 14:10:00
priority: P0
depends_on: []
blocks: [task-04, task-07]
requirement_ids: [FR-07]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/app/modules/daemon/schema.py
  - backend/app/modules/agent/router.py
  - backend/app/modules/change/router.py
  - backend/app/modules/agent/tests/test_agent_sessions_include_ended.py
  - backend/app/modules/daemon/tests/test_change_session.py
provides:
  - contract: AgentSessionListItem
    fields: [mode]
expects_from: {}
goal: >
  给 AgentSessionListItem 补 mode 字段，并让工作区级与变更级两处组装点都从会话 config 填充，使前端能据此区分 scan 会话与 chat 会话。
implementation:
  - daemon/schema.py 的 AgentSessionListItem 补 mode 字段，类型为 str 或 None，缺省 None
  - agent/router.py 的 _assemble_workspace_session_items 组装列表项时填充 mode，取值自会话 config 的 mode 键
  - change/router.py 的 list_change_sessions 组装列表项同样填充 mode，取值方式与组装点一一致
  - 适配或新增测试，断言工作区级与变更级列表项 mode 等于会话 config.mode 且缺省为 None
acceptance:
  - 两组装点返回的列表项 mode 等于会话 config.mode，config 缺失或未含 mode 键时为 None
  - 适配后既有测试全部通过，agent 与 change 模块无回归
verify:
  - pytest 跑 test_agent_sessions_include_ended.py 与 test_change_session.py 全绿
  - pytest 跑 agent 与 change 模块用例确认无回归
constraints:
  - mode 为纯新增可空字段，不改既有字段语义与排序逻辑
  - 两处组装点均为显式构造，需同步补 mode，不依赖 from_attributes 自动映射
  - 本任务不改前端类型与 gen:types 产物，归 task-04
related_tests: test_agent_sessions_include_ended.py 与 test_change_session.py 若断言列表项字段集合则需补 mode
---
