---
id: task-05
title: backend ingest api_duration_ms into duration_api_ms with monotonic write-back
title_zh: backend 摄取与下发（max 累积+仅增不减写回+SSE 增键）
author: qinyi
created_at: 2026-10-10 19:56:43
priority: P0
depends_on: [task-01]
blocks: [task-06]
requirement_ids: [FR-05, FR-06]
decision_ids: []
allowed_paths:
  - backend/app/modules/daemon/run_sync/service/submit_steps.py
  - backend/app/modules/daemon/run_sync/service/submit_commit.py
  - backend/app/modules/daemon/run_sync/service/publish.py
  - backend/app/modules/daemon/tests/test_run_sync_ctx_tokens.py
target_files:
  - backend/app/modules/daemon/run_sync/service/submit_steps.py
  - backend/app/modules/daemon/run_sync/service/submit_commit.py
  - backend/app/modules/daemon/run_sync/service/publish.py
  - backend/app/modules/daemon/tests/test_run_sync_ctx_tokens.py
provides:
  - contract: SSE tokens/turn_completed duration_api_ms
    fields: [duration_api_ms]
expects_from:
  task-01:
    - contract: AgentEventUsage.api_duration_ms
      needs: [api_duration_ms]
goal: >
  backend 摄取 message 顶层 usage.api_duration_ms（max 累积）写回
  AgentRun.duration_api_ms（仅增不减），publish tokens/summary 增键
  duration_api_ms（None 不带键）（FR-05/FR-06）。
implementation:
  - submit_steps.py:57 区加 latest_api_duration_ms + :115 区重置 + :348-379 区提取（isinstance 数值才收，max 累积同 in_tok :366 先例）
  - submit_commit.py:253 ctx_tokens 直写款旁加 duration_api_ms 仅增不减写回（> 现值才写，防跨轮回退——Grill P2 采纳）
  - PublishIntent（publish.py:36）加 duration_api_ms 字段；service/__init__.py:371-445 组装 intent 透传
  - publish.py tokens 事件（:201-221）+ run channel summary（:123-144）：非 None 带键，None 不带键（ctx_tokens 同款）
  - test_run_sync_ctx_tokens.py 增用例：提取累积/乱序不回退/仅增不减写回/None 不带键
acceptance:
  - 先 12000 后 8000 → latest 保持 12000（FR-05 场景）
  - DB 现值 15000、新 submit 累计 8000 → 列保持 15000（仅增不减）
  - daemon 未上报 → tokens 事件无 duration_api_ms 键（FR-06 场景）
  - 非 None → tokens 事件带 duration_api_ms
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_run_sync_ctx_tokens.py -q
  - cd backend && uv run ruff check app/modules/daemon/run_sync/service/
constraints:
  - close_run_steps.py 覆盖守卫（if duration_api_ms is not None）零改动
  - None 不带键（design §9 兼容先例）；旧 daemon/旧前端零影响
  - usage 事件键名 api_duration_ms → 列/SSE 键名 duration_api_ms（两名映射，design 接口契约）

---
-->
