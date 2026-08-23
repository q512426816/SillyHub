---
id: task-05
title: 'regression-and-e2e'
title_zh: '全量回归 + CLI 上报端到端实证'
author: qinyi
created_at: 2026-08-23 05:21:00
priority: P0
depends_on: [task-04]
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05]
decision_ids: []
allowed_paths:
  - .sillyspec/changes/2026-08-23-platform-agent-log-ingest/runtime-evidence.md
goal: >
  全量回归三端 + 真实环境端到端：本地起迁移后的 backend，用本仓库 local.yaml platform
  段配置跑真实 sillyspec CLI，验证 POST /api/agent-logs 上报从上一会话的 404 变 200 并
  落库可见（面板渲染）。
implementation:
  - backend 全量：uv run pytest（tests/ + app/ 全量）+ ruff check app + mypy app
  - frontend 全量：pnpm vitest run + pnpm typecheck + pnpm lint
  - 端到端：本地起 backend（alembic upgrade head 后 uvicorn 127.0.0.1:8001 或复用现有本地部署配置），在本仓库根跑 sillyspec status（CLI 探测→上报），断言后端 200 + platform_agent_logs 出现本仓 workspace 行；面板（本地前端或 API GET）可见该条目
  - 若本地 8001 被 Docker 旧镜像占用：按 deploy 情况选择直跑 uvicorn 于 8001 或临时停容器，实证完恢复
acceptance:
  - 三端全量测试零回归零失败
  - 端到端实证留证（后端日志 200 记录 / 表行截图或 SQL 输出 / GET 响应 JSON）
verify:
  - cd backend && uv run pytest -q
  - cd frontend && pnpm vitest run && pnpm typecheck && pnpm lint
  - curl -s localhost:8001/api/agent-logs?workspace_id=<本仓 ws> -H "Authorization: Bearer <shpsync_ token>"（读通道冒烟，token 从 local.yaml 取，不入库不入提交）
constraints:
  - token 等敏感值只用于本地验证，不写入任何提交产物
  - 不动 sillyspec CLI 仓代码（其已实现并 52 断言测试）
---

# task-05 补充说明
无。
