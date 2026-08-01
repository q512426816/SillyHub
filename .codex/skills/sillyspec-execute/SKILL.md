---
name: sillyspec:execute
description: 用于按 plan 执行代码实现。适合用户说"开始写代码、执行任务、跑 execute、开干"。按 plan.md 中的 Wave 和 Task 逐步实现，遵循 design.md 和模块文档。
---

## 何时使用

- 用户说"开始写代码、执行任务、跑 execute、开干"
- 按 plan.md 的 Wave 分组和 Task 逐步实现代码
- 遵循 design.md + 模块文档 + CONVENTIONS.md

## 多变更说明

项目有多个活跃变更（`.sillyspec/changes/` 下有多个目录）时，所有 `sillyspec run` 命令需加 `--change <变更名>` 指定操作目标；只有一个变更时可省略（CLI 自动检测）。

## 步骤生命周期（所有阶段通用）

> `sillyspec execute` 是 `sillyspec run execute` 的顶层别名，两者等价。

```bash
sillyspec run execute                          # 输出当前步骤 prompt（首次自动创建 worktree）
sillyspec run execute --done --output "摘要"   # 完成当前步骤（--input "用户原话" 记录输入）
sillyspec run execute --status                 # 查看阶段进度
sillyspec run execute --skip                   # 跳过可选步骤
sillyspec run execute --reset                  # 重置阶段（从头开始）
sillyspec run execute --reopen --from-step N   # 重新打开已完成阶段修订（N=序号或名称）
```

## 通用参数（所有阶段适用）

| 参数 | 说明 |
|---|---|
| `--change <名>` | 指定变更名（多活跃变更必填，单变更可省略自动检测） |
| `--spec-dir <path>` | 指定规范目录（默认 `<项目>/.sillyspec`） |
| `--non-interactive` | CI/脚本下禁用交互式 prompt |
| `--skip-approval` | 跳过审批/校验门控（需明确意图） |
| `--json` | 输出 JSON（程序化读取） |

## execute 特有：Worktree 隔离

- CLI 启动 execute 阶段时**自动创建 git worktree**，AI 不需要手动创建
- worktree 路径在步骤 prompt 中输出（`worktreePath`），后续子代理的 cwd 必须设为该路径
- **禁止跳过 worktree 或在主仓库直接写代码**
- worktree 创建失败时 CLI 报错退出，排查后重试
- dirty 状态/未提交文件**不影响** worktree 创建和进入，直接按 CLI 输出的路径操作，不要自行检查 git 状态
- create 时若检测到 base 落后/分叉 `origin/<默认分支>`，CLI 会醒目报告（⚠️「落后 N 个 commit」+ 对齐命令），**不阻断** execute。看到此报告时评估是否提示用户先对齐 main，但**不要自行 fetch/ff**——对齐是用户/主仓库的显式动作

### 依赖门控（depsStatus）

`--done` 时 CLI 校验 worktree 的依赖状态（`depsStatus`）。不达标会阻断完成并提示：

```bash
# 修复依赖供给
sillyspec worktree doctor --fix --change <变更名>
```

`linked / installed / n/a` 放行；`missing / stale / failed / unknown` 阻断。Wave 内所有 task 声明 `no_deps_verify: true` 时可 opt-out。

### Task Review Gate

execute 完成时，每个 task 必须有 `review.json` 且 verdict 通过，否则阻断完成。**例外**：task 在 `tasks/task-XX.md` frontmatter 声明 `low_risk: true`（type-only / 机械迁移等低逻辑风险）时，缺 review.json 只发 warning 不阻断。`cannot_verify` 的 task 会写入 `verify-required-evidence.json`，由 verify 阶段消费。

#### task 级 review.json 契约（CLI 硬校验）

- 路径：`.sillyspec/.runtime/execute-runs/<execute-run-id>/tasks/task-XX/review.json`（目录不存在需先建）。
- `execute-run-id` 取自**第一次** `--done` prompt 输出（形如 `exec-2026-07-28-112833`），也写在 marker 文件 `.runtime/current-execute-run-id-<变更名>`。多个 run 时 gate 读最新 marker。
- 字段（`schemaVersion:1`）：

  ```json
  {
    "schemaVersion": 1,
    "task": "task-01",
    "base": "<git-base-commit-hash>",
    "head": "<git-head-commit-hash>",
    "changedFiles": ["src/..."],
    "specVerdict": "pass",        // pass | fail | cannot_verify
    "qualityVerdict": "pass",     // pass | fail | cannot_verify
    "reviewerNotes": "...",
    "requiredEvidence": []        // cannot_verify 时必须非空
  }
  ```

- `base` / `head` 必须是**真实 git commit**（`git rev-parse --verify`），否则判伪造并阻断。`changedFiles` 与实际 `git diff base..head` 完全不相交也判伪造。base..head 空 commit diff 但 working-tree 有未提交改动 → 视为有效改动（warning 不阻断）。
- 后端 router task 另需在 `.sillyspec/.runtime/contract-artifacts/<task-name>/endpoints.json` 写 API 端点清单（扫 `@router.get/post/...`）。

### Stage Review Gate（execute 末尾的 acceptance review.json）

execute 还有**第二道**独立的 stage 级审查：除逐 task review.json 外，整个 execute 阶段完成还需一个 stage 级 `review.json`（在 "完成确认"/acceptance 步骤产出）。CLI `Stage Review Gate` 硬校验其 schema 与 `docHash` 真实性。

- 路径：`.sillyspec/.runtime/stage-reviews/execute-review-<stage-review-run-id>/review.json`（目录可能不存在需手建；run-id 由该步 `--done` prompt 输出指定）。marker 文件 `.runtime/current-stage-review-run-id-execute-<变更名>`。
- 字段（`schemaVersion:1`，`reviewType=acceptance` —— 区别于 brainstorm/plan/propose 的 `"design"`）：

  ```json
  {
    "schemaVersion": 1,
    "reviewType": "acceptance",
    "reviewedFiles": ["changes/<变更名>/design.md", "<可选追加 git diff 涉及的源码>"],
    "docHash": "<sha256(reviewedFiles[0] 文件内容，hex)>",
    "specVerdict": "pass",       // pass | fail | cannot_verify
    "qualityVerdict": "pass",    // pass | fail | cannot_verify
    "checklist": [               // 扁平数组（非按层嵌套！），逐条对照 design 章节 + FR/NFR/决策核验代码
      { "item": "FR-01 排序", "result": "pass", "note": "..." }   // result: pass | gap | fail
    ],
    "requiredEvidence": [],      // cannot_verify 时必填非空
    "reviewerNotes": "..."
  }
  ```

- `docHash` = `sha256(主审查文档内容)`（hex）—— execute 主审查文档是 `design.md`，即 `reviewedFiles[0]`。CLI 会重算 sha256 比对，不符判伪造（fail-closed）；找不到主文档也 fail。**改 design.md 后须重算 docHash 再写**，可用 `sillyspec run execute --done` 触发的 prompt 注入版契约（`{REVIEW_JSON_CONTRACT}`）逐字改值。
- `tier=independent` 时必须由独立 QA 子代理产出该 review.json（独立上下文，不共享实现者分析）；`tier=self`（变更 ≤3 文件）降级为当前 agent 自审。
- 该 acceptance review 同时覆盖"代码审查"视角，后续代码审查步骤仅需轻量复审。

> 运行时 CLI 会把精确 schema 表 + 完整 JSON 示例 + docHash 算法通过 `{REVIEW_JSON_CONTRACT}` 占位符注入到该步 prompt（源码 `src/stage-review.js: renderReviewJsonContract()`）。本段为常驻摘要；以运行时注入的契约为权威逐字模板。

## worktree 子命令（execute 相关）

```bash
sillyspec worktree apply <变更名>              # 校验并应用 worktree 变更到主工作区
sillyspec worktree apply <变更名> --check-only # 只检查不应用
sillyspec worktree assess <变更名>             # 风险审计 + 自动 apply
sillyspec worktree list                        # 列出所有活跃 worktree
sillyspec worktree meta <变更名>               # 读取 worktree meta.json
sillyspec worktree cleanup <变更名>            # 清理 worktree
sillyspec worktree doctor [--fix]              # 健康检查 + 修复
```

## 阶段流转

```
plan → execute → verify
```

execute 完成后（所有 Wave/task 完成 + Task Review Gate 通过），运行 `sillyspec run verify --change <变更名>` 验证。

### 批量完成（一次 --done 收尾）

当 `plan.md` 所有 task checkbox 已勾（人工勾或基于各 task `review.json` pass 由 CLI 自动勾）且代码客观核验通过（`checkExecuteCodeEvidence` 非"零变更"）时，任一 execute `--done` 会**一次性补完所有剩余 step** 直达阶段完成，不必逐次 +1 推进。日志会打印 `🚀 execute 批量完成：plan 全勾 + 代码核验通过，一次性补完 N 个剩余 step`。条件不满足（plan 未全勾 / 代码零变更）时仍按单步推进，要求补 review 后重跑 `--done` 直至满足。

## 铁律

- **必须用 exec 工具（shell）执行 CLI，不要自己编造流程**
- 你是执行者不是设计师——按 plan 搬砖，发现 plan 不合理就停下来反馈，不自己改方案
- 子代理 cwd 必须用 CLI 输出的 worktreePath
- 完成后立即 `--done`，不跳过

## 用户指令
$ARGUMENTS
