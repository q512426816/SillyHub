# wt-commit / platform sync 后 tasks.md 未完成任务被自动勾选

> 记录时间：2026-10-15 · 来源变更：2026-10-14-admin-server-status（execute Wave1/2 实证）
> 状态：活跃坑（人工核对绕过可靠，待工具修复）

## 现象

execute 阶段主代理直写模式（execution_mode=main）下，`sillyspec wt-commit`（或随后的
`sillyspec platform sync`）执行后，变更目录 tasks.md 中**尚未实现**的后续 task checkbox
被自动改为 `- [x]`（完成态）——与事实不符。

生产实证（2026-10-14-admin-server-status）：
- task-01 wt-commit（cbcfed76）+ platform sync 后，task-02/03/04 三条未实现任务全部被勾 `[x]`；
- 纠正后 task-03 收尾时再次发生（task-04 被提前勾选），二次人工纠正。

## 影响

- execute 批量完成判定失真：CLI「tasks.md 所有 checkbox 已勾 → 一次性补完剩余 step
  直达阶段完成」的批量收口会把未实现任务误判完成，绕过 Task Review/Gate 核验；
- 中断续跑判据污染：「已勾 [x] 的 task 已完成，跳过不重跑」——续跑会跳过未实现任务。

## 根因（推测）

wt-commit / platform sync 路径上存在按「wt-commit 次数或当前 Wave 序号」批量前推
checkbox 的自动勾选逻辑（autoCheckPlanFromReviews 类），未以「该 task 的 review.json /
实现产物存在」为勾选事实锚，把同 Wave 甚至后续 Wave 的任务一并勾掉。

## 绕过

每次 wt-commit / platform sync 后立即 Read tasks.md 核对：被提前勾选的未实现任务改回
`- [ ]`（本变更两次实证纠正有效，不影响流程推进）；execute 收口 --done 前再全文核对
一遍勾选与实际 commit 一一对应。

## 修复建议

自动勾选以每 task 的实现事实锚（review.json verdict=pass 或 worktree 内该 task
allowed_paths 的 commit 存在）为判据；无锚不勾。

## 处置记录（2026-10-15）

**已修（按坑内建议）**（sillyspec `2026-10-15-pitfall-batch-clearance`，归档 a493aef1）：
自动勾选重构为 `autoTickTasksFromCommitSubjects`——判据 = subject token × allowed_paths
**实现事实锚**（该 task 声明路径在区间提交确有触及），无锚不勾；后续 Wave 未实现任务不再
被 wt-commit/platform sync 连带提前勾选。execute 批量收口与中断续跑判据恢复与事实一致。
坑内人工核对绕过继续有效作兜底。归档。
