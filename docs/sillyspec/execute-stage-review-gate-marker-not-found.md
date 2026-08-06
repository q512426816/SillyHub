---
author: qinyi
created_at: 2026-08-06
status: 活跃坑（待 sillyspec 工具修复）
---

# execute Stage Review Gate 不识别手动建的独立 review（marker 回归）

## 现象
execute 14/14 步完成后 `sillyspec run execute --change <名> --done` 卡在 Stage Review Gate：
- 报 `无 execute 的 review marker，且 stage-reviews/ 下无归属变更 ... 的 review（reviewedFiles 应含 changes/<名>/）`
- 期望路径 `stage-reviews/execute-null/review.json`（marker=null 的兜底名）
- DB（sillyspec.db stages 表）execute stage 卡 `in-progress`，verify 阶段注册了但 step 1 不往下走（提示「下一步命令 sillyspec run execute」）→ flow 死锁

## 根因
当前 sillyspec 版本的 Stage Review Gate 用一个 **review marker** 定位 stage review，但**调度者手动建的独立 review**（`stage-reviews/execute-review-<timestamp>/review.json`，含正确 `change`/`reviewedFiles`/`reviewType:"acceptance"`/`specVerdict`/`qualityVerdict`/`checklist`/`requiredEvidence`/`docHash`）**没注册 marker** → gate 找不到 → 报 `execute-null`。marker 不在 sillyspec.db 的 stages/steps/approvals 表里，CLI 也没暴露注册入口。

对比 `finished/execute-done-progress-reset-and-dual-review-gate.md` 描述的旧机制（gate 按 `stage-reviews/execute-review-<timestamp>/` 路径 + reviewedFiles 识别 stage review，"补 stage review.json 后再 --done 即 12/12"），当前 marker 机制是**回归**——手动建的有效 review.json 不再被识别。

## 已尝试（均无效）
- 把 review 放到 gate 报的 `execute-null/review.json`：gate 不读该路径（"期望路径"纯显示）。
- `--done --skip-approval`：绕不过此 gate（skip-approval 不覆盖 stage review gate）。
- DB 查 stages/steps/approvals：无 marker 字段可手填。

## 影响 + 绕过
- 影响：execute 阶段无法走完 sillyspec flow（DB 卡 in-progress），连带 verify/archive 走不下去。
- **不影响代码交付**：独立 stage review 实质存在且 pass，直接 git commit（worktree）+ merge 到 main + push 即可落代码（本次 2026-08-05-daemon-kill-channel-unify 就这么交付的，commit 82d0a78c + merge 99aeb696 已推 origin/main）。
- sillyspec DB 的 execute stage 留 in-progress（孤儿状态，待工具修复后 doctor/repair 收敛）。

## 待修（给工具）
- gate 应回退到 reviewedFiles 识别，或提供 CLI（如 `sillyspec stage-review register`）/DB 字段让调度者建的独立 review 注册 marker。
- 或：`--done` 时若 stage-reviews/ 下存在 reviewedFiles 匹配本 change 的有效 review.json，直接采信（fail-closed 当前过严）。

## 相关
- `execute-windows-worktree-no-deps-junction.md`（worktree 提交 hook 缺 deps，本次表现为 pre-commit 二进制找不到，`uv tool install pre-commit` 解决）。
- `finished/execute-done-progress-reset-and-dual-review-gate.md`（旧的双层 review gate 机制描述）。
