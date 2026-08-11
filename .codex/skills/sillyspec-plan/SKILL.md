---
name: sillyspec:plan
description: 用于把 design 拆解为可执行的实现计划。适合用户说"拆任务、做计划、排 wave、规划实现步骤"。产出 plan.md（Wave 分组 + Task 列表 + 依赖关系）。
---

## 何时使用

- 用户说"拆任务、做计划、排 wave、规划实现步骤"
- 把 brainstorm 的 design.md 拆成可执行的 Wave + Task
- 产出：`plan.md`（Wave 分组 + Task 列表 + 依赖关系），可能含 `tasks/task-NN.md` 任务蓝图

## 多变更说明

项目有多个活跃变更（`.sillyspec/changes/` 下有多个目录）时，所有 `sillyspec run` 命令需加 `--change <变更名>` 指定操作目标；只有一个变更时可省略（CLI 自动检测）。

## 步骤生命周期（所有阶段通用）

> `sillyspec plan` 是 `sillyspec run plan` 的顶层别名，两者等价。

```bash
sillyspec run plan                             # 输出当前步骤 prompt
sillyspec run plan --done --output "摘要"      # 完成当前步骤（--input "用户原话" 记录输入）
sillyspec run plan --status                    # 查看阶段进度
sillyspec run plan --skip                      # 跳过可选步骤
sillyspec run plan --reset                     # 重置阶段（从头开始）
sillyspec run plan --reopen --from-step N      # 重新打开已完成阶段修订（N=序号或名称）
sillyspec run plan --wait --reason "..." --options "A,B"   # 暂停等用户决策
sillyspec run plan --continue --answer "..."               # 恢复等待中的步骤
sillyspec run plan --done --answer "..." --output "..."    # 一步完成 wait+done
```

## 通用参数（所有阶段适用）

| 参数 | 说明 |
|---|---|
| `--change <名>` | 指定变更名（多活跃变更必填，单变更可省略自动检测） |
| `--spec-dir <path>` | 指定规范目录（默认 `<项目>/.sillyspec`） |
| `--non-interactive` | CI/脚本下禁用交互式 prompt |
| `--interactive` | 强制交互（即便 stdin 非 TTY） |
| `--skip-approval` | 跳过审批/校验门控（需明确意图） |
| `--json` | 输出 JSON（程序化读取） |

## plan 特有

### 动态步骤

plan 的步骤是动态的：`generate_plan`（生成分级计划）→ `review_plan`（审查计划，按规模分级：tier=self 当前 agent 自审 / tier=independent 启动独立审查子代理产出 stage review.json，避免生成+自审同一次输出的偏差）→ CLI 从 `plan.md` 解析出 task 自动插入"任务蓝图协调器"步骤（per-task）。这是正常行为，不要手动添加。

### Stage Review Gate（plan 的 design review.json）

`review_plan` 步骤在 `tier=independent` 时产出一个 stage 级 `review.json`，CLI `Stage Review Gate` 硬校验其 schema 与 `docHash` 真实性。

- 路径：`.sillyspec/.runtime/stage-reviews/plan-review-<stage-review-run-id>/review.json`（目录可能不存在需手建；run-id 由该步 `--done` prompt 输出指定）。marker 文件 `.runtime/current-stage-review-run-id-plan-<变更名>`。
- 字段（`schemaVersion:1`，`reviewType=plan` —— plan 阶段主审查文档是 `plan.md`；execute 阶段才是 `acceptance`）：

  ```json
  {
    "schemaVersion": 1,
    "reviewType": "plan",
    "reviewedFiles": ["changes/<变更名>/plan.md"],   // [0] 为主文档
    "docHash": "<sha256(reviewedFiles[0] 文件内容，hex)>",
    "specVerdict": "pass",       // pass | fail | cannot_verify
    "qualityVerdict": "pass",    // pass | fail | cannot_verify
    "checklist": [               // 扁平数组，逐条对照 plan 章节/Wave 结构/task 完整性核验
      { "item": "Wave 分级合理", "result": "pass", "note": "..." }   // result: pass | gap | fail
    ],
    "requiredEvidence": [],      // cannot_verify 时必填非空
    "reviewerNotes": "..."
  }
  ```

- `docHash` = `sha256(主审查文档内容)`（hex）—— plan 主文档是 `plan.md`（`reviewedFiles[0]`）。CLI 重算 sha256 比对，不符判伪造（fail-closed）。改 plan.md 后须重算 docHash。`tier=self`（≤3 文件）降级为当前 agent 自审。
- 运行时 CLI 会把精确 schema 表 + 完整 JSON 示例 + docHash 算法注入到该步 prompt，以你实际收到的注入版契约为权威逐字模板。

### 契约门控（阻断完成）

- **plan 启动前**：CLI 校验 `design.md` 是否满足 plan 契约（缺文件变更清单/风险登记/自审章节会阻断）。若失败需先 `sillyspec run brainstorm --reopen --from-step N` 修订设计。
- **plan 完成时**：CLI 校验 `plan.md` 是否满足 execute 契约（Wave 结构、task 引用等）。失败会阻断完成，提示修复后重新 `--done`。

### 生产接线路径检查

plan 完成校验会检查：design 提到入口文件（cli.ts/main.ts/server.ts 等）但 task 的 allowed_paths 不含该文件 → 报 error。若确实不需要改入口，在 design.md 明示理由。

## 阶段流转

```
brainstorm → plan → execute
```

plan 完成后（plan.md 通过 execute 契约校验），运行 `sillyspec run execute --change <变更名>` 开始实现。

## 铁律

- **必须用 exec 工具（shell）执行 CLI，不要自己编造流程**
- 只做当前步骤 prompt 描述的操作，不跳过、不自行扩展
- plan.md 是任务完成的唯一真相源，task 拆解粒度要均匀、依赖要明确
- 完成后立即 `--done`，不跳过

## 用户指令
$ARGUMENTS
