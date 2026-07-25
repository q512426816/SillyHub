---
id: task-01
title: 新建 llm_providers 表 + alembic migration
title_zh: 新建 llm_providers 表与迁移
author: qinyi
created_at: 2026-07-25 17:06:11
priority: P0
depends_on: []
blocks: [task-02, task-03]
requirement_ids: [FR-01]
decision_ids: [D-001@v1, D-009@v1, D-010@v1]
allowed_paths:
  - backend/app/modules/llm_provider/model.py
  - backend/migrations/versions/20260725_create_llm_providers.py
goal: >
  新建 llm_providers 表的 alembic 迁移（design §7 全部列 + 加密 api_key + is_default +
  显式时间戳 + 两条索引），作为后端 LLM 供应商管理的存储底座。
implementation:
  - 新建 20260725_create_llm_providers.py，revision 唯一，down_revision 接当前唯一 head 202607251000（防多 head）
  - op.create_table 列与 design §7 一一对应（id PK / user_id FK→users.id ondelete CASCADE / name / agent_kind / base_url / encrypted_api_key LargeBinary nn / key_id / model / notes / website_url / auth_field server_default ANTHROPIC_AUTH_TOKEN / model_role_mappings JSON / default_fallback_model / extra_env JSON / is_default / created_at+updated_at 显式 DateTime）
  - 两条索引 ix_llm_providers_user(user_id) + ix_llm_providers_user_agent_default(user_id, agent_kind, is_default)
  - downgrade 对称 drop_index → drop_table；顺手建空 __init__.py 包标记
acceptance:
  - 干净 SQLite 上 alembic upgrade head 建出 llm_providers 表，列与索引齐全
  - alembic heads 仍单 head（无分叉）；alembic downgrade -1 可干净回退
verify:
  - cd backend && uv run alembic upgrade head
  - cd backend && uv run alembic heads
constraints:
  - 防多 head（revision 唯一 + down_revision 接真实 head 202607251000，禁指已分叉旧节点）
  - created_at/updated_at 显式定义（BaseModel 空类 base.py:13-16 不自动提供，照 daemon/model.py:366-381）
  - encrypted_api_key LargeBinary + key_id 复用 core/crypto.py CredentialCipher（D-009，照 git_identity/model.py:55-61）
  - 列定义须与 task-02 model.py ORM 一一对应防代码↔迁移漂移
---
