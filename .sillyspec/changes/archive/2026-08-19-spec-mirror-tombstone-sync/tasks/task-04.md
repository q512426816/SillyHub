---
id: task-04
title: 占位行保护 7 天时效窗
title_zh: _progress_reported_active_keys 加时效过滤
author: qinyi
created_at: 2026-08-19T22:40:00
priority: P0
depends_on: []
blocks: [task-05]
requirement_ids: [FR-03]
decision_ids: []
provides:
  - contract: PLACEHOLDER_PROTECT_WINDOW_DAYS = 7
    fields: [updated_at, cutoff]
allowed_paths:
  - backend/app/modules/change/service.py
goal: >
  change/service.py:1249 _progress_reported_active_keys 查询后过滤：
  updated_at < now(UTC) - 7d 的行不计入保护集
implementation:
  - 模块级常量 PLACEHOLDER_PROTECT_WINDOW_DAYS = 7
  - updated_at 为 tz-aware；naive 值归一化 UTC
  - 过滤逻辑放查询后（in-Python 过滤或 SQL 条件，实现取简洁者）
acceptance:
  - 6 天前的占位行仍保护；8 天前的不保护（changes 行可删）
constraints: >
  对齐 design Non-Goals：不动 apply_ops / daemon / CLI / 前端 / api-types；不做后台任务、UI 入口、migration。
verify:
  - pytest test_reparse_guard 追加用例

---
