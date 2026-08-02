---
id: task-05
title: 扩展 test_proxy.py 覆盖占坑 双表不撞键 docs 存在 回滚 CASCADE 中文 key
title_zh: test_proxy 占坑与回滚测试
author: qinyi
created_at: 2026-08-02 00:34:40
priority: P0
depends_on: [task-01, task-02]
blocks: []
requirement_ids: [FR-01, FR-02, FR-05, FR-06]
decision_ids: [D-001@v2, D-003@v1, D-006@v1]
allowed_paths:
  - backend/app/modules/change_writer/tests/test_proxy.py
provides: []
expect_from: []
related_tests: []
goal: >
  扩展 change_writer 的 test_proxy.py 覆盖 task-01 与 task-02 新行为，占坑 Change 加 docs 先于下发 双表不撞键 proxy 返回 docs 存在 failed 与超时回滚 CASCADE 中文 change_key 加 .lower() 加现有 8 例回归。
implementation:
  - 新增占坑成功 case patch _await_change_write_receipt 在等待前查 DB 断言 Change 与全部 ChangeDocument 的 current_stage 为 draft 与 owner_id 为 user_id 已先于 daemon_change_writes 下发存在
  - 新增双表不撞键 case 模拟 reparse 与 proxy 并发 reparse 单路串行写 docs proxy 路不再 INSERT docs 断言 ux_changes_workspace_key 与 ux_change_docs_type_path 两表均无并发撞键不抛 UniqueViolationError
  - 新增 proxy 返回 docs 存在 case 返回 201 后 DB 已有 Change 与 docs 含 master proposal request 详情页不空 复用 _simulate_daemon_complete 加速
  - 新增 failed 与超时回滚 CASCADE case daemon 回执 failed 或 PROXY_CHANGE_WRITE_TIMEOUT_SECONDS 为 0 时 独立 session DELETE 占坑 Change docs 因 change_id ON DELETE CASCADE 自动删 断言无孤儿行抛 ChangeWriteError 或超时错
  - 新增中文 change_key 加 .lower() case 标题为测试二字生成 change_key 保留中文 英文标题转小写 纯标点兜底 untitled 末尾 uuid 后缀保唯一
  - 跑现有 8 例 online offline stale_heartbeat unbound binding_path timeout 加 refresh 加 service_create_offline 确认不被 task-01 与 task-02 破坏 尤其 online 用例 doc_types 含 master proposal request 在占坑建 docs 行为下继续过
acceptance:
  - AC-02 占坑 Change 加 docs 先于 daemon_change_write 下发 commit DB 可查
  - AC-03 reparse 与 proxy 并发下 ux_changes_workspace_key 与 ux_change_docs_type_path 两表均无并发撞键
  - AC-04 proxy 返回 201 时 DB 已有 Change 与全部 docs 详情页不空
  - AC-05 failed 或超时 占坑 Change 加 docs 经 CASCADE 被删 无孤儿行抛 ChangeWriteError 或超时错
  - AC-01 中文标题 change_key 保留中文 英文小写 纯标点兜底 untitled
verify:
  - cd backend 然后 uv run pytest app/modules/change_writer/tests/test_proxy.py -q --no-cov
constraints:
  - 复用现有 helper _setup_daemon_client_workspace 与 _simulate_daemon_complete 与 _collect_change_write_id 与 _auth 不重复造
  - mock _await_change_write_receipt 与 PROXY_CHANGE_WRITE_TIMEOUT_SECONDS 为 0 加速避免 60 秒轮询阻塞
  - R-05 不断言 reparse 对占坑 docs 全走 update doc_type 不一致下 master 实际 DELETE 加 INSERT request 走 DELETE 只断言无并发唯一键冲突加 proxy 返回 docs 存在
  - 仅扩展测试不改 proxy.py 与 service.py 等源码逻辑 源码改动归 task-01 到 task-04
---
