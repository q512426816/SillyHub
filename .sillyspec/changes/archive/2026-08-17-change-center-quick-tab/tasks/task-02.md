---
id: task-02
title: POST /api/quicklog-entries 推送端点（shpsync_ 鉴权 + 幂等 upsert）+ pytest（覆盖 FR-02, FR-03, D-003, D-004）
title_zh: quicklog 推送接收端点
author: qinyi
created_at: 2026-08-17 00:33:00
priority: P0
depends_on: [task-01]
blocks: [task-06]
requirement_ids: [FR-02, FR-03]
decision_ids: [D-003, D-004]
allowed_paths:
  - backend/app/modules/platform_sync/router.py
  - backend/app/modules/platform_sync/service.py
  - backend/app/modules/platform_sync/tests/
  - backend/app/modules/platform_sync/schema.py
provides:
  - contract: quicklog_push_api
    fields: [method, path, auth, payload_shape, upsert_semantics, workspace_derivation]
expects_from:
  task-01: [quicklog_entries_table]
goal: >
  提供 CLI 推送入口 POST /api/quicklog-entries：shpsync_ 工作区令牌鉴权，workspace 一律由 token 派生
  （payload 不含 workspace 字段，对齐既有安全决策），(workspace_id, ql_id) 幂等 upsert。
implementation:
  - platform_sync/router.py 新增 POST /api/quicklog-entries（router 无自带 prefix，路径写全 /api/quicklog-entries）
  - 鉴权：复用 require_platform_sync_write（shpsync_ 令牌校验 + workspace 解析）
  - service.py 新增 upsert_quicklog_entry：查询 (workspace_id, ql_id) 存在则整条覆盖 payload，否则插入；返回 200 恒成功体
  - schema.py 新增 QuicklogEntryPush（payload 字段与 DTO 对齐，snake_case；无 workspace 字段）
acceptance:
  - 带有效 shpsync_ 令牌 POST → 200，表内出现该条目（workspace_id 来自 token）
  - 同 ql_id 二次 POST（内容变更）→ 200，整条覆盖不重复（行数不变）
  - 无令牌/无效令牌 → 401/403；payload 缺字段 → 422
  - body 带 workspace 字段 → 忽略或 422（不得采信 body workspace）
verify:
  - cd backend && uv run pytest app/modules/platform_sync -x -q
  - cd backend && uv run ruff check app/modules/platform_sync
constraints:
  - workspace 不得从 body/header 取（只取 token）
  - 不做 base_ts 乐观锁（单写者整条覆盖，D-004）
  - 端点只增不改
related_tests: []
---
