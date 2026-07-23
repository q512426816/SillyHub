---
id: task-13
title: 端到端验收（对照 proposal 成功标准 + 全量测试）
phase: W5
priority: P0
status: draft
owner: qinyi
estimated_hours: 2
affected_components: [backend, frontend]
allowed_paths:
  - backend/
  - frontend/
depends_on: [task-01, task-02, task-03, task-04, task-05, task-06, task-07, task-08, task-09, task-10, task-11, task-12]
blocks: []
goal: "端到端验收（对照 proposal 成功标准 + 全量测试）"
implementation:
  - "backend uv run pytest -q --no-cov 全绿（含新 test_router.py）"
  - "frontend pnpm test && pnpm typecheck && pnpm lint 全绿"
  - "backend ruff + mypy 绿"
  - "手动验证：180024 工作日历过去日期标色(1人天→饱和绿)；task多次填报；跨天拆分；problem处置记录可见"
acceptance:
  - "proposal 成功标准 1-7 全部满足"
verify:
  - "cd backend && uv run pytest -q --no-cov"
  - "cd frontend && pnpm test && pnpm typecheck && pnpm lint"
  - "curl 127.0.0.1:8001 验证 calendar API（180024 标色）"
constraints:
  - "依赖 task-01~12 全完成"
---

## 目标
全量测试 + 手动验收对照 proposal 成功标准 1-7。

## 依据
proposal 成功标准；design §6 文件清单。

## steps
1. backend：`cd backend && uv run pytest -q --no-cov` 全绿（含新 test_router.py）
2. frontend：`cd frontend && pnpm test && pnpm typecheck && pnpm lint` 全绿
3. lint：`cd backend && uv run ruff check . && uv run ruff format --check . && uv run mypy app` 全绿
4. 手动/脚本验证：账号 180024 工作日历过去日期标色（1人天+0人天→饱和绿）；task 多次填报（start→submit→start→complete）；跨天拆分；problem 处置记录可见；详情列表

## 验收标准（对照 proposal 成功标准 1-7）
1. 过去日期工时求和 ≥8h 标饱和绿
2. task 启动/提交/完成双按钮 + 多次填报
3. 跨天前端拆分 + 后端 422
4. problem 处置产生执行记录
5. 列表详情可查历次记录
6. 新录入记录日历显示
7. backend pytest + frontend vitest 全绿
