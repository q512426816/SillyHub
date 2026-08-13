---
id: task-05
title: 后端测试 tests/test_sync_incremental.py（各 op / 409 / 软删备份 move / .runtime 拒 / containment 拒 / 旧 tar 失效）
title_zh: 增量端点行为测试
author: qinyi
created_at: 2026-08-13 15:23:34
priority: P0
depends_on: [task-03, task-04]
blocks: []
requirement_ids: [FR-01, FR-02, FR-04, FR-05, FR-06]
decision_ids: [D-001@v1, D-002@v1, D-010@v1]
allowed_paths:
  - backend/app/modules/spec_workspace/tests/test_sync_incremental.py
provides:
  - contract: backend_tests_green
    fields: [test_sync_incremental]
expects_from:
  task-04:
    - contract: sync_incremental_endpoint
      needs: [conflict, server_versions, new_versions]
goal: >
  覆盖增量端点全部行为（各 op / 409 / 软删备份 move / 越界拒 / 旧 tar 失效），作 execute 与 verify 回归锚点。
implementation:
  - 新建 test_sync_incremental.py，参照 test_bundle_sync 夹具（_make_workspace 与 _make_spec_workspace + httpx AsyncClient）
  - add 与 update 断言文件落 spec_root 且清单 version 递增 content_hash 正确
  - rename 断言文件移动且清单 path 更新含 new_path containment 校验
  - delete 断言文件移出 spec_root 到备份区 spec-backups 的 ws 与 ts 与 path 且 exists False version 加 1
  - base_version 过期断言 conflict True 且 server_versions 含服务器当前版本且冲突文件未落盘
  - .runtime op 与 containment 越界（../ 绝对路径 symlink 逃逸）与备份目标越界断言 422
  - 旧 tar apply_sync 后清单行清空且下一次增量重建
  - R-07 兜底断言 update 无行视为新建 version 1 且 delete 无行 no-op 成功
  - R-06 断言构造早于 30 天的备份目录被机会式修剪
acceptance:
  - test_sync_incremental.py 全部用例绿，覆盖各 op 与 409 与软删备份 move 与 .runtime 拒 与 containment 拒 与旧 tar 失效 与 R-07 兜底 与 R-06 修剪
verify:
  - cd backend && uv run pytest app/modules/spec_workspace/tests/test_sync_incremental.py -q --no-cov
constraints:
  - 真实断言不 mock 绕过（CLAUDE.md 规则 11/18）
  - 测试有缺陷回改实现 不改测试逻辑
---
