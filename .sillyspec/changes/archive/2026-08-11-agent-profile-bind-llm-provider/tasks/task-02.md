---
id: task-02
title: alembic migration for llm_provider_id
title_zh: 新增 llm_provider_id 迁移
author: WhaleFall
created_at: 2026-08-11T10:35:00
priority: P0
depends_on: [task-01]
blocks: []
allowed_paths:
  - backend/migrations/versions/20260811_agent_profile_llm_provider.py
goal: >
  新增 Alembic 迁移，给 agent_profiles 表加 llm_provider_id 列与外键约束。
implementation:
  - alembic revision 新建迁移，down_revision 接当前 head
  - upgrade 加 agent_profiles.llm_provider_id 列（UUID，nullable）并 create_foreign_key，ondelete SET NULL 指向 llm_providers.id
  - downgrade 先 drop_foreign_key 再 drop_column，保证可逆
acceptance:
  - alembic upgrade head 成功
  - 列定义与 model.py 一致
  - downgrade -1 后再 upgrade head 可逆
verify:
  - cd backend && alembic upgrade head
  - cd backend && alembic downgrade -1 && alembic upgrade head
constraints:
  - down_revision 取当前 alembic head（execute 时确认）
  - 列定义须与 model.py 防漂移
  - 覆盖 D-003
---
