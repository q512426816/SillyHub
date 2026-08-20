---
id: task-01
title: add-session-attachment-model-and-migration
title_zh: SessionAttachment 模型与 Alembic 迁移（含 llm_providers.multimodal 列）
author: WhaleFall
created_at: 2026-08-20 15:13:46
priority: P0
depends_on: []
blocks: [task-02, task-05, task-08]
requirement_ids: [FR-1, FR-3]
decision_ids: [D-5, D-9]
allowed_paths:
  - backend/app/modules/session_attachment/model.py
  - backend/app/modules/llm_provider/model.py
  - backend/migrations/versions/
provides:
  - contract: SessionAttachment
    fields: [id, user_id, session_id, kind, media_type, bytes, name, object_key, sha256, width, height, created_at]
  - contract: llm_providers.multimodal
    fields: [multimodal]
expects_from: {}
goal: >
  建 session_attachments 表与 SQLModel 模型并为 llm_providers 加 multimodal 三态列 单迁移一次到位。
implementation:
  - 新建 backend/app/modules/session_attachment/model.py 定义 SessionAttachment 继承 app.models.base.BaseModel 字段对齐 design §4（id uuid 主键 / user_id FK users ondelete CASCADE / session_id 可空 FK agent_sessions null 即草稿 / kind 取值 image 或 file / media_type / bytes / name / object_key / sha256 / width height 可空图片专用 / created_at）并建索引 ix_session_attachments_user_session 于 user_id 加 session_id 与 ix_session_attachments_session 于 session_id
  - backend/app/modules/llm_provider/model.py 加 multimodal 字段 String(8) 非空 server_default auto 取值 auto true false（D-9 三态手动覆盖权威来源）
  - 新建迁移文件 down_revision 取当前头 20260819100000 单迁移内 create_table session_attachments 加两索引 并对 llm_providers add_column multimodal 迁移内列定义与模型逐字对齐防漂移 不 import app 模块（既有迁移惯例）downgrade 反向 drop 表 drop 列
acceptance:
  - upgrade head 后 session_attachments 表与两索引就位 llm_providers 多出 multimodal 列存量行默认 auto 且 SessionAttachment 在共享 metadata 注册可被 autogenerate 扫描
  - downgrade -1 再 upgrade head 可重复执行无残留
verify:
  - cd backend && uv run alembic upgrade head
  - cd backend && uv run alembic downgrade -1 && uv run alembic upgrade head
  - cd backend && uv run pytest -q
constraints:
  - 单迁移同时承载两表变更不拆两个迁移文件
  - session_id 可空语义为草稿未发送不加非空约束
  - 不实现任何行级 CRUD 逻辑归 task-02 与 task-03
related_tests: []
---
