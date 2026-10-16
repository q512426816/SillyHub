# verify lint 硬门：归因降档只挂在 --done 路径，noAI 质量扫描路径未接线（同一失败两路径行为分叉）

> 记录时间：2026-10-15 · 来源变更：2026-10-15-dsh-engine-acp（verify 阶段实测）
> 状态：活跃坑（本次用 `SILLYSPEC_VERIFY_LINT_GATE=advisory` 逃生口收口，待工具修复）

## 现象

verify 阶段 lint 实测失败，但失败文件与本次变更**零交集**（全是他人已归档变更的存量债），
两条路径行为分叉：

- `sillyspec run verify --done`（gates.js 拦截面）：有「失败提及文件 × 本变更文件集零交集 →
  pre-existing 降档 advisory」自动通道，理论上会放行；
- `sillyspec run verify` step6「noAI 质量扫描」（verify-quality-scan.js 路径）：**同一失败直接
  throw**「noAI 质量扫描实测测试失败——本步骤未完成」，不降档，verify 卡死不能推进。

本次实例：主仓 mypy 3 处错误全在已归档并行变更
`2026-10-15-group-cross-mention-visibility` 的文件（`delegation_notice.py:136`、
`test_group_bridge_projection.py:1031/1032`），与本变更 30 文件零交集；step6 硬拦，
只能设 `SILLYSPEC_VERIFY_LINT_GATE=advisory`（审计留痕档）收口。ruff/ruff-format/frontend
pnpm lint/daemon typecheck 四段实跑全绿，失败面仅 backend mypy 上述 3 行。

## 根因

- 归因降档逻辑 `triageLintOwnership` 只接线在 `src/run/gates.js` 的 --done 拦截面
  （约 :1395-1410：`lintOwnership.verdict === 'pre-existing'` 才降档）；
- `src/run/verify-quality-scan.js`（step6 质量扫描）只做二值判定：
  `printVerifyLintCheck`（:776）→ `const lintBlocked = shouldBlockVerifyLint(lintCheck)`
  （:800）→ `if (testFailed || lintBlocked) ... throw`（:820）——**没有任何 triage 调用**；
- 附排除项：`triageLintOwnership` 本体对反斜杠路径已做归一（`norm` =
  `replace(/\\/g,'/')` + 宽松双向 `endsWith` 匹配，约 :221-231），mypy 输出的
  `app\modules\...` 形态**不是**本问题原因（本次曾疑反斜杠解析，读码排除）。

## 复现

1. 造一个零交集 lint 债：在主线留一处 mypy 错误（或引用已归档变更的存量债，如上述 3 行）；
2. 让某变更的 commands.lint 走到 backend mypy 段失败；
3. `sillyspec run verify --change <变更>`（进 step6）——即便失败行全为他人文件，
   也 throw「noAI 质量扫描实测测试失败——本步骤未完成」，无降档；
4. 对照：同失败在 `--done` 的 gates 路径会先印 ❌（`printVerifyLintCheck` 硬门措辞）、
   随后 triage 降档 warning 放行——可观察差异 = step6 是否 throw。

## 建议修法

1. 把 gates.js 的 triage 降档块抽为共享 helper（如
   `decideLintOwnershipBlock({ cwd, changeName, specBase, lintCheck, platformOpts })`），
   gates.js 与 verify-quality-scan.js 两处同接线：`pre-existing` → 打印降档 warning + 不 throw
   （对齐 --done 口径）；`owned`/`unattributable` 维持 throw（保守语义不变）；
2. `printVerifyLintCheck` 目前按「env 档位」而非「终判结果」选措辞（gates 路径先印
   「已阻断」再降档，agent 易误判 CLI 抽风）——抽 helper 后按终判档位分支措辞；
3. 可选：把「零交集存量债」的摩擦计数（friction event）与降档联动，供存量债清偿排期。

## 处置记录（2026-10-16）

**已修（按坑内建议①共享 helper）**（sillyspec `2026-10-15-lint-triage-path-unify`，
并行会话落地，本日复核验证）：新增 `src/run/lint-ownership.js` 的
`lintOwnershipDowngrade`（判定 + 文案收敛单源）——gates.js --done 路径与
verify-quality-scan.js step6 noAI 路径**双接线**，零交集存量债降档 advisory 不 throw，
owned/unattributable/鉴定异常维持硬拦（保守）；仅 lint 单独失败时降档（testFailed
优先）。建议②（按终判档位分支措辞）随 helper 文案收敛一并解决；建议③（摩擦计数联动）
已在接线中（recordFrictionEvent 与 throw 解耦）。

**测试**：`lint-ownership-failfast` 21/21（3e 源级锚随契约更新钉 helper 双接线）+
`lint-ownership.test.mjs` 5/5 绿。归档。
