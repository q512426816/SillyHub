---
id: task-01
title: "model + migration — PlanNode + has_module；PlanNodeDetail + module_id + 索引；alembic 加两列"
title_zh: 数据模型与迁移：PlanNode 加 has_module，PlanNodeDetail 加 module_id 及索引
author: WhaleFall
created_at: 2026-07-16 12:25:00
priority: P0
depends_on: []
blocks: [task-02, task-03, task-05]
requirement_ids: [FR-001, FR-004]
decision_ids: [D-001@v1, D-002@v1]
allowed_paths:
  - backend/app/modules/ppm/plan/model.py
  - backend/migrations/versions/
goal: >
  给 PlanNode 加 has_module（bool default false），给 PlanNodeDetail 加 module_id（uuid|null）+ 索引，并生成 alembic 迁移加两列。
implementation:
  - PlanNode 模型加 has_module 字段，Boolean NOT NULL DEFAULT FALSE。
  - PlanNodeDetail 模型加 module_id 字段（UUID，可空，不加 FK，对齐本表 plan_node_id 无 FK 风格）。
  - PlanNodeDetail 加 Index("ix_ppm_plan_node_detail_module", "module_id")。
  - 用 alembic 生成迁移文件，upgrade 加两列 + 索引，downgrade 可逆删两列 + 索引。
acceptance:
  - 迁移 upgrade 成功加 has_module 列（default false）。
  - 迁移 upgrade 成功加 module_id 列（可空）+ ix_ppm_plan_node_detail_module 索引。
  - 迁移 downgrade 可回退到加列前结构。
verify:
  - cd backend && alembic upgrade head
  - cd backend && alembic downgrade -1 && alembic upgrade head
constraints:
  - 不加 FK 约束（对齐本表既有 plan_node_id 无 FK 风格）。
  - 不改 PlanNodeModule 表结构（共用方 milestone-details 零回归）。
  - 现有数据无需回填（has_module default false、module_id default null）。
provides:
  - PlanNode.has_module 字段（model + DB 列）
  - PlanNodeDetail.module_id 字段（model + DB 列 + 索引）
---

plan.md task-01：见 design §5.1（数据模型）、§8（表结构变更）、decisions D-001/D-002。模型与 DB schema 是 W1 后续 schema/service 的基础。
