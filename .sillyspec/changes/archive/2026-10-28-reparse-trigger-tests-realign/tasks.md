---
author: flow-machine-draft
created_at: 2026-10-28T00:24:44.820Z
---
# 任务注册表（Tasks）— 2026-10-28-reparse-trigger-tests-realign

- [x] task-01: TestComputeReparseScope 八用例改三元组解包——rename/delete 入归档断言 (['<name>'], False, True)、恰为 changes/archive 根保持 (None, True, False)、其余形态仅改解包；跑该类全绿
- [x] task-02: TestArchivePathScoping 两用例断言改 scoped 列表 + 命名/docstring 对齐（含 test_archive_full_reparse_still_deletes 机制描述改写）；模块 docstring 与分区注释同步；跑全文件 19 用例绿
- [x] task-03: 回归验证——test_archive_scoped_reparse.py + test_reparse_scoped_zero_delete.py 零破坏；git diff 确认零 src 改动
