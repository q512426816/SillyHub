# verify 证据账 diff 核验对「execute 期已提交」的代码文件必然 miss

- 状态：活跃坑（2026-09-13 实证，待工具修复）
- 影响版本：SillySpec v3.28.x verify `--done` 门控

## 现象

verify `--done` 的 cannot_verify 证据账核验：代码类 verifiedFiles 走「存在 × mtime × **本变更 git diff** 交集」，
而该 diff 取的是**工作树未提交变更**（status-porcelain / diff HEAD 方向）。本变更（2026-09-12-session-live-display-fixes）
代码在 execute 阶段按 wt-commit 流程精确路径提交后，7 个 task 的代码/测试文件全部
`filesExist=true mtimeOk=true diffHit=false`，satisfied 一律核验不过，verify 连续两次被阻断。

## 根因

证据账的 diff 口径与 wt-commit 的产出形态错配：execute 正常流程把改动提交进主仓，
工作树随即干净；verify 期 `git diff`（工作树视角）只剩并行会话噪声，本变更文件永不命中。
同一会话的 scope-audit.patch（冻结 sha256 锚）里其实**包含**这些文件，但证据账核验没有消费它。

## 护栏（当前绕过方案）

- 官方豁免通道可用：`- task-NN: missing（豁免：<一句话理由>）`，理由写明「代码已按 wt-commit 提交，
  落点由 scope-audit.patch 锚与 git log 佐证」即可过门。体验摩擦：需要两轮 gate 回滚试错才能发现该口径。
- 文档/日志类 verifiedFiles（.sillyspec/ 下的 evidence 等）豁免 diff，可正常 satisfied。

## 修复建议

证据账核验的 diff 基线改为「execute --done 冻结的 scope-audit.patch 文件集」或
「change 基线 commit..HEAD」，与 wt-commit 产出形态对齐；工作树 diff 仅作 advisory 提示。

## 证据

- gate 阻断原文：`frontend/.../session-log-assembler.ts [code] 不在本变更 git diff 内（filesExist=true mtimeOk=true diffHit=false）`（7 task × 逐文件）
- 本仓 `.sillyspec/changes/2026-09-12-session-live-display-fixes/verify-result.md` 证据账节的豁免登记
- 同会话 scope-audit 冻结窗口 23 文件（含全部被拦文件）

## 处置记录（2026-09-15 定时收口，已修复归档）

- **修复**（sillyspec 仓 `src/verify-postcheck.js resolveMainChangedFiles`，工作区未提交）：worktree 侧 `diffBase..HEAD` 与**主仓同区间** diff 求并集——wt-commit 把本变更提交落在主仓 HEAD、worktree 分支不前移，仅查 worktree 侧必然 miss（本坑 7 task 连环假红根因）；主仓区间含并行会话提交，过 `splitOwnVsForeignDiffFiles` 他者声明过滤（best-effort，已提交且声明沉寂的他者文件可能共存窗口——可接受：证据账 verifiedFiles 由 agent 按 task 边界声明，存在性+mtime 门仍在）。主仓查询失败不损原 worktree 结果（fail-soft）。
- **测试**：新增 `test/verify-evidence-committed-diff.test.mjs`（真实 git 主仓+worktree：wt-commit 形态提交落主仓 → diff 集命中；并集不丢自己文件且集合有界）2/2 绿；verify 全家回归 69 用例零失败。
- 官方豁免通道（`- task-NN: missing（豁免：…）`）保留为真不匹配场景的出口；本坑形态（正常 wt-commit 后被误拦）不再需要豁免。归档。
