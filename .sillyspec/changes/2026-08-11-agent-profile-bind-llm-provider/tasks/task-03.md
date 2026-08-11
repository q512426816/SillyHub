---
id: task-03
title: profile DTO and service pass-through
title_zh: profile DTO 与 service 透传字段
author: WhaleFall
created_at: 2026-08-11T10:35:00
priority: P0
depends_on: [task-01]
blocks: [task-06, task-11]
allowed_paths:
  - backend/app/modules/agent/profile/router.py
  - backend/app/modules/agent/profile/service.py
goal: >
  AgentProfileCreate/Update/Read 加 llm_provider_id，service 在 create/update/Read 透传。
implementation:
  - Create 加可选 llm_provider_id，默认 None
  - Update 加 llm_provider_id，走 exclude_unset 语义，显式 null 表示解绑
  - Read 透出 llm_provider_id
  - service create 写入，update 按 exclude_unset 处理解绑，Read 返回
acceptance:
  - Create 不传时默认 None
  - Update 显式 null 解绑、不传不动
  - Read 返回 llm_provider_id
verify:
  - cd backend && pytest app/modules/agent/profile/tests/ -n auto
constraints:
  - Read 不暴露 encrypted_api_key 或明文 key（R-02）
  - exclude_unset 语义保留
  - 覆盖 FR-02 / FR-09 / NFR-02
---
