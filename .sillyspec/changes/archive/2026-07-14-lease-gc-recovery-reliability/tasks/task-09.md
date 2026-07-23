---
task_id: task-09
title: 全量回归 + 部署验证
wave: W3
priority: P0
depends_on: [task-01, task-02, task-03, task-04, task-05, task-06, task-07, task-08]
blocks: []
requirement_ids: [FR-08]
decision_ids: []
skills: []
allowed_paths:
  - backend/app/main.py
  - deploy/docker-compose.yml
acceptance:
  - backend 全量 pytest 通过（含 task-03/04/06/07/08 新增守护测试，零回归）
  - daemon 全量 vitest 通过（本变更 daemon 零改动，验证不被破坏）
  - frontend 全量 vitest + typecheck 通过（retry 按钮 + 离线徽标无类型回归）
  - alembic upgrade head 成功（多 head 已由 task-01 收敛到唯一 head）
  - env GC 全关时（GC_LEASE_ENABLED=false 等）行为同现状（lease 靠启动 cleanup_stale_runs 兜底，design §9 兼容策略）
  - 容器重建后 e2e smoke 通过（lease GC 回收重派 / worktree GC 终态回收孤儿保留 / retry 建新 run / session 离线徽标可见）
verify:
  - local.yaml commands.test（backend uv run pytest -q --no-cov + frontend pnpm test + sillyhub-daemon pnpm test）
  - local.yaml commands.lint（backend ruff check + ruff format --check + mypy app + frontend pnpm lint + daemon pnpm typecheck）
  - deploy/docker-compose.yml backend command 的 alembic upgrade head 在容器启动成功
  - 127.0.0.1:8000/api/health 与 127.0.0.1:3000 前端页面可访问
constraints:
  - 本 task 不写新源码，只做全量回归 + 部署验证（回归类 task）
  - 部署 smoke 端口一律用 127.0.0.1 访问（localhost 解析 IPv6 ::1 连 0.0.0.0 映射不通，[docker-localhost-ipv6-use-127.0.0.1]）
  - backend 全量 pytest ~12min 可能超 gate TEST_TIMEOUT_MS（local.yaml 坑 2），本地直跑不依赖 gate
  - 重建镜像前 export COMMIT_SHA（否则 health commit_sha=unknown，[compose-commit-sha-runtime-override]）
  - 验证前确认 backend/app/main.py lifespan 已挂 LeaseReaperService.start/shutdown（task-02 产物入口）
---

## 任务说明

收尾 task：在 task-01~08 全部落地后执行全量回归 + 部署验证，确保 lease/GC/恢复机制可靠性提升整体不破坏现有功能且生产部署可用。对应 plan.md 全局验收标准 + design §9 兼容策略（env 全关零回归）。

## 执行步骤

1. backend：`cd backend && uv run pytest -q --no-cov`（含 task-03/04/06/07/08 新增守护测试），断言零回归。
2. daemon：`cd sillyhub-daemon && pnpm test`（本变更 daemon 零改动，验证不被破坏）。
3. frontend：`cd frontend && pnpm test && pnpm lint`（retry 按钮 + 离线徽标 + typecheck）。
4. backend lint：`cd backend && uv run ruff check . && uv run ruff format --check . && uv run mypy app`。
5. alembic：`cd backend && uv run alembic heads` 确认唯一 head（task-01 收敛结果），`alembic upgrade head` 成功。
6. 部署 smoke：`cd deploy && export COMMIT_SHA=$(git rev-parse HEAD) && docker compose up -d --build`，重建容器。
7. 容器就绪后 `curl 127.0.0.1:8000/api/health` + 访问 `127.0.0.1:3000` 确认前后端存活。
8. e2e smoke：造 batch lease 断开心跳 → 验证 GC 回收重派；造 worktree 关联终态 run → 验证回收、关联活 run 不误删；failed run 点 retry → 验证建新 run；session 列表 → 验证 daemon 离线徽标显示。
9. env 全关回归：`GC_LEASE_ENABLED=false GC_WORKTREE_ENABLED=false GC_RUNTIME_STALE_ENABLED=false` 重启 backend，断言 lease 靠启动 cleanup_stale_runs 兜底，行为同现状。

## 依据

- design §9 兼容策略（env 全关零回归）+ §7.5 生命周期契约表（e2e 事件）。
- plan.md task-09（W3 收尾）+ 全局验收标准 11 项。
- local.yaml commands.test / commands.lint（跨平台测试链）。
- backend/app/main.py:54 lifespan（验证 task-02 LeaseReaperService 挂载入口）。
- deploy/docker-compose.yml:99-105 backend command（alembic upgrade head && uvicorn）。
