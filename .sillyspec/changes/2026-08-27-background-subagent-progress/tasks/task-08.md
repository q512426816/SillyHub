---
id: task-08
author: qinyi
created_at: 2026-08-27 09:36:00
priority: P1
title: backend 单测（透传 / 归位 / 422 / l10n）
title_zh: backend 单测（透传 / 归位 / 422 / l10n）
depends_on: [task-05, task-06, task-07]
blocks: []
allowed_paths:
  - backend/app/modules/daemon/tests/test_agent_task_status_payload.py
  - backend/app/modules/daemon/tests/test_subagent_log_attribution.py
  - backend/app/modules/daemon/tests/test_inject_empty_prompt.py
  - backend/app/modules/daemon/tests/test_session_plan_bash_events.py
provides: []
expects_from:
  - task: task-05
    contract: api_schema
    fields: [AgentTaskStatusEvent 扩展字段, notify 端点]
  - task: task-06
    contract: attribution_behavior
    fields: [parent 行归位, 兜底口径]
goal: |
  FR-04/05/08 的 backend 验收测试。
implementation: |
  1. test_agent_task_status_payload.py：notify 端点收扩展载荷 → Redis publish payload 字段全量（含 async alias）；旧载荷兼容；status 终态值接受。
  2. test_subagent_log_attribution.py：同 session 两 run，第二 run 期间 submit 带 parent_tool_use_id 行 → 落库 run_id=派发 run；未命中 parent → 保持当前 run 不抛错；tool_call 行冷启动反查生效。
  3. test_inject_empty_prompt.py：空串/全空白 → 422 + 中文 detail + 无 AgentRun/user_input 行产生；非空照常（含 queue_when_busy 路径先校验）。
acceptance: |
  三个新文件用例全绿；test_error_message_l10n 既有守护同步绿（SessionEmptyPrompt 中文）。
verify: |
  cd backend && uv run pytest app/modules/daemon/tests/test_agent_task_status_payload.py app/modules/daemon/tests/test_subagent_log_attribution.py app/modules/daemon/tests/test_inject_empty_prompt.py tests/core/test_error_message_l10n.py。
constraints: |
  pytest-asyncio auto 模式（无需装饰器）；不 importlib.reload(config)（knowledge 坑）；单测 SQLite 方言（不依赖 PG 特性）。
---
