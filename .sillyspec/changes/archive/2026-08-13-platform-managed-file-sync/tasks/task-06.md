---
id: task-06
title: hub-client.ts 新增 postSpecSyncIncremental（JSON POST，409 → conflict 透传）
title_zh: daemon 增量推送客户端方法
author: qinyi
created_at: 2026-08-13 15:23:34
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-02, FR-07]
decision_ids: [D-007@v1]
goal: >-
  daemon 侧增量推送 HTTP 客户端方法，conflict 经返回体透传不抛错，供 spec-sync diff 调用
allowed_paths:
  - sillyhub-daemon/src/hub-client.ts
implementation:
  - 新增 async postSpecSyncIncremental(wsId, ops)，URL 拼 ${baseUrl}/api/workspaces/${encodeURIComponent(wsId)}/spec-workspace/sync-incremental，Content-Type 设 application/json，auth 头对齐现有 postSpecSync（X-API-Key 优先、其次 Authorization Bearer，无凭证不带）
  - body 为 { ops }，ops 元素为 FileOp 结构（op/path/new_path/hash/content/base_version，与 backend schema.py 字段逐字一致）
  - 返回解析含 ok/new_versions/conflict/server_versions；HTTP 非 2xx 抛 HubHttpError（对齐 _request 的 status/bodyText/url/method 语义）
  - conflict=true 不抛错（conflict 由返回体透传），由调用方据字段提示人工拍板
  - 导出 FileOp 接口类型（含 op/path/new_path/hash/content/base_version 字段）供 spec-sync.ts 复用
acceptance:
  - postSpecSyncIncremental 方法存在，JSON body + 正确 URL/auth
  - 返回含 ok/new_versions/conflict/server_versions
  - 非 2xx 抛 HubHttpError；conflict=true 不抛（返回体）
verify:
  - cd sillyhub-daemon && pnpm exec tsc --noEmit
constraints:
  - 不改现有 postSpecSync（旧 tar 路径保留，R-01 兼容）
  - FileOp 字段命名与 backend schema.py 逐字一致（避免 422）
provides:
  - contract: postSpecSyncIncremental
    fields: [wsId, ops, new_versions, conflict, server_versions]
    desc: daemon 增量推送客户端方法
expects_from: []
---
