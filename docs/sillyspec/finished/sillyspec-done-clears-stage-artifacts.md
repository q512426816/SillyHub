---
author: qinyi
created_at: 2026-07-23 10:37:00
type: sillyspec-tool-defect
status: resolved（源码不复现，疑似误归因，详见下方核实结论）
---
# sillyspec run <stage> --done / --done --answer 完成步骤时清理产物且不重新生成（已归档：源码不复现）

> **核实结论（2026-07-23，sillyspec 3.24.3 源码实证，只读 agent + git log -S 全量排查）**：本报告描述的 bug 在当前源码中**不存在 / 不复现**，归档。
> - 整个 src/ 目录 grep "git rm" / gitRm → 0 命中；git log -S "git rm" -- src/run.js 历史也为空 —— run.js 从未有过 git rm 级清理产物逻辑。
> - completeStep（run.js:2806）/ --done 分支（run.js:1855）/ --done --answer（doneAnswer 参数）/ continueStep（run.js:2480）四条路径均无任何"删除该 step 关联产物"代码；--continue --answer 与 --done --answer 在清理/生成上无差异（因为两者都没有清理动作）。
> - run.js 全部 rmSync/unlinkSync 仅 4 处（清旧版残留、quick 会话目录、scan 平台临时文件），均不碰 changes/名/ 下的 design.md / proposal.md / requirements.md / tasks.md。
> - 校验失败 rollbackStageCompletion（run.js:2794）只回滚内存进度态（step → pending）让 agent 重做重生成，无文件删除，不存在"只清不生 → 死循环"。
>
> **疑似误归因**：报告观察到的"产物消失"更可能是 (a) agent 在 step8 因 scale 判定/skip 未生成产物，或 (b) 被外部 git 操作清掉 —— 非 CLI 删除。报告给的 progress complete-stage --force 绕过针对本 bug 不再必要（且若产物真缺失，complete-stage --force 只改 db 不校验，反会埋 db/磁盘分裂雷，慎用）。

## 现象
变更 `2026-07-23-milestone-mobile` brainstorm step 8「用户确认并生成规范文件」：
- `sillyspec run brainstorm`（无 --done，恢复执行）→ 删了 step 6 产出的 `design.md`
- `sillyspec run brainstorm --done --answer "确认"`（一步完成 wait+done）→ `git rm` 清掉 step 8 产物 `proposal.md`/`requirements.md`/`tasks.md`（工作区 + 暂存区一起清），且不重新生成 → 阶段校验报「产物缺失」、进度回滚 step 8 未完成 → 死循环（再跑又清）。

## 根因（待工具修复）
完成「带生成产物动作」的 step 时，清理逻辑删除该 step 关联的旧产物，但生成步骤在 `--done` / `--answer` 路径被跳过/失败，导致**只清不生**，校验必然失败。`git rm` 级清理连暂存区一起清，`git restore` 无法恢复（暂存区 blob 也没了）。

## 绕过（已验证 2026-07-23）
用 `sillyspec progress` 轻量命令直接标记阶段完成（只改进度库 `sillyspec.db`，不碰文件、不走 stage 清理逻辑；help 明说 progress「轻量，不强制顺序」）：
```bash
# 1. 先只读确认产物齐全、阶段可完成
sillyspec gate brainstorm --change <变更名> --json   # ok:true 即可
# 2. 轻量标记完成
sillyspec progress complete-stage brainstorm --change <变更名> --force
```
完成后 `progress show` 显示阶段 ✅ 且该阶段所有 step ✅，产物文件原样保留。
注意：`complete-stage`「不自动推进，下一步由你决定」，需手动 `run plan` 进下一阶段。

## 复现
```bash
# 产物齐全时跑（必现清理）
sillyspec run brainstorm --done --answer "确认" --change 2026-07-23-milestone-mobile
# → proposal/requirements/tasks 被删，校验失败，进度回滚
```

## 关联
- `finished/quick-guard-missing-output-lost.md`：`--done` 兜底分支不落盘，同类 `--done` 路径缺陷。
- help 里 `--continue --answer` 是「恢复等待中步骤」的正路，`--done --answer` 是合并一步——后者疑似触发清理。

## 教训
- brainstorm / plan 等 stage 的 `--done` 在产物已手动生成时不可靠，优先 `progress complete-stage --force`。
- 规范文件生成后立即 `git add`（虽会被 `git rm` 清暂存，但至少留过快照）；真正保险是内容备份（对话上下文 / 外部）。
