---
id: task-09
title: backend PolicyAuditLog 表 + migration
author: WhaleFall
created_at: 2026-07-02T15:12:00
priority: P0
depends_on: []
blocks: [task-10]
allowed_paths:
  - backend/app/modules/daemon/audit/model.py
  - backend/app/modules/daemon/audit/__init__.py
  - backend/migrations/versions/
  - backend/app/modules/daemon/audit/tests/
change: 2026-07-02-daemon-filesystem-policy
goal: "(见 body)"
implementation: "(见 body)"
acceptance: "(见 body)"
verify: "(见 body)"
constraints: "(见 body)"
---

# task-09

> goal: 新增 PolicyAuditLog 表落 ALLOW/DENY 审计记录（D-006）。

## implementation
- `audit/model.py` `PolicyAuditLog(BaseModel)`: id, runtime_id(FK index), workspace_id(index), decision, provider, tool, path, reason, created_at
- 索引: (runtime_id, created_at desc), (decision)
- migration 建表 `policy_audit_log`
- 不改 DaemonRuntime 模型

## 验收标准
- PolicyAuditLog 表存在，字段完整
- migration upgrade/downgrade 正确
- 索引就位

## 验证
- `cd backend && uv run alembic upgrade head`
- `cd backend && uv run pytest app/modules/daemon/audit/ -k model`

## constraints
- 项目未上线，schema 可直接建（CONVENTIONS 硬规则 7）
- workspace_id 从 runtime 反查（便于按 workspace 筛）
- 定期清理保留 30 天（R-05，task-10 或独立清理任务）
