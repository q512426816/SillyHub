---
id: task-06
title: _apply_parsed owner_id 守卫加 _reparse created 撞键转 update 单测
title_zh: change 模块守卫单测
author: qinyi
created_at: 2026-08-02 00:34:50
priority: P0
depends_on: [task-03, task-04]
blocks: []
requirement_ids: [FR-03, FR-04]
decision_ids: [D-002@v1, D-004@v1]
allowed_paths:
  - backend/app/modules/change/tests/
provides: []
expect_from: []
related_tests: []
goal: >
  为 task-03 的 _apply_parsed owner_id 守卫加 task-04 的 _reparse created IntegrityError 转 update 补细粒度单测，owner_id 非空行 stage 不被覆盖 owner_id 为 None 行正常覆盖 created 撞键转 update 不抛 500，弥补 test_router.py 真实 fixture 仅覆盖 owner_id 为 None 扫描行的盲区。
implementation:
  - _apply_parsed owner_id 非空不覆盖 case 构造 Change 行 owner_id 为 user_id current_stage 为 draft 加 ParsedChange current_stage 为 brainstorm 直接调 _apply_parsed 断言 row.current_stage 仍为 draft 不被覆盖
  - _apply_parsed owner_id 为 None 覆盖 case 构造 Change 行 owner_id 为 None current_stage 为 draft 加同 ParsedChange 断言 row.current_stage 变为 brainstorm 行为同前扫描行回归保护
  - _reparse created 撞键转 update case mock _session.add 抛 IntegrityError 模拟占坑行已存在同 change_key 调 _reparse 断言走重查到 _apply_parsed 的 update 路径不抛 500 且 stats created 不计该行
  - 确认 test_router.py 现有 reparse 端到端测试 test_reparse_updates_existing_changes 与 test_reparse_idempotent 走 workspace_with_changes 真实文件 fixture owner_id 为 None 扫描行 回归不被本批改动破坏
  - 跑 change tests 全量绿 新建 test 文件或扩 test_router.py 由 execute 阶段定
acceptance:
  - AC-06 _apply_parsed owner_id 非空行不覆盖 current_stage 保 draft owner_id 为 None 行正常被文件推断覆盖历史扫描行回归
  - AC-07 _reparse created 撞 ux_changes_workspace_key 时 catch IntegrityError 重查转 update 不抛 500 sync_status 不永久 dirty
verify:
  - cd backend 然后 uv run pytest app/modules/change/tests -q --no-cov
constraints:
  - 可直接调 service 方法加 mock session 或加 fixture execute 阶段定 不强制走 HTTP 端到端
  - 不改 _apply_parsed 与 _reparse 实现 由 task-03 与 task-04 负责 本 task 仅加测试
  - 不改现有 reparse 端到端测试断言 test_router.py 仅回归确认
  - 落点限 backend/app/modules/change/tests 目录
---
