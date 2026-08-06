---
author: qinyi
created_at: 2026-08-05 19:40:00
status: 活跃坑（待 sillyspec 工具修复）
---

# execute worktree baseline overlay 读 untracked 目录 EISDIR 失败

## 现象
跑 `sillyspec run execute --change <名>` 创建 worktree 时失败：
```
❌ worktree 创建失败: baseline overlay 失败 (2 个错误):
   untracked .worktrees/300a6fb9/: EISDIR: illegal operation on a directory, read
   untracked .worktrees/45b7d3bc/: EISDIR: illegal operation on a directory, read
```

## 根因
- 主仓库根目录有 untracked 的 `.worktrees/<hash>/` 目录（Claude Code 的 Agent 工具 `isolation: worktree` 创建的 agent worktree 残留，branch `workers/<hash>`）。
- execute 的 baseline overlay 机制会把"未提交文件"同步到 execute worktree；它把 `.worktrees/<hash>/`（目录）当**文件**读取（`fs.readFile`），目录报 `EISDIR`。
- `.gitignore` 原本只忽略 `.claude/worktrees/` 和 `.sillyspec/.runtime/worktrees/`，没忽略根目录 `.worktrees/`（Claude Code agent 隔离目录），所以它出现在 untracked。

## 绕过（已应用，2026-08-05）
根 `.gitignore` 加一行 `.worktrees/`（Claude Code agent worktree 临时隔离目录本就该忽略）。加完后 `.worktrees/` 不再 untracked，baseline overlay 跳过，execute worktree 创建成功。

## 改进建议（给 sillyspec 工具）
1. baseline overlay 同步 untracked 时**跳过目录**（或用 `fs.stat` 先判类型，目录走 `cp -r` 或跳过），不要裸 `readFile` 目录。
2. 或自动忽略常见 agent worktree 目录（`.worktrees/` / `.claude/worktrees/` 等）。
3. 错误信息把"EISDIR on directory"翻译成"跳过目录 X"而非整体失败。

## 关联坑：worktree deps lockfile mismatch
同一机制副作用：baseline overlay 把主仓库**未提交的 `pnpm-lock.yaml`** 同步到 execute worktree，导致 worktree 的 lockfile 与 main 不一致（`worktree doctor` 报 `frontend`/`sillyhub-daemon` lockfile mismatch），`depsStatus=unknown`、provisioning 卡住。
- 绕过：续作前 `sillyspec worktree doctor --fix` 重新装依赖对齐 lockfile。
- 改进建议：baseline overlay 不应同步 lockfile（或同步后自动触发 deps 重供给），避免 worktree deps 与 main 漂移。

## 相关 change
`2026-08-05-daemon-kill-channel-unify`（execute step 5 暂停，待新 session 续）。memory `daemon-kill-channel-change.md`。
