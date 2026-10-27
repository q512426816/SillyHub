# target_files 主仓文档路径 × worktree 对账口径结构性错配

- **发现**：2026-10-26-session-stage-progress verify 门（target_files 对账）。
- **现象**：task-05 卡 target_files 声明模块卡路径（`.sillyspec/docs/multi-agent-platform/modules/*.md`，CLI 铁律明令"模块卡一律写主仓，绝不写 worktree 副本"）→ 对账口径 `actual=worktree:diff-base..HEAD + worktree:status-porcelain` 永远判 missing（「声明未做」②类），而产物真实存在于主仓（未提交或已提交均在主仓面）。两规则打架：写 worktree=产物蒸发；写主仓=对账 missing。
- **影响**：凡 target_files 含主仓 `.sillyspec` 文档路径的任务（收尾/文档类 task 常见）verify 门必拦，只能靠"改声明 + 注释说明"绕行——声明与事实脱节，且注释口径各 agent 自由发挥。
- **建议**：对账面把主仓 `.sillyspec/` 前缀路径单独处理（如读主仓 status/diff，或该前缀行不计 missing 仅提示），或在卡 schema 增 `repo: main-docs` 类显式声明。
- **绕行**（本变更采用）：task-05 target_files 置 `[]` + 行内注释说明主仓义务与承载面（module-impact 更新结果表 + verify-result 任务完成度），constraints 原文「以 module-impact 为准更正 target_files」为授权依据。

## 处置记录（2026-10-27 定时收口：已修——建议①落地，关闭归档）

- **根因锐化**：worktree 形态的 actual 面只收集 **worktree 侧** diff 与 porcelain
  （`resolveVerifyChangedFiles` 的 wtFiles/committedFiles 两源；主仓 porcelain 从不进面，
  主仓已提交面也只在 wt-commit 补齐并集里部分可见）——「治理文档一律写主仓」铁律的承载面
  （主仓 `.sillyspec/`）结构性不可见。`resolveVerifyChangedFiles` 2026-09-07 P1 修复保留的
  `.sillyspec/docs/**` 是 **worktree 副本侧**的 docs——产物按铁律不落那边，恒 miss 是结构性的。
- **已修**（sillyspec 仓 src/verify-postcheck.js `reconcileTargetFiles`）：**主仓治理文档救赎**
  ——worktree 形态下，声明路径剥 `NEW:` 前缀后以 `.sillyspec/` 开头者，单独对主仓
  `status --porcelain --untracked-files=all -- .sillyspec/`（未提交臂——`-uall` 防「新建模块卡
  被折叠成目录条目」对不上文件级声明，首版即踩此坑）∪ `baseline..HEAD diff -- .sillyspec/`
  （已提交臂，锚=actual.baseAnchor）匹配；命中则入 actualKeySet 并 notes 披露
  「主仓治理文档救赎：N 个 .sillyspec/ 声明经主仓实际改动面命中」。**只救赎「声明而 missing」
  的主仓治理路径，不扩 undeclared 面**（与 R9/R11 窗口救赎同语义）；fail-open：主仓读取
  失败走既有 missing 判定。主仓侧无改动时不虚造 matched（missing 如实在场）。
- **建议②（卡 schema 增 repo: main-docs 显式声明）不采**：建议①已按路径前缀无感覆盖，
  显式声明只增填写成本不增判别力。
- **测试**：test/target-files-main-docs-rescue.test.mjs 4/4（①真 linked worktree + 主仓未提交
  模块卡 → missing 清零+notes 披露+undeclared 不扩；②主仓已提交臂 baseline..HEAD 命中；
  ③主仓无改动不虚造；④test:core 驻留断言）；reconcile 族回归（feedback-batch2/ir-strict/
  foreign-own-priority/cross-repo-probe7/design-coverage）52/52 零回归；lint 1086 文件绿；
  docs gate 23≤60；doc-ref-check 93/93。
- **绕行形态退役**：修复后 task 卡可直接声明主仓模块卡真实路径——「target_files: [] + 行内
  注释」的声明与事实脱节形态不再必要。
- 处置结论：结构性错配在对账层收口，本文件移入 finished/。
