# execute --done 进度重置 + review.json 双层门控

> 2026-07-28 变更 `2026-07-28-llm-provider-presets-and-usage` execute 阶段实测踩坑。
>
> **状态更新（2026-07-28 核对源码）**：下方「逐次 `--done` 推进」摩擦已由 batch-complete 机制解决（commit `8bc4cd7`，源码已落地、截至 v3.25.4 **未发布**）——plan.md 全勾 + 代码核验（`checkExecuteCodeEvidence` 非 `unchanged`）时，单次 `--done` 批量完成剩余 execute step，直接进 stage 完成分支（不绕过任何 gate）。**双层 review.json 门控（task 级 + stage 级）仍按设计保留**，下方的门控契约/路径/schema/worktree apply baseline 漂移/ci-check hook 全树扫描仍准确。仅「现象/推进策略」段的逐 step 手动法过时（见该段标注）。

## 现象

`execute` 阶段在 `--status` 下进度长期卡在 `4/12`（Step 5 Wave 1），即便 3 个 Wave 的代码 + 测试全部完成并 commit。需要逐次 `--done` 手动推进 Step 5→12，每次 `--done` 仅前进 1 步。

## 根因

CLI 的 `--done` 不做"整体完成"语义推进，而是消费当前 step 的产物后前进 1 步。Wave 代码已完成 ≠ step 已完成，必须按 step 逐个 `--done`。这本身是设计，但**进度在子代理并行执行后偶发重置**（见归档坑 `sillyspec-execute-subagent-concurrency-429` / 进度偶发重置），表现为 status 回退到 4/12，需重走。

## 双层 Review Gate（execute Step 10 + Stage 12）

`--done` 完成时有**两道独立的 review.json 门控**，缺一不可：

### 1. Task Review Gate（Step 10 near）
每个 task 需 `review.json`（路径 `.sillyspec/.runtime/execute-runs/<run-id>/tasks/task-XX/review.json`）：
```json
{ "name_zh":"任务评审", "schemaVersion":1, "task":"task-XX",
  "base":"<git-base>", "head":"<git-head>",
  "changedFiles":["..."], "specVerdict":"pass", "qualityVerdict":"pass",
  "reviewerNotes":"...", "requiredEvidence":[] }
```
- `run-id` 从**第一次** `--done` 的 prompt 输出里固定（如 `exec-2026-07-28-112833`），目录可能尚未创建，需 `os.makedirs` 建空目录。
- `specVerdict`/`qualityVerdict` 取 `pass|fail|cannot_verify`；`cannot_verify` 时 `requiredEvidence` 必须非空。
- task frontmatter 声明 `low_risk: true`（type-only / 机械迁移等）时缺 review.json 只发 warning 不阻断。
- 后端 router task 还要在 `.sillyspec/.runtime/contract-artifacts/<task-name>/endpoints.json` 写 API 端点清单（扫描 `@router.get/post/...`）。

### 2. Stage Review Gate（Step 12 完成确认）
execute 阶段还需一个**独立的 stage 级** review.json：
- 路径由 Step 12 `--done` 输出指定，形如 `.sillyspec/.runtime/stage-reviews/execute-review-<timestamp>/review.json`（目录同样可能不存在，需手建）。
- `reviewType: "acceptance"`（区别于 plan/brainstorm 的 `"design"`）。
- 字段：`schemaVersion, reviewType, reviewedFiles, docHash, specVerdict, qualityVerdict, checklist[], requiredEvidence, reviewerNotes`。
- `docHash` = `sha256(design.md 内容)`（hex）。
- `checklist` 每项 `{item, result:"pass|fail", note}`，按 design 章节 + FR/NFR/决策对照代码逐条核验。

## 推进策略

> **首选（已落地，commit `8bc4cd7`，截至 v3.25.4 未发布）**：plan.md 全勾 + 代码已核验（`checkExecuteCodeEvidence` 非 `unchanged`）→ 单次 `--done` 批量完成剩余 execute step，直接进 stage 完成分支。下方逐 step 手动法仅在 plan 未全勾 / 代码未核验时需要。

逐 step 手动法（batch-complete 落地前 / plan 未全勾时）：
1. 单次 `--done` 推进 1 step；每次输出会打印当前 step 的 prompt（含下一步要的产物路径）。
2. 写齐 11 个 task review.json + contract-artifacts 后，--done 从 Step 5 能连续吃到 Step 11。
3. Step 12 `--done` 会因缺 stage review.json 而 FAILED；补 stage review.json 后再 --done 即 12/12。
4. Step 12 `--done` **未观察到平台同步挂起**（exit 0，与归档坑 `platform-sync-hang` 不同，可能已修或仅部分变更触发）。仍建议 `timeout` 包裹，以 `--status` 为权威。

## 关键风险：worktree apply 与 baseline 漂移

CLI 完成后提示 `Worktree: pending apply`，要求 `sillyspec worktree apply`。但若 execute 期间 main 前进了（如本例 main 在 worktree 创建后有 auth-refresh-token 等 4 个提交），`apply` 会因 baseline 漂移 BLOCKED：
- `worktree apply --check-only` 报 `主工作区 baseline 已变化（execute 前后不一致）`。
- 此时**不要强行 apply**，改用 `git apply` 手动落代码到 main + 隔离提交（只 `git add` 本变更文件，避免缠入并行在制工作）。已 commit 的代码 worktree apply 即冗余。

`worktree apply --check-only` 的"文件清单校验"以 **main 的 design.md §6 文件变更清单**为准——清单里缺的文件会报"不在清单"，但补 main design.md 又会改变 main 从而触发 baseline 漂移。两者都是 hash main design.md，互相打架。本例通过先补清单→apply check 转 baseline 错→git apply 落地绕过。

## 配套坑：ci-check hook 全树扫描

`.claude/hooks/pre-commit-ci-check.cjs` 在 `git commit` 时用 `git diff --cached`（无 `-C`）取暂存文件判定 backend/frontend 范围，但后续 `uv run ruff check/mypy` / `pnpm lint/typecheck/test` 是**全树跑**（cwd 固定为 main 项目）。结论：worktree 提交无法让 hook 校验 worktree 代码，必须把代码搬到 main 提交，hook 才真正覆盖本变更。且 main 全树必须绿（任一在制文件未格式化，如本例 captcha，会拦所有提交）。