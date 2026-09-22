---
id: task-01
title: 'backend 数据层——agent_group_chats 迁移加 archived_at 列 + AgentGroupChat 模型字段 + GroupChatRead 暴露'
title_zh: 'backend 数据层——agent_group_chats 迁移加 archived_at 列 + AgentGroupChat 模型字段 + GroupChatRead 暴露'
author: 'qinyi'
created_at: '2026-09-03 16:55:15'
priority: P0
depends_on: []
blocks: ['task-02']
requirement_ids: [FR-01, FR-02]
decision_ids: ['D-01@v1']
allowed_paths:
  - backend/migrations/versions/
  - backend/app/modules/agent/model.py
  - backend/app/modules/agent/schema.py
goal: >
  为群聊归档功能落数据层：agent_group_chats 新增 archived_at 可空时间戳列
  （Alembic 迁移 + SQLModel 字段），并在 GroupChatRead 读体暴露，使群列表项/
  详情经既有继承链（GroupChatListItemRead/GroupChatDetailRead）自动携带该字段。
implementation:
  - 执行时先 `cd backend && uv run alembic heads` 实测唯一 head（design 假设
    20260903090000，以实测为准定 down_revision）
  - 新建迁移文件 20260903170000_add_group_chat_archived_at.py（照
    20260903090000_add_machine_sillyspec_status.py 先例结构）：upgrade =
    op.add_column("agent_group_chats", sa.Column("archived_at",
    sa.DateTime(timezone=True), nullable=True))；downgrade 对称 op.drop_column；
    docstring 说明列语义（NULL=未归档；对齐 AgentSession.archived_at 口径，
    引用 design §3.1）与不回填原因（存量行为 NULL）
  - backend/app/modules/agent/model.py AgentGroupChat：在 ended_at/deleted_at
    注释块邻域加 archived_at 字段（DateTime(timezone=True), nullable=True,
    default None），注释锚定「2026-09-03-group-chat-archive-delete：归档时间戳，
    NULL=可见；非 NULL=已归档（默认群列表过滤），与 deleted_at/ended_at 正交——
    对齐 AgentSession 三态语义（model.py:796-802 同款注释风格）」
  - backend/app/modules/agent/schema.py GroupChatRead：加 archived_at:
    datetime | None = None（紧跟 ended_at/deleted_at 字段，注释引用变更名）
acceptance:
  - `uv run alembic upgrade head` 在干净库成功；downgrade 一级回退成功
  - `uv run alembic heads` 仍单 head
  - ruff/mypy 对三个文件零新告警（backend 目录）
  - GroupChatRead.model_validate(群行) 携带 archived_at（既有 from_attributes）
verify:
  - cd backend && uv run alembic heads（单 head）&& uv run alembic upgrade head && uv run alembic downgrade -1 && uv run alembic upgrade head（往返成功）
  - cd backend && uv run ruff check app/modules/agent/model.py app/modules/agent/schema.py migrations/versions/
  - cd backend && uv run mypy app/modules/agent/model.py app/modules/agent/schema.py
constraints:
  - 迁移只加列不回填不建索引（archived_at 无查询索引诉求——群列表按成员表 join
    过滤量级小，design §3.1 未要求）
  - down_revision 以执行时 alembic heads 实测为准，不盲信 design 假设值
---
