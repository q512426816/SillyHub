---
id: task-11
title: 全量回归验证（backend pytest + frontend pnpm test/build，确认 delegate 9 方法/stage dispatch/complete_lease 零回归）
title_zh: 全量回归验证
author: qinyi
created_at: 2026-07-12 00:43:24
priority: P0
depends_on: [task-01, task-02, task-03, task-04, task-05, task-06, task-07, task-08, task-09, task-10]
blocks: []
requirement_ids: [NFR-1]
decision_ids: []
allowed_paths:
  - backend/app/main.py
---

## 目标

Wave 3 收尾：本变更（删 archive 死代码 + change_dir 删路径 + scanner/parser 扁平）不动主机/不写源码外的逻辑，task-01..task-10 完成后跑全量测试套件确认零回归（NFR-1 / AC-8）。覆盖三类零回归区——`HostFsDelegate` 9 个现有方法、stage dispatch（brainstorm/plan/execute/verify）流转、`complete_lease` 收尾委托链路（apply_patch / post_scan_validation / stage_callback）行为不变。

## 实现要点

1. backend 全量测试：`cd backend && uv run pytest -q --no-cov`（含 change dispatch / agent / workspace scanner+parser / host_fs delegate / release router 现有测试）。
2. backend lint：`cd backend && uv run ruff check . && uv run ruff format --check . && uv run mypy app`。
3. frontend 全量测试：`cd frontend && pnpm test`。
4. frontend 构建：`cd frontend && pnpm build`（确认 task-02 删 archive.ts 后无悬空 import）。
5. daemon 测试：`cd sillyhub-daemon && pnpm test`（本变更零 daemon 改动，仅守回归）。
6. 零回归区核对（断言通过且无新失败）：
   - `HostFsDelegate` 9 方法：`backend/app/modules/daemon/host_fs/tests/` 全绿。
   - stage dispatch：`test_dispatch_stage_config.py` + `test_dispatch.py`（task-09 已改 11 处断言为 False）。
   - complete_lease 收尾委托链路：agent / lease 收尾相关测试无回归。
7. archive 端点 404 核对：`/workspaces/{ws}/changes/{cid}/archive` 与 `/distill` 返回 404（router 已注销，task-01）。

## 验收标准

- backend 全量 pytest 通过，零新失败（与变更前基线对比，仅允许 task-01 删测试、task-09/10 改断言带来的预期变化）。
- frontend `pnpm test` + `pnpm build` 均通过。
- daemon `pnpm test` 通过（零 daemon 改动，应零变化）。
- `HostFsDelegate` 9 方法、stage dispatch brainstorm/plan/execute/verify、complete_lease 收尾委托链路零回归。
- archive `/archive` `/distill` 端点 404；`/archive-confirm` 仍 200（保留端点未误删）。
- ruff / mypy / frontend lint 无新错误。

## verify

```
cd backend && uv run pytest -q --no-cov
cd backend && uv run ruff check . && uv run ruff format --check . && uv run mypy app
cd frontend && pnpm test
cd frontend && pnpm build
cd sillyhub-daemon && pnpm test
```

本 task 即验证收尾，verify 命令等同 implementation 全量命令。

## 约束

- **不改源码**（allowed_paths 空，本 task 仅跑验证）。
- 发现回归问题：回退对应 task 修复后重跑本 task，不在本 task 内打补丁。
- 不动测试用例（除非测试本身有误，须单独说明并回退到对应 task 修）。
- backend 全量 pytest ~12min（local.yaml 坑 2），gate verify-test 可能 timeout，以手动跑出的结果为准。
- AC-3 的 e2e（归档全流程 daemon 移目录 + status 投影）需真实 daemon 部署环境（R-02），本 task 全量测试不含此 e2e，留部署验证。
