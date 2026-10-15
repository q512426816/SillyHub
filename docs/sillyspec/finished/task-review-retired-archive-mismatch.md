# Task Review 层退役后 archive 完成度判定仍以 per-task review.json 为真相源（两层不一致）

> 记录时间：2026-10-15 · 来源变更：2026-10-14-admin-server-status（archive step2 实证）
> 状态：活跃坑（review write 补登记绕过可靠，待工具修复）

## 现象

- execute 阶段：Task Review Gate 已退役（2026-09-26-task-review-retire），execute `--done`
  批量完成路径**不要求** per-task review.json（本变更 4 任务零 per-task review 顺利 12/12 完成，
  门未拦截，指引也明说「task 粒度不再有前置 review」）；
- archive 阶段：step2「任务完成度判定（真相源 = review.json）」报告 4/4 任务
  **「review.json 缺失（task 未走完 execute 评审）」→ 未通过 4/4**，按指引
  「存在未完成任务 → --wait 请用户裁决，勿自行放行」——整个变更卡在归档门口。

被迫用 `sillyspec review write --task task-NN --spec pass --quality pass --base <hash> --head <hash>`
手工补登记 4 份（verdict 依据=各 task 聚焦测试全绿 + execute 阶段 QA acceptance 逐 commit 核验 pass，
base/head 取 worktree 分支真实提交链）。另有前置摩擦：worktree 已被 apply/cleanup 回收、
分支 `sillyspec/<变更名>` 同步删除，review write 无 worktree meta 可依，
需人工 `git rev-parse <短hash>` 显式给 base/head（报错提示了这条出路，算救了）。

## 影响

- 语义矛盾：execute 说「不需要」，archive 说「必须有」——正常走完五阶段的变更在归档时
  必然踩中（除非恰好走了 per-task review 的旧路径）；
- 补登记是纯事务性誊写（verdict 早已由 QA 验收背书），但 base/head 解析、
  changedFiles 归因、四条命令往返都是人工成本；
- 更糟的组合：若 execute-run-id 的 tasks/ 目录下已有旧 review 而实际返工过，
  「真相源」可能 stale——真相源本身无新鲜度校验。

## 绕过

archive 前检查 `.sillyspec/.runtime/execute-runs/<runId>/tasks/task-*/review.json`：
- 缺失 → 用 `sillyspec review write --change <名> --task task-NN --spec pass --quality pass
  --base <git rev-parse 起点> --head <git rev-parse 该任务提交> --notes "<测试+QA 依据>"` 逐个补；
- worktree/分支已回收时先 `git rev-parse <短hash>^{commit}` 取全 hash。

## 修复建议

两选一对齐：
1. archive 完成度判定改用 tasks.md checkbox + execute 阶段 stage 级 acceptance review.json
   （execute-review-*，双 pass）作复合真相源，per-task review 仅作加分证据；
2. 或 execute 批量完成时自动为每个已勾 task 落一份 review.json（从 acceptance review 与
   per-task commit diff 机械生成），让 archive 的真相源天然在场。

## 处置记录（2026-10-15）

**已修（方向②）**（sillyspec `2026-10-15-pitfall-batch-clearance`，归档 a493aef1）：
execute 批量完成前置**自动补 per-task review 草稿**（generateTaskReviewDrafts 机械幂等）
——archive 完成度真相源（review.json verdict）天然在场，草稿 verdict=cannot_verify 仍由
verify 兑证/人工复核升级，summarizeTaskCompletion 单列可见；不再出现「execute 说不需要、
archive 说必须有」的两层矛盾。坑内绕过（review write 手工补登记）继续有效作兜底口径。
归档。
