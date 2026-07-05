---
id: task-02
title: start_scan_dispatch 接线 member binding + scan_generate owner/count 门禁
author: qinyi
created_at: 2026-07-02 11:00:00
priority: P0
depends_on: [task-01]
blocks: [task-08, task-15]
allowed_paths:
  - backend/app/modules/agent/service.py
  - backend/app/modules/workspace/service.py
  - backend/app/modules/workspace/tests/test_scan_generate_gate.py
---

## 目标
`start_scan_dispatch` actor 透传给 placement（D-006）；`scan_generate` 加 owner 校验（D-003@V2）+ count 门禁（D-004）。

## 实现步骤
- `start_scan_dispatch`（service.py:1246）把 actor_user_id 传给 placement（task-01 改的解析）。
- `scan_generate`（workspace/service.py）：先校验 actor 是否该 workspace owner（非 owner → 403 "仅 owner 可扫描"）；owner 扫描时查 scan_documents count（按 workspace_id），>0 且无 force=true → 409 + 已扫提示。

## 验收标准
- 非 owner 调 scan_generate → 403。
- owner + 已有 scan_documents + 无 force → 409。
- owner + force=true → 重扫成功。

## 验证方式
`cd backend && uv run pytest app/modules/workspace/tests/test_scan_generate_gate.py -q`（owner 403 / count 409 / force 重扫三用例）。

## 约束
- owner 判定用现有 workspace members role（owner role），不新增表。
- count 查询复用 scan_docs/service.py 现有按 workspace_id 查询。
