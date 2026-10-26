---
name: sillyspec:push
description: 推送前压扁本地未推送提交并快进推送。适合用户说“推送 / push / 推到远端 / 发布 / 同步 origin / 把这堆中间提交整理一下”。默认按连续变更段压扁（by-change），可选 --mode one 合并为一笔；只改写本地未推送段，禁止改写已推送历史、禁止 force-push、禁止直接 git push。
argument-hint: "[--mode by-change|one|none] [--change <名>] [--dry-run] [--no-push] [--undo] [--remote <名>] [--branch <名>] [--json]"
---

## 交互规范
当需要用户从多个选项中做出选择时，必须使用 Claude Code 内置的 AskUserQuestion 工具，将选项以参数传入。真实推送前必须先展示 `--dry-run` 计划并取得用户确认。

## 何时使用
- `flow done` / `archive` 收口、提交完成后，准备推送到远端。
- 用户说“推送 / push / 推到 origin / 发布 / 同步远端 / 把中间提交压扁”。
- 本地有多个 `task-NN`、wip、fix、归档提交，需要整理成可审阅的历史。
- 不适用：改写已推送历史、他人分支未授权改写、平台进度同步（那是 `sillyspec platform sync`，不是 git push）。

## 用法
- `sillyspec push` — 默认 `--mode by-change`：连续且归属同一变更的提交压成一笔，其余原样保留。
- `sillyspec push --mode one --change <名>` — 所有未推送提交合并为一笔（有活跃变更时拒绝）。
- `sillyspec push --dry-run` — 只输出计划，不改写 ref/index/工作区/远端。
- `sillyspec push --no-push` — 只压扁，不推送。
- `sillyspec push --undo` — 推送前恢复最近一次压扁；远端已更新时拒绝。
- `sillyspec push --remote origin --branch <分支> --json` — 显式远端/分支/机器输出。

## 流程
### 1. 预检（只读）
```bash
git status -sb
git log --oneline --decorate @{u}..HEAD
sillyspec push --dry-run
```
- 无 upstream、detached HEAD、merge commit、staged 改动、cwd 在 worktree 内 → 先停下说明原因。
- 展示：目标远端/分支、base、每个分段（变更名、旧范围、新 subject）、保留的无关提交、是否快进、pre-push 会跑什么。

### 2. 用户确认
AskUserQuestion：确认执行 / 改为 `--mode one --change <名>` / 取消。
用户未明确同意，不执行真实推送。

### 3. 执行
```bash
sillyspec push
# 或
sillyspec push --mode one --change <名>
```
- CLI 自动：文件锁、pre/post 备份 ref、`commit-tree`、树等价校验、CAS `update-ref`、普通快进 push。
- pre-push hook 失败：修复 lint/docs gate 后重跑；禁止 `--no-verify`。

### 4. 汇报
- 旧 → 新 SHA、远端 ref、备份 ref、压扁段数、`--undo` 命令。
- 若 push 失败：本地压扁保留，按提示重试或 `--undo`；不要手工 `reset`。

## 模式与守卫
- `by-change`：只合并连续同归属段；subject 必须保留 `(<变更名>)`，body 保留全部 `task-NN` 证据。
- `one`：必须 `--change`；区间含其他活跃变更归属时拒绝。
- 拒绝：base 非 HEAD 祖先、区间含已推送提交、merge commit、staged 改动、active worktree、CAS 并发失败、远端分叉。
- 活锚点：scan `source_commit`、活跃 `baseline_commit`、change-patch、worktree meta 会自动抬升 effectiveBase；不要手工越过它们。

## 绝对规则
- ❌ 不要直接 `git push` / `git push --force` / `git push --force-with-lease`。
- ❌ 不要手工 `git reset --soft` + `git commit` 压扁（会卷入共享暂存区）。
- ❌ 不要改写已推送历史；base 非祖先一律停下让用户先 pull/rebase。
- ❌ 不要 `--no-verify`，不要跳过 pre-push hook。
- ❌ 不要在 staged 改动未处置时运行；不要动其他会话的未提交文件。
- ❌ 不要在 SillySpec worktree cwd 内压扁；先 `worktree apply` 回主仓再推送。
- ✅ 不确定时先 `--dry-run`；失败用 `--undo` 恢复，不手改 ref。

## 多会话与并发
- 在主仓根运行；每条命令带 `SILLYSPEC_SESSION_ID=<agent名+任务名>`。
- CLI 用 `<git-common-dir>/sillyspec-push.lock` 串行化，分支用 CAS 更新；锁只约束走 `sillyspec push` 的进程。
- 共享暂存区可能有其他会话的 staged 文件：检测到即拒绝，不要替别人提交或清理。

## 故障排查
- 无 upstream → 先 `git push -u origin <branch>` 一次，再重跑。
- base 非祖先 / 远端领先 → 人工 fetch + rebase/merge，不自动 force。
- pre-push hook 失败 → 修 lint/docs gate，不跳过。
- CAS/锁失败 → 重跑 `--dry-run` 重新计划；确认无并发 push 后再执行。
- 已推送后想整理 → 不在本命令范围；需要团队明确同意后人工 force-with-lease。

## 用户指令
$ARGUMENTS
