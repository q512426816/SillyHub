---
author: qinyi
created_at: 2026-07-28 23:22:06
---

# 坑:worktree 模式下 verify CLI 对账回退全量 commands.test 必然阻断

> **✅ 已解决（2026-07-30 移 finished）**：三个修复方向均已落地源码 + 真实 git fixture 测试全绿（`test/verify-postcheck-worktree.test.mjs` 4 场景 + `test/verify-postcheck-known-failures.test.mjs` 29），且已发布 **v3.25.5**。作者原定「待真实 worktree verify 实测确认」的 fixture 级实测已满足；端到端留待真实 multi-agent-platform worktree 使用中确认（若复现可重开新坑）。下方为原始记录。

> 状态:**活跃坑**,待 sillyspec 工具修复。首次踩中:change 2026-07-28-ppm-project-link-workspace(verify 阶段)。
>
> **状态更新（2026-07-29 核对+全量修复源码，三个方向均已落地；截至 v3.25.4 未发布）**：
> - **方向 1（对账 worktree-aware）**：`runVerifyTestCheck` 经新增 `resolveVerifyChangedFiles`（与 `checkExecuteCodeEvidence` / task-review 同源读 worktree meta.json），在 change 有 worktree meta + baseHash 时于 worktree 跑 `git diff <baseHash>..HEAD` 取真实代码改动集 → 命中模块子集而非回退全量；无 worktree meta 时回退主仓原行为（brownfield 不变）。
> - **方向 2（known_failures 豁免）**：local.yaml 支持 `known_failures:` 声明预存失败（块式/流式）。exit≠0 时按行检测失败标记（FAILED/✕/✗/panic/AssertionError/Traceback/---FAIL/Error:/Exception），排除 summary 计数行（"N failed"/"Tests:"/`=== ===`），全部命中豁免则判 PASS 并披露「请人工复核清单」；**fail-safe：检测不到失败行绝不自动 pass**（避免解析盲区假 PASS）。
> - **方向 3（0 命中人工出口）**：新增 `decideVerifyTestAction`——module 模式 0 命中不再静默回退注定超时/预存失败的全量，改为 `skipped`（不阻断 gate）+ 明示「据 verify-result.md 自报告判定；想跑全量请显式设 test_strategy: full」。
>
> 覆盖测试：`test/verify-postcheck-worktree.test.mjs`（4）+ `test/verify-postcheck-known-failures.test.mjs`（29）+ 既有 `verify-postcheck-module.test.mjs`（33）。待真实 worktree verify 实测确认（命中子集、不再回退全量、known_failures 豁免生效）后移 `finished`。

## 现象

verify 阶段最终 `--done` 时,CLI 亲自执行 local.yaml 测试命令与 verify-result.md 对账(`verify-postcheck.js runVerifyTestCheck`)。在 worktree 隔离模式下:

1. 对账的 `cwd` = sillyspec 命令运行目录 = **主仓**(非 worktree)。
2. `test_strategy: module` 时,CLI 在主仓跑 `git diff --name-only HEAD` 判定命中哪些 `modules.path`,命中才走子集(`runModuleSubset`),否则回退全量(`runFullCommand` 跑 `commands.test`)。
3. **本变更代码全在 worktree 且已 commit**,主仓 `git diff HEAD` 只剩 `.sillyspec/` 文档改动(不命中任何代码模块 path)→ **hitCount=0 → 回退全量 commands.test**。
4. 全量 `commands.test` = backend `uv run pytest -q`(monorepo 全量,~12min):既超 `SILLYSPEC_TEST_TIMEOUT_MS`(默认 600s),又含 ppm/plan 等**预存失败**(他人模块,与本变更无关)→ exit≠0 → `testCheck.status==='failed'` → **gates.js 阻断 verify 完成**。

结果:一个测试明明全绿(子模块 618 passed + 前端 1146 passed)的变更,verify 收尾被工具机制卡住,无法 `--done`。

## 根因

sillyspec 的 verify 对账设计假设「代码在主仓工作区有改动」(brownfield),与 execute 阶段的 **worktree 隔离**(代码在 `.sillyspec/.runtime/worktrees/<change>/`,主仓干净)相矛盾。worktree 模式下主仓 `git diff HEAD` 永远命不中代码模块,`test_strategy: module` 的子模块规避路径(memory `sillyspec-324-verify-archive-pitfalls` 提到的「main backend 全量预存 errors 用子模块粒度规避」)在 worktree 模式下**不成立**。

相关源码:
- `src/verify-postcheck.js`:`runVerifyTestCheck`(cwd=主仓)、`gitChangedFiles`(`git diff --name-only HEAD`)、`pickHitModules`(path 前缀匹配)、`computeFullFallbackReason`(hitCount=0 → 回退全量)。
- `src/run/gates.js:172-181`:verify stage `testCheck.status==='failed'` → `rollbackCompletionAndReturn` 阻断。

## 加重因素:worktree apply 也被 baseline 漂移阻断

想「先 apply 把代码合进主仓」也不行:`sillyspec worktree apply` 校验「主工作区 baseline 已变化(execute 前后不一致)」时拒绝直接 patch apply(execute 期间改了元数据/plan checkbox/design 等致 baseline 漂移,见 memory `sillyspec-execute-worktree-pitfalls`)。且即便 apply + commit 进主仓,主仓 `git diff HEAD` 仍为空,对账**仍回退全量**——apply 不解决对账根因。

## 本次绕过方案(用户决策:记为工具坑,人工判 PASS)

经用户确认(2026-07-28):**不自行规避门控**,verify 按实测证据人工判 PASS,对账阻断项如实记录到 verify-result.md 后继续 archive 流程。

实测证据(本变更):
- 后端 workspace+ppm 子集 `uv run pytest app/modules/workspace app/modules/ppm -q --no-cov` = **618 passed, 2 failed**(2 失败 ppm/plan pre-existing,main HEAD 同样失败 + 本变更 git diff ppm/plan 为空)。
- 前端 `pnpm test` = **1146 passed**。
- ruff/mypy/tsc/lint 全绿。

## 建议 sillyspec 修复方向

1. **对账 cwd 改用 worktree**:verify 对账应在 change 的 worktree 目录跑 `git diff`(那里有真实代码改动),而非主仓;或支持 `git diff <baseline>..<worktree-head>` 取变更全量文件集判定命中模块。
2. **全量 commands.test 支持预期失败/排除标记**:local.yaml 允许声明 `known_failures`(预存失败用例)或 `exclude_paths`,对账时从失败集里剔除预存项再判定。
3. **timeout 与全量解耦**:`test_strategy: module` 且 0 命中时,不应静默回退到一个注定超时+预存失败的全量,应显式报「无法判定变更范围」并给出人工确认出口,而非直接判 failed 阻断。

## 验证工具修复后如何确认

修复后,对一个代码在 worktree 的变更跑 verify:CLI 对账应命中 worktree 的代码模块子集(如 workspace/ppm/frontend),跑子模块 test 通过 → 不再回退全量、不再被预存失败/timeout 阻断。确认后把本文件移到 `docs/sillyspec/finished/`。
