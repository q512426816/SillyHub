---
id: task-05
title: MCP submit_stage_review docstring/contract sync
title_zh: MCP submit_stage_review docstring/返回契约同步
author: qinyi
created_at: 2026-08-14 15:46:49
priority: P1
depends_on: [task-03, task-04]
blocks: [task-11]
requirement_ids: [FR-05f]
decision_ids: [D-004@v1]
allowed_paths:
  - backend/app/modules/mcp_gateway/tools.py
  - backend/app/modules/mcp_gateway/tests/test_change_stage_tools.py
goal: >
  MCP submit_stage_review 工具（mcp_gateway/tools.py:1029）docstring/返回契约随 D-004/D-006@v2
  同步更新：审批不再派发（agent_dispatch 恒空/移除），新增 notify 语义说明。
implementation:
  - mcp_gateway/tools.py：submit_stage_review 工具的 docstring 更新（不再声明派发行为；说明只落
    审批记录+状态、不派发 agent；若工具返回结构含 agent_dispatch 字段则按 task-03/04 的 HTTP 端点
    一致语义处理——恒空/移除，并在 docstring 说明）
  - 若工具内部调用了 service 的 review 方法，确保其走的是 task-03/04 改造后的行为（不派发 + 
    notify_session 语义，可透传 notify_session 参数）
  - 更新/新增该工具的测试断言（不派发、notify 语义）
acceptance:
  - submit_stage_review docstring 与返回契约与实际行为一致（不派发；notify 语义说明）
  - 工具测试断言更新后通过
  - ruff/mypy 通过
verify:
  - cd backend && uv run pytest app/modules/mcp_gateway -q --no-cov
  - cd backend && uv run ruff format --check app/modules/mcp_gateway && uv run ruff check app/modules/mcp_gateway && uv run mypy app/modules/mcp_gateway
constraints:
  - 只同步契约与测试，不新增 MCP 工具（design 非目标：不加 create_change）
  - 与 HTTP 端点行为一致（task-03/04 产出的语义是权威）
---
