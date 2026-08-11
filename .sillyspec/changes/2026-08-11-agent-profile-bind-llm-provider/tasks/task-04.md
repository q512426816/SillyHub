---
id: task-04
title: write llm_provider_id into lease metadata
title_zh: lease metadata 透传 llm_provider_id
author: WhaleFall
created_at: 2026-08-11T10:35:00
priority: P0
depends_on: [task-01]
blocks: [task-05]
allowed_paths:
  - backend/app/modules/agent/service.py
goal: >
  _apply_profile_to_lease 把 profile.llm_provider_id 写入 lease.metadata，供 claim 装配读取。
implementation:
  - 在现有 meta 写入处（裸 SQL UPDATE 路径）加 meta 下 llm_provider_id 键，绑定时有值为 id 字符串，未绑为 None
  - 复用同一条 SQL UPDATE，不另开路径
acceptance:
  - lease.metadata 含 llm_provider_id 键
  - 绑定时为 id 字符串，未绑时为 None
  - daemon claim 路径能读到（task-05 与 task-09 验证）
verify:
  - cd backend && pytest app/modules/agent/ -n auto -k profile
provides:
  fields:
    - lease.metadata.llm_provider_id
constraints:
  - 必须走裸 SQL UPDATE，不能只改 ORM metadata_，否则 commit 不刷新列
  - 沿用现有窄竞态路径，不引入新竞态（R-08）
  - 覆盖 D-003
---
