---
name: sillyspec:brainstorm
description: 用于正式开始开发前的需求澄清和技术方案设计。适合用户提出新功能、新模块、架构调整、复杂改造，或说"先做需求分析、输出技术方案、创建变更前先梳理、帮我设计下"。产出结构化方案（design/proposal/requirements/tasks 四件套），但不直接写代码。
---

## 交互规范

**当需要用户从多个选项中做出选择时，必须使用 Claude Code 内置的 AskUserQuestion 工具，将选项以参数传入。** 不要用编号列表让用户手动输入数字。

## 何时使用

- 用户提出新功能、新模块、架构调整、复杂改造
- 用户说"先做需求分析、输出技术方案、创建变更前先梳理、帮我设计下"
- 产出：`design.md` + `proposal.md` + `requirements.md` + `tasks.md`（四件套），不写代码

## 多变更说明

项目有多个活跃变更（`.sillyspec/changes/` 下有多个目录）时，所有 `sillyspec run` 命令需加 `--change <变更名>` 指定操作目标；只有一个变更时可省略（CLI 自动检测）。建议变更名格式：`YYYY-MM-DD-<简短描述>`。

## 步骤生命周期（所有阶段通用）

> `sillyspec brainstorm` 是 `sillyspec run brainstorm` 的顶层别名，两者等价。

```bash
sillyspec run brainstorm                       # 输出当前步骤 prompt
sillyspec run brainstorm --done --output "摘要"     # 完成当前步骤（--input "用户原话" 记录输入）
sillyspec run brainstorm --status              # 查看阶段进度
sillyspec run brainstorm --skip                # 跳过可选步骤
sillyspec run brainstorm --reset               # 重置阶段（从头开始）
sillyspec run brainstorm --reopen --from-step N     # 重新打开已完成阶段修订（N=序号或名称）
sillyspec run brainstorm --wait --reason "..." --options "A,B"   # 暂停等用户决策
sillyspec run brainstorm --continue --answer "..."               # 恢复等待中的步骤
sillyspec run brainstorm --done --answer "..." --output "..."    # 一步完成 wait+done
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

## brainstorm 特有：requiresWait 步骤

某些步骤（如"对话式探索与需求澄清"）需要用户输入。两种方式：

> 自动去重：若前置 step 已对同一问题（waitReason 归一化后相同）确认过，后续重复 wait 会自动跳过，无需再 `--wait`。

- **方式一（推荐）**：分步——先 `--wait` 记录等待，让用户亲眼看到 CLI 打出的选项再作答，再 `--continue --answer`，最后 `--done`：
  ```bash
  sillyspec run brainstorm --wait --change <名> --reason "等待用户回答" --output "探索问题"
  sillyspec run brainstorm --continue --answer "用户回答" --change <名>
  sillyspec run brainstorm --done --change <名> --output "需求已澄清"
  ```
- **方式二**：AI 自行与用户交互后，一步完成（仅在用户已在对话中明确给出答案、无需再走 CLI 等待展示时用）：
  ```bash
  sillyspec run brainstorm --done --change <名> --answer "用户回答" --output "需求已澄清"
  ```

> ⚠️ 两种方式都要求 `--answer` 是**用户真实的回答**，不是你替用户编的回答。`requiresWait` 门只校验 `--answer` 非空，挡不住「AI 伪造用户回答」——所以对方案选择/设计确认这类关键决策，优先用方式一让用户亲手作答，而不是 AI 中继一句话带过。

## 阶段流转

```
                ┌─ scale=large → plan（四件套齐）
scan → brainstorm ┤
                └─ scale=small → quick --linked-changes（仅 design.md）
```

brainstorm 完成时按 design.md frontmatter 的 `scale` 分叉：
- **large**（多文件/跨模块/有状态机或 schema 变更）：四件套齐 + Design Grill 审查通过（tier=independent 时由独立审查子代理产出 stage review.json）→ `sillyspec run plan --change <变更名>`
- **small**（≤2 文件、单模块、无跨模块依赖）：仅生成 design.md → `sillyspec run quick --linked-changes <变更名>`

> 规模由 AI 在 brainstorm 最后一步评估并写入 design.md frontmatter。判错可手动改 `scale` 后再跑相应阶段。

### Stage Review Gate（brainstorm 末尾的 design review.json）

brainstorm 在 `tier=independent` 规模下除 design.md 等四件套外，还需产出一个 stage 级 `review.json`，CLI `Stage Review Gate` 硬校验其 schema 与 `docHash` 真实性。

- 路径：`.sillyspec/.runtime/stage-reviews/brainstorm-review-<stage-review-run-id>/review.json`（目录可能不存在需手建；run-id 由该步 `--done` prompt 输出指定）。marker 文件 `.runtime/current-stage-review-run-id-brainstorm-<变更名>`。
- 字段（`schemaVersion:1`，`reviewType=design` —— 区别于 execute 的 `acceptance`）：

  ```json
  {
    "schemaVersion": 1,
    "reviewType": "design",
    "reviewedFiles": ["changes/<变更名>/design.md"],   // [0] 为主文档
    "docHash": "<sha256(reviewedFiles[0] 文件内容，hex)>",
    "specVerdict": "pass",       // pass | fail | cannot_verify
    "qualityVerdict": "pass",    // pass | fail | cannot_verify
    "checklist": [               // 扁平数组，逐条对照 design 章节核验
      { "item": "背景与目标", "result": "pass", "note": "..." }   // result: pass | gap | fail
    ],
    "requiredEvidence": [],      // cannot_verify 时必填非空
    "reviewerNotes": "..."
  }
  ```

- `docHash` = `sha256(主审查文档内容)`（hex）—— brainstorm 主文档是 `design.md`（即 `reviewedFiles[0]`）。CLI 重算 sha256 比对，不符判伪造（fail-closed）。改 design.md 后须重算 docHash。`tier=self`（≤3 文件）降级为当前 agent 自审，不强制独立子代理。
- 运行时 CLI 会把精确 schema 表 + 完整 JSON 示例 + docHash 算法注入到该步 prompt，以你实际收到的注入版契约为权威逐字模板。

## 铁律

- **必须用 exec 工具（shell）执行 CLI，不要自己编造流程**
- 只做当前步骤 prompt 描述的操作，不跳过、不自行扩展
- 产物写入 CLI 输出的 `changeDir` 目录（如 `<changeDir>/design.md`），不要自己拼路径
- 完成后立即 `--done`，不跳过

## 用户指令
$ARGUMENTS
