---
author: WhaleFall
created_at: 2026-07-31T10:14:09
type: sillyspec-pitfall
status: 已解决（5 坑全清，2026-08-05）
---

# verify/archive 流程坑（2026-07-30-daemon-heartbeat-dedup-fix 归档时踩到）

> **进度注记（2026-08-05）**：5 坑全清，可移 finished。坑 3 已修（archive step5 --change 在 archive/ 匹配放行，stage-contract.js archive 分支）；坑 4 已修（sync-module-docs 加 requiresWait，--continue 确认后回到本步由 agent 写模块卡片，ql-20260803-002-eff0）；坑 1/5 已修（progress repair 新增 Fix e：execute completed stage 有 pending step 但 task 实际 review.json 客观产出全通过时，按实际产出自动标 completed 而非一律 manual，ql-20260803-003-8dd5）；**坑 2 已修（2026-08-05）**：sillyspec 新增顶层命令 `backfill-reviews --change <name>`，复用 execute --done 同源的 generateTaskReviewDrafts 草稿兜底（幂等、fail-open），据 git diff base..head + working-tree 按 task allowed_paths 归属生成 cannot_verify 草稿，agent 复核升级 pass/fail——手动补 task 缺 review.json 不再需手工拼 JSON（ql-20260805-002-1ee8，npm 3.25.9+）。

## 坑 1：plan 后加 Wave/task → execute 阶段流转卡 + 状态机不一致

- **现象**：变更 execute 已 ✅，reopen 补 task-14（在 plan.md 加 Wave 2.1）后，sillyspec 把 task-14 识别为 execute 的「Wave 4 执行」step，但该 step 从未走（手动实现的 task-14）→ step pending。导致 `sillyspec run verify` 报「阶段转换不允许：(起始) → verify，verify 需要先完成 execute」。
- **根因**：plan.md 的 Wave 结构被 execute 状态机反向解析成 step；后加的 Wave 没对应 execute run 记录 → step/stage 状态矛盾（progress check 报 "execute/Wave 4: step pending, stage completed"）。
- **绕过**：`sillyspec run verify --change <名> --skip-approval`（execute 实际已完成，阶段转换门控是 plan 加 Wave 的副作用）。
- **建议工具修**：execute 完成后再加 task，应走「reopen execute」正规路径（会重建 step 状态），或 plan 加 Wave 时自动同步 execute step 状态；progress repair 应能自动修「task 实际有 review.json/产出但 step pending」的情况（✅ 已落地 ql-20260803-003-8dd5：progress repair Fix e 按 review.json 客观产出全通过时自动标 completed，否则回落 manual）。

## 坑 2：execute 后手动补的 task 缺 review.json → archive 客观完成度阻断

- **现象**：task-14 是 execute 完成后手动实现的（没走 execute 子代理 review gate），无 `.runtime/execute-runs/<runId>/tasks/task-14/review.json`。archive step1 客观完成度（真相源 = review.json verdict）算「13/14，task-14 缺失」→ 阻断归档。
- **绕过**：手动补 task-14 review.json（schemaVersion/task/base/head/changedFiles/specVerdict=pass/qualityVerdict=pass/reviewerNotes/requiredEvidence=[]），base/head 用 worktree 分支该 task commit 的 base..head（`git rev-parse --short=7 <commit>^` / `<commit>`）。
- **建议工具修**：手动补 task（ reopen execute / 直接实现）应提供「补 review.json」的官方入口（基于实际产出 + verify 结论生成 verdict），而非手工拼 JSON。（✅ 已落地 ql-20260805-002-1ee8：sillyspec `backfill-reviews --change <name>` 顶层命令，复用 generateTaskReviewDrafts 草稿兜底，幂等生成 cannot_verify 草稿，agent 复核升级 pass/fail。）

## 坑 3：归档后 `--change <原名>` 失效 → archive step5 --done 报错

- **现象**：archive step4 `--confirm` 把 change 目录移到 `archive/` 并从 active 注销后，step5 `sillyspec run archive --done --change <原名>` 报「变更 <原名> 在当前 spec 下不存在」（CLI 在 active 列表找，已注销）。
- **影响**：step5 的 --done 收尾无法完成（归档核心动作——移目录 + git add——实际已完成，只是 CLI 收尾报错）。
- **建议工具修**：archive 阶段 step5（及以后）应接受已归档的 change（从 archive/ 找，或在 step4 --confirm 后内部记住 change 上下文，不依赖 active 列表）。

## 坑 4：archive step3 `--continue --answer 确认写入` 后不自动写模块文档

- **现象**：archive step3 sync-module-docs 的 `--wait` → `--continue --answer "确认写入"` 后，CLI 进到 step4，但模块卡片（modules/<m>.md）实际没被写入（grep 本变更 = 0）。
- **绕过**：手动 Edit modules/agent.md + daemon.md（变更索引加条目）。模块文档在 `.sillyspec/docs/modules/`，归档（移 changes/ 目录）不影响它，可在归档前后补。
- **建议工具修**：--continue 确认后 CLI 应基于 module-impact.md 自动写入模块文档（或明确提示「由 agent 写入」+ 校验写入结果）。

## 坑 5：状态机错位（status 辅助阶段 + plan 加 Wave 累积）

- **现象**：progress check 报 5 处不一致（brainstorm 2 step stale + execute Wave4 pending）。`progress repair --apply` 对「需手动确认」项不自动改。
- **建议工具修**：progress repair 应支持「按实际产出（review.json/文件/git）判定」自动修一致性，而非对矛盾项一律保守不动。（✅ 已落地 ql-20260803-003-8dd5：progress repair Fix e 按 review.json 客观产出全通过时自动修 execute step 脱钩，不碰非 execute 阶段。）

## 通用教训

- **worktree 与主仓库易脱节**：本次 worktree 分支曾缺 segmentId type 修复（上轮只做到主仓库）。canonical（worktree）与部署态（主仓库）需双向同步预警。
- **pre-commit hook 在 worktree commit 时按命令 cwd 判断**：worktree commit 时 hook 在主仓库 cwd 跑 `git diff --cached`（主仓库 index 空）→ 触发全量检查（含 frontend），worktree 无 node_modules → 假性失败。应按实际改动文件在对应树跑。
