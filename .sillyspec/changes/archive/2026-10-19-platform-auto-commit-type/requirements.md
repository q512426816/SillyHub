---
author: flow-machine-draft
created_at: 2026-10-19T03:07:50.552Z
---
# 需求规格（Requirements）— 2026-10-19-platform-auto-commit-type

## 功能需求

### FR-01: C 件 parser：reparse 对含 timeline.md 的变更，从「任务面」锚定哈希 × 🔀 行标题提取白名单内主类型（优先级 feat/fix > perf/refactor/test > docs/style > build/chore/revert），作权威类型（允许覆盖；flow-state.yaml 显式 commit_type 字段仍最优先，目录推断兜底不变）；无 timeline/无锚定哈希/无命中类型 → 回落不写

- reparse 遇含 timeline.md 的变更目录 MUST 从任务面锚定哈希 ∩ 🔀 行提取白名单内
  主类型并置权威标志（允许覆盖库中旧值）；flow-state.yaml 显式 commit_type MUST
  优先于 timeline 源（已回填行不被覆盖）；白名单外伪前缀 MUST 不认；缺文件/
  无锚/无命中 MUST 返 None 回落目录推断路径（fail-open 不抛）。

#### 场景：主路径

Given timeline.md（🔀 含 fix 主提交 + docs/chore 工件提交，任务面锚定 fix 哈希），
When 提取，Then 返 fix（优先级 feat/fix 高于 docs/chorie 工件）。

#### 场景：并行噪音

Given 🔀 行含他变更提交哈希（不在任务面锚集），When 提取，Then 该提交不参与判定；
锚全不命中 → None。

#### 场景：权威序

Given flow-state commit_type=docs 与 timeline 提取 fix 同场，When reparse，
Then change_type=docs（flow-state 最优先）。

### FR-02: B 件同步重扫：spec-sync 落盘 ops 后，路径命中 flow-state.yaml 或 timeline.md 的变更键集合非空时，以后台任务对该集合跑 scoped reparse（独立 session、失败仅告警不阻断同步响应）

- 核对确认（2026-10-19）：该机制已完整存在（apply_ops 落盘后
  `_trigger_change_reparse` 后台任务 + `_compute_reparse_scope`：归档 rename →
  全量重扫、archive add/update → scoped、无标注 ops 路径兜底、失败仅告警），
  本变更 MUST NOT 重复实现；timeline.md/flow-state.yaml 落盘 op MUST 被既有
  scope 检测覆盖（两者均在 changes/ 前缀下）。

#### 场景：主路径

Given CLI 归档同步推 rename op（changes/<key>/ → changes/archive/<key>/），When
apply_ops，Then 全量 reparse 自动触发（既有 test_archive_rename_op_triggers_full_reparse
钉）。

### FR-03: 聚焦测试：timeline 提取用例（含并行噪音排除/截断标题/无锚回退）+ 既有 parser/reparse 测试零回归；ruff/mypy 干净

- 本变更 MUST 补 timeline 提取用例（锚定主类型/并行噪音排除/缺文件无锚回退/伪
  前缀拒识/权威序两用例），MUST 跑绿既有 parser + reparse guard 全部用例，
  MUST 通过 ruff/mypy；禁止 跑全量测试（CLAUDE.md 规则 0）。

#### 场景：主路径

Given 改动落地，When 跑 test_parser.py + test_reparse_guard.py，Then 全绿
（50 + 16 passed），ruff/mypy 干净。

### FR-04: 本机真数据端到端验证：以模块方式对真实归档批量对照 timeline 提取与 git 全历史口径，抽样核验分歧语义

- 部署不属本变更范围（用户明确指示不含部署）。本变更 MUST 以本机真实归档做批量
  对照验证（提取非空率、与 git 口径一致率、分歧样本语义核验），分歧口径差异
  MUST 在 design 记录结论（timeline 锚定执行窗交付提交 vs git 全历史最后归属，
  抽样核验 timeline 不劣；flow-state 优先级保证已回填行稳定）。

#### 场景：主路径

Given 本仓 208 个含 timeline 归档，When 批量对照，Then 提取非空 135（98 一致 +
37 分歧）、提取为空 73（锚缺失/伪前缀，回落不猜）；分歧样本抽样核验为口径哲学
差异非提取错误（design 已记）。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: backend/app/modules/change/tests/test_parser.py「TestTimelineCommitType::test_anchored_hash_extracts_main_type / test_unanchored_parallel_commits_ignored / test_missing_timeline_or_no_anchor_returns_none / test_unknown_pseudo_prefix_rejected / test_flow_state_field_beats_timeline / test_timeline_source_authoritative_when_no_flow_state」
FR-02: backend/app/modules/spec_workspace/tests/test_incremental_reparse_trigger.py 既有测试群（test_archive_add_op_goes_scoped / test_archive_rename_op_triggers_full_reparse / test_no_change_dirs_falls_back_to_path_detection / test_reparse_failure_does_not_block_sync 等）——机制核对零新代码
FR-03: 同 FR-01 绑定用例 + test_reparse_guard.py 全量（backend 50 + 16 passed + ruff/mypy 干净实测留痕）
FR-04: 本机批量对照脚本留痕（一次性 python 驱动，输出 一致=98 不一致=37 提取为空=73→核对后 135 非空；非持久测试面，不适用：一次性验证数据已记 design/FR 场景）
