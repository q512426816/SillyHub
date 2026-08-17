---
id: task-06
title: sillyspec quicklog.js 两触发点 best-effort 推送 + helper + mock fetch 测试（repo: sillyspec）
title_zh: quick CLI 推送平台端点
author: qinyi
created_at: 2026-08-17 00:37:00
priority: P0
depends_on: [task-02]
blocks: []
requirement_ids: [FR-02]
decision_ids: [D-003]
repo: sillyspec
base_commit: 40571ae7c05ef22bb39290de144d627f0a1be071
head_commit: PENDING_EXECUTE
allowed_paths:
  - src/quicklog.js
  - test/quicklog-push-platform.test.mjs
provides:
  - contract: cli_quicklog_push
    fields: [trigger_points, payload_shape, best_effort_semantics, platform_config_source]
expects_from:
  task-02: [quicklog_push_api]
goal: >
  sillyspec CLI 在 allocateQuicklogEntry（写「进行中」骨架）与 completeQuicklogEntry（翻「已完成」+回填）
  两触发点后，best-effort POST 条目 JSON 到平台 POST /api/quicklog-entries（对齐变更 triggerSync 范式）。
implementation:
  - src/quicklog.js 新增内部 helper pushQuicklogToPlatform(specBase, entry)：读 local.yaml `platform:` 段（url+token）→ fetch POST → 5s 超时
  - allocateQuicklogEntry 成功路径尾部：构造条目对象（ql_id/timestamp/title/status=in_progress/author_raw/linked_changes/文件）→ push（best-effort）
  - completeQuicklogEntry 成功路径尾部：读回落盘条目头行/正文组装完成态 payload（标题以 extractTitleFromResult 刷新后的落盘值为准）→ push
  - 任何异常（无 platform 配置/fetch 失败/非 2xx）静默 console.warn 一行不抛，不阻断 quick 主流程
acceptance:
  - allocate 后 mock fetch 断言 POST 一次、url=平台 /api/quicklog-entries、Authorization=Bearer shpsync_ token、payload 含 status=in_progress
  - complete 后 POST 一次 payload status=completed 且含回填文件/四段
  - 无 platform 配置 → 不 POST 不报错；fetch 拒绝 → 不抛不阻断
  - 既有 quicklog 测试零回归（推送是附加副作用，默认 mock 或配置缺失时跳过）
verify:
  - cd ~/IdeaProjects/sillyspec && npm test（含新增 test/quicklog-push-platform.test.mjs）
constraints:
  - 不碰 daemon、不碰 sync.js 主链路；独立小函数
  - 平台 URL 从 local.yaml platform.url 取（不带 /mcp 后缀），token 用 platform.token（shpsync_）
  - 字段 snake_case 与平台 QuicklogEntryDTO 对齐；workspace 不带入 payload（平台由 token 派生）
related_tests: []
---
