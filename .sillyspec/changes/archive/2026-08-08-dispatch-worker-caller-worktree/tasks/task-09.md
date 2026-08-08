---
id: task-09
title: 全套零回归（test_dispatch_worker_worktree / test_mcp_tools / test_execution / team 模式 create_mission 全绿，只跑不改）
title_zh: Wave 3 零回归守门
author: qinyi
created_at: 2026-08-08 17:39:23
priority: P0
depends_on: [task-01, task-02, task-03, task-04, task-05, task-06, task-07, task-08]
blocks: []
requirement_ids: [FR-05]
decision_ids: []
allowed_paths:
  - C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\agent\tests\test_dispatch_worker_worktree.py
  - C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\agent\tests\test_mcp_tools.py
  - C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\tests\modules\agent\test_execution.py
  - C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\mcp_gateway\tests\test_tools_new.py
provides:
  - contract: 路径A + external 落地后 team 模式 / 既有调用方字节不变（零回归证据）
expects_from:
  - task: task-01..task-06
    contract: orchestration_mode 默认 team + dispatch_worker 三参默认 None + converge external 默认不命中（§9）→ 既有调用方行为不变
  - task: task-07
    contract: 新增 external mode 测试绿
  - task: task-08
    contract: 新增 caller-worktree 测试绿
goal: >
  守门零回归：新增可选参（orchestration_mode 默认 team / worktree_path|branch|worker_prompt 默认 None / converge external 默认不命中）对既有 team 模式 worker、既有 MCP/HTTP dispatch 调用方字节不变（AC-02/FR-05）。只跑不改。
implementation:
  - 不改 src / 既有测试，纯执行既有套件验证默认值兼容（design §9）；红 = task-01..06 破坏兼容，回 src 不修测试（规则 11）。
  - test_dispatch_worker_worktree.py（per-worker worktree AC-01..06）+ test_mcp_tools.py + backend/tests/modules/agent/test_execution.py（worker_tool_config/render_worker_prompt/placement/collect_artifact/endpoint）全绿 → 注入 delegate 原自建 worktree 路径 + execution + HTTP 入口契约不变。
  - test_tools_new.py::test_create_mission_created_by_is_token_creator 绿 → team 默认 create_mission 仍 spawn orchestrator run（external 分叉未污染默认路径）。
acceptance:
  - app/modules/agent 全量（含 task-07/08 新增 + 既有）绿（AC-02）。
  - team 默认 create_mission 仍返 orchestrator run；dispatch_worker 不传三参走原 per-worker worktree 自建路径（既有断言不破）。
verify:
  - cd backend && uv run pytest app/modules/agent -q --no-cov --deselect app/modules/agent/tests/test_dispatch_metadata.py::test_build_claim_payload_propagates_bundle_fields --deselect app/modules/agent/tests/test_execution_context.py::test_get_execution_context_task_run
  - cd backend && uv run pytest app/modules/mcp_gateway/tests/test_tools_new.py -q --no-cov
constraints:
  - 只跑不改：不动 src 也不动既有测试源文件；红 = 实现 bug 回 src。deselect 两条与本变更无关的已知用例，保持绿信号干净。
---
