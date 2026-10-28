---
author: flow-machine-draft
created_at: 2026-10-28T00:24:44.820Z
---
# 提案书（Proposal）— 2026-10-28-reparse-trigger-tests-realign

## 动机

任务原话转写：增量重扫触发测试对齐 scoped 新契约

动机：backend spec_workspace test_incremental_reparse_trigger.py 有 11 个基线失败（2026-10-28 风险审查时已存在，git stash 基线对照排除 2026-10-28-cgroup-v2-watermark-fix 引入）。定位结论：引入提交 60629d2bb（2026-10-27-archive-reparse-oom-governance）把 _compute_reparse_scope 从二元组改三元组 (scope, archive_hit, structural)，且归档 rename/delete 从「全量 reparse」刻意改为「scoped + structural 立即通道」（docstring 落痕 D-004/D-007，全量退位为手动端点/异常兜底）；该笔同提交新增契约测试 test_archive_scoped_reparse.py（全过）但漏更新本旧文件——8 个纯函数用例死于二元组解包（too many values to unpack），3 个端到端用例死于「期望全量、实得 scoped 列表」。判定：测试过时，非实现回归，按新契约对齐更新测试。

成功标准：
- TestComputeReparseScope 八用例改三元组解包并按新契约断言：rename/delete 入 changes/archive/<name> → (['<name>'], archive_hit=False, structural=True)；恰为 changes/archive 根 → (None, True, False) 兜底不变；纯标注/兜底/add 归档/零触发/混合去重语义不变仅改解包
- TestArchivePathScoping 两用例（rename/delete 全量期望）改断言 scoped 列表；test_archive_full_reparse_still_deletes 仍过但机制描述与命名对齐 scoped 双名覆盖实际
- 本文件 19 用例全绿；test_archive_scoped_reparse.py 既有契约测试回归零破坏；不改动任何 src 代码

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. TestComputeReparseScope 八用例改三元组解包并按新契约断言：rename/delete 入 changes/archive/<name> → (['<name>'], archive_hit=False, structural=True)；恰为 changes/archive 根 → (None, True, False) 兜底不变；纯标注/兜底/add 归档/零触发/混合去重语义不变仅改解包
2. TestArchivePathScoping 两用例（rename/delete 全量期望）改断言 scoped 列表；test_archive_full_reparse_still_deletes 仍过但机制描述与命名对齐 scoped 双名覆盖实际
3. 本文件 19 用例全绿；test_archive_scoped_reparse.py 既有契约测试回归零破坏；不改动任何 src 代码

## 成功标准（可验证）

1. TestComputeReparseScope 八用例改三元组解包并按新契约断言：rename/delete 入 changes/archive/<name> → (['<name>'], archive_hit=False, structural=True)；恰为 changes/archive 根 → (None, True, False) 兜底不变；纯标注/兜底/add 归档/零触发/混合去重语义不变仅改解包
2. TestArchivePathScoping 两用例（rename/delete 全量期望）改断言 scoped 列表；test_archive_full_reparse_still_deletes 仍过但机制描述与命名对齐 scoped 双名覆盖实际
3. 本文件 19 用例全绿；test_archive_scoped_reparse.py 既有契约测试回归零破坏；不改动任何 src 代码
