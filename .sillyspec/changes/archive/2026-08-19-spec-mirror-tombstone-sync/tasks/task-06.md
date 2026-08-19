---
id: task-06
title: 全量回归
title_zh: spec_workspace + change 回归 + ruff
author: qinyi
created_at: 2026-08-19T22:40:00
priority: P1
depends_on: [task-05]
blocks: []
requirement_ids: []
decision_ids: []
provides: []
allowed_paths:
  - backend/app/modules/spec_workspace/service.py
  - backend/app/modules/change/service.py
goal: >
  cd backend && .venv/Scripts/python.exe -m pytest app/modules/spec_workspace
  app/modules/change -q 全绿；ruff format + lint 干净；gen:types 不适用确认
  （无 API 契约变化，SSE 事件是流文本非 OpenAPI schema）
implementation:
  - pytest 两模块
  - ruff format + lint
acceptance:
  - 两模块测试全绿 + ruff 干净
constraints: >
  对齐 design Non-Goals：不动 apply_ops / daemon / CLI / 前端 / api-types；不做后台任务、UI 入口、migration。
verify:
  - 命令输出

---
