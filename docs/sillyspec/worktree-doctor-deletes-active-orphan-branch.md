# worktree doctor --fix 会把「活跃变更的分支」当孤儿删除（元数据竞态）

- 发现日期：2026-08-20（变更 2026-08-20-runtime-readpoint-repo-first execute Step12）
- 状态：活跃（已发生一次误删并即时恢复，待工具修复）

## 现象

`2026-08-20-frontend-ai-native-style`（**另一并行会话正在进行中的变更**）的分支
`sillyspec/2026-08-20-frontend-ai-native-style` 被 `sillyspec worktree doctor --fix`
（全局模式）判定为 `orphan-branch（无对应 meta）` 并删除——而该变更的 worktree
目录与 meta.json **当时都存在且活跃**（doctor 同一次运行还刚给它 re-provision 过
deps，自相矛盾）。

时间线（本机 2026-08-20 11:35 实测）：
1. 并行会话在其 worktree 正常 commit（tip=f0939936，11:35:32）；
2. 本会话跑全局 `worktree doctor --fix` → `deleted orphan branch: sillyspec/2026-08-20-frontend-ai-native-style`；
3. 一分钟内该分支被（并行会话侧工具/人工）重建回 f0939936，损伤自愈。

## 根因推测

doctor 的孤儿分支判定与活跃 worktree 注册表存在竞态/判定缺口：worktree list 能列出
该变更（有 meta、有目录），orphan-branch 检查却认为无对应 meta。两者数据源不一致
（可能一个读 worktrees/ 目录、另一个读独立注册文件，或 meta 读写有时序窗口）。

## 影响

- worktree 目录的**文件不丢**（worktree 是磁盘检出，删分支不动文件）；
- 丢的是分支上的 commit 历史（baseline checkpoint、阶段 checkpoint），后续
  `worktree apply --3way` 与 task review.json 的 commit 引用会悬空。

## 绕过与建议

- 多会话并行时**避免全局 `doctor --fix`**，始终带 `--change <名>` 限定作用域；
- 误删可用 `git reflog --all | grep <分支名>` 找回 tip 后 `git branch <名> <tip>` 恢复；
- 建议工具修复：orphan-branch 判定必须交叉核对「worktrees/ 目录 + worktree list
  注册表 + 分支最近提交时间（如 10 分钟内有 commit 一律不删）」三源，且默认改为
  只报告不自动删（--fix 显式加 --delete-branches 才删）。
