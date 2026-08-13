---
id: task-09
title: 兼容收尾（旧 tar 端点保留核验 / 单成员快速路径 / .runtime 垃圾 ScanDocument 行可选清洗 / P2 R-04+R-06 落盘验收）
title_zh: 兼容性与 P2 决策验收收尾
author: qinyi
created_at: 2026-08-13 15:23:34
priority: P1
depends_on: [task-05, task-07]
blocks: []
requirement_ids: [FR-06, FR-07]
decision_ids: [D-008@v1, D-010@v1]
allowed_paths:
  - backend/app/modules/spec_workspace/tests/test_sync_incremental.py
  - backend/app/modules/spec_workspace/service.py
  - backend/app/modules/scan_docs/service.py
goal: >
  收尾兼容性（旧 tar 端点保留可用、单成员快速路径不冲突）+ P2 R-04/R-06 落盘验收，.runtime 垃圾行仅可选清洗不扩范围（NG-03）。
expects_from:
  task-05:
    - contract: backend_tests_green
      needs: [test_sync_incremental]
  task-07:
    - contract: incremental_diff_push
      needs: [ops, old tar fallback]
implementation:
  - 核验旧 tar POST /spec-workspace/sync（apply_sync）未改仍可用，旧客户端行为不变（R-01 兼容），补回归断言
  - 单成员 workspace base_version 恒匹配增量不冲突（test_sync_incremental 用例断言）
  - P2 落盘验收：R-04 软删仅恢复文件内容不恢复 Change 行状态（test_sync_incremental 已有断言）+ R-06 备份 30 天机会式修剪（task-03 实现，此处验收）
  - .runtime 垃圾 ScanDocument 行清洗为可选（FR-06）：测试暴露旧 tar 曾建垃圾行则补过滤，否则记录已知残留（NG-03 不扩范围）
acceptance:
  - 旧 tar 端点可用（apply_sync 回归绿）；单成员增量不冲突
  - R-04/R-06 落盘决策实现并验证通过；.runtime 垃圾行有则清洗无则记录已知残留
verify:
  - cd backend && uv run pytest app/modules/spec_workspace -q --no-cov
constraints:
  - 不改旧 tar 端点契约（R-01）；NG-03 不为 .runtime 垃圾行扩范围（除非本次直接暴露）；P2 决策以 plan 关键落盘决策节为准不 re-litigate
provides:
  - contract: compat_verified
    fields: [old tar retained, single member fast path, P2 recorded, runtime garbage optional]
---
