# sillyspec 平台模式 worktree execute 收尾坑（2026-07-10 remove-server-local-workspace-mode 变更实测）

## 现象
变更 `2026-07-10-remove-server-local-workspace-mode` execute 15 task 全部代码实现完成（后端 pytest 2458 passed/88.52% + 前端 vitest 837 passed/typecheck 0 error + 迁移 offline 验证 + 代码审查 passed），但 execute Step 15 完成确认被两个工具层问题阻断：

### 坑 1：worktree apply BLOCKED（baseline 漂移）
- `sillyspec worktree assess` 报 `Decision: BLOCKED`：主工作区 baseline 已变化（execute 前 `d6f499a` → 当前 `c6b9b85`）。
- 根因：execute 期间主仓库 main 推进（P3 gate `de1bbd6b`+`fab9ff6c` 两 commit）+ 主仓库工作区 dirty（`docs/sillyspec/local.yaml-gate-pitfalls.md` 移到 `finished/` 未 commit）。worktree patch 基于旧 baseline，不能干净应用。
- worktree 改动完整（127 文件未 commit 在 worktree 工作区 `.../.sillyspec/.runtime/worktrees/<change>/`），**不会丢**，但 `sillyspec worktree apply` 自动 patch 失败。
- 解法：手动 `git -C worktree add -A && git commit` 后，主仓库 `git merge sillyspec/<change>` 分支（git 合并比 patch apply 鲁棒，处理 baseline 漂移 + P3 gate vs server-local 删除潜在冲突）。

### 坑 2：Task Review Gate review.json 机制失效（平台模式 worktree）
- execute `--done` Step 15 阻断：`task-01~15 缺少 review.json — task 未经过评审`。
- 但 review.json **无处可补**：
  - `specDir/.runtime/execute-runs/` 只有 3 个**别变更**的 run（AgentSession/workspace.ts/P3 gate delegate），本次 execute run **未创建 tasks/review.json 目录**。
  - 两个 `sillyspec.db`（`specDir/.runtime/` + `specDir/.sillyspec/.runtime/`）都**空表**（无 execute_runs/reviews 表）。
  - worktree 的 `.sillyspec/.runtime/execute-runs/` 也不存在。
- 即 sillyspec 在**平台模式（specDir=~/.sillyhub）+ worktree 隔离**下，execute run 的 review.json 落盘机制完全不工作——CLI 阻断要 review.json 但工具从未创建 run 目录或 db 记录。
- 影响：execute `--done` 无法过 Step 15 gate，execute 阶段无法在工具层标记完成（代码实际已完成）。

## 建议（sillyspec 工具改进）
1. worktree apply：baseline 漂移时提供 `--merge` 选项（git merge worktree 分支替代 patch apply），或 execute 期间锁定主仓库 baseline（禁止 main 推进/dirty）。
2. review gate 平台模式：execute 启动时在 `specDir/.runtime/execute-runs/<runId>/tasks/task-XX/` 创建 review.json 模板，或 review gate 改为基于 plan.md checkbox + 测试通过（而非依赖落盘 review.json）。
3. 阻断信息明确化：CLI 阻断时给出 review.json 期望路径 + runId，而非仅"缺少 review.json"。

## 变更实际状态（2026-07-11）
- 代码实现：100% 完成（worktree 127 文件，15 task）
- 测试：全绿（后端 2458 passed/88.52% + 前端 837 passed/typecheck 0 error）
- 审查：passed（无 P0，P1-2/P2-1 已修）
- apply 主仓库：**未完成**（worktree apply blocked，需手动 git merge）
- verify 部署验收：cannot_verify（Docker e2e + 真 daemon 留部署）
