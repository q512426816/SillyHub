---
author: flow-machine-draft
created_at: 2026-10-28T00:24:44.820Z
---
# 需求规格（Requirements）— 2026-10-28-reparse-trigger-tests-realign

## 功能需求

### FR-01: TestComputeReparseScope 八用例改三元组解包并按新契约断言：rename/delete 入 changes/archive/<name> → (['<name>'], archive_hit=False, structural=True)；恰为 changes/archive 根 → (None, True, False) 兜底不变；纯标注/兜底/add 归档/零触发/混合去重语义不变仅改解包

- 必须把八用例的二元组解包改为三元组 `(scope, archive_hit, structural)`；rename 跨根入归档与归档区 delete 必须断言 `scope == ['<name>']`、`archive_hit is False`、`structural is True`（D-004/D-007 新契约）；恰为 `changes/archive` 根必须保持 `(None, True, False)` 全量兜底断言；其余四形态（纯标注/兜底/add 归档/零触发/混合去重）语义不变、仅改解包。禁止改动 `_compute_reparse_scope` 实现来迁就旧断言。

#### 场景：rename 入归档走 scoped+structural

Given op=rename（旧侧活跃区、新侧 changes/archive/<name>）
When 调用 `_compute_reparse_scope([], [该 op])`
Then 返回 `(['<name>'], False, True)`——不再全量

### FR-02: TestArchivePathScoping 两用例（rename/delete 全量期望）改断言 scoped 列表；test_archive_full_reparse_still_deletes 仍过但机制描述与命名对齐 scoped 双名覆盖实际

- 必须把 `test_archive_rename_op_triggers_full_reparse` / `test_archive_delete_op_triggers_full_reparse` 的 `scope is None` 断言改为 scoped 列表断言（`["2026-08-13-old"]`）并改名/改 docstring 对齐新契约；`test_archive_full_reparse_still_deletes` 行为断言不变（仍须通过），但命名与 docstring 必须按真实机制改写（scoped 双名覆盖：rename 双侧 name 均进 scope，活跃侧目录消失行在 scoped 内删除）。

#### 场景：sync 端到端 rename 入归档

Given 增量同步携带 rename op（活跃 → 归档）
When 同步完成 reparse 被调度
Then mock 收到 `scope == ["2026-08-13-old"]`（scoped 而非 None）

### FR-03: 本文件 19 用例全绿；test_archive_scoped_reparse.py 既有契约测试回归零破坏；不改动任何 src 代码

- 本文件全部用例必须跑绿；`test_archive_scoped_reparse.py` 与 `test_reparse_scoped_zero_delete.py` 回归必须零破坏；禁止改动任何 src 代码（本变更是纯测试对齐——实现回归判定已被 60629d2bb docstring D-004/D-007 落痕与新增契约测试共同排除）。

#### 场景：回归全绿

Given 测试文件按新契约更新完成
When 运行 spec_workspace 测试目录
Then 本文件 19 用例全绿且既有契约测试零失败

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: backend/app/modules/spec_workspace/tests/test_incremental_reparse_trigger.py「TestComputeReparseScope 八用例（更新后）」
FR-02: backend/app/modules/spec_workspace/tests/test_incremental_reparse_trigger.py「TestArchivePathScoping rename/delete scoped 断言（更新后）」
FR-03: backend/app/modules/spec_workspace/tests/test_incremental_reparse_trigger.py「全文件」+ backend/app/modules/spec_workspace/tests/test_archive_scoped_reparse.py「回归」
