---
id: task-01
title: add llm_provider_id FK to AgentProfile
title_zh: AgentProfile 加 llm_provider_id 外键
author: WhaleFall
created_at: 2026-08-11T10:35:00
priority: P0
depends_on: []
blocks: [task-02, task-03, task-04]
allowed_paths:
  - backend/app/modules/agent/profile/model.py
goal: >
  给 AgentProfile 新增 llm_provider_id 字段，UUID 外键指向 llm_providers.id，ondelete SET NULL，nullable。
implementation:
  - 在 provider 字段附近新增 llm_provider_id，UUID 类型，ForeignKey 指向 llm_providers.id 且 ondelete SET NULL，nullable 为 True
  - 复用现有 owner_user_id 与 tool_policy_id 的 FK 写法
  - 不改现有任何字段
acceptance:
  - 字段 llm_provider_id 存在且 nullable
  - 外键指向 llm_providers.id 且 ondelete SET NULL
  - ruff 与 mypy 通过
verify:
  - cd backend && ruff check app/modules/agent/profile/model.py
  - cd backend && mypy app/modules/agent/profile/model.py
constraints:
  - 继承 BaseModel，不直接继承 SQLModel
  - 外键目标表名 llm_providers（LlmProvider 表）
  - 不加反查索引（YAGNI）
  - 覆盖 D-003 / FR-02 / NFR-02
---
