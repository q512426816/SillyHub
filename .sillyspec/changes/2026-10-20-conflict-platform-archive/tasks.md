---
author: flow-machine-draft
created_at: 2026-10-20T00:16:49.178Z
---
# 任务注册表（Tasks）— 2026-10-20-conflict-platform-archive

- [x] task-01: 后端留档蒸馏器——`_distill_local_archive` 纯函数（add/update/rename/delete 条目形态、utf8/binary、32000 字符截断、512KB 总量帽、300 条目帽）+ 先红后绿单测（纯函数直测，test_conflict_local_archive.py）
- [x] task-02: apply_ops 七处被拒点收集 conflicted_ops + _upsert_sync_conflict 增参写 details_json.local_archive——单测断言冲突推送后 open 行留档形态（乐观锁/墓碑/delete missing/rename new_path 各一例）
- [x] task-03: compare 回退——_scope_snapshot_to_change 参数化 label、compare() 捕获 conflict_record_missing → _load_archived_snapshot（fail-soft）——单测回退命中 200/platform-archive/段边界裁剪、不命中重抛、非 missing 不回退（test_sillyspec_compare.py）
- [x] task-04: 前端 platform-archive 来源横幅（conflict-compare-modal.tsx，与 full-tree 横幅互斥）+ 测试用例（含互斥断言）
- [x] task-05: 回归清偿——后端 test_sillyspec_compare / test_sync_incremental / test_platform_deleted_guard / test_conflict_local_archive 全绿 + 前端 conflict-compare-modal 套件全绿 + ruff lint 过
