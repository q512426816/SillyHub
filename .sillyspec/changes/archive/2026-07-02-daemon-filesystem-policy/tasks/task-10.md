---
id: task-10
title: backend audit service + 端点
author: WhaleFall
created_at: 2026-07-02T15:12:00
priority: P0
depends_on: [task-09]
blocks: [task-19, task-22]
allowed_paths:
  - backend/app/modules/daemon/audit/service.py
  - backend/app/modules/daemon/audit/router.py
  - backend/app/modules/daemon/audit/schema.py
  - backend/app/modules/daemon/router.py
  - backend/app/modules/daemon/audit/tests/
change: 2026-07-02-daemon-filesystem-policy
goal: "(见 body)"
implementation: "(见 body)"
acceptance: "(见 body)"
verify: "(见 body)"
constraints: "(见 body)"
---

# task-10

> goal: audit 批量接收 + 查询端点（D-006）。

## implementation
- `audit/service.py`: `batch_insert(events)` + `query(rid, filters, pagination)`
- `audit/router.py`: `POST /daemon/audit/batch`（claim_token 鉴权，批量插入）+ `GET /workspaces/{wid}/runtimes/{rid}/policy-audit`（分页 + 筛选 decision/provider/tool/path/时间）
- `audit/schema.py`: AuditBatchRequest/AuditLogRead DTO
- 挂载到 daemon router（main.py include）
- 显式 response_model（CONVENTIONS）

## 验收标准
- daemon POST /daemon/audit/batch 批量写入 PolicyAuditLog
- GET 端点支持分页 + 筛选，返回 AuditLogRead 列表
- claim_token 鉴权生效

## 验证
- `cd backend && uv run pytest app/modules/daemon/audit/`
- `cd backend && uv run ruff check app/modules/daemon/audit && uv run mypy app/modules/daemon/audit`

## constraints
- 批量插入上限（如 500/批）防超量
- 查询默认按 created_at desc
- 定期清理 30 天（R-05，可 service 内 cleanup 方法）
