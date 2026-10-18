---
author: flow-machine-draft
created_at: 2026-10-18T12:31:35.167Z
---
# 提案书（Proposal）— 2026-10-18-change-type-git-conventional

## 动机

任务原话转写：变更类型改用git惯用前缀彩色标签

动机：变更详情页「类型」行现状恒显示 feature/quick/prototype 旧枚举，用户实际想看 git 惯用提交前缀式语义分类（feat/fix/docs/chore 等）。语义类型只存在于本机 git 提交信息，平台无 git 历史，需要数据通道：变更目录 flow-state.yaml 新增可选字段 commit_type 作为权威类型源，平台 reparse 读取；存量归档变更由本地脚本按「提交信息含变更 key」反查 git 回填（排除 chore(archive) 归档提交）。

成功标准：
- 后端 reparse：变更目录 flow-state.yaml 含 commit_type 字段时作为权威类型写入 change_type（允许覆盖库中已有旧值）；无该字段的变更保持现有目录推断与只为空回填行为不变
- 回填脚本：遍历归档变更，git 提交信息反查变更 key，排除 chore(archive)，按优先级（feat/fix > perf/refactor/test > docs/style > build/chore）取主类型，幂等写入该变更 flow-state.yaml（已存在则替换该行，最小 diff）
- 前端详情页「类型」行改为彩色标签：已知类型（feat/fix/docs/chore/perf/refactor/test/build/style）固定配色，未知类型中性样式显示原值，空值显示 —
- 聚焦测试：parser commit_type 读取用例、_apply_parsed 权威覆盖用例、change-overview-side 类型标签用例全绿；前端 tsc 通过
- 本仓回填 dogfood：脚本跑完后抽验 2026-10-17-session-envelope-rev-stale-guard 的 flow-state.yaml 含 commit_type: fix

## 变更范围

按成功标准机械推导，共 5 条验收面：
1. 后端 reparse：变更目录 flow-state.yaml 含 commit_type 字段时作为权威类型写入 change_type（允许覆盖库中已有旧值）；无该字段的变更保持现有目录推断与只为空回填行为不变
2. 回填脚本：遍历归档变更，git 提交信息反查变更 key，排除 chore(archive)，按优先级（feat/fix > perf/refactor/test > docs/style > build/chore）取主类型，幂等写入该变更 flow-state.yaml（已存在则替换该行，最小 diff）
3. 前端详情页「类型」行改为彩色标签：已知类型（feat/fix/docs/chore/perf/refactor/test/build/style）固定配色，未知类型中性样式显示原值，空值显示 —
4. 聚焦测试：parser commit_type 读取用例、_apply_parsed 权威覆盖用例、change-overview-side 类型标签用例全绿；前端 tsc 通过
5. 本仓回填 dogfood：脚本跑完后抽验 2026-10-17-session-envelope-rev-stale-guard 的 flow-state.yaml 含 commit_type: fix

## 成功标准（可验证）

1. 后端 reparse：变更目录 flow-state.yaml 含 commit_type 字段时作为权威类型写入 change_type（允许覆盖库中已有旧值）；无该字段的变更保持现有目录推断与只为空回填行为不变
2. 回填脚本：遍历归档变更，git 提交信息反查变更 key，排除 chore(archive)，按优先级（feat/fix > perf/refactor/test > docs/style > build/chore）取主类型，幂等写入该变更 flow-state.yaml（已存在则替换该行，最小 diff）
3. 前端详情页「类型」行改为彩色标签：已知类型（feat/fix/docs/chore/perf/refactor/test/build/style）固定配色，未知类型中性样式显示原值，空值显示 —
4. 聚焦测试：parser commit_type 读取用例、_apply_parsed 权威覆盖用例、change-overview-side 类型标签用例全绿；前端 tsc 通过
5. 本仓回填 dogfood：脚本跑完后抽验 2026-10-17-session-envelope-rev-stale-guard 的 flow-state.yaml 含 commit_type: fix
