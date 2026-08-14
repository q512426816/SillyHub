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
- worktree 创建/进入不依赖工作区 git 状态（dirty/未提交文件均可）：直接按 CLI 输出的路径操作，无需自行检查 git 状态；`sillyspec worktree apply` 步以命令实际输出为准（apply 会校验 dirty，按输出处理）
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
- **run-id / marker 由 CLI 自动生成注入**（review step prompt 渲染时 echo 完整目录路径 + 写 marker；撞 gate 报缺 review.json 时 gate 也 echo 完整路径 + 写 marker）。直接用 CLI 给的路径写 review.json，**勿手算 run-id（必须 `review-` 前缀）、勿手写 marker**。卡住时用 `sillyspec register-stage-review --change <名> --stage execute` 一步生成。
- 字段（`schemaVersion:1`，`reviewType=acceptance` —— 区别于 brainstorm/plan 的 `"design"`）：

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

- `docHash` = `sha256(主审查文档内容)`（hex）—— execute 主审查文档是 `design.md`，即 `reviewedFiles[0]`。CLI 会重算 sha256 比对，不符判伪造（fail-closed）；找不到主文档也 fail。**改 design.md 后须重算 docHash 再写**，可用 `sillyspec run execute --done` 触发的 prompt 注入版契约（运行时注入的 schema 表 + JSON 示例 + docHash 算法）逐字改值。
- `tier=independent` 时必须由独立 QA 子代理产出该 review.json（独立上下文，不共享实现者分析）；`tier=self`（变更 ≤3 文件）降级为当前 agent 自审。
- 该 acceptance review 同时覆盖"代码审查"视角，后续代码审查步骤仅需轻量复审。

> 运行时 CLI 会把精确 schema 表 + 完整 JSON 示例 + docHash 算法注入到该步 prompt。本段为常驻摘要；以你实际收到的注入版契约为权威逐字模板。

## 派发模式（SillyHub MCP，可选）

`execute` Wave 内的子代理默认用本机 Agent tool 执行。若消费方配置了 SillyHub MCP（`local.yaml` 的 `mcp` 段写 `mcp.url` / `mcp.token`——可由 `sillyspec platform connect` 同源写入或手填；或环境变量 `SILLYHUB_MCP_URL` / `SILLYHUB_MCP_TOKEN` 作回退），Wave 步骤 prompt 运行时可能注入一段 SillyHub 派发指令——**出现就照其中的指令执行**（创建 mission / dispatch_worker / 轮询结果 / 本机兜底），**没出现就用本机 Agent tool**。未配置 MCP 时完全不注入，行为与无此机制一致。

可选：`sillyspec dispatch probe` 查看 SillyHub 是否可用。

## 跨仓 task（一个 change 改多个仓库）

单个 change 的 task 可以分散到主仓 + 多个跨仓仓实现（典型场景：dogfood 自指、monorepo 多包仓、共享库 + 调用方联合改造）。**单仓 change 不需要任何跨仓配置**（所有 task 不写 `repo:` 即走原流程，零回归）。

### 跨仓 task 配置（plan 阶段产出，execute 阶段消费）

- **task 卡片 `repo:` 字段**：跨仓 task 在 `tasks/task-NN.md` frontmatter 写 `repo: <key>`（缺省='main'=主仓 task，不写即主仓）。
- **local.yaml `repos:` 段**：在 `.sillyspec/local.yaml` 注册跨仓仓路径（`main` 不用注册，隐式=当前项目）：
  ```yaml
  repos:
    sillyspec: C:/Users/qinyi/IdeaProjects/sillyspec
    shared-lib: ../shared-lib
  ```
  task 卡 `repo:` 引用的 key 必须在此注册，否则 execute 启动 fail-closed 阻断（跨仓 apply 走错仓=数据所有权事故，配置错误不降级）。
- **跨仓 task 的 `allowed_paths`**：指**相对跨仓仓根**的路径（非主仓根）。

### workdir 切换（execute 派发子代理时）

- **主仓 task**：子代理 workdir = 主仓 worktree 路径（CLI 自动创建的隔离 worktree）。
- **跨仓 task**：子代理 workdir = 跨仓仓根目录（**直接在跨仓仓主干工作区改+commit，不经主仓 worktree、不建分支**）。commit 到跨仓仓主干即落盘。
- 同一个 Wave 内允许混合主仓 + 跨仓 task（每个 task 独立子代理，各传各的 workdir）。Wave prompt 会注入 per-task workdir 表，按表选。

### 跨仓 task 的双锡点（CLI 写入，子代理不改）

- `base_commit`：CLI 派发跨仓 task 前实时 `git -C <跨仓仓根> rev-parse HEAD` 落盘到 task 卡 frontmatter（锁 base，防同 Wave 多 task 改同跨仓仓时 HEAD 推进致 diff 漂移）。
- `head_commit`：跨仓 task 子代理 commit 完成后、写 review.json / 勾选 checkbox **之前**，由你（主 agent）运行 `git -C <跨仓仓根> rev-parse HEAD` 把结果写入该 task 卡 frontmatter `head_commit:` 字段。
- review.json 的 `base`/`head` 取这两个锡点（非瞬时 HEAD）。

### 跨仓 task 的 review.json

- 路径仍写主仓 `.sillyspec/.runtime/execute-runs/<run-id>/tasks/task-XX/review.json`（review 统一存主仓）。
- 加 `repo: <key>` 字段标该 task 所属仓（缺省='main'）。
- `base`/`head` 是**跨仓仓的 commit**（取 task 卡锡点），CLI 据此在跨仓仓根跑 git 校验。

### 跨仓 task apply = no-op

跨仓 task 的代码由子代理直接 commit 到跨仓仓主干（commit 即落地），主仓 `worktree apply` 对跨仓 task **不打 patch、不 cleanup**——只校验 `review.head` 是跨仓仓真实 commit。主仓 task 走原 apply 路径不变。

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
