---
author: qinyi
created_at: 2026-07-05 02:00:00
---

# SillySpec 工具使用坑 (sillyspec-gotchas)

> SillySpec CLI（brainstorm/plan/execute/verify/archive）使用中踩过的坑。多为工具行为或 worktree 隔离机制导致，与业务代码无关。
> 部分坑伴随工具版本演进可能已修复，条目内标注的版本/日期为踩坑时点。

## execute 启动前主仓库规范文件必须 commit（worktree apply 前提）

`sillyspec run execute` 创建 worktree 时，baseline = 主仓库当前 HEAD + overlay（staged 文件）。若 brainstorm/plan 产出的规范文件（proposal/design/plan/tasks）staged 未 commit，`sillyspec worktree apply` 陷死循环：apply 第一校验要主仓库 clean（staged commit/stash），但 commit 规范使 HEAD 推进 → base hash 校验失败；stash 规范则 overlay 的 plan.md 在主仓库不存在 → patch 失败。

- 正确做法：**execute 启动前先把规范文件 commit**（主仓库 clean），再 run execute（worktree baseline 基于规范已 commit 的 HEAD，apply 时主仓库 = base，校验通过）。
- 来源：2026-06-25-admin-users-org-tree 因 execute 前规范未 commit 致 worktree apply 失败，改用 worktree→主仓库手动 cp（改动经 task 测试验证后 cp），属 workaround。

## execute 的 worktree 基线不含未提交改动

`sillyspec worktree create` 从最新 commit（HEAD）干净 checkout，**不包含主工作区里 staged/未提交的改动**。如果上一个变更（如 quick 流程）的代码改动只 `git add` 未 commit，worktree 里看到的是改动前的旧版文件。

- 后果：execute 子代理在 worktree 内基于过时基线实现，可能写出与已存在（但未提交）改动冲突、甚至撤销前序成果的代码。
- 规避：execute 前确认相关前序改动已 commit；发现基线不符时在**主工作区**（正确基线）重做改动、worktree 仅作隔离参考。审查子代理产出时务必对比主工作区当前真实文件，不要盲信子代理"按蓝图实现"的报告。

## SQLite PRAGMA foreign_keys 默认关闭致 CASCADE 失效（清理孤儿变更）

`.sillyspec/.runtime/sillyspec.db` 的 stages/steps 表虽声明 `REFERENCES changes(id) ON DELETE CASCADE`，但 SQLite 默认 `PRAGMA foreign_keys=OFF`，`DELETE FROM changes` **不会**级联删 stages/steps，残留孤儿行。

- 清理孤儿变更记录时必须手动按外键依赖顺序：先 `DELETE FROM steps WHERE stage_id IN (SELECT id FROM stages WHERE change_id=X)`，再 `DELETE FROM stages WHERE change_id=X`，最后 `DELETE FROM changes WHERE id=X AND name='...'`（双条件防 id 复用误删）。
- 验证：`SELECT COUNT(*) FROM stages WHERE change_id=X` 应为 0，`SELECT COUNT(*) FROM steps WHERE stage_id IN (SELECT id FROM stages WHERE change_id=X)` 应为 0。

## plan/execute 子代理可能把 CWD 设到变更目录，产生嵌套 .sillyspec 副作用

- 现象：`.sillyspec/changes/<change>/.sillyspec/.runtime/sillyspec.db` 出现二级 runtime（含独立 db/wal/shm/artifacts/user-inputs.md），与根目录 `.sillyspec/.runtime/` 重复。
- 成因：plan/execute 某些步骤的子代理或命令把工作目录设到了变更目录内，sillyspec 在那里又初始化了一个 .runtime。
- 影响：归档时会带入垃圾；两个 sillyspec.db 容易混淆哪个是活跃的。
- 排查：对比两个 db 的最后修改时间，最新修改的是活跃 DB；plan 阶段时间戳的是死 DB。
- 处理：`rm -rf .sillyspec/changes/<change>/.sillyspec`（确认非活跃后）；知识库审阅阶段务必检查变更目录是否干净。

## execute worktree 内跑 pnpm 后 Bash cwd 持久，致 sillyspec 命令在子项目上下文重置

- 现象：execute Wave 验证时 `cd {worktree}/frontend && pnpm typecheck/test`，之后 `sillyspec run execute --done` 在 worktree/frontend 子目录运行，CLI 检测到 frontend 子项目，**重新初始化 execute**（project 由 multi-agent-platform 变 frontend、steps 数变化、从 Step 1 重开），主仓库 progress 未记录该 Wave 完成。
- 根因：Bash 工具 cwd 在调用间持久；sillyspec 命令对 cwd 敏感——在 worktree/frontend（子项目根）跑会切到该子项目上下文。
- 规避：worktree 内只跑 `pnpm`/`rg`/`git`（测试/验证），**所有 sillyspec 命令（`run`/`--done`/`progress`）必须在主仓库根 cwd 跑**；每次 `cd {worktree}/frontend` 后下一条 sillyspec 命令前显式 `cd 主仓库根`。
- 关联记忆：sillyspec 必须在根运行（[[sillyspec-must-run-at-repo-root]]）。

## execute worktree 无 node_modules + 子代理 cwd 需显式 worktree 路径

- SillySpec execute 的隔离 worktree（`.sillyspec/.runtime/worktrees/<change>`）是 baseline 快照，**不含 node_modules**（gitignore），worktree 内无法直接跑 tsc/vitest/lint。
- 解法：PowerShell `New-Item -ItemType Junction` 把主仓库 `frontend/node_modules` 链到 `worktree/frontend/node_modules`（junction 免管理员，比 `cmd mklink /J` 引号嵌套更稳）。
- Agent 子代理 cwd 可能**不随父 session 的 EnterWorktree 切换**（子代理可能把产物写到了主仓库而非 worktree）。解法：子代理 prompt 显式给 worktree 绝对路径前缀；审查用 `git status` + `ls worktree` 确认落点，错位则 `cp` 统一到 worktree + 主仓库 `git checkout` 恢复。

## plan→execute contract：task 编号须严格按拓扑 Wave 递增

- 现象：plan.md 按 brainstorm 的 Wave 分组时，task 编号与拓扑 Wave 顺序冲突，contract 校验报「task id 重复/不连续」。
- 根因：SillySpec execute contract 校验器按 plan.md 文本里 `task-0N` 出现顺序期望严格递增，且把任务总表的 `task-0N` 引用也计入。若 task 编号不按拓扑 Wave 递增（如 W2 含 task-06 而 W3 是 task-04），校验失败。
- 解法：①task 文件编号按拓扑 Wave 严格递增（W1=01,02..; W2=03,04..; 不回跳）；②plan.md 里 `task-0N` 仅保留在 Wave checkbox 行，任务总表/关键路径/AC/覆盖矩阵用纯数字编号（01/02）不带 task 前缀；③AC 行不要用 `- [ ]` checkbox 格式（会被误当 task 行）。
- 同类 SillySpec 校验工具缺陷见 `docs/sillyspec/finished/`（supersede 校验误报等）。

## execute 的 exec-run ID 可能复用旧目录，review.json 残留需先 Read 再覆盖

`sillyspec run execute` 的 exec-run ID（如 `exec-2026-06-24-100156`）可能复用旧变更的 execute-runs 目录，导致 `tasks/task-XX/review.json` 是**旧变更的残留**（changedFiles/reviewerNotes 是旧变更的）。

- 写 review.json 前必须先 Read（发现残留）再 Write 覆盖，否则 Write 报 `File has not been read yet`。残留会误导后续审查。

## plan postcheck 多变更环境校验错变更（progress.json 空 + sort reverse）

- plan step 4 postcheck 的 `resolveChangeDir` 读空 `progress.json` → 回退 `sort().reverse()` 取字典序最大目录（`workspace-*` 排在 `2026-*` 前），校验了别人的变更卡住当前 plan。
- workaround：写 `progress.json` `{"currentChange":"<变更名>"}` + task 放 `tasks/` 子目录。
- 完整根因+workaround 见 `docs/sillyspec/finished/plan-postcheck-multi-change-bug.md`。
