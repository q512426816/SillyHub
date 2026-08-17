---
id: task-04
title: quicklog_service.py 双源合并 + enrich + 模块推导 + pytest（覆盖 FR-04, FR-08, D-005）
title_zh: quicklog 双源合并服务
author: qinyi
created_at: 2026-08-17 00:35:00
priority: P0
depends_on: [task-01, task-03]
blocks: [task-05]
requirement_ids: [FR-04, FR-08]
decision_ids: [D-005]
allowed_paths:
  - backend/app/modules/change/quicklog_service.py
  - backend/app/modules/change/tests/test_quicklog_service.py
provides:
  - contract: quicklog_query_data
    fields: [merge_semantics, stale_threshold, enrich_fields, module_derivation]
expects_from:
  task-01: [quicklog_entries_table]
  task-03: [quicklog_parsed_entry]
goal: >
  提供查询服务：PG 推送条目 ∪ 文件解析条目按 ql_id 去重（PG 优先，D-003 冲突取推送时点），
  stale 判定（in_progress>24h，查询时算不落库 D-005）、author enrich（users.display_name 优先）、
  affected_modules 推导（复用 change/parser.py module-map 口径）。
implementation:
  - quicklog_service.py：list_entries(workspace, filters) + get_entry(workspace, ql_id)
  - 合并：读 PG（QuicklogEntry payload 反序列化）+ 文件解析（quicklog_parser），ql_id 键去重取 PG
  - 按 timestamp desc 排序；search 匹配标题+四段全文；status/author/include_placeholder 筛选
  - stale：status=in_progress 且 now-timestamp>24h → 输出 stale；作者 enrich 批量 join users（display_name 优先 username fallback）
  - affected_modules：文件路径集合 → change/parser.py _load_module_map + _match_paths_to_modules
  - get_entry：双源合并后定位单条，返回全字段（含 body 全文 + raw_block）
acceptance:
  - 双源同 ql_id 取 PG；仅文件源 / 仅 PG 源 / 双空 均正确
  - stale 判定 24h 阈值可注入（测试用固定 now）；enrich 命中/未命中（回退原始用户名）正确
  - 分页 + search 全文 + status/author 筛选正确
  - 不影响既有 change 服务（纯新增）
verify:
  - cd backend && uv run pytest app/modules/change/tests/test_quicklog_service.py -x -q
constraints:
  - 不写库（只读合并）；派生字段不落库（D-005）
  - enrich 失败不抛（回退 author_raw）
  - Windows/Linux 路径兼容
related_tests: []
---
