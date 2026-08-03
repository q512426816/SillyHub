---
author: WhaleFall
created_at: 2026-08-03 11:19:26
status: 活跃坑（待工具修复）
severity: P0
---

# execute 阶段 --done 后状态重置 + db project 名污染 + .runtime 清理

> 变更 `2026-08-03-session-stream-partial-revoke` 实跑踩到。代码不受影响（git commit 永久），但过程产物丢失 + sillyspec 流程状态崩。

## 现象

execute 阶段推进到 step 9（知识库审阅），执行 `sillyspec run execute --done --change <变更名> --output "..."` 后：

1. **execute 重置回 step 1**：`sillyspec run execute --status` 显示 `Step 1: 进度确认 ✅ / Step 2: 加载上下文 ← 当前`，`progress show` 显示新 execute run（`开始: 2026/8/3 11:17:10`），原 exec-2026-08-03-103337 run 的进度丢失。
2. **db project 名被污染**：`progress show` 顶层 `项目: (未命名)` + `当前阶段: 代码扫描`（实际应是 SillyHub + execute 波次执行）；`sillyspec run execute` 输出 `project: <变更名>`（把变更名当 project 名）。
3. **.runtime 过程产物被清理**：`.sillyspec/.runtime/execute-runs/`、`stage-reviews/`、`worktrees/<变更名>/` 目录全没了，只剩 `sillyspec.db` + `sillyspec.db.bak`。所有 task review.json、stage review.json（brainstorm/plan/execute）丢失。
4. **worktree 目录被删但 git 注册残留**：`git worktree list` 仍列 `<变更名> worktree defe47e2`，但目录 `No such file or directory`（prunable）。
5. **主仓库被 checkout 到 sillyspec/<变更名> 分支**（原应在 main），工作区只剩 `meta.json` 一处 sillyspec 噪声改动。

## 根因（推测）

- 多变更环境下 `sillyspec.db` 状态不一致（本项目累计 164 个活跃变更 + 多个僵尸变更）。
- execute `--done`（step 9 知识库审阅）触发了某种错误的「清理 + 重置」路径：疑似把 worktree apply 回主仓库（主仓库 checkout 到 sillyspec 分支）+ 清理 .runtime 子目录 + execute 重启新 run。
- db 的 project 表记录被写成了变更名（project 名污染）。

## 影响

- **代码不受影响**：所有 task commit 在 git 分支 `sillyspec/<变更名>` 里（永久），主仓库工作区 = 实现代码。
- **过程审查产物丢失**：task review.json、stage review.json 全没（但这些是过程产物，可从 git diff + 测试重建）。
- **sillyspec 流程无法正常收尾**：execute 状态乱，verify/archive 阶段难以接续（db 不一致）。

## 绕过方案（已验证）

1. **代码安全**：`git log --oneline` 确认 task commit 在分支；主仓库工作区即实现代码（HEAD=分支头）。
2. **修复 db 状态**：跑 `sillyspec doctor --change <变更名>`（5 步，但 doctor 自身也会读到污染的 project 名，需手动核对）。或直接接受流程中断，靠 git + 测试确认代码质量。
3. **过程产物可重建**：review.json 是过程产物，丢失不影响代码正确性（测试是真相）。
4. **主仓库回 main**：`git checkout main` + 决定是否 merge `sillyspec/<变更名>` 分支。

## 待工具修复

- execute `--done` 不应在 step 9（知识库）触发整个 execute 重置 + .runtime 清理。
- db project 名不应被污染成变更名（多变更隔离失效）。
- worktree apply 回主仓库应是显式动作（`sillyspec worktree apply`），不应在 `--done` 时静默执行 + 清理 worktree。
- doctor 在 db 已污染时应能识别 project 名异常并修复。

## 复现

变更 `2026-08-03-session-stream-partial-revoke`：brainstorm（8步）+ plan（5步）+ execute step 1~9 全正常，唯独 `--done step 9`（知识库审阅）触发状态崩。怀疑与 task-09 `cannot_verify`（实跑任务无代码改动、changedFiles 空）+ 多变更 db 状态有关——但未最终确诊。
