# verify reconcile 对账基点取立项时点，主仓并行演进被误圈为 undeclared

- 记录日期：2026-10-10
- 变更：2026-10-10-workspec-maintenance（verify 阶段实证）
- 状态：活跃坑（待工具修复）

## 现象

verify `--done` 的 target_files 对账（reconcile）报 21 个「undeclared」文件，实际全部是
**其它并行变更的产出**（borrow-sandbox-workspace-context 的 daemon 文件、
live-token-speed/session-turn-token-speed 的前端文件、归档期的模块文档等）——
本变更 worktree 的 `git status`（23 条全部本变更）与 `merge-base..HEAD` diff 均不含它们。

## 根因

对账口径 `worktree:diff-base..HEAD + worktree:status-porcelain(uncommitted)` 中的
diff-base 取**变更立项时**记录的主仓 HEAD，而非当前 merge-base。变更执行期间主仓被
并行变更推进（立项点 a55a48248 → worktree HEAD 8dd6e9f32 之间合入了其它变更的提交），
对称 diff 把这段「主仓演进」算成本 worktree 的产出。severity=warning 不阻断 verify，
但 20+ 条噪声会淹没真实 undeclared 信号（本次真实归因缺口 16 文件即被混在同列）。

## 护栏建议

1. diff-base 改用 `git merge-base(main, worktree-branch)` 实时计算（或每次 execute
   启动时刷新基点），立项时点仅作 fallback。
2. undeclared 报告按「不在本 worktree status 且不在 merge-base..HEAD」二次过滤——
   两源都不含的文件直接标「主仓并行演进（非本变更）」折叠，不进对账列。
3. 「并行会话声明文件已被剔除」的剔除源建议扩展到已归档变更的 target_files
   （本次 session-turn-token-speed 已归档但其文件仍被圈入，疑似剔除只认活跃变更）。

## 证据

- `.sillyspec/.runtime/verify-runs/20261010125931/reconcile-result.json`
  （undeclared 24 条中 21 条为并行演进；sources 字段两源）
- `git -C <worktree> status --porcelain`（23 条全部本变更）
- `git log --name-only a55a48248..8dd6e9f32` 含 turn-catalog/borrow/placement 命中
