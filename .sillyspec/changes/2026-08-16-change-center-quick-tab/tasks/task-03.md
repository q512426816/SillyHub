---
id: task-03
title: quicklog_parser.py 条目解析器 + pytest（覆盖 FR-01, FR-08, D-007）
title_zh: QUICKLOG 条目解析器
author: qinyi
created_at: 2026-08-17 00:34:00
priority: P0
depends_on: []
blocks: [task-04]
requirement_ids: [FR-01, FR-08]
decision_ids: [D-002, D-007]
allowed_paths:
  - backend/app/modules/change/quicklog_parser.py
  - backend/app/modules/change/tests/test_quicklog_parser.py
provides:
  - contract: quicklog_parsed_entry
    fields: [ql_id, timestamp, title, status, status_note, placeholder, author_raw, linked_changes, files, body_sections, raw_block]
expects_from: {}
goal: >
  解析 spec_root/quicklog/QUICKLOG-*.md 全目录为条目列表（FR-01），宽松规则覆盖真实数据形态（D-007），
  进程级 mtime 指纹缓存保证毫秒级性能。
implementation:
  - 扫描 spec_root/quicklog/ 下 QUICKLOG-*.md（复用 knowledge service spec content root 口径）
  - 按 `^## (ql-...) \| (时间) \| (标题)$` 切块；统一剥行尾 \r（CRLF）
  - 标签行解析（全半角冒号 `[：:]`）：状态/关联变更/文件/需求/根因/方案/结果；多状态行取最后一条
  - 状态判定（前缀匹配+括注进 status_note）：已完成[（…）]→completed；已暂存[（…）]→partial_done；进行中→in_progress/stale（>24h，由服务层算，解析层仅输出原始状态+原始时间戳）
  - 标题 == "(quick 任务)" → placeholder=true
  - linked_changes 白名单正则 ^\d{4}-\d{2}-\d{2}- 过滤，其余留自由段
  - 文件行支持单行逗号分隔 + 多行 `- path（括注）` bullet 两种形态（含 `::` 括注）
  - 进程级缓存：键=(目录 resolved, 全部文件(name,mtime) 指纹)，值不可变命中回拷贝
  - 单文件 1MB 截断上限（对齐 knowledge MAX_CONTENT_BYTES），超限 raw_block 标注
  - author_raw 从文件名 `QUICKLOG-(.+?)(-\d{4}-\d{2}-\d{2})?\.md` 提取
acceptance:
  - 本仓 .sillyspec/quicklog/ 10 文件 ~500 条解析零异常，条目数=各文件 `## ql-` 行数合计（跨文件轮转各自独立，服务层去重）
  - 4 状态形态、全半角冒号、CRLF、重复状态行取最后、linked_changes 白名单、文件双形态用例全过
  - 缺 quicklog/ 目录 → 空列表不报错
verify:
  - cd backend && uv run pytest app/modules/change/tests/test_quicklog_parser.py -x -q
constraints:
  - 纯函数解析，不碰 DB；不依赖 platform_sync
  - 未知标签行归 body 自由段，不丢原文
  - stale 判定不在解析层（服务层按当前时间算，D-005）
related_tests: []
---
