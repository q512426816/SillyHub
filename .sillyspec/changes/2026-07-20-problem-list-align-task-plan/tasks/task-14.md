---
author: qinyi
created_at: 2026-07-20 11:30:22
id: task-14
title: verify 全量验证
wave: 3
blockedBy: [task-01, task-02, task-03, task-04, task-05, task-06, task-07, task-08, task-09, task-10, task-11, task-12, task-13]
allowed_paths: [backend/app/modules/ppm/problem/router.py, frontend/src/app/(dashboard)/ppm/problem-list/page.tsx]
acceptance: [AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, NFR-1, NFR-2, NFR-3, NFR-4]
---

## 目标
全量验证：后端测试 + 前端测试 + migration + lint/typecheck + AC 端到端 + 回归。

## 实现步骤
1. backend：`cd backend && uv run pytest -q app/modules/ppm/problem`（problem 子域）+ `uv run ruff check . && uv run ruff format --check . && uv run mypy app`。
2. frontend：`cd frontend && pnpm test && pnpm lint && pnpm typecheck`。
3. migration：`cd backend && uv run alembic upgrade head`（干净库）+ `uv run alembic heads`（单 head）。
4. 回归：`uv run pytest -q app/modules/ppm/task`（任务计划不破）+ 工作台 problem 相关测试。
5. AC 端到端（docker 部署后手动，参照 MEMORY `ppm-status-dual-track-and-workbench-verify`：改前端代码须 `docker compose -p multi-agent-platform -f deploy/docker-compose.yml up -d --build frontend`）：
   - AC-1 新建→开始→进行中；
   - AC-2 执行→跨天填报→提交回新建→再开始（重复执行）；
   - AC-3 执行→完成→已完成；
   - AC-4 详情只读；
   - AC-5 编辑不改状态；
   - AC-6 删除权限；
   - AC-7 跨天 422 + 拆分逐天成功；
   - AC-8 废弃端点 404 + 无审核/作废/待验证/变更中状态。
6. verify 报告（PASS / CONDITIONAL_PASS / FAIL）。

## 测试点
- 全部 AC 端到端通过；回归无破坏。

## 验收
- backend problem 子域 + frontend problem 测试全绿；migration 单 head；AC-1~8 通过；ruff/mypy/lint/typecheck 绿。
