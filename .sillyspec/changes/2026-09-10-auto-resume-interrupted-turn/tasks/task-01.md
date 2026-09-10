---
id: task-01
title: 'Wave 1 数据层：migration 两列 + model 同步'
title_zh: 'Wave 1 数据层：migration 两列 + model 同步'
author: 'qinyi'
created_at: 2026-09-10 09:30:00
priority: P0
depends_on: []
blocks: ['task-02','task-03','task-04']
requirement_ids: ['FR-01']
decision_ids: ['D-009@v2']
allowed_paths:
  - backend/app/modules/agent/model.py
  - backend/migrations/versions/20260910120000_add_auto_resume_origin_and_run_metadata.py
target_files:
  - backend/app/modules/agent/model.py
  - NEW:backend/migrations/versions/20260910120000_add_auto_resume_origin_and_run_metadata.py
goal: >
  soft-add 两列（design §1.1）：agent_session_queued_messages.origin TEXT NULL（复合值 'auto_resume:<源run uuid>'，NULL=用户排队存量）；agent_runs.metadata JSON NULL（ORM 属性名 metadata_ 照 AgentRunLog model.py:580-583 先例——metadata 是 SQLAlchemy 保留属性直写报错）。migration 线性追加 down_revision=当前 head（20260909120000），downgrade 对称 drop。
implementation: >
  soft-add 两列（design §1.1）：agent_session_queued_messages.origin TEXT NULL（复合值 'auto_resume:<源run uuid>'，NULL=用户排队存量）；agent_runs.metadata JSON NULL（ORM 属性名 metadata_ 照 AgentRunLog model.py:580-583 先例——metadata 是 SQLAlchemy 保留属性直写报错）。migration 线性追加 down_revision=当前 head（20260909120000），downgrade 对称 drop。
acceptance: >
  migration up/down 干净（alembic heads 单头）；model 属性/列名映射正确；既有 model 测试零回归；PPM 零涉及。跑：cd backend && uv run pytest -q --no-cov app/modules/agent/tests/ 与 alembic upgrade/downgrade 冒烟。
constraints: >
  见 design.md 对应决策与 NFR；禁止越 allowed_paths 改文件；先例引用以行号锚定；既有测试零回归（NFR-01）。
verify: '验收标准见 acceptance 字段'
---


## 验收标准

migration up/down 干净（alembic heads 单头）；model 属性/列名映射正确；既有 model 测试零回归；PPM 零涉及。跑：cd backend && uv run pytest -q --no-cov app/modules/agent/tests/ 与 alembic upgrade/downgrade 冒烟。
