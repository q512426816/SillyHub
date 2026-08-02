---
id: task-01
title: 重构 proxy_create_change 时序 占坑 Change 加全部 ChangeDocument 先于下发 commit 回执 done 不补 docs failed 与超时独立 session DELETE 回滚
title_zh: proxy 占坑时序重构
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01, FR-02, FR-05]
decision_ids: [D-001@v2, D-006@v1]
allowed_paths:
  - backend/app/modules/change_writer/proxy.py
created_at: 2026-08-02 00:33:10
author: qinyi
goal: >
  占坑 Change+docs 先于 daemon_change_write 下发 commit，消除 proxy 落库路与 reparse 的双表并发竞态，失败/超时回滚不留孤儿。
provides: []
expect_from: []
related_tests: []
implementation:
  - 在 _build_files 之后下发 DaemonChangeWrite 之前，INSERT 占坑 Change（current_stage=draft，status=active，location=active，owner_id=user_id，change_type，path=changes/<key>，affected_components 空列表，stages 取 draft done at now.isoformat）+ 遍历 files 每项 INSERT ChangeDocument（doc_type/path 取自该项，exists=True，last_modified_at=now）→ commit 并 refresh change
  - 下发 DaemonChangeWrite（pending，files）→ commit + refresh，下发逻辑不变仅时序后移到占坑 commit 之后，保留 proxy_change_write_dispatched 日志
  - 调 _await_change_write_receipt 等回执（轮询周期 0.5s，超时 60s 翻 failed 并抛错，逻辑不变）
  - 回执 done 时 Change+docs 已 step3 占坑建好，删除原 proxy.py:267-298 回执 ok 后 INSERT Change 与 docs 循环的代码块，直接 refresh 占坑 change 后返回，保留 proxy_change_created 日志
  - 回执 failed 或 _await 超时翻 failed 时，用 get_session_factory 开独立 session 找到占坑 Change 行并 DELETE，依赖 change_documents.change_id ON DELETE CASCADE 级联删 docs，commit 后再抛 ChangeWriteError 或超时错，回滚失败仅 log.warning 不掩盖原错
  - 新增占坑建成与回滚 DELETE 的结构化日志（含 change_id 与 change_key），便于排查幽灵变更
acceptance:
  - AC-02 占坑 Change 与全部 ChangeDocument 的 commit 先于 DaemonChangeWrite 下发 commit；reparse 命中占坑行走 _apply_parsed update 不走 _build_change created
  - AC-03 proxy 回执 done 路径不再 INSERT ChangeDocument；change_documents 表仅 reparse 单路串行写不撞 ux_change_docs_type_path，changes 表不撞 ux_changes_workspace_key
  - AC-04 proxy 返回时 DB 已存在 Change 与全部 ChangeDocument（详情页不空）
  - AC-05 回执 failed 或 60s 超时 → 独立 session DELETE 占坑 Change，change_documents 经 change_id ON DELETE CASCADE 级联删，无孤儿行，抛 ChangeWriteError
verify:
  - 回归命令 cd backend && uv run pytest app/modules/change_writer/tests/test_proxy.py -q --no-cov，本 task 不改测试文件，新 case 由 task-05 加
constraints:
  - 不加 migration、不改 DB schema（R-05 doc_type 不一致另行处理）
  - 不改 _build_files 的 doc_type（保持 master/proposal/request，与 worktree lease 分支一致，R-05）
  - 不碰前端、不改 daemon、不改 router 端点签名与 proxy_create_change 返回类型（仍返回 Change）
  - 回滚用独立 session（get_session_factory）不污染主 session
  - 占坑 INSERT 失败（DB 异常）直接抛错，不下发 daemon_change_write（design §9 无副作用回退）
---
