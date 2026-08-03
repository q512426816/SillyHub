---
author: qinyi
created_at: 2026-08-02 18:30:00
---

# brainstorm 阶段两个状态/路径坑（✅ 全部已修复）

> ## ✅ 修复状态（2026-08-02）
> - **坑1**（--done --answer 不清 WAITING）：✅ 已修复 — sillyspec commit `7edf1df`（ql-20260802-005）。completeStep 新增 `resolveWaitingStepWithAnswer`：doneAnswer + waiting 步骤时把首个 waiting 拉回 pending+补 waitAnswer，主流程门控见 waitAnswer 已置→不阻断→completed。回归测试 `test/wait-done-answer-resolves-waiting.test.mjs` 28 断言。
> - **坑2**（review.json 路径 prompt≠gate）：✅ 早已修复 — sillyspec commit `d20fc63`（2026-07-28，绑定 reviewRunId marker，prompt 注入 ID == gate 读取 ID）。本文档写下时（08-02 18:30）本地源码已修，报告者当时跑的是旧版全局发布版。
> - **坑3/附**（tier self/independent 提示不准）：✅ 已修复 — sillyspec commit `7edf1df`。`renderReviewJsonContract` tier=self 分支改非承诺式：注明基于此刻 design.md 快照、gate 以 --done 时刻重判、design 扩大升级 independent、以 gate 实际校验为准（不再硬承诺「无需产出」）。
>
> 下方为原始记录（保留作历史/复现参考）。

## 坑 1：--done --answer 在 requiresWait 步骤不清 WAITING 标记
- **复现**：step5（分段展示设计，requiresWait）先 `--wait` 暂停，再用 `--done --answer "确认"` 一步完成。CLI 输出"✅ Step X 完成"并推进后续 step 的 prompt（step6/7/8 都正常给 prompt），但 sillyspec.db 里 step5 的 WAITING 标记残留。最后 step8 `--done` 触发阶段完成校验时报"⏸️ Step 5 等待用户输入"，brainstorm 无法 finish。
- **根因**：`--done --answer` 在 wait 步骤上"借过"了 prompt 推进，但没走 wait 清除逻辑。step4 时 CLI 有警告"自动补全 wait 状态"且确实补了，step5 却没补全（行为不一致）。
- **绕过**：requiresWait 步骤严格三步走 `--wait` → `--continue --answer "<回答>"` → `--done`，不要图省事用 `--done --answer` 一步。若已残留 WAITING，用 `sillyspec run brainstorm --continue --answer "<回答>" --change <名>` 清除后再 `--done`。
- **发生**：2026-08-02-agent-profile-layer 变更 step5。

## 坑 2：stage review.json 路径，prompt 写法与 CLI 校验不一致
- **复现**：brainstorm step7（Design Grill）prompt 注入的 review.json 契约写路径 `stage-reviews/brainstorm-review-<stage-review-run-id>/review.json`（**含 "review-"**），但 CLI Stage Review Gate 实际校验路径 `stage-reviews/brainstorm-<run-id>/review.json`（**不含 "review-"**）。按 prompt 建目录会 FAILED（"缺少 stage review.json"）。
- **绕过**：以 CLI 错误信息里的"期望路径"为准（`brainstorm-<run-id>`），不要信 prompt 文本的 `brainstorm-review-<run-id>`。
- **发生**：2026-08-02-agent-profile-layer，run-id=2026-08-02-181007。

## 附：tier 判定 self/independent 的提示也不准
- step7 prompt 注入占位符写"tier=self（变更文件 0≤3），无需 review.json"，但本变更（文件 >3）实际判 tier=independent，Stage Review Gate 硬要求 review.json。以 Stage Review Gate 实际报错为准（FAILED 即 independent 需补 review.json）。
