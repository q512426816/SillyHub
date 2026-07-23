---
author: qinyi
created_at: 2026-07-23 10:37:00
type: sillyspec-tool-defect
status: active
---
# sillyspec run <stage> --done / --done --answer 完成步骤时清理产物且不重新生成

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
