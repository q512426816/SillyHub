---
id: task-04
title: 'Session x model usage read-only endpoint FR-23 (already delivered)'
title_zh: '会话 × 模型用量端点 FR-23（已完成登记）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-21 14:49:18
priority: P1
depends_on: []
blocks: []
requirement_ids: [FR-23]
decision_ids: []
allowed_paths:
  - backend/app/modules/daemon/router/__init__.py
  - backend/openapi.json
  - frontend/src/lib/api-types.ts
  - sillyhub-daemon/src/api-types.ts
  - backend/app/modules/daemon/tests/test_session_model_usage.py
target_files:
  - backend/app/modules/daemon/router/__init__.py
  - backend/openapi.json
  - frontend/src/lib/api-types.ts
  - sillyhub-daemon/src/api-types.ts
  - backend/app/modules/daemon/tests/test_session_model_usage.py
goal: >
  登记 FR-23 已落盘面：GET /api/daemon/sessions/{session_id}/model-usage 只读投影（run × model 用量明细，
  轮次序优先排序，get_agent_session 归属闸门，硬上限 2000 + truncated）。本卡不是待做工作；4 例测试的复跑由 task-15 承接。
implementation:
  - '已落盘：backend/app/modules/daemon/router/session_insights.py:933-1052（_SESSION_MODEL_USAGE_MAX=2000、SessionModelUsageItemRead / SessionModelUsageRead + 端点）；router/__init__.py:283-286 注册；backend/openapi.json +136 行；frontend/src/lib/api-types.ts 与 sillyhub-daemon/src/api-types.ts 各 +117 行（pnpm gen:types 生成，禁手改）；测试 260 行（TestSessionModelUsage 4 例）'
  - '契约：数据源 agent_run_model_usage JOIN agent_runs，只读、不二次聚合、不含日志正文 / system_prompt / agent_profile_snapshot；缺失时间如实 null；跨用户与不存在同 404'
  - 'target_files / allowed_paths 让位说明：`backend/app/modules/daemon/router/session_insights.py` 的写权限在本计划中**独占归 task-08**（同文件另起段加 1b 投影），故本卡两处都不声明该路径——否则同 Wave 内两卡声明同一文件会触发「同波并行互相覆盖」硬拦（本卡已交付，无需再写该文件；design 覆盖由 task-08 承接）'
acceptance:
  - 不再重做，也不得改口径（分页 / 聚合 / 增列须另立决策条目）
  - '复跑判据（task-15 承接）：pytest app/modules/daemon/tests/test_session_model_usage.py 4 例全绿；git diff openapi.json 只含本端点新增行'
  - '1b 后续在 session_insights.py 加 fileChanges / timing 投影时，必须另起段并只加字段，不得动本端点（task-08 约束）'
verify:
  - cd backend && uv run pytest -q --no-cov app/modules/daemon/tests/test_session_model_usage.py
constraints:
  - 生成物一律 pnpm gen:types 重生成；手改 api-types.ts 视为回归
  - 不新增权限面（沿用 TaskRunAgentUser 闸门）与不改变任何既有端点响应形状
related_tests:
  - path: backend/app/modules/daemon/tests/test_session_model_usage.py
    reason: 该 4 例是 FR-23 的唯一断言面，task-15 必须实测复跑并回写结果
---
