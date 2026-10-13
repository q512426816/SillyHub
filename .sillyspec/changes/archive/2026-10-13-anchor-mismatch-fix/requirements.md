---
author: flow-machine-draft
created_at: 2026-10-13T08:50:00.000Z
---
# 需求规格（Requirements）— 2026-10-13-anchor-mismatch-fix

## 功能需求

### FR-01: 扫描模式列出工作区内「交互轮的已解析绑定命令全部一致指向变更 X、且轮锚 != X」的错配轮（run、当前锚、目标 X、命令数、未知 key 数），零写库

- 扫描必须按工作区批量化（两条查询内完成：工作区交互轮 + 这些轮的 sillyspec 命令日志），禁止逐轮 N+1；判定必须只基于已解析（change_key 能映射到工作区 Change 行）的命令，未知 key 计数呈现但不参与一致性判定；报告模式必须零写库。
- 无锚轮（change_id IS NULL）同样属于「轮锚 != X」的错配候选。

#### 场景：主路径

- Given 交互轮锚在 Y 但其全部已解析命令指向 X（form-strict 实测形态），When 扫描，Then 该轮进入错配清单（当前锚=Y、目标=X）。

### FR-02: 修复模式把一致错配的交互轮（spec_strategy=interactive）重锚到 X；正确锚定轮、混合命令轮（指向多个变更）、派发轮禁止触碰；幂等可重跑

- 修复必须只写 agent_runs.change_id（一致错配轮 → X），必须排除：spec_strategy 非 interactive 的轮（派发锚权威）、已解析命令指向多个变更的轮（切换轮 ≤1 轮误差既有裁决）、锚已等于 X 的轮；同一数据重跑必须零更新。

#### 场景：主路径

- When 对含一致错配轮的工作区执行修复，Then 错配轮 change_id 变为 X；重跑修复零更新。

#### 场景：不触发

- Given 轮内命令分别指向 Y 与 X（切换轮），When 修复，Then 该轮不动。

### FR-03: 主导型信息项（指向多变更但最高占比 ≥80% 且 ≥5 条）单独列出仅报告，不自动修

- 占比与条数阈值必须为常量并写入报告输出；主导型信息项禁止被修复模式改动。

#### 场景：主路径

- Given 轮内 12 条已解析命令中 11 条指向 X、1 条指向 Y、轮锚 Y，When 扫描，Then 该轮出现在主导型信息项（不进错配清单、不被修复）。

### FR-04: 脚本 --mismatch 默认只报告，与 --apply 组合才落库；全工作区 --apply 沿用 --yes 门

- `--mismatch`（缺省）必须零写入；`--mismatch --apply` 落库修复；不带 --workspace 的全工作区 --apply 必须复用既有 --yes 确认门；--workspace 语义与既有回填一致。

#### 场景：主路径

- Given --mismatch --apply --workspace <uuid>，When 执行，Then 仅该工作区错配轮被重锚并输出逐轮结果。

### FR-05: 既有测试全过并新增用例绑定上述行为

- 既有 change 模块测试必须全部通过；必须新增覆盖：一致错配检出与修复、混合命令轮不触发、派发轮不触发、主导型仅报告、幂等重跑。

#### 场景：主路径

- When 运行回填测试文件，Then 全部通过（含新增用例）。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: backend/app/modules/change/tests/test_backfill_run_context.py「test_scan_mismatch_reports_unanimous_run_targeting_single_change」
FR-02: backend/app/modules/change/tests/test_backfill_run_context.py「test_fix_mismatch_reanchors_interactive_run + test_fix_mismatch_skips_mixed_and_dispatched + test_fix_mismatch_idempotent」
FR-03: backend/app/modules/change/tests/test_backfill_run_context.py「test_dominant_mixture_reported_but_not_fixed」
FR-04: backend/app/modules/change/tests/test_backfill_run_context.py「test_scan_mismatch_is_read_only」
FR-05: backend/app/modules/change/tests/test_backfill_run_context.py「全量通过」
