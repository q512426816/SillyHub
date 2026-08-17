---
repo: main
id: task-02
title: task-02
title_zh: 新增增量同步落盘端点
goal: 实现 POST /api/changes/-/spec-sync，让 CLI 能把差异 ops 推送到平台并落盘。
implementation: |
  1. 新增 SpecSyncRequest（ops: list[FileOp]）与 SpecSyncResponse schema。
  2. PlatformSyncService.apply_spec_ops(workspace_id, ops) 透调 SpecWorkspaceService.apply_ops()。
  3. router.py 新增端点，依赖 require_platform_sync_write。
acceptance: |
  - add/update/delete/rename 正确落盘；
  - conflict 返回 conflict=true 且 server_versions 非空；
  - 空 ops 返回 ok=true。
verify: pytest backend/app/modules/platform_sync/tests/test_spec_sync.py
constraints: |
  - apply_ops 内部为单事务，一次 POST 全部落盘或全部回滚。
allowed_paths:
  - backend/app/modules/platform_sync/router.py
  - backend/app/modules/platform_sync/schema.py
  - backend/app/modules/platform_sync/service.py
---

# task-02 新增增量同步落盘端点
