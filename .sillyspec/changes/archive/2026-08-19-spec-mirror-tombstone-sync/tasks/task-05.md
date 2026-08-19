---
id: task-05
title: 新增测试
title_zh: 对账/护栏/墓碑/占位时效用例
author: qinyi
created_at: 2026-08-19T22:40:00
priority: P0
depends_on: [task-01, task-02, task-04]
blocks: [task-06]
requirement_ids: [FR-01, FR-02, FR-03, FR-04]
decision_ids: []
provides: []
allowed_paths:
  - backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py
  - backend/app/modules/change/tests/test_reparse_guard.py
goal: >
  新建 test_full_sync_convergence.py + 追加 test_reparse_guard.py 时效用例
implementation:
  - 镜像多 3 文件 → 全 move 备份区 + 空目录清理 + manifest 墓碑
  - 落盘集与镜像一致 → 零删除零墓碑
  - 空 tar → 跳过对账
  - 比例护栏 → 中止 + 镜像不动
  - 镜像存量 local.yaml 整包覆盖后消失
  - manifest 无全表 DELETE（行数断言）
  - 占位保护 updated_at 6 天保护 / 8 天不保护
acceptance:
  - 新增用例全绿
constraints: >
  对齐 design Non-Goals：不动 apply_ops / daemon / CLI / 前端 / api-types；不做后台任务、UI 入口、migration。
verify:
  - pytest 两文件全绿

---
