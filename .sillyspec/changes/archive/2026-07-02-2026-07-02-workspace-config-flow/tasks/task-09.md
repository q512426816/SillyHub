---
id: task-09
title: migration + SpecWorkspace.spec_version + WorkspaceMemberRuntime.init_synced（D-010）
author: qinyi
created_at: 2026-07-02 11:00:00
priority: P0
depends_on: []
blocks: [task-03, task-06, task-10, task-13, task-15]
allowed_paths:
  - backend/app/modules/spec_workspace/model.py
  - backend/app/modules/spec_workspace/service.py
  - backend/app/modules/workspace/member_runtimes/model.py
  - backend/migrations/versions/20260702xxxx_workspace_config_flow_fields.py
---

## 目标
Alembic migration：SpecWorkspace 加 spec_version（int）；WorkspaceMemberRuntime 加 init_synced_at/spec_version（D-010）。scan/apply_sync 后递增。

## 实现步骤
- SpecWorkspace 加 `spec_version: int = Field(default=0, sa_column=Column(Integer, nullable=False, default=0))`（**不复用 profile_version**——语义不同，profile 是 scan profile 版本）。
- WorkspaceMemberRuntime 加 `init_synced_at: datetime | None`、`init_synced_spec_version: int | None`。
- migration：唯一 revision id，down_revision **接 execute 时 alembic_version 表真实 head**（含协调 2026-07-02-change-detail-file-tree-editor 若先合）。
- scan_generate 成功 / apply_sync 落盘后 spec_version += 1。

## 验收标准
- migration up/down 可逆；旧数据 spec_version 默认 0 不崩。
- scan 成功后 spec_version 递增。

## 验证方式
`cd backend && uv run alembic upgrade head && uv run alembic downgrade -1 && uv run alembic upgrade head`；`uv run pytest app/modules/spec_workspace/tests/`。

## 约束
- **无双 head**：execute 前查 `alembic_version` 表 + grep revision/down_revision 配对（见 known issue migration-chain-fragmentation-pattern）。协调并行变更 migration 顺序。
