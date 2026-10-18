---
author: flow-machine-draft
created_at: 2026-10-18T12:31:35.167Z
---
# 需求规格（Requirements）— 2026-10-18-change-type-git-conventional

## 功能需求

### FR-01: 后端 reparse：变更目录 flow-state.yaml 含 commit_type 字段时作为权威类型写入 change_type（允许覆盖库中已有旧值）；无该字段的变更保持现有目录推断与只为空回填行为不变

- reparse 读到 flow-state.yaml 顶层 `commit_type` 时 MUST 将其作为权威类型写入
  change_type（允许覆盖库中已有旧值，值小写化且 ≤50 字符）；文件缺失/字段缺失/
  值非 str/空串/损坏 YAML 时 MUST 返 None 回落目录推断路径；无权威标志的推断值
  禁止 覆盖库中非空 change_type（change_writer 建行语义不被猜测值回翻）。

#### 场景：主路径

Given 归档变更目录含 flow-state.yaml（tier: thin + commit_type: fix）且库行
change_type='feature'，When reparse，Then 库行 change_type 变为 'fix'（权威覆盖）。

#### 场景：无字段回落

Given flow-state.yaml 无 commit_type 字段，When reparse，Then change_type 保持
目录推断值且 change_type_authoritative=False（只为空回填语义不变）。

### FR-02: 回填脚本：遍历归档变更，git 提交信息反查变更 key，排除 chore(archive)，按优先级（feat/fix > perf/refactor/test > docs/style > build/chore）取主类型，幂等写入该变更 flow-state.yaml（已存在则替换该行，最小 diff）

- 脚本 MUST 按提交信息中「最后一个」变更 key 形态 token 归属提交（防跨变更引用
  误判），MUST 排除 chore(archive) 归档留档提交与白名单外伪前缀（实证：
  `sillyspec: baseline checkpoint`）；MUST 幂等（行存在原位替换、同值不写、缺则
  追加一行最小 diff）；SHOULD 禁止 为 active 且无 flow-state.yaml 的变更新建文件
  （防 _infer_current_stage 误判 thin）；无匹配提交的变更 MUST 跳过不写（不猜）。

#### 场景：主路径

Given 变更 key 在 git 历史中有 fix(frontend) 主提交与 docs(spec) 工件提交，When
回填，Then 取 fix（优先级 feat/fix 高于 docs）；复跑输出 unchanged（幂等）。

#### 场景：伪前缀拒识

Given 提交 `sillyspec: baseline checkpoint for <key>`，When 归属，Then 该提交不
参与类型判定（白名单外）；若为该变更唯一提及则整体 no_match 跳过。

### FR-03: 前端详情页「类型」行改为彩色标签：已知类型（feat/fix/docs/chore/perf/refactor/test/build/style）固定配色，未知类型中性样式显示原值，空值显示 —

- 详情页「类型」行 MUST 渲染 CommitTypeChip（已知前缀固定配色），未知前缀 MUST
  以中性配色显示原值（禁止误配色），change_type 为空 MUST 显示 —；旧枚举
  feature SHOULD 在显示层等价映射为 feat（数据不动）。

#### 场景：主路径

Given change_type='fix'，Then 标签文本 fix 且红色阶（border-red）；'docs' 为蓝色阶。

#### 场景：未知与空值

Given change_type='hotfix'（未知），Then 中性配色原样显示；change_type=null，
Then 该行显示 — 且无标签节点。

### FR-04: 聚焦测试：parser commit_type 读取用例、_apply_parsed 权威覆盖用例、change-overview-side 类型标签用例全绿；前端 tsc 通过

- 本变更 MUST 补齐并跑绿三类聚焦测试（parser commit_type 读取/集成、_apply_parsed
  覆盖三分支、change-overview-side 标签四用例），MUST 通过前端 tsc 与后端
  ruff/mypy；禁止 跑全量测试（CLAUDE.md 规则 0）。

#### 场景：主路径

Given 改动落地，When 跑 test_parser.py + test_reparse_guard.py + 侧栏组件测试，
Then 全绿（60 + 11 passed），tsc exit 0。

### FR-05: 本仓回填 dogfood：脚本跑完后抽验 2026-10-17-session-envelope-rev-stale-guard 的 flow-state.yaml 含 commit_type: fix

- 本仓 MUST 实跑回填并抽验 session-envelope-rev-stale-guard 的 flow-state.yaml
  含 `commit_type: fix`；脚本 MUST 输出动作统计（appended/created/no_match）供
  人工核对覆盖面。

#### 场景：主路径

Given 本仓 641 个归档变更与 5020 条提交，When 实跑脚本，Then 抽验变更末行含
commit_type: fix，复跑统计 unchanged=426（幂等实证）。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: test_parser.py「TestCommitTypeFlowState::test_read_returns_lowercase_value / test_read_missing_file_or_field_returns_none / test_read_corrupted_yaml_returns_none / test_parse_workspace_commit_type_overrides_inference / test_parse_workspace_without_field_keeps_inference_not_authoritative」+ test_reparse_guard.py「test_apply_parsed_change_type_inference_only_fills_none / test_apply_parsed_change_type_none_fill_unchanged / test_apply_parsed_authoritative_commit_type_overwrites」（backend/app/modules/change/tests/）
FR-02: test_parser.py「TestCommitTypeFlowState」（脚本写入字段的消费侧契约）；脚本本体以 dogfood 实跑验证（幂等复跑 unchanged=426 + 伪前缀 no_match 抽验 change-detail-redesign）——无独立单测面
FR-03: frontend/src/components/changes/detail/__tests__/change-overview-side.test.tsx「类型行：已知前缀渲染彩色标签（fix 红色阶 / docs 蓝色阶）/ 旧枚举 feature 显示层等价映射 feat / 未知前缀中性配色显示原值 / change_type 为空 → 显示 —」
FR-04: 同 FR-01/FR-03 绑定的全部用例（backend 60 passed + frontend 11 passed + tsc exit 0 实测留痕）
FR-05: dogfood 实跑：.sillyspec/changes/archive/2026-10-17-session-envelope-rev-stale-guard/flow-state.yaml 末行 commit_type: fix（git diff +1 行留痕）
