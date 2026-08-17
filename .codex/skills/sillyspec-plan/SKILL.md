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
| `--skip-approval` | 跳过阶段转换/审批检查（不能跳产物校验 gate——review.json/文档产物硬校验仍在） |

## plan 特有

### 动态步骤

plan 的步骤是动态的：`generate_plan`（生成分级计划）→ `review_plan`（审查计划，按规模分级：tier=self 当前 agent 自审 / tier=independent 启动独立审查子代理产出 stage review.json，避免生成+自审同一次输出的偏差）→ CLI 从 `plan.md` 解析出 task 自动插入"任务蓝图协调器"步骤（per-task）。这是正常行为，不要手动添加。

### Stage Review Gate（plan 的 design review.json）

`review_plan` 步骤在 `tier=independent` 时产出一个 stage 级 `review.json`，CLI `Stage Review Gate` 硬校验其 schema 与 `docHash` 真实性。

- 路径：`.sillyspec/.runtime/stage-reviews/plan-review-<stage-review-run-id>/review.json`（目录可能不存在需手建；run-id 由该步 `--done` prompt 输出指定）。marker 文件 `.runtime/current-stage-review-run-id-plan-<变更名>`。
- **run-id / marker 由 CLI 自动生成注入**（review step prompt 渲染时 echo 完整目录路径 + 写 marker；撞 gate 报缺 review.json 时 gate 也 echo 完整路径 + 写 marker）。直接用 CLI 给的路径写 review.json，**勿手算 run-id（必须 `review-` 前缀）、勿手写 marker**。卡住时用 `sillyspec register-stage-review --change <名> --stage plan` 一步生成。
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

## 跨仓 task 卡片协议（一个 change 改多个仓库）

单个 change 的 task 可以分散到主仓 + 多个跨仓仓实现（典型场景：dogfood 自指、monorepo 多包仓、共享库 + 调用方联合改造）。**单仓 change 不需要任何跨仓配置**（所有 task 不写 `repo:` 即走原流程，零回归）。

### 跨仓 task 卡片字段

在 `tasks/task-NN.md` frontmatter 加：

- `repo: <key>`（可选，缺省='main'=主仓 task）：task 所属仓的 key。key 必须在 `.sillyspec/local.yaml` `repos:` 段注册（`main` 隐式=主仓不用注册）。跨仓 change 缺注册 → execute 启动 fail-closed 阻断。
- `allowed_paths`：跨仓 task 时指**相对跨仓仓根**的路径（非主仓根）。例如跨仓 task 改 `sillyspec` 仓的 `src/foo.js`，allowed_paths 写 `src/foo.js`（相对 sillyspec 仓根），不是 `../sillyspec/src/foo.js`。
- `base_commit` / `head_commit`：**不要手写**——CLI 在 execute 派发/回收时自动落盘双锡点（锁 base/head 防 diff 漂移），plan 阶段不写。

### local.yaml `repos:` 段（跨仓注册表）

跨仓 change 必须在 `.sillyspec/local.yaml` 注册所有跨仓仓路径：

```yaml
repos:
  shared-lib: ../shared-lib
  tool-repo: C:/path/to/your/tool-repo
```

key = task 卡 `repo:` 引用名，value = 跨仓仓绝对路径（或相对主仓根的路径）。`main` 不用注册。

### design.md 文件变更清单按仓分段

跨仓 change 的 `## 文件变更清单` 段须按仓分段，段头格式 `## <repo> 仓变更`（主仓段头可省略或写 `## main 仓变更`）：

```markdown
## 文件变更清单

### sillyspec 仓变更
| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | src/task-review.js | 跨仓 task 改的文件 |

### main 仓变更
| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | src/index.js | 主仓 task 改的文件 |
```

plan 完成校验会按仓分段对账：跨仓仓路径相对跨仓仓根校验 task allowed_paths 覆盖，主仓路径相对主仓根校验。跨仓 task 与主仓 task 同名物理路径分属不同 repo 不判冲突。

### Wave 划分

同 Wave 内允许混合主仓 + 跨仓 task（execute 按 per-task workdir 派发，不强制同 Wave 同 repo）。共享文件的 task 仍须分到不同 Wave（同 Wave 共享文件会被强制并行，子代理互相覆盖）。

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
