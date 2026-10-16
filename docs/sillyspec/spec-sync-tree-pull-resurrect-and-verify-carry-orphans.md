# spec-sync 文件树拉取回灌本地已删文件 + verify-result --force 携载孤儿表行

> 记录时间：2026-10-16 · 来源变更：2026-10-16-fix-auth-random-logout（plan 卡重构 + verify 收口实测）
> 状态：活跃坑（已人工清理绕过，待工具修复）

## 缺陷一：spec-sync 文件树拉取把本地已删除的旧文件回灌「复活」

现象：plan 阶段把任务卡从 7 张重构为 4 张（`task-05/06/07.md` 三个旧骨架卡已 `rm` 删除并实测
确认消失）。进入 verify 后，`verify-probes --init` 的探针 10（预填注清零 error 门）报
`tasks/task-05.md、task-06.md、task-07.md 仍含未删预填注`；决策追踪矩阵机械预填同步显示
「8 条决策 × **7** 张 task 卡」——三个已删除文件被重新物化到主仓变更目录。

根因推断：本轮 spec-sync 长时段异常（`文件树本次未同步，下次自动重试` 刷屏数十次、409/超时熔断），
本地删除未上行到平台；后续某次拉取以平台侧旧文件树覆盖回本地，把已删路径重新落盘
（与 `archived-change-resurrect-by-merge.md`（finished）的「远端 merge 复活」同族、但机制不同：
本例是**同变更目录内文件级**复活，非整变更复活）。旧卡随回归致探针 10 error 门被误触发、
矩阵预填出现幽灵卡（7 卡含 3 张不存在的卡）。

期望修复：① spec-sync 拉取对「本地墓碑（删除）」路径跳过覆盖（对齐墓碑语义）；或② 文件树
未同步积压期间给出显式警告「拉取可能复活本地删除」，并在拉取后回放本地删除集。

证据：本变更 verify 目录两次人工清理 task-05/06/07；`verify-probes --init` 输出
「决策追踪矩阵机械半边已预填：8 条决策 × 7 张 task 卡」与探针 10 三条 ❌（清理后复跑 ✅）。

## 缺陷二：verify-result `--init --force` 携载段产生孤儿表行，被 gate 误归到最后一张任务卡

现象：骨架 `--force` 重生成时，旧版骨架的「已填行」按段携载保留，但产生两条**无段头归属**的
孤儿表格行（旧模板占位「可验证的验收条件 1/2 | …」），夹在 task-04 表与探针 4 之间（工具自注
`<!-- refresh 携载的已填行（新渲染中无同键行，agent 裁决去留） -->`）。`gate verify` 档位把
这两行归到最近的 task 段（task-04），报「探针 7 矩阵含 2 行 partial/uncovered 且移交项零有效行」
——实际 task-04 两行判定均为 non-testable，属幽灵行污染。

根因推断：携载逻辑只对「同键行」替换，对孤儿行落盘原文并留裁定注释；下游 gate 的矩阵解析器
按「最后出现的 task 段头」归属无头行，无归属语义。

期望修复：① 携载孤儿行移入注释区（不参与解析）或在骨架中以显式 `(orphan)` 标记段头隔离；
② gate 矩阵解析对无头行忽略并 warning（而非归到最后 task）。

证据：本变更 verify-result.md 生成时 2 条孤儿行（`可验证的验收条件 1/2`）→ gate 报
task-04 partial/uncovered ×2；人工删除孤儿行+注释后 docs-only 门通过。

## 附：本轮同族既有记录交叉引用（不新开条目）

- spec-sync 409/超时/自回声：已有 probe-noise-and-commit-suggest-quality.md（409 刷屏）、
  platform-sync-409-local-ahead.md（finished）、platform-sync-hang-and-timeout-loses-progress.md 等覆盖。
- verify 隔离快照不可用回退主仓口径（并行 WIP 混入判定，本次 `createVerifyGateSnapshot 返回 null`
  + pnpm junction 不可靠提示）：与 verify-gate-worktree-crossrepo-three-defects.md 缺陷二同族
  （触发根因不同：本例为快照基建不可用/变更文件集为空，非 worktree overlay 叠加）——已在该文
  记录的设计项范畴内，如需细分可在彼文件追加缺陷四。
