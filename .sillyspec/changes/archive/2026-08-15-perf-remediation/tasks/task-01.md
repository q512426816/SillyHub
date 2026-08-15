---
id: task-01
title: reparse to_thread (change + scan_docs)
title_zh: reparse 解析移入线程——change 与 scan_docs 同步 FS IO 不再阻塞事件循环
author: qinyi
created_at: 2026-08-15 07:00:00
priority: P1
depends_on: []
blocks: [task-10]
requirement_ids: [FR-01]
decision_ids: [D-002@v1]
allowed_paths:
  - backend/app/modules/change/service.py
  - backend/app/modules/scan_docs/service.py
  - backend/app/modules/change/tests/
  - backend/app/modules/scan_docs/tests/
goal: >
  reparse 全链路（change.parse_workspace / change._resync_change_docs /
  scan_docs.parse_docs_tree / parse_component）的 parser 同步重 IO 调用
  包 await asyncio.to_thread，解析期间事件循环可服务并发请求，结果零变更。
implementation:
  - change/service.py:1086（reparse 内 self._parser.parse_workspace(...)）改 await asyncio.to_thread(self._parser.parse_workspace, sillyspec_root, platform_managed=True, scope=scope)
  - change/service.py:480 附近 _resync_change_docs 内对 _parse_change 的调用同样包 to_thread（同类顺手，单目录解析纯同步读）
  - scan_docs/service.py:172-176（parse_docs_tree / parse_component 两分支）各包 await asyncio.to_thread(...)
  - 范式照抄 tool_gateway/service.py:322（Wave C 已落地的注释+to_thread 写法，含中文注释说明为何移线程）
  - 解析后的 DB 写回保持原样在事件循环（原本就在）；parser 纯同步纯读无共享可变状态，线程安全前提成立（design R-01）
  - 并发 reparse 交错风险与现状相同（既有 IntegrityError 自愈），不新增
acceptance:
  - 既有 reparse 测试（test_reparse_guard.py / test_reparse_scoped_zero_delete.py / scan_docs test_service.py）全绿，断言零修改——行为保持是本 task 的核心验收
  - parse 返回值类型不变，stats 与 existing 对比逻辑不动
verify:
  - cd backend && uv run pytest app/modules/change/tests/test_reparse_guard.py app/modules/change/tests/test_reparse_scoped_zero_delete.py -q --no-cov
  - cd backend && uv run pytest app/modules/scan_docs/tests/ -q --no-cov
  - cd backend && uv run ruff format --check app/modules/change/service.py app/modules/scan_docs/service.py
  - cd backend && uv run mypy app/modules/change/service.py app/modules/scan_docs/service.py
constraints: 不改 parser 本体（change/parser.py 属 task-06/07 领地）；不动 DB 写回逻辑；NFR-01 行为零变更。
---
